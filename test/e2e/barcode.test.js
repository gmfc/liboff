/**
 * Exercises the scanner against real barcode images.
 *
 * These run against the WebAssembly decoder, because Linux Chromium has no
 * BarcodeDetector — which is the same path iOS Safari takes, and the one most
 * likely to break silently.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { launchBrowser, loadPlaywright, openApp, startServer, SKIP_REASON } from './harness.mjs';
import { encodeEan13 } from './ean13.mjs';

const playwright = loadPlaywright();

/**
 * Draws an EAN-13 symbol into a canvas inside the page and decodes it with the
 * app's own decoder — the same call the camera loop makes on every frame.
 */
async function drawAndDecode({ modules, moduleWidth, height, quiet, rotate, blur }) {
  const width = (modules.length + quiet * 2) * moduleWidth;
  const canvas = document.createElement('canvas');
  canvas.width = rotate ? height : width;
  canvas.height = rotate ? width : height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (rotate) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  }
  ctx.fillStyle = '#000';
  modules.forEach((bit, index) => {
    if (bit) ctx.fillRect((index + quiet) * moduleWidth, 0, moduleWidth, height);
  });

  let source = canvas;
  if (blur) {
    // Blur the finished symbol in one pass. Setting ctx.filter before drawing
    // the bars would instead give each bar its own halo, which is not what a
    // defocused camera does.
    const soft = document.createElement('canvas');
    soft.width = canvas.width;
    soft.height = canvas.height;
    const softCtx = soft.getContext('2d', { willReadFrequently: true });
    softCtx.fillStyle = '#fff';
    softCtx.fillRect(0, 0, soft.width, soft.height);
    softCtx.filter = `blur(${blur}px)`;
    softCtx.drawImage(canvas, 0, 0);
    source = soft;
  }

  const { createDecoder } = await import('/src/scanner/decode.js');
  const decoder = await createDecoder({ preferNative: false });
  return { engine: decoder.name, values: await decoder.decode(source) };
}

async function decodeBarcode(page, code, overrides = {}) {
  const { modules } = encodeEan13(code);
  return page.evaluate(drawAndDecode, {
    modules,
    moduleWidth: 3,
    height: 120,
    quiet: 12,
    rotate: false,
    blur: 0,
    ...overrides,
  });
}

test('barcode scanning', { skip: playwright ? false : SKIP_REASON }, async (t) => {
  const server = await startServer();
  const browser = await launchBrowser(playwright);
  const { page, context } = await openApp(browser, server.origin);

  t.after(async () => {
    await context.close();
    await browser.close();
    await server.close();
  });

  await t.test('falls back to the bundled wasm decoder when the platform has no BarcodeDetector', async () => {
    const supported = await page.evaluate(() => typeof BarcodeDetector !== 'undefined');
    assert.equal(supported, false, 'this browser is expected to lack the native API');

    const { engine, values } = await decodeBarcode(page, '9780140328721');
    assert.equal(engine, 'wasm');
    assert.ok(values.length > 0, 'the wasm decoder read the symbol');
  });

  await t.test('reads the ISBN printed on a real book', async () => {
    const { values } = await decodeBarcode(page, '9780140328721');
    const { isbnFromBarcode } = await import('../../src/lib/isbn.js');
    const isbn = values.map(isbnFromBarcode).find(Boolean);
    assert.equal(isbn, '9780140328721');
  });

  await t.test('reads a 979-prefixed ISBN', async () => {
    const { values } = await decodeBarcode(page, '9791234567896');
    const { isbnFromBarcode } = await import('../../src/lib/isbn.js');
    assert.equal(values.map(isbnFromBarcode).find(Boolean), '9791234567896');
  });

  await t.test('reads a barcode held sideways', async () => {
    const { values } = await decodeBarcode(page, '9780261102217', { rotate: true });
    const { isbnFromBarcode } = await import('../../src/lib/isbn.js');
    assert.equal(values.map(isbnFromBarcode).find(Boolean), '9780261102217');
  });

  // 1.5px of blur on 4px modules: a real hand-held miss-focus, and comfortably
  // inside the decoder's measured limit of about 2px at this module width.
  await t.test('reads a slightly out-of-focus barcode', async () => {
    const { values } = await decodeBarcode(page, '9780571311576', { blur: 1.5, moduleWidth: 4 });
    const { isbnFromBarcode } = await import('../../src/lib/isbn.js');
    assert.equal(values.map(isbnFromBarcode).find(Boolean), '9780571311576');
  });

  await t.test('a non-book EAN is decoded but rejected as a book', async () => {
    const { values } = await decodeBarcode(page, '4006381333931');
    const { isbnFromBarcode } = await import('../../src/lib/isbn.js');
    assert.ok(values.includes('4006381333931'), 'the symbol itself still reads');
    assert.equal(values.map(isbnFromBarcode).find(Boolean), undefined, 'but it is not a book');
  });

  await t.test('an image with no barcode yields nothing rather than throwing', async () => {
    const values = await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 200;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(0, 0, 320, 200);
      const { createDecoder } = await import('/src/scanner/decode.js');
      const decoder = await createDecoder({ preferNative: false });
      return decoder.decode(canvas);
    });
    assert.deepEqual(values, []);
  });
});
