/**
 * Book metadata lookup by ISBN.
 *
 * Open Library is the primary source: no key, permissive CORS, good coverage
 * of the ISBNs printed on physical books. Google Books is tried second because
 * it fills gaps for recent titles. Every call is optional — when both fail (or
 * the device is offline) the caller falls back to manual entry, which is why
 * this module never throws for a miss.
 */

const OPEN_LIBRARY = 'https://openlibrary.org/api/books';
const GOOGLE_BOOKS = 'https://www.googleapis.com/books/v1/volumes';
const COVER_BASE = 'https://covers.openlibrary.org/b/isbn';

const TIMEOUT_MS = 8000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function yearFrom(value) {
  const match = String(value ?? '').match(/(1[0-9]{3}|20[0-9]{2})/);
  return match ? Number(match[1]) : null;
}

export function coverUrlFor(isbn, size = 'L') {
  return isbn ? `${COVER_BASE}/${isbn}-${size}.jpg?default=false` : '';
}

async function fromOpenLibrary(isbn) {
  const url = `${OPEN_LIBRARY}?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`;
  const payload = await fetchJson(url);
  const entry = payload?.[`ISBN:${isbn}`];
  if (!entry) return null;
  return {
    isbn,
    title: entry.title ?? '',
    authors: (entry.authors ?? []).map((a) => a.name).filter(Boolean),
    publisher: entry.publishers?.[0]?.name ?? '',
    year: yearFrom(entry.publish_date),
    pages: entry.number_of_pages ?? null,
    coverUrl: entry.cover?.large ?? entry.cover?.medium ?? coverUrlFor(isbn),
    source: 'Open Library',
  };
}

async function fromGoogleBooks(isbn) {
  const payload = await fetchJson(`${GOOGLE_BOOKS}?q=isbn:${encodeURIComponent(isbn)}&maxResults=1`);
  const info = payload?.items?.[0]?.volumeInfo;
  if (!info) return null;
  const image = info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? '';
  return {
    isbn,
    title: info.title ? [info.title, info.subtitle].filter(Boolean).join(': ') : '',
    authors: info.authors ?? [],
    publisher: info.publisher ?? '',
    year: yearFrom(info.publishedDate),
    pages: info.pageCount ?? null,
    // Google serves http:// thumbnails, which a https page will refuse to load.
    coverUrl: image.replace(/^http:/, 'https:'),
    source: 'Google Books',
  };
}

/**
 * @returns {Promise<object|null>} normalised metadata, or null if nothing
 *          usable was found anywhere.
 */
export async function lookupIsbn(isbn) {
  if (!isbn) return null;
  const openLibrary = await fromOpenLibrary(isbn);
  if (openLibrary?.title) return openLibrary;
  const google = await fromGoogleBooks(isbn);
  if (google?.title) return google;
  return openLibrary ?? google ?? null;
}

/** Free-text search, so a book with a missing or damaged barcode can still be found. */
export async function searchByText(queryText, limit = 12) {
  const query = String(queryText ?? '').trim();
  if (!query) return [];
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=title,author_name,first_publish_year,isbn,number_of_pages_median,publisher,cover_i`;
  const payload = await fetchJson(url);
  return (payload?.docs ?? [])
    .map((doc) => {
      const isbn = (doc.isbn ?? []).find((value) => /^97[89][0-9]{10}$/.test(value)) ?? doc.isbn?.[0] ?? null;
      return {
        isbn,
        title: doc.title ?? '',
        authors: doc.author_name ?? [],
        publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : (doc.publisher ?? ''),
        year: doc.first_publish_year ?? null,
        pages: doc.number_of_pages_median ?? null,
        coverUrl: doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
          : coverUrlFor(isbn),
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
