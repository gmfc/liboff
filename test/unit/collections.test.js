import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  DEFAULT_COLLECTION_ORDER,
  addToCollection,
  booksInCollection,
  collectionsForBook,
  isInCollection,
  makeCollection,
  pruneCollections,
  removeFromCollection,
  renameCollection,
  setCollectionOrder,
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

test('a collection is ordered by title, then author, unless told otherwise', () => {
  assert.equal(makeCollection({ name: 'x' }).order, DEFAULT_COLLECTION_ORDER);
  assert.equal(DEFAULT_COLLECTION_ORDER, 'title-asc');
  assert.equal(
    makeCollection({ name: 'x', order: 'nonsense' }).order,
    DEFAULT_COLLECTION_ORDER,
    'an unknown order falls back rather than sorting by nothing',
  );
  assert.equal(makeCollection({ name: 'x', order: 'manual' }).order, 'manual');
  assert.equal(makeCollection({ name: 'x', order: 'author-asc' }).order, 'author-asc');
});

test('changing the order moves the clock; setting the same one does not', () => {
  const collection = makeCollection({ name: 'x', updatedAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(setCollectionOrder(collection, collection.order), collection);
  const next = setCollectionOrder(collection, 'manual');
  assert.equal(next.order, 'manual');
  assert.ok(next.updatedAt > collection.updatedAt);
  assert.deepEqual(next.bookIds, collection.bookIds, 'the added order is kept, not discarded');
});

test('booksInCollection sorts by the order the collection remembers', () => {
  const books = [
    makeBook({ title: 'Beta', authors: ['Zoe Ash'], id: 'b1' }),
    makeBook({ title: 'Gamma', authors: ['Ann Bell'], id: 'b2' }),
    makeBook({ title: 'Alpha', authors: ['Mia Cole'], id: 'b3' }),
  ];
  const ids = ['b1', 'b2', 'b3'];

  const byTitle = makeCollection({ name: 'x', bookIds: ids });
  assert.deepEqual(booksInCollection(byTitle, books).map((b) => b.title), [
    'Alpha',
    'Beta',
    'Gamma',
  ]);

  const byAuthor = makeCollection({ name: 'x', bookIds: ids, order: 'author-asc' });
  assert.deepEqual(booksInCollection(byAuthor, books).map((b) => b.title), [
    'Beta', // Ash
    'Gamma', // Bell
    'Alpha', // Cole
  ]);
});

test('a manual collection keeps the order you added books in', () => {
  const books = [
    makeBook({ title: 'A', id: 'b1' }),
    makeBook({ title: 'B', id: 'b2' }),
    makeBook({ title: 'C', id: 'b3' }),
  ];
  const collection = makeCollection({ name: 'x', bookIds: ['b3', 'b1'], order: 'manual' });
  assert.deepEqual(booksInCollection(collection, books).map((b) => b.title), ['C', 'A']);
});

test('booksInCollection skips ids with no book rather than yielding holes', () => {
  const books = [makeBook({ title: 'A', id: 'b1' })];
  const collection = makeCollection({ name: 'x', bookIds: ['ghost', 'b1'], order: 'manual' });
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
