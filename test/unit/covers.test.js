import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBook } from '../../src/lib/model.js';
import {
  COVER_ZOOM,
  MIN_COVER_BYTES,
  coverCandidates,
  coverKey,
  fetchCoverBlob,
  isPlaceholderCover,
  isUsableCover,
  resolveCover,
  upgradeGoogleThumbnail,
} from '../../src/lib/covers.js';

const ISBN = '9780140328721';

/** Enough of a Blob for these tests: a type and a size. */
const blob = (type, size) => ({ type, size });

function stubFetch(rules) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [match, reply] of rules) {
      if (!String(url).includes(match)) continue;
      if (reply === null) return { ok: false, status: 404 };
      return { ok: true, status: 200, blob: async () => reply };
    }
    return { ok: false, status: 404 };
  };
  return calls;
}

test.afterEach(() => {
  delete globalThis.fetch;
});

/* ------------------------------------------------------------------ keying */

test('a cover is filed under the ISBN, or the book itself when there is none', () => {
  assert.equal(coverKey(makeBook({ title: 'x', isbn: ISBN })), ISBN);
  const noIsbn = makeBook({ title: 'Handwritten' });
  assert.equal(coverKey(noIsbn), noIsbn.id, 'a book typed in by hand can still have a cover');
  assert.equal(coverKey(null), '');
});

/* -------------------------------------------------------------- candidates */

test('the candidates run largest-first and end with the one that 404s cleanly', () => {
  const candidates = coverCandidates(makeBook({ title: 'x', isbn: ISBN, coverUrl: 'https://example.test/c.jpg' }));
  assert.equal(candidates.length, 3);
  assert.match(candidates[0], /books\.google\.com.*vid=ISBN9780140328721/);
  assert.match(candidates[0], new RegExp(`zoom=${COVER_ZOOM}`));
  assert.equal(candidates[1], 'https://example.test/c.jpg');
  assert.match(candidates[2], /covers\.openlibrary\.org.*default=false/);
});

test('a book with no ISBN has only whatever address it was given', () => {
  assert.deepEqual(coverCandidates(makeBook({ title: 'x', coverUrl: 'https://example.test/c.jpg' })), [
    'https://example.test/c.jpg',
  ]);
  assert.deepEqual(coverCandidates(makeBook({ title: 'x' })), []);
});

test('the same address is not tried twice', () => {
  const url = `https://covers.openlibrary.org/b/isbn/${ISBN}-L.jpg?default=false`;
  const candidates = coverCandidates(makeBook({ title: 'x', isbn: ISBN, coverUrl: url }));
  assert.equal(candidates.filter((c) => c === url).length, 1);
});

test('a Google thumbnail is asked for at a useful size, without the drawn-on curl', () => {
  const thumb = 'http://books.google.com/books/content?id=AB1&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api';
  const upgraded = upgradeGoogleThumbnail(thumb);
  assert.match(upgraded, new RegExp(`zoom=${COVER_ZOOM}`));
  assert.ok(!upgraded.includes('edge=curl'), 'the curl is a graphic drawn over the artwork');
  assert.ok(upgraded.startsWith('https:'), 'an https page will not load an http image');
});

test('an address that is not a Google thumbnail is left exactly as it is', () => {
  const url = 'https://covers.openlibrary.org/b/id/123-L.jpg';
  assert.equal(upgradeGoogleThumbnail(url), url);
});

/* -------------------------------------------------------------- validation */

test('Google answers "no cover" with a PNG, and that is not a cover', () => {
  const url = `https://books.google.com/books/content?vid=ISBN${ISBN}&img=1&zoom=3`;
  assert.ok(isPlaceholderCover(url, 'image/png'));
  assert.ok(!isPlaceholderCover(url, 'image/jpeg'), 'real artwork comes back as JPEG');
  assert.ok(
    !isPlaceholderCover('https://covers.openlibrary.org/b/isbn/x-L.png', 'image/png'),
    'the rule is about that one server, not about PNGs',
  );
});

test('what counts as usable artwork', () => {
  const url = 'https://example.test/c.jpg';
  assert.ok(isUsableCover(blob('image/jpeg', 40000), url));
  assert.ok(!isUsableCover(blob('text/html', 40000), url), 'an error page is not a cover');
  assert.ok(!isUsableCover(blob('image/jpeg', MIN_COVER_BYTES - 1), url), 'a spacer is not a cover');
  assert.ok(!isUsableCover(null, url));
  assert.ok(
    !isUsableCover(blob('image/png', 9103), `https://books.google.com/books/content?vid=ISBN${ISBN}`),
    'the measured placeholder, at its measured size',
  );
});

/* ---------------------------------------------------------------- resolving */

test('candidates are tried in turn until one yields real bytes', async () => {
  const calls = stubFetch([
    // Google has no artwork for this one, and says so in pictures.
    ['books.google.com', blob('image/png', 9103)],
    ['covers.openlibrary.org', blob('image/jpeg', 72000)],
  ]);
  const found = await resolveCover(makeBook({ title: 'x', isbn: ISBN }));
  assert.ok(found);
  assert.match(found.url, /covers\.openlibrary\.org/);
  assert.equal(found.blob.size, 72000);
  assert.equal(calls.length, 2, 'and no further than it had to');
});

test('the first candidate wins when it has real artwork', async () => {
  const calls = stubFetch([['books.google.com', blob('image/jpeg', 130591)]]);
  const found = await resolveCover(makeBook({ title: 'x', isbn: ISBN }));
  assert.match(found.url, /books\.google\.com/);
  assert.equal(calls.length, 1, 'the rest are not asked');
});

test('a book nobody has artwork for resolves to nothing, not to a grey rectangle', async () => {
  stubFetch([
    ['books.google.com', blob('image/png', 9103)],
    ['covers.openlibrary.org', null],
  ]);
  assert.equal(await resolveCover(makeBook({ title: 'x', isbn: ISBN })), null);
});

test('a 404 is not mistaken for artwork', async () => {
  stubFetch([['example.test', null]]);
  assert.equal(await fetchCoverBlob('https://example.test/c.jpg'), null);
  assert.equal(await fetchCoverBlob(''), null);
});

test('a dropped request yields nothing rather than throwing', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('network error');
  };
  assert.equal(await fetchCoverBlob('https://example.test/c.jpg'), null);
});
