import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FOUND,
  NOT_FOUND,
  UNAVAILABLE,
  clearLookupCache,
  coverUrlFor,
  lookupIsbn,
  mergeRecords,
  searchByText,
  setGoogleBooksKey,
} from '../../src/lib/metadata.js';

const ISBN13 = '9780140328721';
const ISBN10 = '0140328726';

/**
 * A fetch stand-in that records what was asked for and answers from a list of
 * [match, reply] rules. Anything unmatched 404s, so a test that forgets a
 * catalogue sees a miss rather than a hang.
 */
function stubFetch(rules) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    for (const [match, reply] of rules) {
      if (!String(url).includes(match)) continue;
      if (typeof reply === 'function') return reply(String(url), calls);
      // A rule may be a ready-made response (to set a status) or a JSON body.
      if (reply && typeof reply.ok === 'boolean') return reply;
      return jsonResponse(reply);
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return calls;
}

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const errorResponse = (status) => ({ ok: false, status, json: async () => ({}) });

const openLibraryHit = (isbn, extra = {}) => ({
  [`ISBN:${isbn}`]: {
    title: 'Fantastic Mr. Fox',
    authors: [{ name: 'Roald Dahl' }],
    publishers: [{ name: 'Puffin' }],
    publish_date: 'October 1, 1988',
    ...extra,
  },
});

const googleHit = (identifier, extra = {}) => ({
  items: [
    {
      volumeInfo: {
        title: 'Fantastic Mr. Fox',
        authors: ['Roald Dahl'],
        pageCount: 96,
        industryIdentifiers: [{ type: 'ISBN_13', identifier }],
        ...extra,
      },
    },
  ],
});

test.beforeEach(() => clearLookupCache());
test.afterEach(() => {
  delete globalThis.fetch;
});

/* ------------------------------------------------------------------ merging */

test('merging takes the first non-empty value of each field, in source order', () => {
  const merged = mergeRecords([
    { title: 'A Book', authors: ['Ann'], publisher: '', year: null, pages: null, coverUrl: '', source: 'Open Library' },
    { title: 'A Book', authors: ['Someone Else'], publisher: 'Puffin', year: 1988, pages: 96, coverUrl: 'c.jpg', source: 'Google Books' },
  ]);
  assert.equal(merged.title, 'A Book');
  assert.deepEqual(merged.authors, ['Ann'], 'the leading source still leads where it has a value');
  assert.equal(merged.publisher, 'Puffin', 'and yields where it is blank');
  assert.equal(merged.pages, 96);
  assert.equal(merged.year, 1988);
  assert.deepEqual(merged.sources, ['Open Library', 'Google Books']);
});

test('merging ignores records with no title, and returns null when none has one', () => {
  assert.equal(mergeRecords([null, { title: '', pages: 10 }]), null);
  const merged = mergeRecords([{ title: '  ' }, { title: 'Real', authors: [], source: 'Google Books' }]);
  assert.equal(merged.title, 'Real');
  assert.deepEqual(merged.sources, ['Google Books'], 'an untitled record is not credited as a source');
});

/* ------------------------------------------------------------------ coverage */

test('a book filed under its ISBN-10 is still found from the scanned ISBN-13', async () => {
  const calls = stubFetch([
    ['openlibrary.org/api/books', openLibraryHit(ISBN10)],
    ['googleapis.com', { totalItems: 0 }],
  ]);
  const { status, book, sources } = await lookupIsbn(ISBN13);
  assert.equal(status, FOUND);
  assert.equal(book.title, 'Fantastic Mr. Fox');
  assert.equal(book.isbn, ISBN13, 'stored under the scanned form whichever one answered');
  assert.deepEqual(sources, ['Open Library']);
  assert.ok(
    calls.some((url) => url.includes(`ISBN%3A${ISBN13}%2CISBN%3A${ISBN10}`)),
    `both forms go in one request, got ${calls[0]}`,
  );
});

