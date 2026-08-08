/**
 * Application state.
 *
 * A single observable object holding the whole library. The library is small
 * enough (thousands of books at worst) that keeping it all in memory and
 * re-deriving views on every change is simpler and fast enough — the database
 * is a write-through backup, never read during a render.
 */

import * as db from './db.js';
import {
  addToCollection,
  makeCollection,
  pruneCollections,
  removeFromCollection,
  renameCollection,
  setCollectionOrder,
  sortCollections,
  toggleInCollection,
} from './collections.js';
import { removeTagFromBooks, renameTagInBooks } from './tags.js';
import { applyShelfSideEffects, makeBook, updateBook } from './model.js';
import { DEFAULT_SORT } from './query.js';
import { toIsbn13 } from './isbn.js';
import { fetchCoverBlob } from './metadata.js';

const listeners = new Set();

export const state = {
  ready: false,
  books: [],
  collections: [],
  shelf: 'all',
  /** Active facet filters. Both combine with the shelf and the search. */
  collectionId: null,
  tag: null,
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
  const [books, collections, sort, shelf, theme] = await Promise.all([
    db.loadBooks(),
    db.loadCollections(),
    db.getSetting('sort', DEFAULT_SORT),
    db.getSetting('shelf', 'all'),
    db.getSetting('theme', 'system'),
  ]);
  state.books = books.map((book) => makeBookSafe(book));
  state.collections = sortCollections(collections.map((entry) => makeCollectionSafe(entry)));
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

function makeCollectionSafe(raw) {
  try {
    return makeCollection(raw);
  } catch {
    return makeCollection({ name: 'Unreadable collection' });
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
  await pruneCollectionsFor(state.books);
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

export async function replaceLibrary(books, collections = null) {
  state.books = books.map((book) => makeBookSafe(book));
  if (collections) {
    state.collections = sortCollections(collections.map((entry) => makeCollectionSafe(entry)));
  }
  state.collections = pruneCollections(state.collections, state.books);
  notify();
  await db.replaceAllBooks(state.books);
  await db.replaceAllCollections(state.collections);
  hydrateCovers();
}

/* ------------------------------------------------------------- collections */

async function persistCollection(collection) {
  try {
    await db.putCollection(collection);
  } catch (error) {
    console.warn('liboff: could not save collection —', error);
  }
}

function replaceCollection(next) {
  state.collections = sortCollections(
    state.collections.map((entry) => (entry.id === next.id ? next : entry)),
  );
  notify();
  return persistCollection(next).then(() => next);
}

export async function createCollection(name, bookIds = []) {
  const collection = makeCollection({ name, bookIds });
  state.collections = sortCollections([collection, ...state.collections]);
  notify();
  await persistCollection(collection);
  return collection;
}

export async function editCollectionName(id, name) {
  const current = findCollectionById(id);
  if (!current) return null;
  const next = renameCollection(current, name);
  if (next === current) return current;
  return replaceCollection(next);
}

/**
 * How the collection is ordered when you open it. Stored on the collection
 * rather than as one global preference: the order that suits a reading list is
 * not the order that suits a shelf of favourites.
 */
export async function editCollectionOrder(id, order) {
  const current = findCollectionById(id);
  if (!current) return null;
  const next = setCollectionOrder(current, order);
  if (next === current) return current;
  return replaceCollection(next);
}

export async function addBookToCollection(id, bookId) {
  const current = findCollectionById(id);
  if (!current) return null;
  return replaceCollection(addToCollection(current, bookId));
}

export async function removeBookFromCollection(id, bookId) {
  const current = findCollectionById(id);
  if (!current) return null;
  return replaceCollection(removeFromCollection(current, bookId));
}

export async function toggleBookInCollection(id, bookId) {
  const current = findCollectionById(id);
  if (!current) return null;
  return replaceCollection(toggleInCollection(current, bookId));
}

export async function removeCollection(id) {
  const removed = findCollectionById(id);
  state.collections = state.collections.filter((entry) => entry.id !== id);
  // Deleting the collection you are looking at should not leave the library
  // filtered by something that no longer exists.
  if (state.collectionId === id) state.collectionId = null;
  notify();
  await db.deleteCollection(id);
  return removed;
}

export function findCollectionById(id) {
  return state.collections.find((collection) => collection.id === id) ?? null;
}

async function pruneCollectionsFor(books) {
  const pruned = pruneCollections(state.collections, books);
  const changed = pruned.filter((collection, index) => collection !== state.collections[index]);
  if (!changed.length) return;
  state.collections = pruned;
  await Promise.all(changed.map(persistCollection));
}

/* -------------------------------------------------------------------- tags */

/** Rename a tag across the whole library, writing only the books that moved. */
export async function renameTag(from, to) {
  const changed = renameTagInBooks(state.books, from, to);
  return applyTagChanges(changed);
}

export async function deleteTag(tag) {
  const changed = removeTagFromBooks(state.books, tag);
  const count = await applyTagChanges(changed);
  if (state.tag && state.tag.toLowerCase() === String(tag).toLowerCase()) state.tag = null;
  notify();
  return count;
}

async function applyTagChanges(changed) {
  if (!changed.length) return 0;
  const byId = new Map(changed.map((book) => [book.id, book]));
  state.books = state.books.map((book) => {
    const next = byId.get(book.id);
    return next ? updateBook(book, { tags: next.tags }) : book;
  });
  notify();
  await Promise.all(
    state.books.filter((book) => byId.has(book.id)).map((book) => persist(book)),
  );
  return changed.length;
}

export async function clearLibrary() {
  for (const url of coverUrls.values()) URL.revokeObjectURL(url);
  coverUrls.clear();
  state.books = [];
  state.collections = [];
  state.collectionId = null;
  state.tag = null;
  notify();
  await db.replaceAllBooks([]);
  await db.replaceAllCollections([]);
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
