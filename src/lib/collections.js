/**
 * Collections: named groups you put books into by hand.
 *
 * Distinct from shelves and tags, and worth keeping distinct:
 *
 *   shelf       where a book is in your reading — one at a time, a status
 *   tags        free-form labels, derived from the books that carry them
 *   collection  a curated group with an existence of its own
 *
 * The last point is the reason a collection is a stored record rather than
 * another string on the book: an empty collection is a real thing you just
 * made and are about to fill, and the order you put books in is yours to
 * choose. Membership therefore lives on the collection as an ordered list of
 * book ids, not on the book as an unordered set of names.
 *
 * Each collection also remembers how it wants to be read — by title, by
 * author, or in the order you added things — so opening "Book club" and
 * opening "Read these in order" do not have to mean the same thing.
 */

import { MANUAL_SORT, SORTS, SORT_IDS, selectBooks } from './query.js';
import { newId } from './model.js';

/**
 * How a collection is ordered when you open it. Every library sort, plus the
 * order you added the books in — which no comparator can express, because it
 * is not a property of the books at all.
 */
export const COLLECTION_ORDERS = [{ id: MANUAL_SORT, label: 'Order added' }, ...SORTS];

/** By title, then author: the order a shelf of books is usually kept in. */
export const DEFAULT_COLLECTION_ORDER = 'title-asc';

const ORDER_IDS = new Set([MANUAL_SORT, ...SORT_IDS]);

function cleanOrder(value) {
  return ORDER_IDS.has(value) ? value : DEFAULT_COLLECTION_ORDER;
}

function cleanName(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const id of value) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function cleanTimestamp(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Build a stored collection from arbitrary input (new, or imported). */
export function makeCollection(input = {}) {
  const now = new Date().toISOString();
  return {
    id: typeof input.id === 'string' && input.id ? input.id : newId('c'),
    name: cleanName(input.name) || 'Untitled collection',
    description: cleanName(input.description).slice(0, 400),
    // Order is meaningful: it is the order you added them in, and a
    // collection like "read these in this order" depends on it — which is
    // why the list is kept even when `order` is currently by title.
    bookIds: cleanIds(input.bookIds),
    order: cleanOrder(input.order),
    createdAt: cleanTimestamp(input.createdAt) ?? now,
    // Preserved rather than re-stamped, for the same reason as books: this is
    // what decides which copy survives a merge.
    updatedAt: cleanTimestamp(input.updatedAt) ?? now,
  };
}

function touch(collection, bookIds) {
  return { ...collection, bookIds, updatedAt: new Date().toISOString() };
}

/** Adding a book it already holds is a no-op, not a duplicate. */
export function addToCollection(collection, bookId) {
  if (!bookId || collection.bookIds.includes(bookId)) return collection;
  return touch(collection, [...collection.bookIds, bookId]);
}

export function removeFromCollection(collection, bookId) {
  if (!collection.bookIds.includes(bookId)) return collection;
  return touch(
    collection,
    collection.bookIds.filter((id) => id !== bookId),
  );
}

export function toggleInCollection(collection, bookId) {
  return collection.bookIds.includes(bookId)
    ? removeFromCollection(collection, bookId)
    : addToCollection(collection, bookId);
}

export function renameCollection(collection, name) {
  const next = cleanName(name);
  if (!next || next === collection.name) return collection;
  return { ...collection, name: next, updatedAt: new Date().toISOString() };
}

export function setCollectionOrder(collection, order) {
  const next = cleanOrder(order);
  if (next === collection.order) return collection;
  return { ...collection, order: next, updatedAt: new Date().toISOString() };
}

export function isInCollection(collection, bookId) {
  return Boolean(collection?.bookIds.includes(bookId));
}

export function collectionsForBook(collections, bookId) {
  return collections.filter((collection) => isInCollection(collection, bookId));
}

/**
 * Drop ids that no longer exist. A collection holding the ghost of a deleted
 * book would report a count it cannot show, so this runs after a delete and
 * after an import.
 */
export function pruneCollections(collections, books) {
  const live = new Set(books.map((book) => book.id));
  return collections.map((collection) => {
    const kept = collection.bookIds.filter((id) => live.has(id));
    return kept.length === collection.bookIds.length ? collection : { ...collection, bookIds: kept };
  });
}

/**
 * The books of a collection, in the collection's own order rather than any
 * sort the library happens to be using. Ids with no book are skipped rather
 * than yielding holes.
 */
export function booksInCollection(collection, books) {
  if (!collection) return [];
  return selectBooks(books, { sort: collection.order, ids: collection.bookIds });
}

export function findCollection(collections, id) {
  return collections.find((collection) => collection.id === id) ?? null;
}

/** Newest activity first — the one you just used is the one you want next. */
export function sortCollections(collections) {
  return [...collections].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
