/**
 * The book record and the vocabulary around it.
 *
 * Ratings are deliberately two fields rather than one number: `rating` is
 * 0-5 stars (null when unrated) and `bomb` is a separate verdict for books
 * that are not merely weak but actively bad. A bomb outranks nothing — it
 * sorts below zero stars — and hides the stars in the UI.
 */

export const SHELVES = [
  { id: 'wishlist', label: 'Want to read', short: 'Wishlist' },
  { id: 'reading', label: 'Reading', short: 'Reading' },
  { id: 'read', label: 'Read', short: 'Read' },
  { id: 'abandoned', label: 'Abandoned', short: 'Abandoned' },
];

export const SHELF_IDS = SHELVES.map((s) => s.id);
export const DEFAULT_SHELF = 'wishlist';

export const MAX_STARS = 5;

/** Lowest possible rank, used to sort bombed books beneath 0-star books. */
export const BOMB_RANK = -1;

/**
 * Collapse the two rating fields into one sortable number.
 * Unrated books return null so callers can decide where to park them.
 */
export function rankValue(book) {
  if (book?.bomb) return BOMB_RANK;
  if (typeof book?.rating === 'number') return book.rating;
  return null;
}

export function isRated(book) {
  return rankValue(book) !== null;
}

/** Short human form of a rating, used in lists and exports. */
export function ratingText(book) {
  if (book?.bomb) return 'Bomb';
  if (typeof book?.rating === 'number') {
    return `${book.rating}/${MAX_STARS}`;
  }
  return 'Unrated';
}

function cleanString(value, max = 500) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanStringList(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = cleanString(item, 200);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

function cleanYear(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/(1[0-9]{3}|20[0-9]{2}|21[0-9]{2})/);
  if (!match) return null;
  return Number(match[1]);
}

function cleanCount(value, max = 100000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.round(n), max);
}

/** An ISO timestamp we are willing to trust, or null. */
function cleanTimestamp(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanDate(value) {
  if (!value) return null;
  const text = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** Clamp a star rating to a whole number in 0..MAX_STARS, or null. */
export function cleanRating(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_STARS, Math.max(0, Math.round(n)));
}

let idCounter = 0;

/**
 * Ids only need to be unique within one device's library. The prefix says what
 * kind of thing it is, which makes a stray id in an export readable.
 */
export function newId(prefix = 'b') {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}${random}`;
}

/**
 * Build a stored book from arbitrary input (scan result, manual form, import).
 * Every field is normalised here so the rest of the app can trust the shape.
 */
export function makeBook(input = {}) {
  const now = new Date().toISOString();
  const shelf = SHELF_IDS.includes(input.shelf) ? input.shelf : DEFAULT_SHELF;
  const bomb = Boolean(input.bomb);
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId(),
    isbn: input.isbn ? String(input.isbn).replace(/[^0-9X]/gi, '') : null,
    title: cleanString(input.title) || 'Untitled',
    authors: cleanStringList(input.authors),
    publisher: cleanString(input.publisher, 200),
    year: cleanYear(input.year),
    pages: cleanCount(input.pages),
    coverUrl: typeof input.coverUrl === 'string' ? input.coverUrl.slice(0, 2000) : '',
    shelf,
    // A bombed book keeps no star value, so the two can never disagree.
    rating: bomb ? null : cleanRating(input.rating),
    bomb,
    notes: cleanString(input.notes, 4000),
    tags: cleanStringList(input.tags),
    startedAt: cleanDate(input.startedAt),
    finishedAt: cleanDate(input.finishedAt),
    addedAt: cleanTimestamp(input.addedAt) ?? now,
    // Preserved rather than re-stamped: this timestamp is what decides which
    // copy of a book survives a merge, so normalising a record must not make
    // it look freshly edited. `updateBook` is what moves it forward.
    updatedAt: cleanTimestamp(input.updatedAt) ?? now,
  };
}

/** Apply a partial edit, re-normalising through makeBook. */
export function updateBook(book, patch = {}) {
  const merged = { ...book, ...patch };
  // Setting stars clears a bomb and vice versa: they are one verdict.
  if (patch.rating !== undefined && patch.rating !== null) merged.bomb = false;
  if (patch.bomb === true) merged.rating = null;
  const next = makeBook(merged);
  next.addedAt = book.addedAt;
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Moving a book onto a shelf implies dates the user would otherwise have to
 * type. We only fill blanks, so an explicit date is never overwritten.
 */
export function applyShelfSideEffects(book, shelf) {
  const today = new Date().toISOString().slice(0, 10);
  const patch = { shelf };
  if (shelf === 'reading' && !book.startedAt) patch.startedAt = today;
  if (shelf === 'read') {
    if (!book.startedAt) patch.startedAt = today;
    if (!book.finishedAt) patch.finishedAt = today;
  }
  return updateBook(book, patch);
}

export function authorText(book) {
  const authors = book?.authors ?? [];
  if (!authors.length) return 'Unknown author';
  if (authors.length <= 2) return authors.join(' & ');
  return `${authors[0]} +${authors.length - 1}`;
}
