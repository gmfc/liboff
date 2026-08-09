/**
 * Cover artwork: where to look, what counts as a cover, and how to keep one
 * you supplied yourself.
 *
 * Three things this module exists to get right.
 *
 * **A URL is not a cover.** The metadata merge hands back the first cover
 * *address* any catalogue mentioned, which is not the same as one that
 * resolves — Open Library answers a cover it does not have with a 404. So the
 * candidates are tried in turn and the first that yields real bytes wins.
 *
 * **Google's cover server is not its Books API.** `books.google.com/books/
 * content` takes an ISBN directly, needs no key, and is not metered against
 * the API quota that regularly runs dry — so it still answers when the rest of
 * Google Books has gone quiet. It also serves a much larger image than the
 * 128-pixel thumbnail the API hands out.
 *
 * **It says "no cover" in pictures.** Rather than a 404, that server returns a
 * grey placeholder image, byte-identical for every book without artwork. It is
 * a PNG, and real covers come back as JPEG; that is the whole test. Stored
 * unchecked it would fill a shelf with rectangles reading "image not
 * available", which is worse than the placeholder this app draws itself.
 */

const GOOGLE_CONTENT = 'https://books.google.com/books/content';
const OPEN_LIBRARY_COVERS = 'https://covers.openlibrary.org/b/isbn';

/**
 * Google's zoom levels are 0–4 (5 and 6 repeat 1 and 0). Measured on real
 * covers: 1 is 128px, 2 is ~300px, 3 is ~575px, 4 is ~800px and 0 is the full
 * scan, which reached 764 KB for a single book. A library tile is about 180
 * CSS pixels, so 3 covers a 3× screen with nothing spent on pixels no one
 * will see.
 */
export const COVER_ZOOM = 3;

/** A photo off a phone is several megabytes; a cover does not need to be. */
export const CUSTOM_COVER_WIDTH = 700;
export const CUSTOM_COVER_QUALITY = 0.82;

/** Below this it is a spacer, a broken response or a blank strip. */
export const MIN_COVER_BYTES = 1024;

export const TIMEOUT_MS = 12000;

/** The key a cover is stored under: the ISBN if there is one, else the book. */
export function coverKey(book) {
  return book?.isbn || book?.id || '';
}

/**
 * Where a cover for this book might be, best first.
 *
 * Google leads because it is measurably the largest of the three and does not
 * depend on the metered API; whatever the catalogues offered comes next; the
 * Open Library cover server is last because `default=false` makes it 404
 * cleanly, which is exactly what a last resort should do.
 */
export function coverCandidates(book) {
  const isbn = book?.isbn ?? '';
  const candidates = [];
  if (isbn) {
    candidates.push(`${GOOGLE_CONTENT}?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=${COVER_ZOOM}`);
  }
  if (book?.coverUrl) candidates.push(upgradeGoogleThumbnail(book.coverUrl));
  if (isbn) candidates.push(`${OPEN_LIBRARY_COVERS}/${isbn}-L.jpg?default=false`);
  return [...new Set(candidates.filter(Boolean))];
}

/**
 * The Books API hands out a 128-pixel thumbnail with a curled-corner effect
 * drawn onto it. Both are parameters on the same URL, so ask for the size we
 * actually want and drop the curl, which is a graphic of a page corner sitting
 * on top of the artwork.
 */
export function upgradeGoogleThumbnail(url) {
  const value = String(url ?? '');
  if (!value.includes('books.google.') || !value.includes('img=1')) return value;
  return value
    .replace(/([?&])zoom=\d+/, `$1zoom=${COVER_ZOOM}`)
    .replace(/([?&])edge=curl/, '$1edge=none')
    .replace(/^http:/, 'https:');
}

/**
 * Google says "no cover" with a picture rather than a status code. Real covers
 * come back as JPEG and the placeholder as PNG — checked against every book in
 * a sample, where the placeholder was byte-identical each time.
 */
export function isPlaceholderCover(url, type) {
  return String(url).includes('books.google.') && String(type ?? '').startsWith('image/png');
}

export function isUsableCover(blob, url) {
  if (!blob || !String(blob.type).startsWith('image/')) return false;
  if (blob.size < MIN_COVER_BYTES) return false;
  return !isPlaceholderCover(url, blob.type);
}

/**
 * Download one candidate. Returns null for anything that is not usable art,
 * including the opaque-response case where a missing cover arrives as a
 * one-pixel spacer.
 */
export async function fetchCoverBlob(url) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    return isUsableCover(blob, url) ? blob : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try each candidate until one yields real artwork.
 *
 * @returns {Promise<{blob: Blob, url: string}|null>} the URL comes back too,
 *          so the book can remember where its cover actually came from rather
 *          than the address that merely got mentioned first.
 */
export async function resolveCover(book) {
  for (const url of coverCandidates(book)) {
    const blob = await fetchCoverBlob(url);
    if (blob) return { blob, url };
  }
  return null;
}

/**
 * Re-encode a picked photo down to cover size.
 *
 * Without this, one photo off a modern phone is several megabytes in a
 * database meant to hold a whole library — and every pixel above the tile it
 * will be drawn into is spent on nothing. Anything that cannot be decoded is
 * returned untouched rather than lost.
 */
export async function shrinkImage(file, maxWidth = CUSTOM_COVER_WIDTH) {
  if (!file || typeof createImageBitmap !== 'function') return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', CUSTOM_COVER_QUALITY),
    );
    // Re-encoding an already-small image can make it bigger; keep the smaller.
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
