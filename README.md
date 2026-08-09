# liboff

Catalogue and rank your books by scanning the barcode on the back. Everything
lives on your phone — no account, no server, no network needed after the first
visit.

A minimal, installable take on Libib: a static progressive web app with no
build step and no dependencies.

```
┌──────────────┐   scan the barcode   ┌───────────────┐   rate it   ┌──────────┐
│  📖 a book   │ ───────────────────► │  ISBN lookup  │ ──────────► │  shelf   │
└──────────────┘      EAN-13          └───────────────┘  ★★★★☆ / 💣 └──────────┘
```

## What it does

- **Scan** the EAN-13 barcode on a book and it is catalogued in about half a
  second — three catalogues, asked under both widths of the ISBN, and their
  answers merged. The scanner keeps running so you can work through a shelf.
- **Rank** every book 0–5 stars, or hand it a **bomb** for the ones that are
  not merely weak but actively bad. Zero stars and a bomb are different
  verdicts, and a bomb sorts below zero.
- **Shelve** books as Want to read → Owned → Reading → Read, or Abandoned.
  Start and finish dates fill themselves in. *Owned* is the pile every reader
  has and most apps refuse to name: bought, on the shelf, not started. A book
  you mean to buy and a book already reproaching you from the bedside table
  are not the same thing.
- **Tag** freely — sci-fi, borrowed, signed — with the tags you already use
  offered as you type, so a library does not end up with "scifi" and "sci-fi"
  both meaning the same thing.
- **Collect** books into groups you name yourself: a book club, a series, the
  ones you keep lending out. A book can be in as many as you like, and each
  collection keeps its own order — by title and author, or the order you put
  them in when the sequence is the point.
- **Find** anything by title, author, tag, note, year or ISBN; filter by shelf,
  collection and tag together; sort by rating, title, author or date.
- **See** where your taste actually sits: rating distribution, average, pages
  read, and your ranked best.
- **Works offline.** The library, the covers and the barcode decoder are all on
  the device. Only ISBN lookups need the network, and the app tells you when
  they will have to wait.

## Try it

Any static file server will do — there is nothing to build.

```sh
npm start            # http://localhost:8080
```

Then open it on your phone and use **Add to Home Screen**. It opens full
screen and works with the network off.

> The camera needs a secure context. `localhost` counts; a phone on your LAN
> pointed at `http://192.168.x.x` does not, so use https (or a tunnel) when
> testing the scanner on a real device.

## How it is built

No framework, no bundler, no dependencies. The browser loads ES modules
directly, which is why `npm install` does nothing and the deployed site is
simply this repository.

```
index.html            app shell
manifest.webmanifest  installability
sw.js                 offline caching, and how updates reach the app
assets/app.css        one stylesheet, mobile-first, light and dark
src/
  app.js              bootstrap: store, router, tab bar
  router.js           hash routing (works from any static subpath)
  update.js           service worker registration and the update check
  lib/                isbn, model, collections, tags, query, transfer, db,
                      metadata, covers, store
  scanner/            decode (BarcodeDetector or wasm) + camera loop
  ui/                 dom helpers, rating control, cards, toasts
  views/              library, scan, stats, settings, book sheet
vendor/zbar-wasm/     barcode decoder, unmodified upstream (see Licence)
```

**Storage.** Books live in IndexedDB, and covers are stored beside them as
blobs so a shelf still looks like a shelf on a plane. The whole library is held
in memory and written through, so no render ever waits on the database.

**Covers.** Three candidates are tried in turn until one yields real bytes,
because a cover *URL* is not a cover — Open Library answers artwork it does not
have with a 404, and taking the first address any catalogue mentioned left
books blank that had a perfectly good cover one source over. Google's cover
server leads: it takes an ISBN directly, is not metered against the Books API
quota that regularly runs dry, and serves ~575px against the API's 128px
thumbnail. Over ten ISBNs this took covers found from 6 to 8, and made most of
the rest larger.

It has one trap. Asked for a book it has no artwork for, that server does not
send a 404 — it sends a grey image reading "image not available", byte-identical
for every such book. Stored unchecked, a shelf fills up with those, which is
worse than the placeholder this app draws itself (the title, on a colour
derived from it). Real covers come back as JPEG and the placeholder as PNG, and
that is the whole test.

