/**
 * Service worker.
 *
 * Caching policy, chosen by what the request is for:
 *
 *   app shell    precached, then stale-while-revalidate — opens instantly and
 *                with no network, navigations included, while a redeployed
 *                file still reaches the app on the visit after it lands
 *   wasm decoder runtime, cache-first — 240 KB, only fetched by browsers that
 *                lack BarcodeDetector, and immutable once fetched
 *   covers       runtime, cache-first — immutable once fetched
 *   metadata     network only — a stale ISBN lookup helps nobody
 *
 * The shell is deliberately not cache-first. This app has no build step and so
 * no content hashes in its filenames: cache-first would serve the first
 * version a device ever saw until CACHE_VERSION happened to be bumped by hand,
 * which is exactly the kind of thing that gets forgotten and strands users on
 * old code. Revalidating in the background costs one conditional request per
 * asset while online and nothing at all while offline.
 *
 * CACHE_VERSION only needs bumping to discard old caches wholesale.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `liboff-shell-${CACHE_VERSION}`;
const COVER_CACHE = `liboff-covers-${CACHE_VERSION}`;
const LAZY_CACHE = `liboff-lazy-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/app.css',
  'assets/icons/favicon.svg',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
  'assets/icons/apple-touch-icon.png',
  'src/app.js',
  'src/router.js',
  'src/install.js',
  'src/lib/db.js',
  'src/lib/isbn.js',
  'src/lib/metadata.js',
  'src/lib/model.js',
  'src/lib/query.js',
  'src/lib/store.js',
  'src/lib/transfer.js',
  'src/scanner/camera.js',
  'src/scanner/decode.js',
  'src/ui/book-card.js',
  'src/ui/dom.js',
  'src/ui/rating.js',
  'src/ui/toast.js',
  'src/views/book-sheet.js',
  'src/views/library.js',
  'src/views/scan.js',
  'src/views/settings.js',
  'src/views/stats.js',
];

const COVER_HOSTS = ['covers.openlibrary.org', 'books.google.com', 'books.googleusercontent.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll is all-or-nothing; one 404 would leave the app uninstallable,
      // so each asset is added individually and failures are reported.
      await Promise.all(
        SHELL_ASSETS.map(async (asset) => {
          try {
            await cache.add(new Request(asset, { cache: 'reload' }));
          } catch (error) {
            console.warn('liboff sw: could not precache', asset, error);
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, COVER_CACHE, LAZY_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/**
 * Answer from cache immediately, then refresh the entry in the background so
 * the next load gets the newer file. `event.waitUntil` keeps the worker alive
 * for the refresh after the response has already gone out.
 */
async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) ?? new Response('', { status: 504, statusText: 'Offline' });
}

/**
 * The SPA shell for any in-scope navigation.
 *
 * Same policy as the rest of the shell — answer from cache, refresh behind —
 * so launching an installed app never waits on a network round trip for its
 * HTML. Any in-scope URL falls back to index.html, because the route lives in
 * the hash and the document is always the same one.
 */
async function shellResponse(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached =
    (await cache.match(request)) ?? (await cache.match('index.html')) ?? (await cache.match('./'));

  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (
    (await refresh) ??
    new Response('liboff is offline and has no cached copy yet.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    })
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (COVER_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, COVER_CACHE).catch(() => Response.error()));
    return;
  }

  // Anything else cross-origin is a metadata lookup: always try the network,
  // and let it fail cleanly offline rather than serving a stale answer.
  if (url.origin !== self.location.origin) return;

  // The wasm decoder is deliberately outside the precache — only the browsers
  // that need it pay for it, and then only once.
  if (url.pathname.includes('/vendor/zbar-wasm/')) {
    event.respondWith(cacheFirst(request, LAZY_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(shellResponse(event, request));
    return;
  }

  event.respondWith(
    staleWhileRevalidate(event, request, SHELL_CACHE).catch(
      () => new Response('', { status: 504, statusText: 'Offline' }),
    ),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
