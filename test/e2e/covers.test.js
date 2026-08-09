/**
 * Cover artwork, driven through the interface.
 *
 * The claim under test throughout: a book ends up with real artwork or with
 * the placeholder this app draws itself — never with a picture of the words
 * "image not available", and never with a five-megabyte phone photo sitting in
 * a database meant to hold a whole library.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { goToTab, launchBrowser, loadPlaywright, openApp, startServer, waitFor, SKIP_REASON } from './harness.mjs';

const playwright = loadPlaywright();

/**
 * Service workers are blocked throughout this file. Cover hosts are cache-first
 * in the worker, and `page.route` does not intercept requests the worker itself
 * makes — so whether a stub applied would depend on whether the worker had
 * claimed the page yet, which is a race, not a test.
 */
const NO_WORKERS = { serviceWorkers: 'block' };

const ISBN = '9780140328721';
const GOOGLE_COVER = /books\.google\.com\/books\/content/;
const OPEN_LIBRARY_COVER = /covers\.openlibrary\.org\//;

/** A real JPEG of the requested size, painted in the browser is not an option
 *  here, so build one with a canvas inside the page instead. */
async function makeImage(page, { width, height, label }) {
  return page.evaluate(
    async ({ width, height, label }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // Noise, so the JPEG cannot be compressed down to nothing.
      for (let y = 0; y < height; y += 8) {
        for (let x = 0; x < width; x += 8) {
          ctx.fillStyle = `hsl(${(x * y) % 360} 70% 50%)`;
          ctx.fillRect(x, y, 8, 8);
        }
      }
      ctx.fillStyle = '#000';
      ctx.font = '40px sans-serif';
      ctx.fillText(label, 10, 60);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      const buffer = await blob.arrayBuffer();
      return [...new Uint8Array(buffer)];
    },
    { width, height, label },
  );
}

const seed = (page, book) =>
  page.evaluate(async (input) => {
    const store = await import('/src/lib/store.js');
    const made = await store.addBook(input);
    return made.id;
  }, book);

const coverState = (page, id) =>
  page.evaluate(async (bookId) => {
    const store = await import('/src/lib/store.js');
    const db = await import('/src/lib/db.js');
    const { coverKey } = await import('/src/lib/covers.js');
    const book = store.findById(bookId);
    const blob = await db.getCover(coverKey(book));
    return {
      held: store.hasLocalCover(book),
      bytes: blob?.size ?? 0,
      type: blob?.type ?? '',
      coverUrl: book.coverUrl,
      shown: Boolean(document.querySelector('.cover.has-image')),
    };
  }, id);

