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

- **Scan** the EAN-13 barcode on a book and it is catalogued in a couple of
  seconds — the scanner keeps running so you can work through a whole shelf.
- **Rank** every book 0–5 stars, or hand it a **bomb** for the ones that are
  not merely weak but actively bad. Zero stars and a bomb are different
  verdicts, and a bomb sorts below zero.
- **Shelve** books as Want to read → Reading → Read, or Abandoned. Start and
  finish dates fill themselves in.
- **Find** anything by title, author, tag or note, filter by shelf, and sort by
  rating, title, author or date.
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
sw.js                 offline caching — precached shell, cached covers
assets/app.css        one stylesheet, mobile-first, light and dark
src/
  app.js              bootstrap: store, router, tab bar, service worker
  router.js           hash routing (works from any static subpath)
  lib/                isbn, model, query, transfer, db, metadata, store
  scanner/            decode (BarcodeDetector or wasm) + camera loop
  ui/                 dom helpers, rating control, cards, toasts
  views/              library, scan, stats, settings, book sheet
vendor/zbar-wasm/     barcode decoder, unmodified upstream (see Licence)
```

**Storage.** Books live in IndexedDB, and covers are stored beside them as
blobs so a shelf still looks like a shelf on a plane. The whole library is held
in memory and written through, so no render ever waits on the database.

**Barcodes.** Where the platform provides `BarcodeDetector` — Android Chrome,
recent desktop Chrome — that is used. Everywhere else, notably **iOS Safari**,
a 240 KB WebAssembly build of zbar is fetched on first use and then kept. Each
frame is cropped to the on-screen guide and downscaled before decoding, and a
code has to be read twice before it counts.

**Metadata** comes from Open Library, falling back to Google Books. Neither
needs a key. When both are unreachable you can still type the book in, and the
ISBN is kept either way.

## Your data

It never leaves the device except as an ISBN sent to a lookup service. That
also means nothing is backing it up for you, so **More → Export** writes a JSON
file that imports back exactly. Re-importing is safe: books are matched on
ISBN, then id, then title and author, and the more recently edited copy of a
book wins. There is a CSV export too, for spreadsheets.

## Development

```sh
npm start          # serve on :8080
npm run check      # parse every module, verify imports and the precache list
npm test           # unit tests (node:test, no dependencies)
npm run test:e2e   # browser tests — needs Playwright, see below
npm run icons      # regenerate the PNG icons from scripts/generate-icons.mjs
```

The browser tests drive a real Chromium: they add and rate books, reload to
prove persistence, cut the network to prove the offline claim, and decode
synthesised EAN-13 barcodes through the same wasm path iOS uses. Playwright is
not a dependency of the project, so install it when you want to run them:

```sh
npm install --no-save playwright && npx playwright install chromium
npm run test:e2e
```

`npm run check` is worth running before a commit: with no bundler, a mistyped
import path and a service worker precache list that has drifted are both
invisible until the app is already broken in someone's browser.

## Deploying

Push to `main` and the Pages workflow publishes the repository as-is. For any
other host, upload `index.html`, `manifest.webmanifest`, `sw.js`, `assets/`,
`src/` and `vendor/`. Paths are relative throughout, so serving from a
subdirectory works without configuration.

## Licence

liboff is MIT licensed — see [LICENSE](LICENSE).

`vendor/zbar-wasm/` is a verbatim copy of
[@undecaf/zbar-wasm](https://github.com/undecaf/zbar-wasm) 0.11.0, which is
**LGPL-2.1-or-later**. It is used unmodified as a separate, dynamically
imported module and is not linked into the rest of the app; its licence text
sits alongside it, and [NOTICE](NOTICE) records how to replace it. CI checks
the vendored files still match upstream byte for byte.

Book metadata and cover art come from
[Open Library](https://openlibrary.org/developers/api) and
[Google Books](https://developers.google.com/books).
