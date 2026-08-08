#!/usr/bin/env node
/**
 * Generates the PNG app icons.
 *
 * Written against zlib and raw pixel buffers rather than a rasteriser so the
 * project keeps zero dependencies — `npm install` on this repo does nothing,
 * which is a property worth protecting for an app whose whole point is that it
 * is a folder of static files.
 *
 *   node scripts/generate-icons.mjs
 *
 * The mark is a row of books of differing widths standing on a shelf: at small
 * sizes it also reads as a barcode, which is what the app is for.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icons');

const PAPER = [0xfa, 0xf6, 0xef];
const ACCENT = [0xb4, 0x53, 0x1f];
const GOLD = [0xc9, 0x91, 0x1f];

/** Books as [x0, y0, x1, y1] in unit space, standing on the shelf. */
const BOOKS = [
  [0.235, 0.300, 0.335, 0.700],
  [0.352, 0.370, 0.427, 0.700],
  [0.444, 0.255, 0.556, 0.700],
  [0.573, 0.405, 0.640, 0.700],
  [0.657, 0.330, 0.765, 0.700],
];
const SHELF = [0.200, 0.722, 0.800, 0.788];

const SAMPLES = 4; // per axis, so 16 samples per pixel

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Coverage of a rounded rectangle at a point, in unit space. */
function insideRoundedRect(x, y, [x0, y0, x1, y1], radius) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
  if (r <= 0) return true;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * @param {number} size  pixel dimension
 * @param {{bleed?: boolean, scale?: number}} options
 *        `bleed` fills the whole square (maskable and iOS, which apply their
 *        own mask); otherwise the background is a rounded square.
 *        `scale` shrinks the glyph towards the centre for the maskable safe zone.
 */
function renderIcon(size, { bleed = false, scale = 1 } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (SAMPLES + 1);
  const bgRadius = 0.22;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0;
      let glyphHits = 0;

      for (let sy = 1; sy <= SAMPLES; sy += 1) {
        for (let sx = 1; sx <= SAMPLES; sx += 1) {
          const x = (px + sx * step) / size;
          const y = (py + sy * step) / size;

          if (bleed || insideRoundedRect(x, y, [0, 0, 1, 1], bgRadius)) bgHits += 1;

          // Glyph coordinates, scaled about the centre.
          const gx = (x - 0.5) / scale + 0.5;
          const gy = (y - 0.5) / scale + 0.5;
          const onGlyph =
            BOOKS.some((book) => insideRoundedRect(gx, gy, book, 0.028)) ||
            insideRoundedRect(gx, gy, SHELF, 0.033);
          if (onGlyph) glyphHits += 1;
        }
      }

      const total = SAMPLES * SAMPLES;
      const bgAlpha = bgHits / total;
      const glyphAlpha = glyphHits / total;

      // Diagonal accent-to-gold gradient behind the mark.
      const t = Math.min(1, Math.max(0, (px / size) * 0.45 + (py / size) * 0.55));
      const background = mix(ACCENT, GOLD, t);
      const colour = mix(background, PAPER, glyphAlpha);
      // The glyph is always inside the background, so the background's own
      // coverage is what decides the pixel's alpha.
      const alpha = Math.round(bgAlpha * 255);

      const offset = (py * size + px) * 4;
      pixels[offset] = colour[0];
      pixels[offset + 1] = colour[1];
      pixels[offset + 2] = colour[2];
      pixels[offset + 3] = alpha;
    }
  }

  return pixels;
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ SVG */

function svgIcon() {
  const rect = ([x0, y0, x1, y1], r) =>
    `<rect x="${(x0 * 100).toFixed(1)}" y="${(y0 * 100).toFixed(1)}" width="${((x1 - x0) * 100).toFixed(1)}" height="${((y1 - y0) * 100).toFixed(1)}" rx="${(r * 100).toFixed(1)}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="liboff">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b4531f"/>
      <stop offset="1" stop-color="#c9911f"/>
    </linearGradient>
  </defs>
  <rect width="100" height="100" rx="22" fill="url(#g)"/>
  <g fill="#faf6ef">
    ${BOOKS.map((book) => rect(book, 0.028)).join('\n    ')}
    ${rect(SHELF, 0.033)}
  </g>
</svg>
`;
}

/* ----------------------------------------------------------------- main */

const TARGETS = [
  { file: 'icon-192.png', size: 192, options: {} },
  { file: 'icon-512.png', size: 512, options: {} },
  // Maskable icons are cropped to a circle inscribed in the middle 80%, so the
  // background bleeds to the edges and the mark shrinks into the safe zone.
  { file: 'maskable-512.png', size: 512, options: { bleed: true, scale: 0.68 } },
  // iOS applies its own squircle mask and does not support transparency well.
  { file: 'apple-touch-icon.png', size: 180, options: { bleed: true, scale: 0.9 } },
];

mkdirSync(OUT_DIR, { recursive: true });

for (const target of TARGETS) {
  const pixels = renderIcon(target.size, target.options);
  writeFileSync(join(OUT_DIR, target.file), encodePng(target.size, pixels));
  console.log(`wrote ${target.file} (${target.size}×${target.size})`);
}

writeFileSync(join(OUT_DIR, 'favicon.svg'), svgIcon());
console.log('wrote favicon.svg');
