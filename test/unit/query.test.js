import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  countsByShelf,
  libraryStats,
  matchesSearch,
  selectBooks,
  sortBooks,
  topBooks,
} from '../../src/lib/query.js';

const library = () => [
  makeBook({
    title: 'The Hobbit',
    authors: ['J.R.R. Tolkien'],
    shelf: 'read',
    rating: 5,
    year: 1937,
    pages: 310,
    addedAt: '2024-01-01T00:00:00.000Z',
    finishedAt: `${new Date().getFullYear()}-02-02`,
  }),
  makeBook({
    title: 'Solaris',
    authors: ['Stanisław Lem'],
    shelf: 'read',
    rating: 4,
    year: 1961,
    pages: 204,
    addedAt: '2024-02-01T00:00:00.000Z',
  }),
  makeBook({
    title: 'A Terrible Book',
    authors: ['Anon'],
    shelf: 'abandoned',
    bomb: true,
    addedAt: '2024-03-01T00:00:00.000Z',
  }),
  makeBook({
    title: 'Dull But Finished',
    authors: ['Anon'],
    shelf: 'read',
    rating: 0,
    addedAt: '2024-04-01T00:00:00.000Z',
  }),
  makeBook({
    title: 'Unread Thing',
    authors: ['Zebra Writer'],
    shelf: 'wishlist',
    addedAt: '2024-05-01T00:00:00.000Z',
  }),
];

test('search matches across title, author and tags, ignoring accents and case', () => {
  const [hobbit, solaris] = library();
  assert.ok(matchesSearch(hobbit, 'hobbit'));
  assert.ok(matchesSearch(hobbit, 'TOLKIEN'));
  assert.ok(matchesSearch(solaris, 'stanislaw lem'), 'ł folds to l');
  assert.ok(!matchesSearch(hobbit, 'solaris'));
});

test('every search term must match, so extra words narrow the result', () => {
  const [hobbit] = library();
  assert.ok(matchesSearch(hobbit, 'hobbit tolkien'));
  assert.ok(!matchesSearch(hobbit, 'hobbit lem'));
  assert.ok(matchesSearch(hobbit, '   '), 'a blank search matches everything');
});

test('sorting by rank puts the best first and the bomb last', () => {
  const sorted = sortBooks(library(), 'rank-desc').map((b) => b.title);
  assert.deepEqual(sorted, [
    'The Hobbit', // 5
    'Solaris', // 4
    'Dull But Finished', // 0
    'A Terrible Book', // bomb
    'Unread Thing', // unrated, always last
  ]);
});

test('sorting by rank ascending still leaves unrated books last', () => {
  const sorted = sortBooks(library(), 'rank-asc').map((b) => b.title);
  assert.deepEqual(sorted, [
    'A Terrible Book',
    'Dull But Finished',
    'Solaris',
    'The Hobbit',
    'Unread Thing',
  ]);
});

test('title sort ignores a leading article', () => {
  const sorted = sortBooks(library(), 'title-asc').map((b) => b.title);
  assert.deepEqual(sorted, [
    'Dull But Finished',
    'The Hobbit', // files under H
    'Solaris',
    'A Terrible Book', // files under T
    'Unread Thing',
  ]);
});

test('author sort files by surname', () => {
  const sorted = sortBooks(library(), 'author-asc').map((b) => b.authors[0]);
  assert.deepEqual(sorted, ['Anon', 'Anon', 'Stanisław Lem', 'J.R.R. Tolkien', 'Zebra Writer']);
});

test('sortBooks does not mutate its input', () => {
  const books = library();
  const before = books.map((b) => b.title);
  sortBooks(books, 'title-asc');
  assert.deepEqual(books.map((b) => b.title), before);
});

test('selectBooks combines shelf, search and sort', () => {
  const books = library();
  assert.deepEqual(
    selectBooks(books, { shelf: 'read', sort: 'rank-desc' }).map((b) => b.title),
    ['The Hobbit', 'Solaris', 'Dull But Finished'],
  );
  assert.deepEqual(
    selectBooks(books, { shelf: 'all', search: 'anon' }).map((b) => b.title).sort(),
    ['A Terrible Book', 'Dull But Finished'],
  );
  assert.equal(selectBooks(books, { rated: true }).length, 4, 'unrated is excluded');
});

test('shelf counts cover every shelf plus the total', () => {
  const counts = countsByShelf(library());
  assert.equal(counts.all, 5);
  assert.equal(counts.read, 3);
  assert.equal(counts.wishlist, 1);
  assert.equal(counts.abandoned, 1);
});

test('stats average over starred books only, excluding bombs and unrated', () => {
  const stats = libraryStats(library());
  assert.equal(stats.total, 5);
  assert.equal(stats.rated, 4, 'the bomb counts as rated');
  assert.equal(stats.bombs, 1);
  assert.equal(stats.averageStars, 3, '(5 + 4 + 0) / 3');
  assert.equal(stats.pagesRead, 514, 'only books on the read shelf with a page count');
  assert.equal(stats.finishedThisYear, 1);
  assert.equal(stats.authors, 4, 'Anon counted once');
});

test('the distribution has a row per star value plus a bomb row', () => {
  const { distribution } = libraryStats(library());
  assert.deepEqual(distribution.map((d) => d.key), ['5', '4', '3', '2', '1', '0', 'bomb']);
  assert.equal(distribution.find((d) => d.key === '5').count, 1);
  assert.equal(distribution.find((d) => d.key === '0').count, 1);
  assert.equal(distribution.find((d) => d.key === 'bomb').count, 1);
});

test('stats on an empty library do not divide by zero', () => {
  const stats = libraryStats([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.averageStars, null);
  assert.equal(stats.maxDistribution, 0);
});

test('the top list excludes bombs and unrated books', () => {
  const top = topBooks(library(), 10).map((b) => b.title);
  assert.deepEqual(top, ['The Hobbit', 'Solaris', 'Dull But Finished']);
});
