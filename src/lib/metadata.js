/**
 * Book metadata lookup by ISBN.
 *
 * Three things make a lookup good enough to scan a shelf with: it should find
 * the book, it should not find the *wrong* book, and it should say which of
 * those happened. This module is built around those, in that order.
 *
 * **Coverage.** Every catalogue is queried under both forms of the ISBN. A
 * book printed before 2007 is frequently filed under its ISBN-10 even though
 * the barcode carries the ISBN-13, and asking for only one form is how a book
 * that is plainly in the catalogue comes back as "not found". Open Library and
 * Google Books are asked at the same time rather than one after the other, and
 * Crossref is asked only when both miss — it indexes scholarly books, so it
 * answers for the monograph the trade catalogues do not have.
 *
 * **Correctness.** Open Library replies are keyed by the ISBN asked for, so
 * they verify themselves. Google's do not: `q=isbn:` is a search, and a search
 * can return a book that is not the one you scanned. Every Google and Crossref
 * result is therefore checked to actually carry the ISBN before it is
 * believed. Getting a confidently-labelled wrong book is worse than getting
 * nothing.
 *
 * **Honesty.** A rate-limited or unreachable catalogue is not the same as a
 * book nobody has catalogued, and telling the two apart is the difference
 * between "try again" and "type the title in yourself". Every result says
 * which it is.
 *
 * Nothing here throws. A lookup is always optional — the caller can fall back
 * to manual entry, and offline it must.
 */

import { cleanIsbn, isbn13To10, toIsbn13 } from './isbn.js';

const OPEN_LIBRARY = 'https://openlibrary.org/api/books';
const OPEN_LIBRARY_SEARCH = 'https://openlibrary.org/search.json';
const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1/volumes';
const CROSSREF = 'https://api.crossref.org/works';
const COVER_BASE = 'https://covers.openlibrary.org/b/isbn';

/**
 * Shorter than it looks: two catalogues are raced, so this is how long the
 * whole lookup can take, not how long each one gets in a queue.
 */
const TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 400;

/** What a lookup can conclude. */
export const FOUND = 'found';
export const NOT_FOUND = 'not-found';
export const UNAVAILABLE = 'unavailable';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @returns {Promise<{data: object|null, transient: boolean}>} `transient` is
 *          the whole point: it separates "busy or unreachable" from "does not
 *          have it", which the caller reports differently and retries
 *          differently.
 */
async function request(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (response.ok) return { data: await response.json(), transient: false };
    // 429 is the one that matters in practice: Google Books rations keyless
    // callers per address per day, and a rationed reply looks exactly like a
    // missing book unless it is read as what it is.
    return { data: null, transient: response.status === 429 || response.status >= 500 };
  } catch {
    // Timeouts, DNS failures, blocked requests, malformed JSON. None of them
    // are evidence about whether the book exists.
    return { data: null, transient: true };
  } finally {
    clearTimeout(timer);
  }
}

/** One retry, because a phone changing cell tower should not cost you a book. */
async function requestOnce(url) {
  const first = await request(url);
  if (!first.transient) return first;
  await delay(RETRY_DELAY_MS);
  return request(url);
}

/* --------------------------------------------------------------- normalising */

function yearFrom(value) {
  const match = String(value ?? '').match(/(1[0-9]{3}|20[0-9]{2})/);
  return match ? saneYear(match[1]) : null;
}

/** A page count outside these bounds is a data-entry accident, not a book. */
function sanePages(value) {
  const pages = Number(value);
  return Number.isInteger(pages) && pages > 0 && pages < 20000 ? pages : null;
}

