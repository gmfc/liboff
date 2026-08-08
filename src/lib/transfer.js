/**
 * Backup and restore. The library lives only on the device, so an export that
 * round-trips exactly is the user's safety net — treat this format as stable.
 */

import { makeBook, ratingText, SHELF_IDS } from './model.js';
import { toIsbn13 } from './isbn.js';

export const EXPORT_VERSION = 1;

export function exportJson(books) {
  return JSON.stringify(
    {
      format: 'liboff-library',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      count: books.length,
      books,
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
  'startedAt',
  'finishedAt',
  'addedAt',
  'notes',
];

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv(books) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const book of books) {
    rows.push(
      CSV_COLUMNS.map((column) => {
        if (column === 'authors') return csvCell((book.authors ?? []).join('; '));
        if (column === 'tags') return csvCell((book.tags ?? []).join('; '));
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

/**
 * Merge an export back in. Existing books win unless `replace` is set, so a
 * restore on a device that has kept reading does not undo recent edits.
 *
 * Identity is the ISBN when present, otherwise the stored id, otherwise
 * title+author — enough to stop an accidental double-import duplicating a
 * whole shelf.
 */
export function mergeImport(existing, incomingRaw, { replace = false } = {}) {
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

  if (replace) {
    return { books: incoming, added: incoming.length, updated: 0, skipped: 0 };
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

  for (const book of incoming) {
    const keys = keysOf(book);
    const hit = keys.map((key) => index.get(key)).find((position) => position !== undefined);
    if (hit === undefined) {
      books.push(book);
      const position = books.length - 1;
      for (const key of keys) if (!index.has(key)) index.set(key, position);
      added += 1;
      continue;
    }
    // Same book on both sides: keep whichever copy was edited most recently.
    const current = books[hit];
    if (String(book.updatedAt) > String(current.updatedAt)) {
      books[hit] = { ...book, id: current.id, addedAt: current.addedAt };
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return { books, added, updated, skipped };
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