test('a 979 ISBN asks about one form only, having no ISBN-10 to ask about', async () => {
  const calls = stubFetch([['openlibrary.org', {}], ['googleapis.com', { totalItems: 0 }]]);
  await lookupIsbn('9791234567896');
  const bibkeys = calls.find((url) => url.includes('bibkeys'));
  assert.ok(bibkeys.includes('9791234567896'));
  assert.ok(!bibkeys.includes('%2CISBN%3A'), 'no second bibkey');
});

test('the catalogues are asked at the same time, not one after the other', async () => {
  let openLibraryDone = false;
  let googleStartedBeforeOpenLibraryFinished = false;
  stubFetch([
    [
      'openlibrary.org',
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        openLibraryDone = true;
        return jsonResponse(openLibraryHit(ISBN13));
      },
    ],
    [
      'googleapis.com',
      () => {
        googleStartedBeforeOpenLibraryFinished = !openLibraryDone;
        return jsonResponse({ totalItems: 0 });
      },
    ],
  ]);
  await lookupIsbn(ISBN13);
  assert.ok(googleStartedBeforeOpenLibraryFinished);
});

test('what one catalogue knows and the other does not, both end up on the book', async () => {
  stubFetch([
    // Open Library commonly has no page count.
    ['openlibrary.org', openLibraryHit(ISBN13)],
    ['googleapis.com', googleHit(ISBN13)],
  ]);
  const { book, sources } = await lookupIsbn(ISBN13);
  assert.equal(book.publisher, 'Puffin', 'from Open Library');
  assert.equal(book.pages, 96, 'from Google Books, which Open Library alone would have lost');
  assert.equal(book.year, 1988);
  assert.deepEqual(sources, ['Open Library', 'Google Books']);
});

test('Crossref is asked only after both trade catalogues have answered and missed', async () => {
  const calls = stubFetch([
    ['openlibrary.org', {}],
    ['googleapis.com', { totalItems: 0 }],
    [
      'api.crossref.org',
      {
        message: {
          items: [
            {
              title: ['Linear Algebra Done Right'],
              author: [{ given: 'Sheldon', family: 'Axler' }],
              publisher: 'Springer',
              issued: { 'date-parts': [[2015]] },
              ISBN: [`http://id.crossref.org/isbn/${ISBN13}`, ISBN13],
            },
          ],
        },
      },
    ],
  ]);
  const { status, book, sources } = await lookupIsbn(ISBN13);
  assert.equal(status, FOUND);
  assert.equal(book.title, 'Linear Algebra Done Right');
  assert.deepEqual(book.authors, ['Sheldon Axler']);
  assert.deepEqual(sources, ['Crossref']);
  assert.equal(calls.filter((url) => url.includes('crossref')).length, 1);
});

test('Crossref is still asked when another catalogue fell over', async () => {
  // Google's shared keyless quota is spent most of the time. Gating the last
  // resort on a clean sweep meant it was almost never reached.
  const calls = stubFetch([
    ['openlibrary.org', {}],
    ['googleapis.com', errorResponse(429)],
    ['api.crossref.org', { message: { items: [{ title: ['Found Anyway'], ISBN: [ISBN13] }] } }],
  ]);
  const { status, book } = await lookupIsbn(ISBN13);
  assert.equal(calls.filter((url) => url.includes('crossref')).length, 1);
  assert.equal(status, FOUND);
  assert.equal(book.title, 'Found Anyway');
});

/* --------------------------------------------------------------- correctness */

test('a Google result that does not carry the ISBN is refused, not catalogued', async () => {
  stubFetch([
    ['openlibrary.org', {}],
    [
      'googleapis.com',
      {
        items: [
          {
            volumeInfo: {
              title: 'A Completely Different Book',
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780000000002' }],
            },
          },
        ],
      },
    ],
    ['api.crossref.org', { message: { items: [] } }],
  ]);
  const { status, book } = await lookupIsbn(ISBN13);
  assert.equal(status, NOT_FOUND);
  assert.equal(book, null, 'better nothing than the wrong book under this barcode');
});

test('a Google result carrying the ISBN-10 is accepted, since that is the same book', async () => {
  stubFetch([
    ['openlibrary.org', {}],
    ['googleapis.com', googleHit(ISBN10, { industryIdentifiers: [{ type: 'ISBN_10', identifier: ISBN10 }] })],
  ]);
  const { status, book } = await lookupIsbn(ISBN13);
  assert.equal(status, FOUND);
  assert.equal(book.pages, 96);
});

