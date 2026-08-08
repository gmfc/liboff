import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  MANUAL_SORT,
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

test('an ISBN finds its book however it is punctuated', () => {
  const book = makeBook({
    title: 'Fantastic Mr. Fox',
    authors: ['Roald Dahl'],
    isbn: '9780140328721',
    year: 1988,
  });
  assert.ok(matchesSearch(book, '9780140328721'), 'bare digits');
  assert.ok(matchesSearch(book, '978-0-14-032872-1'), 'hyphenated, as printed on the copyright page');
  assert.ok(matchesSearch(book, '9 780140 328721'), 'grouped, as printed under the barcode');
  assert.ok(matchesSearch(book, '1988'), 'the year is searchable too');
  assert.ok(!matchesSearch(book, '9780140328722'), 'a different ISBN must not match');
  assert.ok(!matchesSearch(book, '12345'), 'a short number is not treated as an ISBN');
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

test('title sort breaks ties on the author, so editions do not shuffle', () => {
  const editions = [
    makeBook({ title: 'Ulysses', authors: ['Declan Kiberd'] }),
    makeBook({ title: 'Ulysses', authors: ['James Joyce'] }),
    makeBook({ title: 'Ulysses', authors: ['Hans Walter Gabler'] }),
  ];
  const order = () => sortBooks(editions, 'title-asc').map((b) => b.authors[0]);
  assert.deepEqual(order(), ['Hans Walter Gabler', 'James Joyce', 'Declan Kiberd']);
  assert.deepEqual(order(), order(), 'and the same order every time');
});

test('a book with no author still sorts, at the end of its title group', () => {
  const books = [makeBook({ title: 'Ulysses' }), makeBook({ title: 'Ulysses', authors: ['Joyce'] })];
  assert.deepEqual(
    sortBooks(books, 'title-asc').map((b) => b.authors[0] ?? '—'),
    ['Joyce', '—'],
  );
});

test('author sort files by surname', () => {
  const sorted = sortBooks(library(), 'author-asc').map((b) => b.authors[0]);
  assert.deepEqual(sorted, ['Anon', 'Anon', 'Stanisław Lem', 'J.R.R. Tolkien', 'Zebra Writer']);
});

test('a surname particle files with the surname, the way a shelf does', () => {
  const books = [
    makeBook({ title: 'A', authors: ['Frank Herbert'] }),
    makeBook({ title: 'B', authors: ['Ursula K. Le Guin'] }),
    makeBook({ title: 'C', authors: ['John le Carré'] }),
    makeBook({ title: 'D', authors: ['Ludwig van Beethoven'] }),
    makeBook({ title: 'E', authors: ['Cher'] }),
  ];
  assert.deepEqual(sortBooks(books, 'author-asc').map((b) => b.authors[0]), [
    'Ludwig van Beethoven', // van is not a particle here: files under B
    'Cher', // a one-word name is its own file
    'Frank Herbert',
    'John le Carré', // le Carré, not Carré
    'Ursula K. Le Guin', // Le Guin, not Guin
  ]);
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

test('an id list narrows the result, as a set or as an array', () => {
  const books = library();
  const ids = [books[1].id, books[0].id];
  assert.deepEqual(
    selectBooks(books, { ids: new Set(ids), sort: 'title-asc' }).map((b) => b.title),
    ['The Hobbit', 'Solaris'],
  );
  assert.deepEqual(
    selectBooks(books, { ids, sort: 'title-asc' }).map((b) => b.title),
    ['The Hobbit', 'Solaris'],
    'an array filters exactly as the set does',
  );
});

test('the manual sort keeps the order of the id list it was given', () => {
  const books = library();
  const ids = [books[4].id, books[0].id, books[2].id];
  assert.deepEqual(
    selectBooks(books, { ids, sort: MANUAL_SORT }).map((b) => b.title),
    ['Unread Thing', 'The Hobbit', 'A Terrible Book'],
  );
  assert.deepEqual(
    selectBooks(books, { ids, sort: MANUAL_SORT, shelf: 'read' }).map((b) => b.title),
    ['The Hobbit'],
    'other filters still apply inside a manual order',
  );
});

test('a manual sort with nothing to be manual about falls back', () => {
  const books = library();
  assert.deepEqual(
    selectBooks(books, { sort: MANUAL_SORT }).map((b) => b.title),
    selectBooks(books, {}).map((b) => b.title),
  );
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
