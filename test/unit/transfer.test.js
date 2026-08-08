import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  exportCsv,
  exportJson,
  mergeCollections,
  mergeImport,
  parseImportFile,
  shareText,
  EXPORT_VERSION,
} from '../../src/lib/transfer.js';
import { makeCollection } from '../../src/lib/collections.js';

const book = (overrides) => makeBook({ title: 'A Book', authors: ['Someone'], ...overrides });

test('a JSON export round-trips through import unchanged', () => {
  const books = [
    book({ isbn: '9780140328721', rating: 4, shelf: 'read' }),
    book({ title: 'Bombed', bomb: true, shelf: 'abandoned' }),
  ];
  const payload = parseImportFile(exportJson(books));
  assert.equal(payload.version, EXPORT_VERSION);
  assert.equal(payload.count, 2);

  const { books: restored, added } = mergeImport([], payload);
  assert.equal(added, 2);
  assert.equal(restored[0].rating, 4);
  assert.equal(restored[1].bomb, true);
  assert.equal(restored[1].rating, null);
  assert.equal(restored[0].isbn, '9780140328721');
});

test('importing the same file twice does not duplicate the library', () => {
  const original = [book({ isbn: '9780140328721' })];
  const payload = parseImportFile(exportJson(original));

  const first = mergeImport([], payload);
  const second = mergeImport(first.books, payload);
  assert.equal(second.books.length, 1);
  assert.equal(second.added, 0);
  assert.equal(second.skipped, 1);
});

test('books without an ISBN de-duplicate on title and author', () => {
  const existing = [book({ title: 'Same Book', authors: ['Author'] })];
  const incoming = [{ ...book({ title: 'Same Book', authors: ['Author'] }), id: 'different-id' }];
  const merged = mergeImport(existing, incoming);
  assert.equal(merged.books.length, 1);
  assert.equal(merged.added, 0);
});

test('the more recently edited copy of a book wins', () => {
  const mine = book({ isbn: '9780140328721', rating: 2 });
  mine.updatedAt = '2024-01-01T00:00:00.000Z';
  const theirs = { ...mine, rating: 5, updatedAt: '2025-01-01T00:00:00.000Z' };

  const merged = mergeImport([mine], [theirs]);
  assert.equal(merged.books.length, 1);
  assert.equal(merged.books[0].rating, 5);
  assert.equal(merged.updated, 1);
  assert.equal(merged.books[0].id, mine.id, 'the local id is kept');

  const other = mergeImport([{ ...theirs, id: mine.id }], [mine]);
  assert.equal(other.books[0].rating, 5, 'an older copy does not clobber a newer one');
  assert.equal(other.skipped, 1);
});

test('replace mode discards the existing library', () => {
  const merged = mergeImport([book({ title: 'Old' })], [book({ title: 'New' })], { replace: true });
  assert.equal(merged.books.length, 1);
  assert.equal(merged.books[0].title, 'New');
});

test('import normalises an ISBN-10 to the 13-digit key so it matches a scan', () => {
  const merged = mergeImport([], [{ title: 'Fox', isbn: '0140328726' }]);
  assert.equal(merged.books[0].isbn, '9780140328721');
});

test('import survives junk records without losing the good ones', () => {
  const merged = mergeImport([], [{ title: 'Fine' }, null, 42, { title: 'Bad', shelf: 'nope' }]);
  const titles = merged.books.map((b) => b.title);
  assert.ok(titles.includes('Fine'));
  assert.ok(titles.includes('Bad'), 'an unknown shelf is corrected, not dropped');
  assert.equal(merged.books.length, 3, 'null and 42 become minimal records rather than crashing');
});

test('a bare array is accepted as well as a wrapped export', () => {
  const merged = mergeImport([], [book({ title: 'Bare' })]);
  assert.equal(merged.books[0].title, 'Bare');
});

test('a file that is not a liboff export is rejected with a readable message', () => {
  assert.throws(() => mergeImport([], { nope: true }), /does not look like a liboff export/);
  assert.throws(() => parseImportFile('<html>'), /not valid JSON/);
});

test('CSV export quotes fields that contain commas, quotes and newlines', () => {
  const csv = exportCsv([
    book({ title: 'Comma, Book', notes: 'He said "hi"\nthen left', authors: ['A', 'B'], rating: 3 }),
    book({ title: 'Bombed', bomb: true }),
  ]);
  const [header, ...rows] = csv.trim().split('\r\n');
  assert.ok(header.startsWith('title,authors,isbn,shelf,rating,bomb'));
  assert.ok(rows[0].includes('"Comma, Book"'));
  assert.ok(rows[0].includes('""hi""'), 'inner quotes are doubled');
  assert.ok(rows[0].includes('A; B'), 'authors joined with a separator that is not a comma');
  assert.ok(rows[1].includes(',yes,'), 'the bomb is flagged');
});