test('the right volume is picked out of several, not simply the first', async () => {
  stubFetch([
    ['openlibrary.org', {}],
    [
      'googleapis.com',
      {
        items: [
          { volumeInfo: { title: 'Study Guide', industryIdentifiers: [{ identifier: '9780000000002' }] } },
          { volumeInfo: { title: 'Fantastic Mr. Fox', pageCount: 96, industryIdentifiers: [{ identifier: ISBN13 }] } },
        ],
      },
    ],
  ]);
  const { book } = await lookupIsbn(ISBN13);
  assert.equal(book.title, 'Fantastic Mr. Fox');
});

test('nonsense page counts and years are dropped rather than stored', async () => {
  stubFetch([
    ['openlibrary.org', openLibraryHit(ISBN13, { number_of_pages: 0, publish_date: '0912' })],
    ['googleapis.com', { totalItems: 0 }],
  ]);
  const { book } = await lookupIsbn(ISBN13);
  assert.equal(book.pages, null);
  assert.equal(book.year, null);
});

test('a title-less ISBN is not a lookup at all', async () => {
  const calls = stubFetch([['openlibrary.org', {}]]);
  assert.equal((await lookupIsbn('not-an-isbn')).status, NOT_FOUND);
  assert.equal(calls.length, 0, 'and costs no request');
});

test('a book with no cover anywhere still gets the Open Library cover URL to try', async () => {
  stubFetch([
    ['openlibrary.org', openLibraryHit(ISBN13)],
    ['googleapis.com', { totalItems: 0 }],
  ]);
  const { book } = await lookupIsbn(ISBN13);
  assert.equal(book.coverUrl, coverUrlFor(ISBN13));
});

/* ------------------------------------------------------------------- honesty */

test('unavailable means every catalogue was silent, not merely one of them', async () => {
  stubFetch([
    ['openlibrary.org', errorResponse(503)],
    ['googleapis.com', errorResponse(429)],
    ['api.crossref.org', errorResponse(503)],
  ]);
  const outcome = await lookupIsbn(ISBN13);
  assert.equal(outcome.status, UNAVAILABLE);
  assert.equal(outcome.partial, false, 'nothing answered, so there is no partial verdict to give');
});

test('a catalogue that failed does not overrule one that answered', async () => {
  // The case that made the app unusable: Google rations keyless callers
  // against one globally shared quota, so its 429 is the normal state of the
  // world. Every clean Open Library miss was being reported as "could not be
  // reached", and the retry it offered could never help.
  stubFetch([
    ['openlibrary.org', {}],
    ['googleapis.com', errorResponse(429)],
    ['api.crossref.org', { message: { items: [] } }],
  ]);
  const outcome = await lookupIsbn(ISBN13);
  assert.equal(outcome.status, NOT_FOUND, 'two catalogues gave a straight answer');
  assert.equal(outcome.partial, true, 'but one did not, so it is worth asking again');
});

test('a 404 is a real miss, and a whole-sweep miss is not partial', async () => {
  stubFetch([
    ['openlibrary.org', errorResponse(404)],
    ['googleapis.com', errorResponse(404)],
    ['api.crossref.org', errorResponse(404)],
  ]);
  const outcome = await lookupIsbn(ISBN13);
  assert.equal(outcome.status, NOT_FOUND);
  assert.equal(outcome.partial, false);
});

test('a verdict reached with a catalogue missing is not remembered', async () => {
  const calls = stubFetch([
    ['openlibrary.org', {}],
    ['googleapis.com', errorResponse(429)],
    ['api.crossref.org', { message: { items: [] } }],
  ]);
  await lookupIsbn(ISBN13);
  const first = calls.length;
  await lookupIsbn(ISBN13);
  assert.ok(calls.length > first, 'the silent catalogue may have come back');
});

test('a hit reached while a catalogue was silent still says so', async () => {
  stubFetch([
    ['openlibrary.org', openLibraryHit(ISBN13)],
    ['googleapis.com', errorResponse(429)],
  ]);
  const outcome = await lookupIsbn(ISBN13);
  assert.equal(outcome.status, FOUND);
  assert.equal(outcome.partial, true, 'the page count Google would have added is missing');
});

