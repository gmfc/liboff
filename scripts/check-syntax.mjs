#!/usr/bin/env node
/**
 * A dependency-free stand-in for a linter.
 *
 * It checks the three things a project with no build step and a hand-written
 * service worker gets wrong most easily:
 *
 *   1. a file that does not parse;
 *   2. a module importing a path that does not exist — invisible until the
 *      browser tries to load it, because nothing bundles this app;
 *   3. a service worker precache list that has drifted from the files on disk,
 *      which shows up only as a broken app offline.
 *
 *   npm run check
 */

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

async function walk(directory, pattern) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(path, pattern)));
    else if (pattern.test(entry.name)) found.push(path);
  }
  return found;
}

const rel = (path) => relative(ROOT, path).split('\\').join('/');

/** Import specifiers, ignoring anything inside a comment. */
function importSpecifiers(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const specifiers = [];
  for (const pattern of [
    /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bnew URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g,
  ]) {
    for (const match of code.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

/* --------------------------------------------------------- parse + imports */

const modules = [
  ...(await walk(join(ROOT, 'src'), /\.js$/)),
  ...(await walk(join(ROOT, 'scripts'), /\.mjs$/)),
  ...(await walk(join(ROOT, 'test'), /\.(js|mjs)$/)),
  join(ROOT, 'sw.js'),
];

await Promise.all(
  modules.map(async (file) => {
    try {
      // `node --check` parses without executing, which is exactly what is
      // wanted here: importing a module would run it instead.
      await run(process.execPath, ['--check', file]);
    } catch (error) {
      problems.push(`${rel(file)}: ${String(error.stderr ?? error.message).trim().split('\n').slice(0, 3).join(' ')}`);
    }

    const source = await readFile(file, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue; // node builtins, bare packages
      if (!existsSync(resolve(dirname(file), specifier))) {
        problems.push(`${rel(file)}: imports "${specifier}", which does not exist`);
      }
    }
  }),
);

/* ------------------------------------------------- service worker precache */

const swSource = await readFile(join(ROOT, 'sw.js'), 'utf8');
const precached = new Set(
  [...swSource.matchAll(/^\s*'([^']+)',\s*$/gm)]
    .map((match) => match[1])
    .filter((entry) => /^(src|assets)\//.test(entry)),
);

const shipped = [
  ...(await walk(join(ROOT, 'src'), /\.js$/)),
  ...(await walk(join(ROOT, 'assets'), /\.(css|png|svg)$/)),
].map(rel);

for (const file of shipped) {
  if (!precached.has(file)) {
    problems.push(`sw.js: "${file}" ships but is not precached — it would be missing offline`);
  }
}
for (const entry of precached) {
  if (!existsSync(join(ROOT, entry))) {
    problems.push(`sw.js: precaches "${entry}", which does not exist`);
  }
}

/* -------------------------------------------------------------------- done */

if (problems.length) {
  console.error(`check failed with ${problems.length} problem(s):\n`);
  for (const problem of problems.sort()) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `check passed: ${modules.length} files parse, imports resolve, ${shipped.length} shipped assets are precached`,
);