test('covers', { skip: playwright ? false : SKIP_REASON }, async (t) => {
  const server = await startServer();
  const browser = await launchBrowser(playwright);

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('Google’s "no cover" image is refused, and the next candidate used', async () => {
    const { context, page } = await openApp(browser, server.origin, NO_WORKERS);
    const real = await makeImage(page, { width: 575, height: 893, label: 'OL' });

    // Exactly what the cover server does for a book it has no artwork for:
    // a PNG, not a 404. Stored unchecked it would read "image not available".
    await page.route(GOOGLE_COVER, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(9103, 7) }),
    );
    await page.route(OPEN_LIBRARY_COVER, (route) =>
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(real) }),
    );

    const id = await seed(page, { title: 'Fantastic Mr. Fox', isbn: ISBN });
    await waitFor(page, async (bookId) => {
      const store = await import('/src/lib/store.js');
      return store.hasLocalCover(store.findById(bookId));
    }, id);

    const state = await coverState(page, id);
    assert.equal(state.type, 'image/jpeg', 'the PNG placeholder was not what got stored');
    assert.match(state.coverUrl, /covers\.openlibrary\.org/, 'and the book remembers where its art came from');
    await context.close();
  });

  await t.test('a book nobody has artwork for keeps the drawn placeholder', async () => {
    const { context, page } = await openApp(browser, server.origin, NO_WORKERS);
    await page.route(GOOGLE_COVER, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(9103, 7) }),
    );
    await page.route(OPEN_LIBRARY_COVER, (route) => route.fulfill({ status: 404, body: '' }));

    const id = await seed(page, { title: 'Nothing Has This', isbn: ISBN });
    await goToTab(page, 'library');
    await page.waitForSelector('[data-testid=book-card]');
    await page.waitForTimeout(1200); // let the cover attempt finish and fail

    const state = await coverState(page, id);
    assert.equal(state.held, false);
    assert.equal(await page.locator('.cover--placeholder').count() > 0, true);
    assert.equal(await page.locator('.cover.has-image').count(), 0);
    await context.close();
  });

  await t.test('a photo becomes the cover, shrunk on the way in', async () => {
    const { context, page } = await openApp(browser, server.origin, NO_WORKERS);
    await page.route(GOOGLE_COVER, (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(OPEN_LIBRARY_COVER, (route) => route.fulfill({ status: 404, body: '' }));

    const id = await seed(page, { title: 'Photographed By Hand', isbn: ISBN });
    // A phone-sized photo: far larger than any tile will ever draw.
    const photo = await makeImage(page, { width: 3000, height: 4000, label: 'PHOTO' });

    await goToTab(page, 'library');
    await page.click('[data-testid=book-card]');
    await page.waitForSelector('[data-testid=cover-pick]');
    await page.setInputFiles('[data-testid=cover-file]', {
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo),
    });
    await page.waitForSelector('[data-testid=cover-remove]', { timeout: 15000 });

    const state = await coverState(page, id);
    assert.equal(state.held, true);
    assert.ok(state.bytes > 0);
    assert.ok(
      state.bytes < photo.length / 2,
      `expected the photo to be shrunk, got ${state.bytes} from ${photo.length}`,
    );
    const width = await page.evaluate(async (bookId) => {
      const store = await import('/src/lib/store.js');
      const db = await import('/src/lib/db.js');
      const { coverKey } = await import('/src/lib/covers.js');
      const blob = await db.getCover(coverKey(store.findById(bookId)));
      const bitmap = await createImageBitmap(blob);
      return bitmap.width;
    }, id);
    assert.ok(width <= 700, `stored at ${width}px, which is more than a tile can use`);
    await context.close();
  });

  await t.test('a chosen cover survives a reload, and can be taken off again', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...NO_WORKERS });
    const page = await context.newPage();
    await page.route(GOOGLE_COVER, (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(OPEN_LIBRARY_COVER, (route) => route.fulfill({ status: 404, body: '' }));
    await page.goto(`${server.origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.tabbar');

    const id = await seed(page, { title: 'Kept Across A Reload', isbn: ISBN });
    const photo = await makeImage(page, { width: 900, height: 1200, label: 'MINE' });
    await goToTab(page, 'library');
    await page.click('[data-testid=book-card]');
    await page.setInputFiles('[data-testid=cover-file]', {
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo),
    });
    await page.waitForSelector('[data-testid=cover-remove]', { timeout: 15000 });

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('[data-testid=book-card]', { timeout: 15000 });
    await waitFor(page, async (bookId) => {
      const store = await import('/src/lib/store.js');
      return store.hasLocalCover(store.findById(bookId));
    }, id);
    assert.equal((await coverState(page, id)).held, true, 'still there after a restart');

    await page.click('[data-testid=book-card]');
    await page.click('[data-testid=cover-remove]');
    await page.waitForSelector('[data-testid=cover-find]', { timeout: 10000 });
    assert.equal((await coverState(page, id)).held, false);
    await context.close();
  });

  await t.test('a book with no ISBN can still be given a cover', async () => {
    const { context, page } = await openApp(browser, server.origin, NO_WORKERS);
    const id = await seed(page, { title: 'Typed In By Hand' });
    const photo = await makeImage(page, { width: 800, height: 1100, label: 'X' });

    await goToTab(page, 'library');
    await page.click('[data-testid=book-card]');
    await page.setInputFiles('[data-testid=cover-file]', {
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(photo),
    });
    await page.waitForSelector('[data-testid=cover-remove]', { timeout: 15000 });

    const state = await coverState(page, id);
    assert.equal(state.held, true, 'filed under the book itself, there being no ISBN');
    await context.close();
  });

  await t.test('missing covers are fetched for the whole shelf at once', async () => {
    const { context, page } = await openApp(browser, server.origin, NO_WORKERS);
    // Nothing available at first, so the books land without artwork.
    await page.route(GOOGLE_COVER, (route) => route.fulfill({ status: 404, body: '' }));
    await page.route(OPEN_LIBRARY_COVER, (route) => route.fulfill({ status: 404, body: '' }));

    await seed(page, { title: 'One', isbn: ISBN });
    await seed(page, { title: 'Two', isbn: '9780441013593' });
    await page.waitForTimeout(800);

    await goToTab(page, 'more');
    await page.waitForSelector('[data-testid=fetch-covers]');
    assert.match(await page.textContent('[data-testid=fetch-covers]'), /\(2\)/, 'it counts them');

    // ...and now the artwork exists.
    const real = await makeImage(page, { width: 575, height: 893, label: 'LATER' });
    await page.unroute(GOOGLE_COVER);
    await page.route(GOOGLE_COVER, (route) =>
      route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from(real) }),
    );

    await page.click('[data-testid=fetch-covers]');
    await page.waitForSelector('.toast:has-text("Found 2 covers")', { timeout: 30000 });
    const held = await waitFor(page, async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books.every((book) => store.hasLocalCover(book));
    });
    assert.equal(held, true);
    await context.close();
  });
});
