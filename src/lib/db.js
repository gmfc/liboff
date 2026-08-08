/**
 * IndexedDB persistence.
 *
 * The whole library is held in memory by the store and written through to
 * IndexedDB, which is used rather than localStorage because cached cover
 * images are blobs and would otherwise blow the 5 MB string quota.
 *
 * If IndexedDB is unavailable (private windows on some browsers, blocked
 * storage) we fall back to an in-memory map so the app still runs for the
 * session instead of failing to boot.
 */

const DB_NAME = 'liboff';
// v2 added the collections store. Upgrades only ever add stores, so an
// existing library survives untouched.
const DB_VERSION = 2;
const BOOKS = 'books';
const COVERS = 'covers';
const META = 'meta';
const COLLECTIONS = 'collections';

let dbPromise = null;
let memoryFallback = null;

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('no indexedDB'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS)) {
        const store = db.createObjectStore(BOOKS, { keyPath: 'id' });
        store.createIndex('isbn', 'isbn', { unique: false });
        store.createIndex('shelf', 'shelf', { unique: false });
      }
      if (!db.objectStoreNames.contains(COVERS)) db.createObjectStore(COVERS);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(COLLECTIONS)) {
        db.createObjectStore(COLLECTIONS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    request.onblocked = () => reject(new Error('indexedDB blocked'));
  });
}

function useMemoryFallback() {
  if (!memoryFallback) {
    memoryFallback = {
      books: new Map(),
      covers: new Map(),
      meta: new Map(),
      collections: new Map(),
    };
  }
  return memoryFallback;
}

async function db() {
  if (memoryFallback) return null;
  if (!dbPromise) {
    dbPromise = openDatabase().catch((error) => {
      console.warn('liboff: falling back to in-memory storage —', error?.message ?? error);
      useMemoryFallback();
      return null;
    });
  }
  return dbPromise;
}

export function isPersistent() {
  return !memoryFallback;
}

function run(store, mode, work) {
  return db().then((database) => {
    if (!database) return work(null);
    return new Promise((resolve, reject) => {
      const tx = database.transaction(store, mode);
      const objectStore = tx.objectStore(store);
      let result;
      try {
        result = work(objectStore);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
  });
}

export async function loadBooks() {
  const database = await db();
  if (!database) return [...useMemoryFallback().books.values()];
  return new Promise((resolve, reject) => {
    const tx = database.transaction(BOOKS, 'readonly');
    const request = tx.objectStore(BOOKS).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function putBook(book) {
  const database = await db();
  if (!database) {
    useMemoryFallback().books.set(book.id, book);
    return book;
  }
  await run(BOOKS, 'readwrite', (store) => store.put(book));
  return book;
}

export async function deleteBook(id) {
  const database = await db();
  if (!database) {
    useMemoryFallback().books.delete(id);
    return;
  }
  await run(BOOKS, 'readwrite', (store) => store.delete(id));
}

/** Bulk replace, used by import and by "erase everything". */
export async function replaceAllBooks(books) {
  const database = await db();
  if (!database) {
    const memory = useMemoryFallback();
    memory.books.clear();
    for (const book of books) memory.books.set(book.id, book);
    return;
  }
  await run(BOOKS, 'readwrite', (store) => {
    store.clear();
    for (const book of books) store.put(book);
  });
}

/* ------------------------------------------------------------- collections */

export async function loadCollections() {
  const database = await db();
  if (!database) return [...useMemoryFallback().collections.values()];
  return new Promise((resolve, reject) => {
    const tx = database.transaction(COLLECTIONS, 'readonly');
    const request = tx.objectStore(COLLECTIONS).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function putCollection(collection) {
  const database = await db();
  if (!database) {
    useMemoryFallback().collections.set(collection.id, collection);
    return collection;
  }
  await run(COLLECTIONS, 'readwrite', (store) => store.put(collection));
  return collection;
}

export async function deleteCollection(id) {
  const database = await db();
  if (!database) {
    useMemoryFallback().collections.delete(id);
    return;
  }
  await run(COLLECTIONS, 'readwrite', (store) => store.delete(id));
}

export async function replaceAllCollections(collections) {
  const database = await db();
  if (!database) {
    const memory = useMemoryFallback();
    memory.collections.clear();
    for (const collection of collections) memory.collections.set(collection.id, collection);
    return;
  }
  await run(COLLECTIONS, 'readwrite', (store) => {
    store.clear();
    for (const collection of collections) store.put(collection);
  });
}

/**
 * Covers are cached as blobs so the library still renders its artwork with
 * the network off — the single most visible part of "offline".
 */
export async function putCover(isbn, blob) {
  if (!isbn || !blob) return;
  const database = await db();
  if (!database) {
    useMemoryFallback().covers.set(isbn, blob);
    return;
  }
  await run(COVERS, 'readwrite', (store) => store.put(blob, isbn));
}

export async function getCover(isbn) {
  if (!isbn) return null;
  const database = await db();
  if (!database) return useMemoryFallback().covers.get(isbn) ?? null;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(COVERS, 'readonly');
    const request = tx.objectStore(COVERS).get(isbn);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteCover(isbn) {
  if (!isbn) return;
  const database = await db();
  if (!database) {
    useMemoryFallback().covers.delete(isbn);
    return;
  }
  await run(COVERS, 'readwrite', (store) => store.delete(isbn));
}

export async function clearCovers() {
  const database = await db();
  if (!database) {
    useMemoryFallback().covers.clear();
    return;
  }
  await run(COVERS, 'readwrite', (store) => store.clear());
}

export async function getSetting(key, fallback = null) {
  const database = await db();
  if (!database) return useMemoryFallback().meta.get(key) ?? fallback;
  return new Promise((resolve, reject) => {
    const tx = database.transaction(META, 'readonly');
    const request = tx.objectStore(META).get(key);
    request.onsuccess = () => resolve(request.result ?? fallback);
    request.onerror = () => reject(request.error);
  });
}

export async function setSetting(key, value) {
  const database = await db();
  if (!database) {
    useMemoryFallback().meta.set(key, value);
    return;
  }
  await run(META, 'readwrite', (store) => store.put(value, key));
}

/**
 * Ask the browser not to evict us under storage pressure. Best effort: it is
 * granted silently on installed PWAs and refused elsewhere, and either way the
 * app works — so failure is not worth surfacing.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

export async function storageEstimate() {
  try {
    if (navigator.storage?.estimate) return await navigator.storage.estimate();
  } catch {
    /* ignore */
  }
  return null;
}