**Some books have no artwork anywhere**, and no amount of catalogue-shopping
fixes that — a 2026 Brazilian paperback is not going to turn up in an American
scanning project. So a book's page will take a photo instead. It is re-encoded
to 700px on the way in, since a phone camera produces several megabytes and a
tile draws about two hundred pixels. Books with no ISBN can have one too.

**Shelves, tags and collections** are three different things on purpose:

| | what it is | how many per book | what happens when it empties |
|---|---|---|---|
| Shelf | where the book is in your reading | exactly one | — |
| Tag | a free-form label | any number | the tag ceases to exist |
| Collection | a group you assembled and named | any number | the collection remains, empty |

That last column is the whole distinction. A tag is derived from the books
carrying it, so it is counted on demand and never stored. A collection is a
record of its own, because an empty collection you just made is a real thing,
and the order you put books in is yours to choose — so membership lives on the
collection as an ordered list, not on the book as a set of names.

A collection also stores how it wants to be read. Books sort by title and then
author by default, which is how a shelf is usually kept, but a collection can
be set to any of the library's sorts or to the order you added things —
"read these in this order" is a real kind of list, and no comparator over the
books can express it. While a collection is open, the sort control belongs to
it rather than to the library, so setting "Book club" to file by author leaves
everything else alone.

**Updates.** The shell is precached so the app opens offline, then revalidated
in the background, so a redeployed file reaches an installed app on the visit
after it lands. That matters here because there is no build step and therefore
no content hashes in the filenames: a plain cache-first worker would pin every
device to the first version it ever saw until someone remembered to bump a
constant.

**More → Version → Check now** does it immediately. It deliberately does more
than `registration.update()`: that call only re-fetches `sw.js`, and with no
build step a deploy that changes a view leaves the worker byte-identical — so
it would find nothing and the app would report itself current while still
serving yesterday's files. The worker instead re-fetches every precached asset,
compares it byte for byte with what it holds, and reports how many actually
differ. Nothing changed means nothing changed; anything else reloads onto it.

**Barcodes.** Where the platform provides `BarcodeDetector` — Android Chrome,
recent desktop Chrome — that is used. Everywhere else, notably **iOS Safari**,
a 240 KB WebAssembly build of zbar is fetched on first use and then kept. Each
frame is cropped to the on-screen guide and downscaled before decoding, and a
code has to be read twice before it counts.