function saneYear(value) {
  const year = Number(value);
  const limit = new Date().getFullYear() + 1;
  return Number.isInteger(year) && year >= 1400 && year <= limit ? year : null;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanAuthors(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const name = cleanText(value);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Google serves http:// thumbnails, which an https page refuses to load. */
function secureUrl(value) {
  const url = cleanText(value);
  return url ? url.replace(/^http:/, 'https:') : '';
}

export function coverUrlFor(isbn, size = 'L') {
  return isbn ? `${COVER_BASE}/${isbn}-${size}.jpg?default=false` : '';
}

/** Does this record actually claim one of the ISBNs we asked about? */
function carriesIsbn(candidates, isbns) {
  const wanted = new Set(isbns);
  return (candidates ?? []).some((value) => wanted.has(cleanIsbn(value)));
}

/* ----------------------------------------------------------------- providers */

async function fromOpenLibrary(isbns) {
  const bibkeys = isbns.map((isbn) => `ISBN:${isbn}`).join(',');
  const url = `${OPEN_LIBRARY}?bibkeys=${encodeURIComponent(bibkeys)}&format=json&jscmd=data`;
  const { data, transient } = await requestOnce(url);
  if (!data) return { record: null, transient };

  // The reply is keyed by the bibkey asked for, so whichever form answers,
  // it answers for the book that was scanned. No verification needed.
  const entry = isbns.map((isbn) => data[`ISBN:${isbn}`]).find((value) => value?.title);
  if (!entry) return { record: null, transient: false };

  return {
    transient: false,
    record: {
      title: cleanText(entry.title),
      authors: cleanAuthors((entry.authors ?? []).map((author) => author?.name)),
      publisher: cleanText(entry.publishers?.[0]?.name),
      year: yearFrom(entry.publish_date),
      pages: sanePages(entry.number_of_pages),
      coverUrl: secureUrl(entry.cover?.large ?? entry.cover?.medium ?? ''),
      source: 'Open Library',
    },
  };
}

function fromGoogleVolume(info) {
  const image = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? '';
  return {
    // Google splits the subtitle out; a shelf wants the whole title.
    title: cleanText([info.title, info.subtitle].filter(Boolean).join(': ')),
    authors: cleanAuthors(info.authors),
    publisher: cleanText(info.publisher),
    year: yearFrom(info.publishedDate),
    pages: sanePages(info.pageCount),
    coverUrl: secureUrl(image),
    source: 'Google Books',
  };
}

async function fromGoogleBooks(isbns) {
  for (const isbn of isbns) {
    const { data, transient } = await requestOnce(`${GOOGLE_BOOKS}?q=isbn:${isbn}&maxResults=5`);
    // A rationed or unreachable Google says nothing about the other form
    // either, so stop rather than report a miss it never made.
    if (transient) return { record: null, transient: true };
    const item = (data?.items ?? []).find((entry) =>
      carriesIsbn(
        (entry?.volumeInfo?.industryIdentifiers ?? []).map((id) => id?.identifier),
        isbns,
      ),
    );
    if (item?.volumeInfo?.title) return { record: fromGoogleVolume(item.volumeInfo), transient: false };
  }
  return { record: null, transient: false };
}

/**
 * Crossref, asked last and only on a miss. It indexes what publishers deposit
 * a DOI for — scholarly monographs and textbooks — so it is silent on most
 * fiction and decisive on the academic book neither trade catalogue carries.
 */
async function fromCrossref(isbns) {
  const filter = isbns.map((isbn) => `isbn:${isbn}`).join(',');
  const url = `${CROSSREF}?filter=${encodeURIComponent(filter)}&rows=5&select=title,author,publisher,issued,ISBN`;
  const { data, transient } = await requestOnce(url);
  if (!data) return { record: null, transient };

  const item = (data.message?.items ?? []).find((entry) => carriesIsbn(entry?.ISBN, isbns));
  const title = cleanText(item?.title?.[0]);
  if (!title) return { record: null, transient: false };

  return {
    transient: false,
    record: {
      title,
      authors: cleanAuthors(
        (item.author ?? []).map((author) =>
          [author?.given, author?.family].filter(Boolean).join(' '),
        ),
      ),
      publisher: cleanText(item.publisher),
      year: saneYear(item.issued?.['date-parts']?.[0]?.[0]),
      pages: null,
      coverUrl: '',
      source: 'Crossref',
    },
  };
}

/* -------------------------------------------------------------------- merging */

function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  return Array.isArray(value) && value.length === 0;
}

/**
 * Take the best of every catalogue rather than the first one that answered.
 *
 * Open Library describes the edition in your hands and Google Books usually
 * knows how many pages it has; first-source-wins throws one of those away on
 * every single lookup. Records are merged field by field in the order given,
 * so the more authoritative source still leads — it just no longer silences
 * the others where it happens to be blank.
 */
export function mergeRecords(records) {
  const usable = records.filter((record) => record && cleanText(record.title));
  if (!usable.length) return null;

  const pick = (field) => {
    for (const record of usable) {
      if (!isEmpty(record[field])) return record[field];
    }
    return null;
  };

  return {
    title: pick('title') ?? '',
    authors: pick('authors') ?? [],
    publisher: pick('publisher') ?? '',
    year: pick('year'),
    pages: pick('pages'),
    coverUrl: pick('coverUrl') ?? '',
    sources: usable.map((record) => record.source),
  };
}

/* -------------------------------------------------------------------- lookup */

/**
 * Lookups already made this session. Scanning a shelf means re-reading the
 * same barcode whenever a hand slips, and a book you skipped and came back to
 * should not cost a second round trip. Misses are cached too — they will not
 * change while the app is open — but unreachable never is, since that is the
 * one worth trying again.
 */
const cache = new Map();

export function clearLookupCache() {
  cache.clear();
}

function result(status, book = null, sources = []) {
  return { status, book, sources };
}

/**
 * @param {string} input any accepted ISBN form
 * @param {{refresh?: boolean}} [options] `refresh` skips the cache, for the
 *        retry offered after a lookup could not reach anything.
 * @returns {Promise<{status: 'found'|'not-found'|'unavailable',
 *                    book: object|null, sources: string[]}>}
 */
export async function lookupIsbn(input, options = {}) {
  const isbn = toIsbn13(input);
  if (!isbn) return result(NOT_FOUND);

  if (!options.refresh && cache.has(isbn)) return cache.get(isbn);

  // Two six-second timeouts are a poor way to discover you are on a train.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return result(UNAVAILABLE);
  }

  // Both forms of the number, because catalogues disagree about which one a
  // pre-2007 book is filed under. 979 prefixes have no ISBN-10 and yield one.
  const isbns = [isbn, isbn13To10(isbn)].filter(Boolean);

  const [openLibrary, google] = await Promise.all([
    fromOpenLibrary(isbns),
    fromGoogleBooks(isbns),
  ]);
  let records = [openLibrary.record, google.record];
  let transient = openLibrary.transient || google.transient;

  if (!records.some(Boolean) && !transient) {
    const crossref = await fromCrossref(isbns);
    records = [crossref.record];
    transient = crossref.transient;
  }

  const merged = mergeRecords(records);
  if (!merged) {
    // Nothing found, but say so only if every catalogue actually answered.
    const outcome = transient ? result(UNAVAILABLE) : result(NOT_FOUND);
    if (!transient) cache.set(isbn, outcome);
    return outcome;
  }

  const { sources, ...book } = merged;
  const found = result(FOUND, { ...book, isbn, coverUrl: book.coverUrl || coverUrlFor(isbn) }, sources);
  cache.set(isbn, found);
  return found;
}

