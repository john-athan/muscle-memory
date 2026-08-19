/**
 * Assert that every file the extension refers to is actually in the tree.
 *
 * The failure this prevents is quiet and hard to diagnose from the outside: a
 * file renamed in src/ but not in the manifest, or an options page linking a
 * stylesheet nobody ships, loads without complaint and simply does not work.
 * Chrome reports it, if at all, in a place the user will never look.
 *
 * Walks the manifest generically rather than checking a hand-written list,
 * since the list is exactly the thing that goes stale, and then follows the
 * src and href attributes out of the extension's own HTML pages.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const problems = [];
const checked = new Set();

function check(relative, why) {
  checked.add(relative);
  if (!existsSync(join(root, relative))) problems.push(`${why} -> ${relative}`);
}

/** Every string anywhere in the manifest that names a file we ship. */
function walk(value, path) {
  if (typeof value === 'string') {
    if (/\.(js|html|css|png|json)$/.test(value)) check(value, `manifest ${path}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  }
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
walk(manifest, '');

// The HTML pages carry a second, hand-maintained list of the same scripts.
for (const page of readdirSync(join(root, 'src')).filter((f) => f.endsWith('.html'))) {
  const rel = join('src', page);
  const html = readFileSync(join(root, rel), 'utf8');
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:|data:|#|mailto:)/.test(ref)) continue;
    check(join(dirname(rel), ref), `${rel}`);
  }
}

if (problems.length) {
  console.error('Referenced files that do not exist:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`checked ${checked.size} referenced files, all present`);
