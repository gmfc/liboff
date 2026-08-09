/**
 * Browser-test plumbing.
 *
 * Playwright is deliberately not a dependency of this project — the app itself
 * has none, and keeping it that way means `npm install` stays a no-op. CI
 * installs it just before running these tests; if it is absent the suite skips
 * with an explanation rather than failing.
 */

import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStaticServer } from '../../scripts/serve.mjs';

const require = createRequire(import.meta.url);
export const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');

export function loadPlaywright() {
  try {
    return require('playwright');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return null;
  }
}

export const SKIP_REASON =
  'playwright is not installed — run `npm i --no-save playwright && npx playwright install chromium`';

/**
 * Playwright expects a browser build matching its own version. When the
 * environment supplies a different one (a preinstalled image, say), fall back
 * to whatever chromium is actually on disk instead of failing to launch.
 */
function findChromium() {
  if (process.env.LIBOFF_CHROMIUM && existsSync(process.env.LIBOFF_CHROMIUM)) {
    return process.env.LIBOFF_CHROMIUM;
  }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return null;
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith('chromium-')) continue;
    for (const candidate of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const path = join(base, entry, candidate);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

export async function launchBrowser(playwright) {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  try {
    return await playwright.chromium.launch({ args });
  } catch (error) {
    const executablePath = findChromium();
    if (!executablePath) throw error;
    return playwright.chromium.launch({ args, executablePath });
  }
}

/** Exactly what the Pages workflow uploads. */
const DEPLOYED = ['index.html', 'manifest.webmanifest', 'sw.js', 'assets', 'src', 'vendor'];

/**
 * Serves a throwaway copy of the site on an ephemeral port, so a test can
 * change a deployed file and observe what the app does about it.
 *
 * `basePath` puts the site in a subdirectory, the shape GitHub Pages serves a
 * project site in.
 */
export async function startMutableServer({ basePath = '' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'liboff-deploy-'));
  const siteDir = basePath ? join(root, basePath) : root;
  for (const entry of DEPLOYED) {
    await cp(join(ROOT, entry), join(siteDir, entry), { recursive: true });
  }
  const server = createStaticServer(root);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    /** The URL the app is actually served from. */
    url: basePath ? `${origin}/${basePath}/` : `${origin}/`,
    /** Rewrite a file as a deploy would. */
    async deploy(relativePath, transform) {
      const target = join(siteDir, relativePath);
      await writeFile(target, transform(await readFile(target, 'utf8')));
    },
    async close() {
      await new Promise((done) => server.close(done));
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** Serves the repository root on an ephemeral port. */
export async function startServer() {
  const server = createStaticServer(ROOT);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((done) => server.close(done));
    },
  };
}

export const PHONE = { width: 390, height: 844 };

/**
 * A phone-shaped context: this app is mobile-first, so test it that way.
 *
 * `isMobile` is deliberately off. It drives Chromium's meta-viewport emulation,
 * which settles asynchronously and intermittently leaves the page laid out at
 * the wrong scale — every coordinate-based click then lands somewhere else.
 * A plain 390px viewport with touch enabled exercises the same CSS
 * deterministically, which is what these tests are actually about.
 */
export async function openApp(browser, origin, options = {}) {
  const context = await browser.newContext({
    viewport: { ...PHONE },
    deviceScaleFactor: 2,
    hasTouch: true,
    ...options,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(new Error(message.text()));
  });
  await page.goto(`${origin}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('.tabbar', { timeout: 15000 });
  return { context, page, errors };
}

/**
 * Poll a value out of the page until it satisfies the predicate.
 *
 * Deliberately not `page.waitForFunction`. That takes whatever the page
 * function returns and tests it for truthiness — and an `async` function
 * returns a Promise, which is always truthy, so a wait written that way is
 * satisfied on its first poll without having waited for anything. Measured:
 * such a wait returned in 9 ms on a condition that was still false.
 *
 * Anything worth waiting for in this app is behind an `await` (the store, the
 * database), so the polling has to happen out here, where `page.evaluate` does
 * settle the promise.
 */
export async function waitFor(page, fn, arg, { timeout = 15000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await page.evaluate(fn, arg);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeout}ms`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/** Move between the four tabs. */
export async function goToTab(page, tab) {
  await page.click(`[data-tab="${tab}"]`);
  await page.waitForFunction((name) => location.hash === `#/${name}`, tab);
}
