/**
 * Filtering, searching and sorting for the library view. Pure functions over
 * an array of books so they can be tested without a DOM or a database.
 */

import { authorText, isRated, rankValue, MAX_STARS } from './model.js';

export const SORTS = [
  { id: 'added-desc', label: 'Recently added' },
  { id: 'rank-desc', label: 'Highest rated' },
  { id: 'rank-asc', label: 'Lowest rated' },
  { id: 'title-asc', label: 'Title A–Z' },
  { id: 'author-asc', label: 'Author A–Z' },
  { id: 'year-desc', label: 'Newest published' },
];

export const DEFAULT_SORT = 'added-desc';

/**
 * Letters with no canonical decomposition, which NFD therefore cannot strip.
 * Without these, searching "Stanislaw Lem" would not find "Stanisław Lem".
 */
const TRANSLITERATE = {
  'ł': 'l', 'đ': 'd', 'ø': 'o', 'ð': 'd', 'þ': 'th', 'ß': 'ss',
  'æ': 'ae', 'œ': 'oe', 'ı': 'i', 'ħ': 'h', 'ŋ': 'n', 'ŧ': 't',
};

/** Fold case and accents so search is forgiving about diacritics. */
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[łđøðþßæœıħŋŧ]/g, (char) => TRANSLITERATE[char] ?? char);
}

/** The text we match a search query against. */
function haystack(book) {
  return fold(
    [book.title, ...(book.authors ?? []), book.publisher, book.isbn, ...(book.tags ?? []), book.notes]
      .filter(Boolean)
      .join(' '),
  );
}

/**
 * Every whitespace-separated term must appear somewhere in the record, so
 * "dahl fox" narrows rather than widens.
 */
export function matchesSearch(book, search) {
  const terms = fold(search).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = haystack(book);
  return terms.every((term) => text.includes(term));
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Ignore a leading article so "The Hobbit" files under H. */
function sortableTitle(book) {
  return fold(book.title).replace(/^(the|a|an)\s+/, '');
}

function sortableAuthor(book) {
  const author = book.authors?.[0];
  if (!author) return '\uffff'; // unknown authors sort last
  const parts = fold(author).split(' ');
  return parts.length > 1 ? `${parts[parts.length - 1]} ${parts.slice(0, -1).join(' ')}` : parts[0];
}

/** Unrated books sort after rated ones in both directions. */
function byRank(direction) {
  return (a, b) => {
    const ra = rankValue(a);
    const rb = rankValue(b);
    if (ra === null && rb === null) return 0;
    if (ra === null) return 1;
    if (rb === null) return -1;
    if (ra !== rb) return direction === 'desc' ? rb - ra : ra - rb;
    return collator.compare(sortableTitle(a), sortableTitle(b));
  };
}

const COMPARATORS = {
  'added-desc': (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)),
  'rank-desc': byRank('desc'),
  'rank-asc': byRank('asc'),
  'title-asc': (a, b) => collator.compare(sortableTitle(a), sortableTitle(b)),
  'author-asc': (a, b) => {
    const cmp = collator.compare(sortableAuthor(a), sortableAuthor(b));
    return cmp !== 0 ? cmp : collator.compare(sortableTitle(a), sortableTitle(b));
  },
  'year-desc': (a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    return collator.compare(sortableTitle(a), sortableTitle(b));
  },
};

export function sortBooks(books, sortId = DEFAULT_SORT) {
  const comparator = COMPARATORS[sortId] ?? COMPARATORS[DEFAULT_SORT];
  return [...books].sort(comparator);
}

/**
 * @param {object[]} books
 * @param {{shelf?: string, search?: string, sort?: string, rated?: boolean}} options
 *        `shelf` of 'all' (or omitted) keeps every shelf.
 */
export function selectBooks(books, options = {}) {
  const { shelf = 'all', search = '', sort = DEFAULT_SORT, rated } = options;
  let result = books;
  if (shelf && shelf !== 'all') result = result.filter((book) => book.shelf === shelf);
  if (rated === true) result = result.filter(isRated);
  if (search) result = result.filter((book) => matchesSearch(book, search));
  return sortBooks(result, sort);
}

export function countsByShelf(books) {
  const counts = { all: books.length };
  for (const book of books) {
    counts[book.shelf] = (counts[book.shelf] ?? 0) + 1;
  }
  return counts;
}

/** Numbers for the stats view. Kept here so it is testable. */
export function libraryStats(books) {
  const rated = books.filter(isRated);
  const starred = books.filter((b) => !b.bomb && typeof b.rating === 'number');
  const bombs = books.filter((b) => b.bomb);
  const totalStars = starred.reduce((sum, b) => sum + b.rating, 0);
  const distribution = [];
  for (let stars = MAX_STARS; stars >= 0; stars -= 1) {
    distribution.push({
      key: String(stars),
      stars,
      count: starred.filter((b) => b.rating === stars).length,
    });
  }
  distribution.push({ key: 'bomb', stars: null, count: bombs.length });

  const pagesRead = books
    .filter((b) => b.shelf === 'read' && b.pages)
    .reduce((sum, b) => sum + b.pages, 0);

  const finishedThisYear = books.filter(
    (b) => b.shelf === 'read' && b.finishedAt?.startsWith(String(new Date().getFullYear())),
  ).length;

  return {
    total: books.length,
    rated: rated.length,
    bombs: bombs.length,
    averageStars: starred.length ? totalStars / starred.length : null,
    distribution,
    maxDistribution: distribution.reduce((max, d) => Math.max(max, d.count), 0),
    pagesRead,
    finishedThisYear,
    authors: new Set(books.flatMap((b) => b.authors ?? [])).size,
  };
}

/** Top-ranked books, used for the "best of" list. */
export function topBooks(books, limit = 10) {
  return sortBooks(books.filter((b) => !b.bomb && typeof b.rating === 'number'), 'rank-desc').slice(
    0,
    limit,
  );
}

export { authorText };
