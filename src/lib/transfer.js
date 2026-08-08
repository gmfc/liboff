/**
 * Backup and restore. The library lives only on the device, so an export that
 * round-trips exactly is the user's safety net — treat this format as stable.
 */

import { makeBook, ratingText, SHELF_IDS } from './model.js';
import { makeCollection, pruneCollections } from './collections.js';
import { toIsbn13 } from './isbn.js';

// v2 added collections. A v1 file still imports — it simply has none — so old
// backups keep working.
export const EXPORT_VERSION = 2;

export function exportJson(books, collections = []) {
  return JSON.stringify(
    {
      format: 'liboff-library',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      count: books.length,
      books,
      collections,
    },
    null,
    2,
  );
}

const CSV_COLUMNS = [
  'title',
  'authors',
  'isbn',
  'shelf',
  'rating',
  'bomb',
  'year',
  'pages',
  'publisher',
  'tags',
  'collections',
  'startedAt',
  'finishedAt',
  'addedAt',
  'notes',
];

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv(books, collections = []) {
  // Membership lives on the collection, so invert it once rather than scanning
  // every collection for every row.
  const namesByBook = new Map();
  for (const collection of collections) {
    for (const bookId of collection.bookIds ?? []) {
      if (!namesByBook.has(bookId)) namesByBook.set(bookId, []);
      namesByBook.get(bookId).push(collection.name);
    }
  }

  const rows = [CSV_COLUMNS.join(',')];
  for (const book of books) {
    rows.push(
      CSV_COLUMNS.map((column) => {
        if (column === 'authors') return csvCell((book.authors ?? []).join('; '));
        if (column === 'tags') return csvCell((book.tags ?? []).join('; '));
        if (column === 'collections') return csvCell((namesByBook.get(book.id) ?? []).join('; '));
        if (column === 'bomb') return book.bomb ? 'yes' : '';
        if (column === 'rating') return book.bomb ? '' : (book.rating ?? '');
        return csvCell(book[column]);
      }).join(','),
    );
  }
  return `${rows.join('\r\n')}\r\n`;
}

/** Human-readable single-book summary, used by the share sheet. */
export function shareText(book) {
  const authors = (book.authors ?? []).join(', ');
  return [book.title, authors && `by ${authors}`, ratingText(book)].filter(Boolean).join(' — ');
}

function parseBooksPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.books)) return payload.books;
  throw new Error('This file does not look like a liboff export.');
}

function parseCollectionsPayload(payload) {
  if (!payload || Array.isArray(payload)) return []; // a bare array is books only
  return Array.isArray(payload.collections) ? payload.collections : [];
}

/**
 * Merge collections, rewriting membership through `idMap`.
 *
 * The remap is the part that matters. A book already in the library keeps its
 * local id, so an imported collection referring to the file's id would point
 * at nothing — you would restore a backup and get collections that count
 * books they cannot show.
 *
 * Collections match on id first, then on name, so importing a backup onto a
 * device where you recreated "Book club" by hand merges the two instead of
 * leaving you with a pair.
 */
export function mergeCollections(existing, incomingRaw, idMap, { replace = false } = {}) {
  const remap = (bookIds) =>
    bookIds.map((id) => idMap.get(id)).filter((id) => typeof id === 'string');

  const incoming = incomingRaw
    .map((raw) => {
      try {
        const collection = makeCollection(raw);
        return { ...collection, bookIds: remap(collection.bookIds) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (replace) {
    return { collections: incoming, collectionsAdded: incoming.length, collectionsUpdated: 0 };
  }

  const collections = existing.map((collection) => ({ ...collection }));
  const byId = new Map(collections.map((collection, index) => [collection.id, index]));
  const byName = new Map(
    collections.map((collection, index) => [collection.name.toLowerCase(), index]),
  );

  let collectionsAdded = 0;
  let collectionsUpdated = 0;

  for (const collection of incoming) {
    const hit = byId.get(collection.id) ?? byName.get(collection.name.toLowerCase());
    if (hit === undefined) {
      collections.push(collection);
      byId.set(collection.id, collections.length - 1);
      byName.set(collection.name.toLowerCase(), collections.length - 1);
      collectionsAdded += 1;
      continue;
    }
    // Union rather than last-write-wins: a book in either copy of the
    // collection was put there deliberately, and losing it is the worse error.
    const current = collections[hit];
    const merged = [...current.bookIds];
    for (const bookId of collection.bookIds) {
      if (!merged.includes(bookId)) merged.push(bookId);
    }
    if (merged.length !== current.bookIds.length) {
      collections[hit] = {
        ...current,
        bookIds: merged,
        updatedAt: new Date().toISOString(),
      };
      collectionsUpdated += 1;
    }
  }

  return { collections, collectionsAdded, collectionsUpdated };
}

/**
 * Merge an export back in. Existing books win unless `replace` is set, so a
 * restore on a device that has kept reading does not undo recent edits.
 *
 * Identity is the ISBN when present, otherwise the stored id, otherwise
 * title+author — enough to stop an accidental double-import duplicating a
 * whole shelf.
 */
export function mergeImport(existing, incomingRaw, { replace = false, collections = [] } = {}) {
  const incoming = parseBooksPayload(incomingRaw)
    .map((raw) => {
      try {
        const book = makeBook(raw);
        const isbn13 = book.isbn ? toIsbn13(book.isbn) : null;
        if (isbn13) book.isbn = isbn13;
        if (!SHELF_IDS.includes(book.shelf)) return null;
        return book;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const incomingCollections = parseCollectionsPayload(incomingRaw);

  if (replace) {
    const idMap = new Map(incoming.map((book) => [book.id, book.id]));
    return {
      books: incoming,
      added: incoming.length,
      updated: 0,
      skipped: 0,
      ...mergeCollections(collections, incomingCollections, idMap, { replace: true }),
    };
  }

  const keysOf = (book) =>
    [
      book.isbn ? `i:${book.isbn}` : null,
      book.id ? `d:${book.id}` : null,
      `t:${book.title.toLowerCase()}|${(book.authors ?? []).join(',').toLowerCase()}`,
    ].filter(Boolean);

  const index = new Map();
  const books = existing.map((book) => ({ ...book }));
  books.forEach((book, position) => {
    for (const key of keysOf(book)) {
      if (!index.has(key)) index.set(key, position);
    }
  });

  let added = 0;
  let updated = 0;
  let skipped = 0;
  /** incoming book id -> the id that book ends up with in the merged library. */
  const idMap = new Map();

  for (const book of incoming) {
    const keys = keysOf(book);
    const hit = keys.map((key) => index.get(key)).find((position) => position !== undefined);
    if (hit === undefined) {
      books.push(book);
      const position = books.length - 1;
      for (const key of keys) if (!index.has(key)) index.set(key, position);
      idMap.set(book.id, book.id);
      added += 1;
      continue;
    }
    // Same book on both sides: keep whichever copy was edited most recently,
    // but always the local id, so anything already pointing at it still does.
    const current = books[hit];
    idMap.set(book.id, current.id);
    if (String(book.updatedAt) > String(current.updatedAt)) {
      books[hit] = { ...book, id: current.id, addedAt: current.addedAt };
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  const merged = mergeCollections(collections, incomingCollections, idMap);
  return {
    books,
    added,
    updated,
    skipped,
    ...merged,
    collections: pruneCollections(merged.collections, books),
  };
}

export function parseImportFile(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('Could not read that file — it is not valid JSON.');
  }
  return payload;
}
