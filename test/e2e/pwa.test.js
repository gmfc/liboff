/**
 * Installability and offline behaviour.
 *
 * The claim this app makes is that it installs to a phone and keeps working
 * with the network off. That is only worth making if it is tested, so this
 * suite genuinely cuts the network and reloads.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { launchBrowser, loadPlaywright, openApp, startServer, ROOT, SKIP_REASON } from './harness.mjs';

const playwright = loadPlaywright();

/** Width and height straight out of a PNG's IHDR chunk. */
async function pngSize(path) {
  const buffer = await readFile(path);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${path} is not a PNG`);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('progressive web app', { skip: playwright ? false : SKIP_REASON }, async (t) => {
  const server = await startServer();
  const browser = await launchBrowser(playwright);

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('the manifest declares everything an install needs', async () => {
    const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
    assert.equal(manifest.display, 'standalone');
    assert.ok(manifest.name && manifest.short_name);
    // Relative, so the app also installs correctly from a project subpath such
    // as a GitHub Pages URL.
    assert.ok(manifest.start_url.startsWith('./'), 'start_url must be relative');
    assert.ok(manifest.scope.startsWith('./'), 'scope must be relative');

    const sizes = manifest.icons.map((icon) => icon.sizes);
    assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
    assert.ok(
      manifest.icons.some((icon) => icon.purpose === 'maskable'),
      'Android needs a maskable icon or it draws a white box behind the mark',
    );

    for (const icon of manifest.icons) {
      const [width, height] = icon.sizes.split('x').map(Number);
      const actual = await pngSize(join(ROOT, icon.src));
      assert.deepEqual(actual, { width, height }, `${icon.src} is not ${icon.sizes}`);
    }
  });

  await t.test('every asset the manifest and page reference is actually served', async () => {
    const { context, page } = await openApp(browser, server.origin);
    const referenced = await page.evaluate(() =>
      [...document.querySelectorAll('link[href]')].map((n) => n.getAttribute('href')),
    );
    for (const href of [...referenced, 'assets/icons/apple-touch-icon.png', 'sw.js']) {
      const response = await page.request.get(`${server.origin}/${href.replace(/^\.?\//, '')}`);
      assert.equal(response.status(), 200, `${href} is missing`);
    }
    await context.close();
  });

  await t.test('the service worker takes control of the page', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });
    const scope = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.scope;
    });
    assert.ok(scope.startsWith(server.origin), `unexpected scope ${scope}`);
    await context.close();
  });

  await t.test('the app opens with the network off, library intact', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${server.origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.tabbar');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });

    await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      await store.addBook({ title: 'Read On A Plane', authors: ['Anon'], shelf: 'reading', rating: 4 });
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 1);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });

    await page.waitForSelector('.tabbar', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 1, null, {
      timeout: 20000,
    });
    assert.equal(await page.textContent('.card__title'), 'Read On A Plane');

    await context.setOffline(false);
    await context.close();
  });

  // The banner is checked separately, against the events the browser actually
  // fires. `context.setOffline` blocks the network but does not reliably move
  // `navigator.onLine` — it does in some Chromium builds and not in others —
  // so asserting the banner off the back of it tests the automation, not us.
  await t.test('the offline banner follows the browser connectivity state', async () => {
    const { context, page } = await openApp(browser, server.origin);
    assert.equal(
      await page.evaluate(() => document.querySelector('.offline-banner').hidden),
      true,
      'hidden while online',
    );

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    await page.waitForFunction(
      () => document.querySelector('.offline-banner')?.hidden === false,
      null,
      { timeout: 5000 },
    );

    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    });
    await page.waitForFunction(
      () => document.querySelector('.offline-banner')?.hidden === true,
      null,
      { timeout: 5000 },
    );
    await context.close();
  });

  await t.test('the barcode decoder still works offline once it has been used', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${server.origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.tabbar');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 20000 });

    // First use pulls the wasm down and the service worker keeps it.
    const online = await page.evaluate(async () => {
      const { createDecoder } = await import('/src/scanner/decode.js');
      return (await createDecoder({ preferNative: false })).name;
    });
    assert.equal(online, 'wasm');

    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.tabbar', { timeout: 20000 });

    const offline = await page.evaluate(async () => {
      const { createDecoder } = await import('/src/scanner/decode.js');
      return (await createDecoder({ preferNative: false })).name;
    });
    assert.equal(offline, 'wasm', 'the decoder must survive going offline');

    await context.setOffline(false);
    await context.close();
  });
});
