/**
 * Application state.
 *
 * A single observable object holding the whole library. The library is small
 * enough (thousands of books at worst) that keeping it all in memory and
 * re-deriving views on every change is simpler and fast enough — the database
 * is a write-through backup, never read during a render.
 */

import * as db from './db.js';
import { applyShelfSideEffects, makeBook, updateBook } from './model.js';
import { DEFAULT_SORT } from './query.js';
import { toIsbn13 } from './isbn.js';
import { fetchCoverBlob } from './metadata.js';

const listeners = new Set();

export const state = {
  ready: false,
  books: [],
  shelf: 'all',
  search: '',
  sort: DEFAULT_SORT,
  view: 'library',
  theme: 'system',
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
};

/** Object URLs for cached cover blobs, keyed by ISBN. Revoked on replace. */
const coverUrls = new Map();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify() {
  for (const listener of listeners) listener(state);
}

export function setState(patch) {
  Object.assign(state, patch);
  notify();
}

export async function init() {
  const [books, sort, shelf, theme] = await Promise.all([
    db.loadBooks(),
    db.getSetting('sort', DEFAULT_SORT),
    db.getSetting('shelf', 'all'),
    db.getSetting('theme', 'system'),
  ]);
  state.books = books.map((book) => makeBookSafe(book));
  state.sort = sort;
  state.shelf = shelf;
  state.theme = theme;
  state.ready = true;
  notify();
  // Covers are decorative, so hydrate them after the first paint.
  hydrateCovers();
}

/** Never let one corrupt record stop the library from loading. */
function makeBookSafe(raw) {
  try {
    return makeBook(raw);
  } catch {
    return makeBook({ title: raw?.title ?? 'Unreadable record' });
  }
}

async function hydrateCovers() {
  const seen = new Set();
  for (const book of state.books) {
    if (!book.isbn || seen.has(book.isbn)) continue;
    seen.add(book.isbn);
    const blob = await db.getCover(book.isbn);
    if (blob) coverUrls.set(book.isbn, URL.createObjectURL(blob));
  }
  if (seen.size) notify();
}

/** Locally cached cover for a book, or '' to fall back to the remote URL. */
export function localCover(book) {
  return book?.isbn ? (coverUrls.get(book.isbn) ?? '') : '';
}

export function findById(id) {
  return state.books.find((book) => book.id === id) ?? null;
}

export function findByIsbn(isbn) {
  const normalised = toIsbn13(isbn) ?? isbn;
  return state.books.find((book) => book.isbn === normalised) ?? null;
}

async function persist(book) {
  try {
    await db.putBook(book);
  } catch (error) {
    console.warn('liboff: could not save book —', error);
  }
}

export async function addBook(input) {
  const isbn13 = input.isbn ? toIsbn13(input.isbn) : null;
  const book = makeBook({ ...input, isbn: isbn13 ?? input.isbn ?? null });
  state.books = [book, ...state.books];
  notify();
  await persist(book);
  cacheCover(book);
  return book;
}

export async function editBook(id, patch) {
  const current = findById(id);
  if (!current) return null;
  const next =
    patch.shelf && patch.shelf !== current.shelf
      ? updateBook(applyShelfSideEffects(current, patch.shelf), { ...patch, shelf: patch.shelf })
      : updateBook(current, patch);
  state.books = state.books.map((book) => (book.id === id ? next : book));
  notify();
  await persist(next);
  if (patch.coverUrl) cacheCover(next);
  return next;
}

export async function removeBook(id) {
  const book = findById(id);
  state.books = state.books.filter((entry) => entry.id !== id);
  notify();
  await db.deleteBook(id);
  // Only drop the cached cover when no other copy of the book still needs it.
  if (book?.isbn && !state.books.some((entry) => entry.isbn === book.isbn)) {
    const url = coverUrls.get(book.isbn);
    if (url) URL.revokeObjectURL(url);
    coverUrls.delete(book.isbn);
    await db.deleteCover(book.isbn);
  }
  return book;
}

export async function replaceLibrary(books) {
  state.books = books.map((book) => makeBookSafe(book));
  notify();
  await db.replaceAllBooks(state.books);
  hydrateCovers();
}

export async function clearLibrary() {
  for (const url of coverUrls.values()) URL.revokeObjectURL(url);
  coverUrls.clear();
  state.books = [];
  notify();
  await db.replaceAllBooks([]);
  await db.clearCovers();
}

/**
 * Pull the cover down once and keep the bytes, so the shelf still looks like a
 * shelf on a plane. Failures are silent by design.
 */
export async function cacheCover(book) {
  if (!book?.isbn || !book.coverUrl) return;
  if (coverUrls.has(book.isbn)) return;
  const existing = await db.getCover(book.isbn);
  if (existing) {
    coverUrls.set(book.isbn, URL.createObjectURL(existing));
    notify();
    return;
  }
  const blob = await fetchCoverBlob(book.coverUrl);
  if (!blob) return;
  await db.putCover(book.isbn, blob);
  coverUrls.set(book.isbn, URL.createObjectURL(blob));
  notify();
}

export async function setPreference(key, value) {
  setState({ [key]: value });
  await db.setSetting(key, value);
}

export function watchConnectivity() {
  if (typeof window === 'undefined') return;
  const update = () => {
    if (state.online !== navigator.onLine) setState({ online: navigator.onLine });
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  // Re-read once now: `state.online` was sampled when this module was first
  // evaluated, and an event fired between then and here would have been missed.
  update();
}
