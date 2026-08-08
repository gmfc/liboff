/**
 * The scan flow, end to end.
 *
 * The camera is replaced with a canvas that paints a real EAN-13 symbol and is
 * captured as a MediaStream. Everything downstream of `getUserMedia` is the
 * production code: the frame loop, the crop, the wasm decoder, the two-reads
 * confirmation, the ISBN lookup and the add-to-library panel.
 *
 * This is deterministic where Chromium's own fake capture device is not, and
 * it also lets the barcode be chosen per test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { goToTab, launchBrowser, loadPlaywright, openApp, startServer, SKIP_REASON } from './harness.mjs';
import { encodeEan13 } from './ean13.mjs';

const playwright = loadPlaywright();

/**
 * Replaces getUserMedia with a canvas stream showing the given barcode.
 * Runs before any of the app's own scripts.
 */
function fakeCamera({ modules }) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  const moduleWidth = 4;
  const quiet = 10;
  const barcodeWidth = (modules.length + quiet * 2) * moduleWidth;
  const barcodeHeight = 120;
  const left = Math.round((canvas.width - barcodeWidth) / 2);
  const top = Math.round((canvas.height - barcodeHeight) / 2);

  function paint() {
    ctx.fillStyle = '#d8d2c8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(left, top, barcodeWidth, barcodeHeight);
    ctx.fillStyle = '#000';
    modules.forEach((bit, index) => {
      if (bit) {
        ctx.fillRect(left + (index + quiet) * moduleWidth, top, moduleWidth, barcodeHeight);
      }
    });
    requestAnimationFrame(paint);
  }
  paint();

  const stream = canvas.captureStream(15);
  window.__fakeStream = stream;
  navigator.mediaDevices.getUserMedia = async () => stream;
}

/** A canned Open Library reply, so the flow does not depend on the network. */
async function stubLookup(page, isbn, data) {
  await page.route('**/openlibrary.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ [`ISBN:${isbn}`]: data }),
    });
  });
  // Google Books is the fallback; it must never be reached for these cases.
  await page.route('**/googleapis.com/**', (route) => route.abort());
}

async function openWithCamera(browser, origin, code, contextOptions = {}) {
  const { modules } = encodeEan13(code);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['camera'],
    ...contextOptions,
  });
  await context.addInitScript(fakeCamera, { modules });
  const page = await context.newPage();
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.tabbar');
  return { context, page };
}

test('scan flow', { skip: playwright ? false : SKIP_REASON }, async (t) => {
  const server = await startServer();
  const browser = await launchBrowser(playwright);

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('scanning a book looks it up and adds it to the library', async () => {
    const isbn = '9780140328721';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await stubLookup(page, isbn, {
      title: 'Fantastic Mr. Fox',
      authors: [{ name: 'Roald Dahl' }],
      publishers: [{ name: 'Puffin' }],
      publish_date: 'October 1, 1988',
      number_of_pages: 96,
    });

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');

    await page.waitForSelector('[data-testid=scan-result]', { timeout: 30000 });
    assert.match(await page.textContent('.result-card__flag'), /Found via Open Library/);
    assert.match(await page.textContent('.row-card__title'), /Fantastic Mr\. Fox/);

    // By attribute, not by text: ":has-text('Read')" also matches "Reading".
    await page.click('.segmented__item[data-shelf=read]');
    await page.click('.star-btn[aria-label="5 stars"]');
    await page.click('[data-testid=confirm-add]');

    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.title, 'Fantastic Mr. Fox');
    assert.deepEqual(book.authors, ['Roald Dahl']);
    assert.equal(book.isbn, isbn);
    assert.equal(book.year, 1988);
    assert.equal(book.pages, 96);
    assert.equal(book.shelf, 'read');
    assert.equal(book.rating, 5);
    await context.close();
  });

  await t.test('the scanner keeps running so a shelf can be worked through', async () => {
    const isbn = '9780140328721';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await stubLookup(page, isbn, { title: 'Fantastic Mr. Fox', authors: [{ name: 'Roald Dahl' }] });

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=scan-result]', { timeout: 30000 });
    await page.click('[data-testid=confirm-add]');

    // Same book still in frame: it is recognised as one already held rather
    // than silently added twice.
    await page.waitForSelector('.result-card__flag:has-text("Already in your library")', {
      timeout: 30000,
    });
    const count = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books.length;
    });
    assert.equal(count, 1);
    await context.close();
  });

  await t.test('a book the catalogue does not know still gets added by hand', async () => {
    const isbn = '9791234567896';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await page.route('**/openlibrary.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await page.route('**/googleapis.com/**', (route) => route.abort());

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=candidate-title]', { timeout: 30000 });

    assert.match(await page.textContent('.result-card__isbn'), /9 791234 567896/);
    await page.fill('[data-testid=candidate-title]', 'A Book Nobody Catalogued');
    await page.click('[data-testid=confirm-add]');

    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.title, 'A Book Nobody Catalogued');
    assert.equal(book.isbn, isbn);
    await context.close();
  });

  await t.test('stopping the scanner releases the camera', async () => {
    const { context, page } = await openWithCamera(browser, server.origin, '9780140328721');
    await page.route('**/openlibrary.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForFunction(() => document.querySelector('.scanner__video')?.videoWidth > 0, null, {
      timeout: 20000,
    });

    await page.click('button[aria-label="Stop camera"]');
    await page.waitForSelector('[data-testid=start-scan]');
    const states = await page.evaluate(() =>
      window.__fakeStream.getVideoTracks().map((track) => track.readyState),
    );
    assert.deepEqual(states, ['ended'], 'the camera must be released when the scanner stops');
    await context.close();
  });

  await t.test('navigating away from the scan tab shuts the camera down', async () => {
    const { context, page } = await openWithCamera(browser, server.origin, '9780140328721');
    await page.route('**/openlibrary.org/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForFunction(() => document.querySelector('.scanner__video')?.videoWidth > 0, null, {
      timeout: 20000,
    });

    await goToTab(page, 'library');
    await page.waitForFunction(
      () => window.__fakeStream.getVideoTracks().every((track) => track.readyState === 'ended'),
      null,
      { timeout: 5000 },
    );
    await context.close();
  });

  await t.test('a decoder that will not load surfaces the error and still frees the camera', async () => {
    // Service workers are blocked for this one: page.route does not intercept
    // requests the worker itself makes, so once it had claimed the page the
    // abort below was bypassed and the decoder loaded anyway — a race decided
    // by whether claiming won, which is not what this test is about.
    const { context, page } = await openWithCamera(browser, server.origin, '9780140328721', {
      serviceWorkers: 'block',
    });
    await page.route('**/vendor/zbar-wasm/**', (route) => route.abort());

    const outcome = await page.evaluate(async () => {
      const { startScanner } = await import('/src/scanner/camera.js');
      const video = document.createElement('video');
      document.body.appendChild(video);
      try {
        await startScanner(video, { onResult: () => {} });
        return { threw: false };
      } catch (error) {
        // A ReferenceError here would mean the cleanup path itself broke and
        // buried the real reason the scanner could not start.
        return { threw: true, name: error.name, detached: video.srcObject === null };
      }
    });

    assert.equal(outcome.threw, true, 'a broken decoder must reject, not hang');
    assert.notEqual(outcome.name, 'ReferenceError', 'the cleanup path masked the real error');
    assert.equal(outcome.detached, true, 'the stream was released');
    await context.close();
  });
});
