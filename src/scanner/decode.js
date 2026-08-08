/**
 * Barcode decoding.
 *
 * Two engines behind one interface:
 *   - `BarcodeDetector`, the platform API. Present on Android Chrome and
 *     recent desktop Chrome, hardware-accelerated, costs us nothing.
 *   - zbar compiled to WebAssembly, loaded on demand for everything else —
 *     notably iOS Safari, which has no BarcodeDetector and is exactly where
 *     an installed book-scanning PWA is most likely to run.
 *
 * The wasm engine is imported lazily so devices with the native API never
 * download it.
 */

const BOOK_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'isbn_13'];

const ZBAR_URL = new URL('../../vendor/zbar-wasm/index.mjs', import.meta.url);

let zbarPromise = null;

async function loadZbar() {
  if (!zbarPromise) {
    zbarPromise = import(/* @vite-ignore */ ZBAR_URL.href).then(async (zbar) => {
      const scanner = await zbar.ZBarScanner.create();
      const { ZBarSymbolType: Type, ZBarConfigType: Config } = zbar;
      // Start from nothing and enable only the retail symbologies a book
      // barcode can use: fewer symbologies means fewer false reads per frame.
      scanner.setConfig(Type.ZBAR_NONE, Config.ZBAR_CFG_ENABLE, 0);
      for (const symbology of [
        Type.ZBAR_EAN13,
        Type.ZBAR_EAN8,
        Type.ZBAR_UPCA,
        Type.ZBAR_UPCE,
        Type.ZBAR_ISBN13,
        Type.ZBAR_ISBN10,
      ]) {
        scanner.setConfig(symbology, Config.ZBAR_CFG_ENABLE, 1);
      }
      scanner.setConfig(Type.ZBAR_NONE, Config.ZBAR_CFG_BINARY, 1);
      return { zbar, scanner };
    });
  }
  return zbarPromise;
}

export async function nativeSupportedFormats() {
  if (typeof BarcodeDetector === 'undefined') return [];
  try {
    const supported = await BarcodeDetector.getSupportedFormats();
    return BOOK_FORMATS.filter((format) => supported.includes(format));
  } catch {
    return [];
  }
}

/**
 * Pick an engine. Call once and reuse: both engines hold native resources.
 * @returns {Promise<{name: 'native'|'wasm', decode: (source: ImageData|HTMLCanvasElement) => Promise<string[]>}>}
 */
export async function createDecoder({ preferNative = true } = {}) {
  if (preferNative) {
    const formats = await nativeSupportedFormats();
    if (formats.length) {
      const detector = new BarcodeDetector({ formats });
      return {
        name: 'native',
        async decode(source) {
          try {
            const results = await detector.detect(source);
            return results.map((result) => result.rawValue).filter(Boolean);
          } catch {
            // A detached canvas or a frame mid-resize throws; skip the frame.
            return [];
          }
        },
      };
    }
  }

  const { zbar, scanner } = await loadZbar();
  return {
    name: 'wasm',
    async decode(source) {
      const imageData = source instanceof ImageData ? source : imageDataFrom(source);
      if (!imageData) return [];
      try {
        const image = await zbar.ZBarImage.createFromRGBABuffer(
          imageData.width,
          imageData.height,
          imageData.data.buffer,
        );
        try {
          const count = scanner.scan(image);
          if (count <= 0) return [];
          return image
            .getSymbols()
            .map((symbol) => symbol.decode('utf-8'))
            .filter(Boolean);
        } finally {
          image.destroy();
        }
      } catch {
        return [];
      }
    },
  };
}

function imageDataFrom(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Confirms a code only after seeing it more than once.
 *
 * EAN-13 carries a check digit, so a single read is already unlikely to be
 * wrong — but a barcode half in frame next to another one on a shelf can
 * produce a valid-looking neighbour, and a second agreeing read costs about
 * a tenth of a second.
 */
export function createConfirmer({ needed = 2, windowMs = 1500 } = {}) {
  const seen = new Map();
  return {
    /** @returns {string|null} the value once it has been confirmed */
    offer(value, now = Date.now()) {
      for (const [key, entry] of seen) {
        if (now - entry.first > windowMs) seen.delete(key);
      }
      const entry = seen.get(value) ?? { count: 0, first: now };
      entry.count += 1;
      seen.set(value, entry);
      if (entry.count >= needed) {
        seen.delete(value);
        return value;
      }
      return null;
    },
    reset() {
      seen.clear();
    },
  };
}