/* -------------------------------------------------------------------- search */

/** Free-text search, so a book with a missing or damaged barcode can still be found. */
export async function searchByText(queryText, limit = 12) {
  const query = cleanText(queryText);
  if (!query) return [];

  // Someone who pastes an ISBN into the title box means the ISBN. Searching
  // the text index for it finds nothing like as reliably as looking it up.
  const isbn = toIsbn13(query);
  if (isbn) {
    const { status, book, sources } = await lookupIsbn(query);
    return status === FOUND ? [{ ...book, source: sources.join(' + ') }] : [];
  }

  const fields = 'title,author_name,first_publish_year,isbn,number_of_pages_median,publisher,cover_i';
  const url = `${OPEN_LIBRARY_SEARCH}?q=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
  const { data } = await requestOnce(url);
  return (data?.docs ?? [])
    .map((doc) => {
      const found = (doc.isbn ?? []).find((value) => /^97[89][0-9]{10}$/.test(value)) ?? doc.isbn?.[0] ?? null;
      return {
        isbn: found,
        title: cleanText(doc.title),
        authors: cleanAuthors(doc.author_name),
        publisher: cleanText(Array.isArray(doc.publisher) ? doc.publisher[0] : doc.publisher),
        year: saneYear(doc.first_publish_year),
        pages: sanePages(doc.number_of_pages_median),
        coverUrl: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
          : coverUrlFor(found),
        source: 'Open Library',
      };
    })
    .filter((item) => item.title);
}

/**
 * Download a cover so it can be stored alongside the book. Returns null on any
 * failure, including the opaque-response case where a missing cover comes back
 * as a 1-pixel placeholder.
 */
export async function fetchCoverBlob(url) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size < 1024) return null;
    return blob;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
