/**
 * Validate the store package before anybody uploads it.
 *
 * The Chrome Web Store rejects on things that are cheap to check and
 * expensive to discover: a field over its character limit, a missing icon
 * size, a file referenced but not packed. A rejection also costs a review
 * cycle, which is days rather than minutes, so the check belongs here rather
 * than in the upload form.
 *
 *   node scripts/check-package.mjs muscle-memory.zip
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const zip = resolve(process.argv[2] || 'muscle-memory.zip');
const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
  .split('\n').map((s) => s.trim()).filter(Boolean).filter((n) => !n.endsWith('/'));

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const problems = [];
const notes = [];

// Store limits, as the dashboard enforces them.
if (manifest.name.length > 45) problems.push(`name is ${manifest.name.length} chars, limit 45`);
if (manifest.description.length > 132) problems.push(`description is ${manifest.description.length} chars, limit 132`);
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`version "${manifest.version}" is not a valid extension version`);

for (const size of ['16', '48', '128']) {
  const icon = manifest.icons && manifest.icons[size];
  if (!icon) problems.push(`no ${size}px icon declared`);
  else if (!listing.includes(icon)) problems.push(`${size}px icon declared but not packed: ${icon}`);
}

// Everything the manifest points at has to be inside the zip, or the
// extension installs and then fails in a way only the user sees.
function walk(value) {
  if (typeof value === 'string') {
    if (/\.(js|html|css|png|json)$/.test(value) && !listing.includes(value)) {
      problems.push(`referenced but not packed: ${value}`);
    }
  } else if (Array.isArray(value)) value.forEach(walk);
  else if (value && typeof value === 'object') Object.values(value).forEach(walk);
}
walk(manifest);

// Nothing that is not the extension. A stray test or dotfile is not a
// rejection, but it is a bigger review surface and a wider licence question.
const allowed = /^(manifest\.json|src\/|icons\/)/;
for (const name of listing) {
  if (!allowed.test(name)) problems.push(`unexpected file in the package: ${name}`);
  if (/(^|\/)\./.test(name)) problems.push(`hidden file in the package: ${name}`);
}

// Things that make a review go badly, checked in the packed sources only.
for (const name of listing.filter((n) => n.endsWith('.js'))) {
  const body = readFileSync(name, 'utf8');
  for (const [pattern, why] of [
    [/\beval\s*\(/, 'eval()'],
    [/new\s+Function\s*\(/, 'new Function()'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/, 'a network call'],
    [/\.innerHTML\s*=/, 'innerHTML assignment'],
  ]) {
    if (pattern.test(body)) problems.push(`${name} contains ${why}, which the listing says it does not`);
  }
}

if (manifest.permissions) notes.push(`permissions: ${manifest.permissions.join(', ')}`);
if (manifest.host_permissions) notes.push(`host_permissions: ${manifest.host_permissions.join(', ')}`);
for (const cs of manifest.content_scripts || []) notes.push(`content script on: ${cs.matches.join(', ')}`);

console.log(`${listing.length} files packed`);
for (const note of notes) console.log(`  ${note}`);
if (problems.length) {
  console.error('\nProblems:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nPackage looks acceptable to the store.');