test('a key of your own is sent to Google Books when one has been set', async () => {
  const calls = stubFetch([['openlibrary.org', {}], ['googleapis.com', { totalItems: 0 }], ['crossref', { message: { items: [] } }]]);
  setGoogleBooksKey('  abc123  ');
  await lookupIsbn(ISBN13);
  assert.ok(calls.some((url) => url.includes('key=abc123')), `expected a key, got ${calls}`);

  clearLookupCache();
  setGoogleBooksKey('');
  const bare = stubFetch([['openlibrary.org', {}], ['googleapis.com', { totalItems: 0 }], ['crossref', { message: { items: [] } }]]);
  await lookupIsbn(ISBN13);
  assert.ok(!bare.some((url) => url.includes('key=')), 'and none when there is none to send');
});

test('a dropped request is retried once before it is believed', async () => {
  let attempts = 0;
  stubFetch([
    [
      'openlibrary.org',
      () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('network error');
        return jsonResponse(openLibraryHit(ISBN13));
      },
    ],
    ['googleapis.com', { totalItems: 0 }],
  ]);
  const { status, book } = await lookupIsbn(ISBN13);
  assert.equal(attempts, 2);
  assert.equal(status, FOUND);
  assert.equal(book.title, 'Fantastic Mr. Fox');
});

/* -------------------------------------------------------------------- caching */

test('the same ISBN is not looked up twice, and a miss is remembered too', async () => {
  const hit = stubFetch([['openlibrary.org', openLibraryHit(ISBN13)], ['googleapis.com', { totalItems: 0 }]]);
  await lookupIsbn(ISBN13);
  const first = hit.length;
  await lookupIsbn(ISBN13);
  assert.equal(hit.length, first, 'a repeat scan costs nothing');

  clearLookupCache();
  const miss = stubFetch([['openlibrary.org', {}], ['googleapis.com', { totalItems: 0 }], ['crossref', { message: { items: [] } }]]);
  assert.equal((await lookupIsbn(ISBN13)).status, NOT_FOUND);
  const after = miss.length;
  await lookupIsbn(ISBN13);
  assert.equal(miss.length, after);
});

test('an unreachable catalogue is never cached — that is the one worth retrying', async () => {
  const calls = stubFetch([['openlibrary.org', errorResponse(429)], ['googleapis.com', errorResponse(429)]]);
  await lookupIsbn(ISBN13);
  const first = calls.length;
  await lookupIsbn(ISBN13);
  assert.ok(calls.length > first);
});

test('refresh goes back to the network even on a remembered answer', async () => {
  const calls = stubFetch([['openlibrary.org', openLibraryHit(ISBN13)], ['googleapis.com', { totalItems: 0 }]]);
  await lookupIsbn(ISBN13);
  const first = calls.length;
  await lookupIsbn(ISBN13, { refresh: true });
  assert.ok(calls.length > first);
});

/* --------------------------------------------------------------------- search */

test('an ISBN pasted into the title box is looked up, not text-searched', async () => {
  const calls = stubFetch([
    ['openlibrary.org/api/books', openLibraryHit(ISBN13)],
    ['googleapis.com', { totalItems: 0 }],
  ]);
  const results = await searchByText('978-0-14-032872-1');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Fantastic Mr. Fox');
  assert.equal(results[0].isbn, ISBN13);
  assert.ok(!calls.some((url) => url.includes('search.json')), 'the text index was not consulted');
});

test('a title search still searches, and drops results with no title', async () => {
  stubFetch([
    [
      'search.json',
      {
        docs: [
          { title: 'Fantastic Mr. Fox', author_name: ['Roald Dahl'], first_publish_year: 1970, isbn: [ISBN13] },
          { author_name: ['Nobody'] },
        ],
      },
    ],
  ]);
  const results = await searchByText('fantastic mr fox');
  assert.equal(results.length, 1);
  assert.equal(results[0].isbn, ISBN13);
  assert.equal(results[0].year, 1970);
});
