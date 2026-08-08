#!/usr/bin/env node
/**
 * A static file server for local development and the browser tests.
 *
 * It exists because the app must be served over http for modules, service
 * workers and getUserMedia to work at all — opening index.html from the file
 * system will not do. Deployment needs nothing like this: any static host
 * serves the same directory as-is.
 *
 *   npm start -- --port 8080 --root .
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function parseArgs(argv) {
  const options = { port: 8080, root: '.' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port' || argv[i] === '-p') options.port = Number(argv[i + 1]);
    if (argv[i] === '--root' || argv[i] === '-r') options.root = argv[i + 1];
  }
  return options;
}

export function createStaticServer(rootDir) {
  const root = resolve(rootDir);

  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Refuse anything that escapes the served directory.
    const target = resolve(join(root, normalize(pathname)));
    if (target !== root && !target.startsWith(root + sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    try {
      const info = await stat(target);
      if (info.isDirectory()) {
        response.writeHead(302, { Location: `${pathname}/` }).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': info.size,
        // Never cache during development: the service worker is confusing
        // enough without a second layer of stale files on top of it.
        'Cache-Control': 'no-store',
        'Service-Worker-Allowed': '/',
      });
      createReadStream(target).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const { port, root } = parseArgs(process.argv.slice(2));
  const server = createStaticServer(root);
  server.listen(port, () => {
    console.log(`liboff serving ${resolve(root)}`);
    console.log(`  http://localhost:${port}/`);
  });
}