test('shareText reads as a sentence', () => {
  assert.equal(
    shareText(book({ title: 'Solaris', authors: ['Lem'], rating: 5 })),
    'Solaris — by Lem — 5/5',
  );
  assert.equal(shareText(book({ title: 'Bad', authors: [], bomb: true })), 'Bad — Bomb');
});


/* ------------------------------------------------------------- collections */

test('collections survive a JSON round trip with their membership intact', () => {
  const books = [book({ title: 'One' }), book({ title: 'Two' })];
  const collections = [makeCollection({ name: 'Book club', bookIds: [books[0].id] })];

  const payload = parseImportFile(exportJson(books, collections));
  assert.equal(payload.version, EXPORT_VERSION);

  const merged = mergeImport([], payload);
  assert.equal(merged.collections.length, 1);
  assert.equal(merged.collections[0].name, 'Book club');
  assert.deepEqual(merged.collections[0].bookIds, [books[0].id]);
});

test('a v1 export with no collections still imports', () => {
  const merged = mergeImport([], { format: 'liboff-library', version: 1, books: [book({})] });
  assert.equal(merged.books.length, 1);
  assert.deepEqual(merged.collections, []);
});

test('membership is remapped onto local ids when a book already exists', () => {
  // The same book, catalogued on both devices under different ids: the local
  // copy keeps its id, so the imported collection has to be rewritten or it
  // would point at a book that is not in the library.
  const mine = book({ title: 'Shared', isbn: '9780140328721' });
  const theirs = { ...book({ title: 'Shared', isbn: '9780140328721' }), id: 'their-id' };
  theirs.updatedAt = '2030-01-01T00:00:00.000Z';

  const merged = mergeImport([mine], {
    books: [theirs],
    collections: [makeCollection({ name: 'Theirs', bookIds: ['their-id'] })],
  });

  assert.equal(merged.books.length, 1, 'still one book');
  assert.deepEqual(
    merged.collections[0].bookIds,
    [mine.id],
    'the collection points at the book that is actually in the library',
  );
});

test('an imported collection drops ids for books that did not come with it', () => {
  const merged = mergeImport([], {
    books: [],
    collections: [makeCollection({ name: 'Dangling', bookIds: ['missing'] })],
  });
  assert.deepEqual(merged.collections[0].bookIds, [], 'no ghosts left counting');
});

test('collections with the same name merge rather than doubling up', () => {
  const mine = book({ title: 'Mine' });
  const theirs = book({ title: 'Theirs' });
  const existing = [makeCollection({ name: 'Book club', bookIds: [mine.id] })];

  const merged = mergeImport([mine], {
    books: [theirs],
    collections: [makeCollection({ name: 'book club', bookIds: [theirs.id] })],
  }, { collections: existing });

  assert.equal(merged.collections.length, 1, 'matched on name, case-insensitively');
  assert.deepEqual(merged.collections[0].bookIds, [mine.id, theirs.id], 'union of both');
  assert.equal(merged.collectionsUpdated, 1);
});

test('merging collections is a union, so a book in either copy is kept', () => {
  const idMap = new Map([['a', 'a'], ['b', 'b']]);
  const existing = [makeCollection({ id: 'c1', name: 'x', bookIds: ['a'] })];
  const result = mergeCollections(existing, [makeCollection({ id: 'c1', name: 'x', bookIds: ['b'] })], idMap);
  assert.deepEqual(result.collections[0].bookIds, ['a', 'b']);
});

test('re-importing the same file twice adds nothing the second time', () => {
  const books = [book({ title: 'One', isbn: '9780140328721' })];
  const collections = [makeCollection({ name: 'Club', bookIds: [books[0].id] })];
  const payload = parseImportFile(exportJson(books, collections));

  const first = mergeImport([], payload);
  const second = mergeImport(first.books, payload, { collections: first.collections });
  assert.equal(second.books.length, 1);
  assert.equal(second.collections.length, 1);
  assert.equal(second.collectionsAdded, 0);
  assert.equal(second.collectionsUpdated, 0);
});

test('replace mode takes the imported collections wholesale', () => {
  const merged = mergeImport([book({ title: 'Old' })], {
    books: [book({ title: 'New' })],
    collections: [makeCollection({ name: 'Fresh' })],
  }, { replace: true, collections: [makeCollection({ name: 'Stale' })] });
  assert.deepEqual(merged.collections.map((c) => c.name), ['Fresh']);
});

test('CSV names the collections each book belongs to', () => {
  const one = book({ title: 'One' });
  const two = book({ title: 'Two' });
  const csv = exportCsv([one, two], [
    makeCollection({ name: 'Book club', bookIds: [one.id] }),
    makeCollection({ name: 'Signed', bookIds: [one.id, two.id] }),
  ]);
  const [header, ...rows] = csv.trim().split('\r\n');
  assert.ok(header.includes('collections'));
  assert.ok(rows[0].includes('Book club; Signed'));
  assert.ok(rows[1].includes('Signed'));
});
