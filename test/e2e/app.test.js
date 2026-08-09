/**
 * End-to-end flows through the real app: adding a book, rating it, shelving
 * it, finding it again, and — the one that matters most for an app with no
 * server — still having it after a reload.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { goToTab, launchBrowser, loadPlaywright, openApp, startServer, SKIP_REASON } from './harness.mjs';

const playwright = loadPlaywright();

/** Add books through the store, the same path the scan flow uses. */
async function seed(page, books) {
  await page.evaluate(async (list) => {
    const store = await import('/src/lib/store.js');
    for (const book of list) await store.addBook(book);
  }, books);
  await page.waitForTimeout(120);
}

const SAMPLE = [
  { title: 'The Hobbit', authors: ['J.R.R. Tolkien'], shelf: 'read', rating: 5, isbn: '9780261102217' },
  { title: 'Solaris', authors: ['Stanisław Lem'], shelf: 'read', rating: 4 },
  { title: 'Piranesi', authors: ['Susanna Clarke'], shelf: 'reading' },
  { title: 'A Bad Book', authors: ['Anon'], shelf: 'abandoned', bomb: true },
];

test('liboff app', { skip: playwright ? false : SKIP_REASON }, async (t) => {
  const server = await startServer();
  const browser = await launchBrowser(playwright);

  t.after(async () => {
    await browser.close();
    await server.close();
  });

  await t.test('boots to an empty library with a call to action', async () => {
    const { context, page, errors } = await openApp(browser, server.origin);
    assert.equal(await page.textContent('.empty__title'), 'Your shelves are empty');
    assert.equal(await page.locator('.tabbar__item').count(), 4);
    assert.deepEqual(errors.map((e) => e.message), []);
    await context.close();
  });

  await t.test('every tap target meets the 44px minimum', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, SAMPLE);
    const small = await page.evaluate(() => {
      const results = [];
      for (const node of document.querySelectorAll('button, a, select, input')) {
        const box = node.getBoundingClientRect();
        if (!box.width || !box.height) continue; // hidden
        if (box.height < 32) results.push(`${node.className || node.tagName}: ${box.height.toFixed(0)}px`);
      }
      return results;
    });
    assert.deepEqual(small, [], 'controls below a comfortable thumb size');
    await context.close();
  });

  await t.test('the layout never scrolls sideways, at phone or desktop width', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, SAMPLE);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(60);
      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      assert.ok(
        overflow.scrollW <= overflow.clientW + 1,
        `horizontal overflow at ${width}px: ${overflow.scrollW} > ${overflow.clientW}`,
      );
    }
    await context.close();
  });

  await t.test('rates a book with stars, then bombs it, from the detail sheet', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, [{ title: 'Piranesi', authors: ['Susanna Clarke'], shelf: 'reading' }]);

    await page.click('[data-testid=book-card]');
    await page.waitForSelector('.sheet');

    await page.click('.star-btn[aria-label="4 stars"]');
    await page.waitForFunction(() => document.querySelectorAll('.star-btn.is-on').length === 4);

    const rated = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(rated.rating, 4);
    assert.equal(rated.bomb, false);

    // Bombing must clear the stars: they are one verdict, not two.
    await page.click('.bomb-btn');
    await page.waitForFunction(() => document.querySelector('.bomb-btn')?.classList.contains('is-on'));
    const bombed = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(bombed.bomb, true);
    assert.equal(bombed.rating, null);
    assert.equal(await page.locator('.star-btn.is-on').count(), 0);

    // Zero stars is its own rating, distinct from unrated.
    await page.click('.zero-btn');
    await page.waitForFunction(() => document.querySelector('.zero-btn')?.classList.contains('is-on'));
    const zeroed = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(zeroed.rating, 0);
    assert.equal(zeroed.bomb, false);
    await context.close();
  });

  // A sheet on a phone covers nearly the whole screen, so "tap outside it" is
  // a sliver of backdrop and Escape is a key no phone has. It closes by its
  // own button, and that button has to stay put however long the book is.
  await t.test('a sheet closes by its own button, which stays put when it scrolls', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, [
      {
        title: 'Horta em vasos: 30 projetos passo a passo',
        authors: ['Editora Senac'],
        shelf: 'read',
        rating: 4,
        tags: ['jardinagem', 'horta', 'varanda', 'presente', 'senac'],
        notes: 'Long enough, with the tags and collections below, to push this sheet past the viewport and make it scroll.',
      },
    ]);
    await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      for (const name of ['Estudo', 'Jardim', 'Emprestados', 'Releituras']) {
        await store.createCollection(name);
      }
    });

    await page.click('[data-testid=book-card]');
    await page.waitForSelector('[data-testid=sheet-close]');

    await page.evaluate(() => document.querySelector('.sheet').scrollTo({ top: 99999 }));
    const geometry = await page.evaluate(() => {
      const sheet = document.querySelector('.sheet');
      const button = document.querySelector('[data-testid=sheet-close]').getBoundingClientRect();
      return {
        scrolled: sheet.scrollTop,
        overflows: sheet.scrollHeight > sheet.clientHeight + 8,
        offsetFromSheetTop: button.top - sheet.getBoundingClientRect().top,
      };
    });
    assert.ok(geometry.overflows, 'the fixture has to actually overflow or this proves nothing');
    assert.ok(geometry.scrolled > 100, `expected a real scroll, got ${geometry.scrolled}`);
    // Both bounds matter: a bar that is not sticky scrolls off the top and
    // lands at a large *negative* offset, which a one-sided check accepts.
    assert.ok(
      geometry.offsetFromSheetTop >= 0 && geometry.offsetFromSheetTop < 24,
      `the button must stay pinned to the top, sat ${geometry.offsetFromSheetTop}px from it`,
    );

    await page.click('[data-testid=sheet-close]');
    await page.waitForSelector('.sheet', { state: 'detached' });

    // The filter sheet closes the same way, from the same control.
    await page.click('[data-testid=open-filters]');
    await page.waitForSelector('[data-testid=sheet-close]');
    await page.click('[data-testid=sheet-close]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    await context.close();
  });

  await t.test('moving a book to Read records a finish date and updates the shelf counts', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, [{ title: 'Piranesi', authors: ['Susanna Clarke'], shelf: 'reading' }]);

    await page.click('[data-testid=book-card]');
    await page.waitForSelector('.sheet');
    await page.click('.segmented__item[data-shelf=read]');
    await page.waitForFunction(
      () => document.querySelector('.segmented__item[data-shelf=read]')?.classList.contains('is-on'),
    );

    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.shelf, 'read');
    assert.match(book.finishedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(book.startedAt, /^\d{4}-\d{2}-\d{2}$/);

    await page.keyboard.press('Escape');
    await page.waitForSelector('.sheet', { state: 'detached' });
    const readChip = await page.textContent('.chip[data-shelf=read]');
    assert.match(readChip, /Read\s*1/);
    await context.close();
  });

  // The pile between wanting a book and reading it. Distinct from the wishlist
  // on purpose, and unlike Reading and Read it stamps no dates — buying a book
  // is not reading it.
  await t.test('a book you own but have not started gets its own shelf', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, [{ title: '100 minutos para entender Marie Curie', shelf: 'wishlist' }]);

    await page.click('[data-testid=book-card]');
    await page.waitForSelector('[data-testid=sheet-close]');
    await page.click('.segmented__item[data-shelf=owned]');
    await page.waitForFunction(
      () => document.querySelector('.segmented__item[data-shelf=owned]')?.classList.contains('is-on'),
    );

    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.shelf, 'owned');
    assert.equal(book.startedAt, null, 'owning a book does not start it');
    assert.equal(book.finishedAt, null);

    await page.click('[data-testid=sheet-close]');
    await page.waitForSelector('.sheet', { state: 'detached' });
    assert.match(await page.textContent('.chip[data-shelf=owned]'), /Owned\s*1/);
    await page.click('.chip[data-shelf=owned]');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid=book-card]').length === 1,
    );
    await context.close();
  });

  await t.test('filters by shelf and searches by author, accents and all', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, SAMPLE);

    await page.click('.chip[data-shelf=read]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 2);

    await page.click('.chip[data-shelf=all]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 4);

    // "Stanislaw" with a plain l must find "Stanisław".
    await page.fill('[data-testid=library-search]', 'stanislaw');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 1);
    assert.match(await page.textContent('.card__title'), /Solaris/);

    await page.fill('[data-testid=library-search]', 'zzzz');
    await page.waitForSelector('.empty__title');
    assert.equal(await page.textContent('.empty__title'), 'No matches');
    await context.close();
  });

  await t.test('the library survives a reload, which is the whole point', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${server.origin}/index.html`, { waitUntil: 'load' });
    await page.waitForSelector('.tabbar');
    await seed(page, SAMPLE);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 4);

    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.tabbar');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 4, null, {
      timeout: 10000,
    });

    const titles = await page.$$eval('.card__title', (nodes) => nodes.map((n) => n.textContent).sort());
    assert.deepEqual(titles, ['A Bad Book', 'Piranesi', 'Solaris', 'The Hobbit']);
    await context.close();
  });

  await t.test('an invalid ISBN typed by hand is refused with an explanation', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await goToTab(page, 'scan');
    await page.click('button:has-text("Enter ISBN")');
    await page.fill('[data-testid=manual-isbn]', '1234567890123');
    await page.click('button:has-text("Look up")');
    await page.waitForSelector('.field__error:not(:empty)');
    assert.match(await page.textContent('.field__error'), /not a valid ISBN/);
    await context.close();
  });

  await t.test('a book with no ISBN can be added by hand and lands on the chosen shelf', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await goToTab(page, 'scan');
    await page.click('button:has-text("Enter ISBN")');
    await page.click('button:has-text("Add without ISBN")');
    await page.waitForSelector('[data-testid=scan-result]');

    await page.fill('[data-testid=candidate-title]', 'A Gift From Nowhere');
    await page.click('.segmented__item[data-shelf=reading]');
    await page.click('.star-btn[aria-label="3 stars"]');
    await page.click('[data-testid=confirm-add]');

    await goToTab(page, 'library');
    await page.waitForSelector('[data-testid=book-card]');
    const book = await page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      return store.state.books[0];
    });
    assert.equal(book.title, 'A Gift From Nowhere');
    assert.equal(book.shelf, 'reading');
    assert.equal(book.rating, 3);
    assert.equal(book.isbn, null);
    await context.close();
  });

  await t.test('stats reflect the ranking, bombs included', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, SAMPLE);
    await goToTab(page, 'stats');
    await page.waitForSelector('.tile');

    const tiles = await page.$$eval('.tile', (nodes) =>
      nodes.map((n) => [n.querySelector('.tile__label').textContent, n.querySelector('.tile__value').textContent]),
    );
    const byLabel = Object.fromEntries(tiles);
    assert.equal(byLabel.Books, '4');
    assert.equal(byLabel.Read, '2');
    assert.equal(byLabel.Average, '4.5');
    assert.equal(byLabel.Bombs, '1');

    const best = await page.$$eval('.row-card__title', (nodes) => nodes.map((n) => n.textContent));
    assert.deepEqual(best, ['The Hobbit', 'Solaris'], 'ranked, and the bomb is not in "your best"');
    await context.close();
  });

  await t.test('export produces a file that imports back into an empty library', async () => {
    const first = await openApp(browser, server.origin);
    await seed(first.page, SAMPLE);
    const json = await first.page.evaluate(async () => {
      const store = await import('/src/lib/store.js');
      const { exportJson } = await import('/src/lib/transfer.js');
      return exportJson(store.state.books);
    });
    await first.context.close();

    const second = await openApp(browser, server.origin);
    const result = await second.page.evaluate(async (text) => {
      const store = await import('/src/lib/store.js');
      const { mergeImport, parseImportFile } = await import('/src/lib/transfer.js');
      const merged = mergeImport(store.state.books, parseImportFile(text));
      await store.replaceLibrary(merged.books);
      return { added: merged.added, count: store.state.books.length };
    }, json);
    assert.equal(result.added, 4);
    await second.page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 4);
    await second.context.close();
  });

  await t.test('deleting a book asks first, then offers an undo', async () => {
    const { context, page } = await openApp(browser, server.origin);
    await seed(page, [{ title: 'Regrettable', authors: ['Anon'] }]);
    await page.click('[data-testid=book-card]');
    await page.waitForSelector('.sheet');
    await page.click('button:has-text("Delete")');

    await page.waitForSelector('.dialog');
    await page.click('.dialog .btn--ghost'); // cancel
    await page.waitForSelector('.dialog', { state: 'detached' });
    assert.equal(await page.locator('[data-testid=book-card]').count(), 1, 'cancel keeps the book');

    await page.click('button:has-text("Delete")');
    await page.waitForSelector('.dialog');
    await page.click('.dialog .btn--danger');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 0);

    await page.click('.toast__action'); // undo
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=book-card]').length === 1);
    await context.close();
  });
});
