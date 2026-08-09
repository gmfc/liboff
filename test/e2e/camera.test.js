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

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Canned catalogue replies, so the flow does not depend on the network.
 *
 * All three are stubbed on every test: the lookup asks Open Library and Google
 * Books together and falls through to Crossref, so leaving one unstubbed would
 * put a real request in the middle of a browser test.
 */
// Matched by regular expression, not by glob. Playwright's `**` still needs a
// literal `/` before what follows it, so `**/googleapis.com/**` never matched
// `https://www.googleapis.com/...` — the stub silently did nothing and the
// tests reached the real API.
const OPEN_LIBRARY_URL = /\/\/openlibrary\.org\//;
const GOOGLE_BOOKS_URL = /googleapis\.com\//;
const CROSSREF_URL = /crossref\.org\//;
const BRASIL_API_URL = /brasilapi\.com\.br\//;

async function stubCatalogues(
  page,
  {
    openLibrary = {},
    google = { totalItems: 0 },
    crossref = { message: { items: [] } },
    brasilApi = null,
  } = {},
) {
  await page.route(OPEN_LIBRARY_URL, (route) => json(route, openLibrary));
  await page.route(GOOGLE_BOOKS_URL, (route) => json(route, google));
  await page.route(CROSSREF_URL, (route) => json(route, crossref));
  // 404 is what the agency says about a number it never registered.
  await page.route(BRASIL_API_URL, (route) =>
    brasilApi ? json(route, brasilApi) : json(route, { name: 'NotFoundError' }, 404),
  );
}

/** The common case: Open Library knows the book, nobody else is needed. */
const stubLookup = (page, isbn, data, rest) =>
  stubCatalogues(page, { openLibrary: { [`ISBN:${isbn}`]: data }, ...rest });

const googleVolume = (isbn, info) => ({
  items: [{ volumeInfo: { industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }], ...info } }],
});

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

  await t.test('a pre-2007 book filed under its ISBN-10 is still found from the barcode', async () => {
    // The barcode carries the ISBN-13; the catalogue entry is under the
    // ISBN-10. Asking about only the scanned form is how a book that is
    // plainly catalogued comes back as unknown.
    const isbn = '9780140328721';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await stubLookup(page, '0140328726', { title: 'Fantastic Mr. Fox', authors: [{ name: 'Roald Dahl' }] });

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=scan-result]', { timeout: 30000 });
    assert.match(await page.textContent('.row-card__title'), /Fantastic Mr\. Fox/);

    await page.click('[data-testid=confirm-add]');
    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.isbn, isbn, 'stored under the scanned form, whichever one answered');
    await context.close();
  });

  await t.test('what each catalogue knows is combined, not the first answer taken', async () => {
    const isbn = '9780140328721';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await stubLookup(
      page,
      isbn,
      // Open Library very often has no page count.
      { title: 'Fantastic Mr. Fox', authors: [{ name: 'Roald Dahl' }], publish_date: '1988' },
      { google: googleVolume(isbn, { title: 'Fantastic Mr. Fox', pageCount: 96 }) },
    );

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=scan-result]', { timeout: 30000 });
    assert.match(await page.textContent('.result-card__flag'), /Open Library \+ Google Books/);

    await page.click('[data-testid=confirm-add]');
    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.year, 1988, 'from Open Library');
    assert.equal(book.pages, 96, 'from Google Books, which first-answer-wins would have lost');
    await context.close();
  });

  await t.test('a catalogue that cannot be reached offers a retry rather than a shrug', async () => {
    const isbn = '9780140328721';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    // 429 is the real-world case: Google Books rations keyless callers, and a
    // rationed reply must not be reported as a book nobody has catalogued.
    let busy = true;
    await page.route(OPEN_LIBRARY_URL, (route) =>
      busy
        ? json(route, {}, 429)
        : json(route, { [`ISBN:${isbn}`]: { title: 'Fantastic Mr. Fox' } }),
    );
    await page.route(GOOGLE_BOOKS_URL, (route) => json(route, {}, 429));
    await page.route(CROSSREF_URL, (route) => json(route, {}, 503));

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=retry-lookup]', { timeout: 30000 });
    assert.match(await page.textContent('.result-card__flag'), /could not be reached/);

    busy = false;
    await page.click('[data-testid=retry-lookup]');
    await page.waitForSelector('.row-card__title', { timeout: 30000 });
    assert.match(await page.textContent('.result-card__flag'), /Found via Open Library/);
    await context.close();
  });

  // The book that prompted this: a 2026 Brazilian title in none of the global
  // catalogues, which the national agency has because it registered the number.
  await t.test('a Brazilian book the global catalogues never heard of is found anyway', async () => {
    const isbn = '9786555666779';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await stubCatalogues(page, {
      brasilApi: {
        isbn,
        title: 'John Locke, Adam Smith e o Liberalismo',
        subtitle: null,
        authors: ['Cultural Livros'],
        publisher: 'Cultural Livros e Editora',
        year: 2026,
        page_count: 144,
        cover_url: null,
        provider: 'cbl',
      },
    });

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=scan-result]', { timeout: 30000 });
    assert.match(await page.textContent('.result-card__flag'), /Found via CBL/);

    await page.click('[data-testid=confirm-add]');
    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.title, 'John Locke, Adam Smith e o Liberalismo');
    assert.equal(book.pages, 144);
    assert.equal(book.year, 2026);
    assert.equal(book.isbn, isbn);
    await context.close();
  });

  // The bug that made the app unusable in the field: Google rations keyless
  // callers against one globally shared quota, so its 429 is the normal state
  // of the world. Letting that overrule a clean Open Library miss meant every
  // uncatalogued book reported "could not be reached", and the retry offered
  // could never help.
  await t.test('a rationed catalogue does not overrule one that answered', async () => {
    const isbn = '9791234567896';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await stubCatalogues(page);
    // Registered last, so it takes precedence over the clean stub above.
    await page.route(GOOGLE_BOOKS_URL, (route) => json(route, {}, 429));

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=candidate-title]', { timeout: 30000 });

    const flag = await page.textContent('.result-card__flag');
    assert.match(flag, /Not in the catalogues that answered/);
    assert.doesNotMatch(flag, /could not be reached/);
    assert.equal(
      await page.locator('[data-testid=retry-lookup]').count(),
      1,
      'still worth asking again, since one catalogue never spoke',
    );
    await context.close();
  });

  await t.test('a book the catalogue does not know still gets added by hand', async () => {
    const isbn = '9791234567896';
    const { context, page } = await openWithCamera(browser, server.origin, isbn);
    await stubCatalogues(page);

    await goToTab(page, 'scan');
    await page.click('[data-testid=start-scan]');
    await page.waitForSelector('[data-testid=candidate-title]', { timeout: 30000 });

    assert.match(await page.textContent('.result-card__flag'), /No catalogue entry/);
    assert.equal(await page.locator('[data-testid=retry-lookup]').count(), 0, 'nothing to retry');
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
    await stubCatalogues(page);
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
    await stubCatalogues(page);
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
