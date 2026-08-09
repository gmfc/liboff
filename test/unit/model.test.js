import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyShelfSideEffects,
  authorText,
  cleanRating,
  isRated,
  makeBook,
  rankValue,
  ratingText,
  updateBook,
  BOMB_RANK,
  DEFAULT_SHELF,
  SHELF_IDS,
} from '../../src/lib/model.js';

test('makeBook normalises whatever it is handed', () => {
  const book = makeBook({
    title: '  The   Hobbit \n',
    authors: ' J.R.R. Tolkien , , j.r.r. TOLKIEN , Christopher Tolkien ',
    year: 'first published 1937',
    pages: '310.4',
    rating: '4.6',
    shelf: 'nonsense',
  });
  assert.equal(book.title, 'The Hobbit');
  assert.deepEqual(
    book.authors,
    ['J.R.R. Tolkien', 'Christopher Tolkien'],
    'blank entries and case-insensitive duplicates dropped, distinct names kept',
  );
  assert.equal(book.year, 1937);
  assert.equal(book.pages, 310);
  assert.equal(book.rating, 5, 'ratings round to whole stars');
  assert.equal(book.shelf, DEFAULT_SHELF, 'an unknown shelf falls back');
  assert.ok(book.id.startsWith('b_'));
});

test('makeBook defaults an empty title rather than storing nothing', () => {
  assert.equal(makeBook({}).title, 'Untitled');
});

test('a bombed book carries no star rating', () => {
  const book = makeBook({ title: 'x', rating: 4, bomb: true });
  assert.equal(book.bomb, true);
  assert.equal(book.rating, null, 'the two verdicts can never disagree');
});

test('cleanRating clamps to the 0-5 scale', () => {
  assert.equal(cleanRating(-3), 0);
  assert.equal(cleanRating(9), 5);
  assert.equal(cleanRating(2.4), 2);
  assert.equal(cleanRating(''), null);
  assert.equal(cleanRating(null), null);
  assert.equal(cleanRating('abc'), null);
});

test('zero stars is a rating, not an absence of one', () => {
  const zero = makeBook({ title: 'Dire', rating: 0 });
  assert.equal(zero.rating, 0);
  assert.equal(rankValue(zero), 0);
  assert.ok(isRated(zero));
  assert.equal(ratingText(zero), '0/5');

  const unrated = makeBook({ title: 'Unread' });
  assert.equal(rankValue(unrated), null);
  assert.ok(!isRated(unrated));
  assert.equal(ratingText(unrated), 'Unrated');
});

test('a bomb ranks below zero stars', () => {
  const bombed = makeBook({ title: 'Awful', bomb: true });
  assert.equal(rankValue(bombed), BOMB_RANK);
  assert.ok(BOMB_RANK < 0, 'bomb must sort under every star value');
  assert.equal(ratingText(bombed), 'Bomb');
});

test('setting stars clears a bomb, and bombing clears the stars', () => {
  const book = makeBook({ title: 'x', bomb: true });
  const starred = updateBook(book, { rating: 3 });
  assert.equal(starred.rating, 3);
  assert.equal(starred.bomb, false);

  const rebombed = updateBook(starred, { bomb: true });
  assert.equal(rebombed.bomb, true);
  assert.equal(rebombed.rating, null);
});

test('updateBook preserves identity and the original added date', () => {
  const book = makeBook({ title: 'x', addedAt: '2020-01-01T00:00:00.000Z' });
  const next = updateBook(book, { title: 'y' });
  assert.equal(next.id, book.id);
  assert.equal(next.addedAt, '2020-01-01T00:00:00.000Z');
  assert.notEqual(next.updatedAt, undefined);
});

test('makeBook keeps the timestamps it is given, and updateBook moves updatedAt on', () => {
  // Normalising a stored or imported record must not make it look freshly
  // edited: the merge in transfer.js decides which copy wins by this field.
  const stored = makeBook({
    title: 'x',
    addedAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2021-06-06T00:00:00.000Z',
  });
  assert.equal(stored.updatedAt, '2021-06-06T00:00:00.000Z');
  assert.equal(stored.addedAt, '2020-01-01T00:00:00.000Z');

  const edited = updateBook(stored, { title: 'y' });
  assert.ok(edited.updatedAt > stored.updatedAt, 'an actual edit bumps the clock');

  const junk = makeBook({ title: 'x', updatedAt: 'not a date' });
  assert.ok(!Number.isNaN(new Date(junk.updatedAt).getTime()), 'a bad timestamp falls back to now');
});

test('shelving to "reading" fills in a start date', () => {
  const book = makeBook({ title: 'x' });
  const reading = applyShelfSideEffects(book, 'reading');
  assert.equal(reading.shelf, 'reading');
  assert.match(reading.startedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(reading.finishedAt, null);
});

test('shelving to "read" fills in both dates but never overwrites one', () => {
  const book = makeBook({ title: 'x', startedAt: '2001-02-03' });
  const read = applyShelfSideEffects(book, 'read');
  assert.equal(read.startedAt, '2001-02-03', 'an explicit date survives');
  assert.match(read.finishedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test('owning a book you have not started stamps no dates', () => {
  const owned = applyShelfSideEffects(makeBook({ title: 'x' }), 'owned');
  assert.equal(owned.shelf, 'owned');
  assert.equal(owned.startedAt, null, 'buying a book is not reading it');
  assert.equal(owned.finishedAt, null);
});

test('the shelves run in the order a book travels', () => {
  assert.deepEqual(SHELF_IDS, ['wishlist', 'owned', 'reading', 'read', 'abandoned']);
  assert.equal(
    makeBook({ title: 'x', shelf: 'owned' }).shelf,
    'owned',
    'and the new one is a shelf a book can actually be put on',
  );
});

test('authorText degrades gracefully', () => {
  assert.equal(authorText(makeBook({ title: 'x' })), 'Unknown author');
  assert.equal(authorText(makeBook({ title: 'x', authors: ['A', 'B'] })), 'A & B');
  assert.equal(authorText(makeBook({ title: 'x', authors: ['A', 'B', 'C'] })), 'A +2');
});

test('ids are unique across rapid creation', () => {
  const ids = new Set(Array.from({ length: 500 }, () => makeBook({ title: 'x' }).id));
  assert.equal(ids.size, 500);
});