**Metadata.** Open Library and Google Books are asked at the same time and
their answers are *combined* — Open Library describes the edition in your
hands, Google usually knows how many pages it has, and taking whichever
replied first threw the other away on every lookup. Crossref is asked only
when both miss, since it indexes scholarly books the trade catalogues do not
carry. A Brazilian ISBN is also put to the Brazilian agency — CBL and Mercado
Editorial, through [BrasilAPI](https://brasilapi.com.br) — which leads the
merge for its own numbers, having registered them. None of them needs a key.

The national agency earns its place on measurement rather than principle. Over
six Brazilian ISBNs, Open Library held one and CBL held five, **four of which
no other reachable catalogue had at all**. Only Brazilian numbers are sent
there: the endpoint rejects the rest, so asking would be a request that could
only fail, made against somebody's free service.

Other catalogues were tried and left out for reasons worth recording, since
"add another source" sounds free and is not. The Deutsche Nationalbibliothek
answers with CORS and no key, but every book it found here was one Open
Library already had — zero unique hits over the same sample, and K10plus
returned nothing at all. Harvard's LibraryCloud sends no CORS header, and
neither does PORBASE. Mercado Livre's API now needs an OAuth token. The
Internet Archive answers, but an `isbn:` search there returns scanning-batch
records rather than books. **Amazon and Kindle are not possible at all**: the
Product Advertising API needs signed credentials and a sales-qualified
associate account, product pages send no CORS header, and a static page with
no server of its own cannot work around either.

Three details do most of the work:

- **Both widths of the number are asked about**, in one request. A book printed
  before 2007 is often filed under its ISBN-10 while the barcode carries the
  ISBN-13, and asking about only the scanned form is how a book that is plainly
  catalogued comes back as unknown.
- **An answer has to carry the ISBN to be believed.** Open Library replies are
  keyed by the number asked for, so they verify themselves; Google's `isbn:` is
  a *search*, and a search can return something else. A confidently mislabelled
  book is worse than no book.
- **"Nobody catalogued this" and "the catalogue did not answer" are different
  things**, and the app says which. A service that is rate-limited or
  unreachable is retried once, then reported as what it is, with a button to
  try again. But a catalogue that failed never overrules one that answered:
  if anybody gave a straight "not here", that is the verdict, marked as reached
  with a source missing.

That last rule is not hypothetical. Google rations callers who bring no key of
their own against **a single quota shared by every such caller in the world**
(`project_number:624717413613`, the same consumer for everybody), and that pool
runs dry. Letting its 429 outvote a clean Open Library miss meant every
uncatalogued book reported "could not be reached", and the retry it offered
could never help. If you want Google Books back for good, **More → Lookups**
takes an API key of your own, which is a quota of your own; it stays on the
device like everything else here.

When nothing answers you can still type the book in, and the ISBN is kept
either way. Lookups made this session are remembered, so re-reading a barcode
costs nothing — except a verdict reached while a catalogue was silent, which is
never cached.

## Your data

It never leaves the device except as an ISBN sent to a lookup service. That
also means nothing is backing it up for you, so **More → Export** writes a JSON
file that imports back exactly — books, tags and collections. Re-importing is
safe: books are matched on ISBN, then id, then title and author, and the more
recently edited copy of a book wins. Collections match on id then name, and
merge as a union, since a book in either copy was put there deliberately.
Membership is rewritten onto local ids on the way in, so a restored collection
points at the books that are actually in the library. There is a CSV export
too, for spreadsheets.

## Development

```sh
npm start          # serve on :8080
npm run check      # parse every module, verify imports and the precache list
npm test           # unit tests (node:test, no dependencies)
npm run test:e2e   # browser tests — needs Playwright, see below (runs serially)
npm run icons      # regenerate the PNG icons from scripts/generate-icons.mjs
```

The browser tests drive a real Chromium: they add, rate, tag and collect books,
reload to prove persistence, upgrade a v1 database to prove nobody's existing
library is lost, cut the network to prove the offline claim, redeploy a file to
prove updates land, and decode synthesised EAN-13 barcodes through the same
wasm path iOS uses. Playwright is not a dependency of the project, so install
it when you want to run them:

```sh
npm install --no-save playwright && npx playwright install chromium
npm run test:e2e
```

They run **one file at a time** (`--test-concurrency=1`). The default is one
per core, which means five Chromiums at once, and the tests that wait on a
service worker — the update check especially, which re-fetches and compares
every precached asset — intermittently ran out of patience under that load.
Serially the suite takes about 50 seconds instead of 25 and does not flake.

`npm run check` is worth running before a commit: with no bundler, a mistyped
import path and a service worker precache list that has drifted are both
invisible until the app is already broken in someone's browser.

## Deploying

Pages needs switching on once, by hand: **Settings → Pages → Source: GitHub
Actions**. After that, every push to `main` publishes the repository as-is.

Two things that are easy to lose an afternoon to:

- The workflow token cannot do this for you. `actions/configure-pages` has an
  `enablement` option, but creating a Pages site needs repository-admin rights
  that `GITHUB_TOKEN` does not have, so it fails with "Resource not accessible
  by integration".
- **Pages on a private repository needs a paid GitHub plan.** On a free plan
  the repository has to be public for the site to publish at all.

For any other host, upload `index.html`, `manifest.webmanifest`, `sw.js`,
`assets/`, `src/` and `vendor/`. Paths are relative throughout, so serving from
a subdirectory works without configuration, and the browser tests cover that
case.

## Licence

liboff is MIT licensed — see [LICENSE](LICENSE).

`vendor/zbar-wasm/` is a verbatim copy of
[@undecaf/zbar-wasm](https://github.com/undecaf/zbar-wasm) 0.11.0, which is
**LGPL-2.1-or-later**. It is used unmodified as a separate, dynamically
imported module and is not linked into the rest of the app; its licence text
sits alongside it, and [NOTICE](NOTICE) records how to replace it. CI checks
the vendored files still match upstream byte for byte.

Book metadata and cover art come from
[Open Library](https://openlibrary.org/developers/api),
[Google Books](https://developers.google.com/books),
[Crossref](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
and, for Brazilian ISBNs, [BrasilAPI](https://brasilapi.com.br) carrying data
from CBL and Mercado Editorial.
