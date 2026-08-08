/**
 * Tags and collections, driven through the interface.
 *
 * The distinction under test throughout: a collection outlives its books
 * (delete every book in it and the collection is still there, empty), a tag
 * does not (delete the last book carrying it and the tag is gone).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { goToTab, launchBrowser, loadPlaywright, openApp, startServer, SKIP_REASON } from './harness.mjs';

const playwright = loadPlaywright();

const SAMPLE = [
  { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], shelf: 'read', rating: 5, tags: ['fantasy', 'signed'] },
  { title: 'Dune', authors: ['Frank Herbert'], shelf: 'read', rating: 5, tags: ['sci-fi'] },
  { title: 'Solaris', authors: ['Stanisław Lem'], shelf: 'read', rating: 4, tags: ['sci-fi'] },
  { title: 'Piranesi', authors: ['Susanna Clarke'], shelf: 'reading', tags: ['fantasy'] },
];

async function seed(page, books = SAMPLE) {
  return page.evaluate(async (list) => {
    const store = await import('/src/lib/store.js');
    const made = [];
    for (const book of list) made.push(await store.addBook(book));
    return made.map((book) => ({ id: book.id, title: book.title }));
  }, books);
}

const readStore = (page, fn) => page.evaluate(fn);

test('tags and collections', { skip: playwright ? false : SKIP_REASON }, async (t) => {
  const server = await startServer();
  const browser = await launchBrowser(playwright);

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('a collection is created from a book, with that book already in it', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, [SAMPLE[0]]);

    await page.click('[data-testid=book-card]');
    await page.waitForSelector('.sheet');
    await page.click('[data-testid=add-collection]');
    await page.fill('[data-testid=collection-name]', 'Book club');
    await page.click('[data-testid=collection-save]');

    await page.waitForSelector('[data-testid=collection-toggle].is-on');
    const state = await readStore(page, async () => {
      const store = await import('/src/lib/store.js');
      return {
        collections: store.state.collections.map((c) => ({ name: c.name, ids: c.bookIds })),
        bookId: store.state.books[0].id,
      };
    });
    assert.equal(state.collections.length, 1);
    assert.equal(state.collections[0].name, 'Book club');
    assert.deepEqual(state.collections[0].ids, [state.bookId], 'the open book went in');
    await context.close();
  });

  await t.test('membership toggles from the book page and the library filters by it', async () => {
    const { context, page } = await openApp(browser, server.origin);
    const books = await seed(page);
    await page.evaluate(async (id) => {
      const store = await import('/src/lib/store.js');
      await store.createCollection('Book club', [id]);
    }, books[0].id);

    await page.click('[data-testid=open-filters]');
    await page.waitForSelector('[data-testid=collection-row]');
    await page.click('[data-testid=collection-row] [data-collection]');

    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 1);
    assert.match(await page.textContent('.card__title'), /Hobbit/);
    assert.equal(await page.locator('[data-testid=filter-pill]').count(), 1);

    // The pill is the way back out.
    await page.click('[data-testid=filter-pill]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 4);
    await context.close();
  });

  await t.test('a collection filter combines with a shelf rather than replacing it', async () => {
    const { context, page } = await openApp(browser, server.origin);
    const books = await seed(page);
    await page.evaluate(async (ids) => {
      const store = await import('/src/lib/store.js');
      await store.createCollection('Mixed', ids);
    }, [books[0].id, books[3].id]); // one read, one reading

    await page.click('[data-testid=open-filters]');
    await page.waitForSelector('[data-testid=collection-row]');
    await page.click('[data-testid=collection-row] [data-collection]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 2);

    await page.click('.chip[data-shelf=read]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 1);
    assert.match(await page.textContent('.card__title'), /Hobbit/, 'both filters applied');
    await context.close();
  });

  await t.test('a tag is added in one tap and suggested from the rest of the library', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page);

    // Piranesi carries "fantasy"; "sci-fi" and "signed" should be offered.
    await page.click('[data-testid=library-search]');
    await page.fill('[data-testid=library-search]', 'piranesi');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 1);
    await page.click('[data-testid=book-card]');
    await page.waitForSelector('.sheet');

    const offered = await page.$$eval('[data-testid=tag-suggestion]', (n) => n.map((x) => x.textContent));
    assert.ok(offered.some((t) => t.includes('sci-fi')), `expected a sci-fi suggestion, got ${offered}`);
    assert.ok(!offered.some((t) => t.includes('fantasy')), 'what it already has is not suggested');

    await page.click('[data-testid=tag-suggestion]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-tag]').length === 2);

    const tags = await readStore(page, async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books.find((b) => b.title === 'Piranesi').tags;
    });
    assert.equal(tags.length, 2);
    assert.ok(tags.includes('fantasy'));
    await context.close();
  });

  await t.test('typing a tag and pressing enter adds it; clicking the chip takes it off', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, [SAMPLE[1]]);
    await page.click('[data-testid=book-card]');
    await page.waitForSelector('.sheet');

    await page.fill('[data-testid=tag-input]', 'borrowed');
    await page.press('[data-testid=tag-input]', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-tag]').length === 2);

    await page.click('[data-testid=book-tag]:last-of-type');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-tag]').length === 1);
    await context.close();
  });

  await t.test('the library filters by tag', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page);

    await page.click('[data-testid=open-filters]');
    await page.waitForSelector('[data-testid=tag-row]');
    await page.click('[data-testid=tag-row] [data-tag="sci-fi"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 2);

    const titles = await page.$$eval('.card__title', (n) => n.map((x) => x.textContent).sort());
    assert.deepEqual(titles, ['Dune', 'Solaris']);
    await context.close();
  });

  await t.test('renaming a tag moves every book carrying it', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page);

    await page.click('[data-testid=open-filters]');
    await page.waitForSelector('[data-testid=tag-row]');
    await page.click('[data-testid=tag-row]:has([data-tag="sci-fi"]) .facet-row__action');
    await page.fill('[data-testid=collection-name]', 'science fiction');
    await page.click('[data-testid=collection-save]');

    await page.waitForFunction(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books.filter((b) => (b.tags ?? []).includes('science fiction')).length === 2;
    });
    const stillOld = await readStore(page, async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books.some((b) => (b.tags ?? []).includes('sci-fi'));
    });
    assert.equal(stillOld, false, 'the old tag is gone everywhere');
    await context.close();
  });

  await t.test('deleting a collection keeps its books; deleting a book empties the collection', async () => {
    const { context, page } = await openApp(browser, server.origin);
    const books = await seed(page, [SAMPLE[0], SAMPLE[1]]);
    await page.evaluate(async (ids) => {
      const store = await import('/src/lib/store.js');
      await store.createCollection('Temporary', ids);
    }, books.map((b) => b.id));

    // Removing a book prunes it from the collection rather than leaving a
    // count that points at nothing.
    await page.evaluate(async (id) => {
      const store = await import('/src/lib/store.js');
      await store.removeBook(id);
    }, books[0].id);

    const afterDelete = await readStore(page, async () => {
      const store = await import('/src/lib/store.js');
      return store.state.collections[0].bookIds.length;
    });
    assert.equal(afterDelete, 1, 'the deleted book is no longer counted');

    await page.click('[data-testid=open-filters]');
    await page.waitForSelector('[data-testid=collection-row]');
    await page.click('[data-testid=collection-row] .facet-row__action--danger');
    await page.waitForSelector('.dialog');
    await page.click('.dialog .btn--danger');

    await page.waitForFunction(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.collections.length === 0;
    });
    const booksLeft = await readStore(page, async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books.length;
    });
    assert.equal(booksLeft, 1, 'deleting the collection did not delete the book');
    await context.close();
  });

  await t.test('collections survive a reload', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${server.origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.tabbar');

    const books = await seed(page, [SAMPLE[0]]);
    await page.evaluate(async (id) => {
      const store = await import('/src/lib/store.js');
      await store.createCollection('Persistent', [id]);
    }, books[0].id);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.tabbar');
    await page.waitForFunction(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.collections.length === 1;
    }, null, { timeout: 10000 });

    const restored = await readStore(page, async () => {
      const store = await import('/src/lib/store.js');
      return { name: store.state.collections[0].name, ids: store.state.collections[0].bookIds };
    });
    assert.equal(restored.name, 'Persistent');
    assert.deepEqual(restored.ids, [books[0].id]);
    await context.close();
  });

  // The version bump is the one change that can destroy data already on
  // someone's phone, so it gets tested against a database built the old way.
  await t.test('an existing v1 library survives the upgrade to v2', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    // A same-origin page that is not the app, so nothing opens the database
    // at v2 before the v1 one has been written.
    await page.goto(`${server.origin}/not-the-app`, { waitUntil: 'load' });
    const seeded = await page.evaluate(async () => {
      const book = {
        id: 'b_legacy',
        title: 'Cataloged Last Year',
        authors: ['Anon'],
        shelf: 'read',
        rating: 4,
        bomb: false,
        tags: ['old'],
        isbn: null,
        addedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('liboff', 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          const store = db.createObjectStore('books', { keyPath: 'id' });
          store.createIndex('isbn', 'isbn', { unique: false });
          store.createIndex('shelf', 'shelf', { unique: false });
          db.createObjectStore('covers');
          db.createObjectStore('meta');
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('books', 'readwrite');
          tx.objectStore('books').put(book);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
      return book.title;
    });
    assert.equal(seeded, 'Cataloged Last Year');

    await page.goto(`${server.origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('[data-testid=book-card]', { timeout: 15000 });
    assert.equal(await page.textContent('.card__title'), 'Cataloged Last Year');

    // ...and the new store works on the upgraded database.
    await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      await store.createCollection('After upgrade', ['b_legacy']);
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.tabbar');
    await page.waitForFunction(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.collections.length === 1 && store.state.books.length === 1;
    }, null, { timeout: 10000 });
    await context.close();
  });

  await t.test('collections come back from a backup with their books', async () => {
    const first = await openApp(browser, server.origin);
    const books = await seed(first.page, [SAMPLE[0], SAMPLE[1]]);
    await first.page.evaluate(async (id) => {
      const store = await import('/src/lib/store.js');
      await store.createCollection('Exported', [id]);
    }, books[0].id);

    const json = await first.page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      const { exportJson } = await import('/src/lib/transfer.js');
      return exportJson(store.state.books, store.state.collections);
    });
    await first.context.close();

    const second = await openApp(browser, server.origin);
    const result = await second.page.evaluate(async (text) => {
      const store = await import('/src/lib/store.js');
      const { mergeImport, parseImportFile } = await import('/src/lib/transfer.js');
      const merged = mergeImport(store.state.books, parseImportFile(text), {
        collections: store.state.collections,
      });
      await store.replaceLibrary(merged.books, merged.collections);
      return {
        books: store.state.books.length,
        collections: store.state.collections.map((c) => ({ name: c.name, size: c.bookIds.length })),
      };
    }, json);

    assert.equal(result.books, 2);
    assert.deepEqual(result.collections, [{ name: 'Exported', size: 1 }]);
    await goToTab(second.page, 'library');
    await second.page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 2);
    await second.context.close();
  });
});
