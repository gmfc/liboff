import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  exportCsv,
  exportJson,
  mergeImport,
  parseImportFile,
  shareText,
  EXPORT_VERSION,
} from '../../src/lib/transfer.js';

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
