import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  bookHasTag,
  normaliseTag,
  removeTagFromBooks,
  renameTagInBooks,
  suggestTags,
  tagCounts,
} from '../../src/lib/tags.js';

const library = () => [
  makeBook({ title: 'A', tags: ['sci-fi', 'borrowed'] }),
  makeBook({ title: 'B', tags: ['Sci-Fi'] }),
  makeBook({ title: 'C', tags: ['signed', 'sci-fi'] }),
  makeBook({ title: 'D' }),
];

test('tags match regardless of case and surrounding space', () => {
  const [book] = library();
  assert.ok(bookHasTag(book, 'SCI-FI'));
  assert.ok(bookHasTag(book, '  sci-fi  '));
  assert.ok(!bookHasTag(book, 'scifi'), 'a different string is a different tag');
  assert.ok(!bookHasTag(book, ''));
  assert.equal(normaliseTag('  Sci-Fi '), 'sci-fi');
});

test('counts fold case together and show the casing first written', () => {
  const counts = tagCounts(library());
  assert.deepEqual(counts, [
    { tag: 'sci-fi', count: 3 },
    { tag: 'borrowed', count: 1 },
    { tag: 'signed', count: 1 },
  ]);
});

test('a book carrying the same tag twice in different cases counts once', () => {
  const counts = tagCounts([makeBook({ title: 'A', tags: ['Sci-Fi'] })]);
  assert.deepEqual(counts, [{ tag: 'Sci-Fi', count: 1 }]);
});

test('an untagged library has no tags rather than an empty-string tag', () => {
  assert.deepEqual(tagCounts([makeBook({ title: 'A' })]), []);
  assert.deepEqual(tagCounts([]), []);
});

test('renaming a tag touches only the books that carry it', () => {
  const books = library();
  const changed = renameTagInBooks(books, 'sci-fi', 'science fiction');
  assert.equal(changed.length, 3, 'the untagged book and the signed-only book are untouched');
  assert.deepEqual(changed[0].tags, ['science fiction', 'borrowed']);
  assert.deepEqual(changed[1].tags, ['science fiction'], 'the differently-cased one moves too');
});

test('renaming onto an existing tag merges them instead of duplicating', () => {
  const books = [makeBook({ title: 'A', tags: ['scifi', 'sci-fi', 'borrowed'] })];
  const [changed] = renameTagInBooks(books, 'scifi', 'sci-fi');
  assert.deepEqual(changed.tags, ['sci-fi', 'borrowed'], 'one sci-fi, order otherwise kept');
});

test('renaming to nothing is refused rather than erasing the tag', () => {
  assert.deepEqual(renameTagInBooks(library(), 'sci-fi', '   '), []);
  assert.deepEqual(renameTagInBooks(library(), '', 'x'), []);
});

test('deleting a tag removes it everywhere and leaves the rest alone', () => {
  const changed = removeTagFromBooks(library(), 'SCI-FI');
  assert.equal(changed.length, 3);
  assert.deepEqual(changed[0].tags, ['borrowed']);
  assert.deepEqual(changed[1].tags, []);
  assert.deepEqual(changed[2].tags, ['signed']);
});

test('deleting a tag nothing carries changes nothing', () => {
  assert.deepEqual(removeTagFromBooks(library(), 'nonexistent'), []);
});

test('suggestions exclude what the book already has, most used first', () => {
  const books = library();
  const suggestions = suggestTags(books, books[0]);
  assert.deepEqual(suggestions, ['signed'], 'sci-fi and borrowed are already on it');
});

test('suggestions narrow as you type', () => {
  const books = library();
  assert.deepEqual(suggestTags(books, makeBook({ title: 'New' }), { query: 'si' }), ['signed']);
  assert.deepEqual(suggestTags(books, makeBook({ title: 'New' }), { query: 'zzz' }), []);
});
