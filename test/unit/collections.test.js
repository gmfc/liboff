import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  addToCollection,
  booksInCollection,
  collectionsForBook,
  isInCollection,
  makeCollection,
  pruneCollections,
  removeFromCollection,
  renameCollection,
  sortCollections,
  toggleInCollection,
} from '../../src/lib/collections.js';

test('a new collection is empty, named and identified', () => {
  const collection = makeCollection({ name: '  Book   club \n' });
  assert.equal(collection.name, 'Book club');
  assert.deepEqual(collection.bookIds, []);
  assert.ok(collection.id.startsWith('c_'), 'ids say what they identify');
  assert.ok(collection.createdAt && collection.updatedAt);
});

test('an unnamed collection still gets a name rather than an empty chip', () => {
  assert.equal(makeCollection({}).name, 'Untitled collection');
  assert.equal(makeCollection({ name: '   ' }).name, 'Untitled collection');
});

test('membership is a set: adding twice does not duplicate', () => {
  let collection = makeCollection({ name: 'x' });
  collection = addToCollection(collection, 'b1');
  const afterFirst = collection;
  collection = addToCollection(collection, 'b1');
  assert.deepEqual(collection.bookIds, ['b1']);
  assert.equal(collection, afterFirst, 'a no-op returns the same object');
});

test('order is preserved, because a collection can be a reading order', () => {
  let collection = makeCollection({ name: 'Series' });
  for (const id of ['b3', 'b1', 'b2']) collection = addToCollection(collection, id);
  assert.deepEqual(collection.bookIds, ['b3', 'b1', 'b2']);

  collection = removeFromCollection(collection, 'b1');
  assert.deepEqual(collection.bookIds, ['b3', 'b2'], 'removal does not reshuffle');
});

test('toggle adds then removes', () => {
  let collection = makeCollection({ name: 'x' });
  collection = toggleInCollection(collection, 'b1');
  assert.ok(isInCollection(collection, 'b1'));
  collection = toggleInCollection(collection, 'b1');
  assert.ok(!isInCollection(collection, 'b1'));
});

test('removing a book that is not in the collection changes nothing', () => {
  const collection = addToCollection(makeCollection({ name: 'x' }), 'b1');
  assert.equal(removeFromCollection(collection, 'nope'), collection);
});

test('editing membership moves the clock, so a merge can tell which is newer', async () => {
  const collection = makeCollection({ name: 'x', updatedAt: '2020-01-01T00:00:00.000Z' });
  const next = addToCollection(collection, 'b1');
  assert.ok(next.updatedAt > collection.updatedAt);
});

test('renaming is a no-op when the name has not really changed', () => {
  const collection = makeCollection({ name: 'Book club' });
  assert.equal(renameCollection(collection, 'Book club'), collection);
  assert.equal(renameCollection(collection, '   '), collection, 'an empty name is refused');
  assert.equal(renameCollection(collection, 'Reading group').name, 'Reading group');
});

test('collections keep their given timestamps so an import does not look fresh', () => {
  const collection = makeCollection({
    name: 'x',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2021-06-06T00:00:00.000Z',
  });
  assert.equal(collection.createdAt, '2020-01-01T00:00:00.000Z');
  assert.equal(collection.updatedAt, '2021-06-06T00:00:00.000Z');
});

test('pruning drops ids whose books are gone', () => {
  const books = [makeBook({ title: 'Kept', id: 'b1' })];
  const collections = [makeCollection({ name: 'x', bookIds: ['b1', 'ghost'] })];
  const pruned = pruneCollections(collections, books);
  assert.deepEqual(pruned[0].bookIds, ['b1']);
});

test('pruning leaves untouched collections identical, so nothing needless is written', () => {
  const books = [makeBook({ title: 'Kept', id: 'b1' })];
  const collections = [makeCollection({ name: 'x', bookIds: ['b1'] })];
  assert.equal(pruneCollections(collections, books)[0], collections[0]);
});

test('booksInCollection resolves in the collection order, not the library order', () => {
  const books = [
    makeBook({ title: 'A', id: 'b1' }),
    makeBook({ title: 'B', id: 'b2' }),
    makeBook({ title: 'C', id: 'b3' }),
  ];
  const collection = makeCollection({ name: 'x', bookIds: ['b3', 'b1'] });
  assert.deepEqual(booksInCollection(collection, books).map((b) => b.title), ['C', 'A']);
});

test('booksInCollection skips ids with no book rather than yielding holes', () => {
  const books = [makeBook({ title: 'A', id: 'b1' })];
  const collection = makeCollection({ name: 'x', bookIds: ['ghost', 'b1'] });
  assert.deepEqual(booksInCollection(collection, books).map((b) => b.title), ['A']);
});

test('a book knows which collections hold it', () => {
  const collections = [
    makeCollection({ name: 'One', bookIds: ['b1'] }),
    makeCollection({ name: 'Two', bookIds: ['b2'] }),
    makeCollection({ name: 'Three', bookIds: ['b1', 'b2'] }),
  ];
  assert.deepEqual(collectionsForBook(collections, 'b1').map((c) => c.name), ['One', 'Three']);
});

test('collections list most recently touched first', () => {
  const sorted = sortCollections([
    makeCollection({ name: 'Old', updatedAt: '2020-01-01T00:00:00.000Z' }),
    makeCollection({ name: 'New', updatedAt: '2026-01-01T00:00:00.000Z' }),
  ]);
  assert.deepEqual(sorted.map((c) => c.name), ['New', 'Old']);
});
