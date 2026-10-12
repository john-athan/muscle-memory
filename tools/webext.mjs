#!/usr/bin/env node
/**
 * The checks and the packaging every browser extension in the fleet shares.
 *
 * This file is owned by oss-kit (templates/webext/webext.mjs) and copied byte
 * for byte into each extension's tools/. Do not edit the copy: change the
 * template and run `oss sync-tooling`, and `oss doctor` reports a copy that has
 * drifted. It is copied rather than fetched because CI runs in public
 * repositories and has to work without oss-kit.
 *
 * What differs between extensions lives in webext.json beside the manifest,
 * so a difference is a declared fact rather than a fork of this file.
 *
 *   node tools/webext.mjs validate        every shared check, then package
 *   node tools/webext.mjs package         build the store zip and check it
 *   node tools/webext.mjs check [zip]     check a zip that already exists
 *
 * No dependencies: node, zip, unzip, git and python3 (for the SVG parse) are
 * on every machine and runner this has to work on.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

const read = (f) => readFileSync(f, 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const config = JSON.parse(read('webext.json'));
const version = manifest.version;
const zipName = config.zip.replace('{version}', version);

let failed = 0;
const step = (title) => console.log(`\n== ${title}`);
const fail = (msg) => { console.error(`FAIL: ${msg}`); failed = 1; };
const ok = (msg) => console.log(`ok ${msg}`);

// Every string in the manifest that names a file, wherever it sits.
function manifestFiles() {
  const out = new Set();
  (function walk(v) {
    if (typeof v === 'string') { if (/^[\w./-]+\.(js|html|css|png|json)$/.test(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  })(manifest);
  return out;
}

// ---------------------------------------------------------------- validate --

function checkManifest() {
  step('manifest.json is well-formed and consistent');
  if (manifest.manifest_version !== 3) fail('not manifest v3');
  // oss release bumps x.y.z; the store would take four parts, the fleet does not.
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`version ${version} is not x.y.z, which oss release needs`);
  if (manifest.name.length > 45) fail(`name is ${manifest.name.length} chars, the store caps it at 45`);
  if (manifest.description.length > 132) fail(`description is ${manifest.description.length} chars, the store caps it at 132`);
  for (const f of manifestFiles()) if (!existsSync(f)) fail(`manifest points at a missing file: ${f}`);
  for (const size of ['16', '48', '128']) if (!manifest.icons?.[size]) fail(`no ${size}px icon declared`);

  // The permission list is the privacy claim. Anything beyond what webext.json
  // admits to is a change someone has to have meant.
  const hosts = config.hosts ?? [];
  for (const h of manifest.host_permissions ?? []) if (!hosts.includes(h)) fail(`host permission not in webext.json: ${h}`);
  const pages = config.contentScripts ?? [];
  for (const cs of manifest.content_scripts ?? []) {
    for (const m of cs.matches) if (!pages.includes(m)) fail(`content script on a page not in webext.json: ${m}`);
  }
  if (!failed) ok(`manifest, version ${version}`);
}

function checkParse() {
  step('JavaScript parses');
  const files = execFileSync('git', ['ls-files', '*.js', '*.mjs'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const f of files) {
    if (!existsSync(f)) continue; // deleted in the working tree, not yet committed
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); ok(f); }
    catch (e) { fail(`${f} does not parse\n${e.stderr}`); }
  }
}

function checkSvg() {
  step('Inline SVG is well-formed');
  // Node has no XML parser and a regex is not one. python3 is on every runner.
  const py = `
import glob, re, sys, xml.etree.ElementTree as ET
bad = 0
for path in sorted(glob.glob('docs/*.html') + glob.glob('meta/*.html') + glob.glob('meta/*.svg')):
    for i, svg in enumerate(re.findall(r'<svg\\b.*?</svg>', open(path, encoding='utf-8').read(), re.S)):
        try:
            ET.fromstring(svg)
        except Exception as e:
            bad += 1
            print(f'FAIL {path} svg#{i+1}: {e}')
print('broken SVG blocks:', bad)
sys.exit(1 if bad else 0)
`;
  try { console.log(execFileSync('python3', ['-c', py], { encoding: 'utf8' }).trim()); }
  catch (e) { console.log(e.stdout); fail('an SVG block does not parse'); }
}

function checkDependencies() {
  step('Dependencies');
  if (config.dependencies) return ok('webext.json allows a package.json');
  const found = ['package.json', 'package-lock.json', 'yarn.lock', 'node_modules'].filter(existsSync);
  if (found.length) fail(`a dependency appeared in a project that is supposed to have none: ${found.join(', ')}`);
  else ok('still no dependencies');
}

function imageSize(path) {
  const d = readFileSync(path);
  if (d.readUInt32BE(0) === 0x89504e47) return [d.readUInt32BE(16), d.readUInt32BE(20)];
  // JPEG: walk the segments to the frame header.
  for (let i = 2; i < d.length;) {
    const marker = d[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return [d.readUInt16BE(i + 7), d.readUInt16BE(i + 5)];
    }
    i += 2 + d.readUInt16BE(i + 2);
  }
  throw new Error(`${path} is neither PNG nor JPEG`);
}

// Alpha of an 8-bit RGBA PNG, unfiltered by hand, for the store icon margin.
function alphaAt(path) {
  const d = readFileSync(path);
  const w = d.readUInt32BE(16), h = d.readUInt32BE(20);
  if (d[24] !== 8 || d[25] !== 6) return null;
  const idat = [];
  for (let off = 8; off < d.length;) {
    const len = d.readUInt32BE(off);
    if (d.toString('latin1', off + 4, off + 8) === 'IDAT') idat.push(d.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? line[x - 4] : 0, b = prev[x], c = x >= 4 ? prev[x - 4] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    rows.push(line);
    prev = line;
  }
  return (x, y) => rows[y][x * 4 + 3];
}

function checkAssets() {
  step('Icons and store artwork are the size the store demands');
  for (const [size, path] of Object.entries(manifest.icons ?? {})) {
    if (!existsSync(path)) continue; // reported by the manifest check
    const [w, h] = imageSize(path);
    if (w !== +size || h !== +size) fail(`${path} is ${w}x${h}, declared as ${size}`);
  }
  for (const [path, [ww, wh]] of Object.entries(config.assets ?? {})) {
    if (!existsSync(path)) { fail(`${path} is missing`); continue; }
    const [w, h] = imageSize(path);
    if (w !== ww || h !== wh) fail(`${path} is ${w}x${h}, the store wants ${ww}x${wh}`);
    else ok(`${path} ${w}x${h}`);
  }
  // The store icon is 96px of artwork in a 128px frame. The console rounds and
  // shadows the outer margin, so a full bleed icon dropped in here gets clipped.
  if (config.storeIcon) {
    const alpha = alphaAt(config.storeIcon);
    if (!alpha) return console.log(`${config.storeIcon} is not 8-bit RGBA, skipping the margin check`);
    for (const [x, y] of [[2, 2], [125, 2], [2, 125], [125, 125], [8, 64], [119, 64]]) {
      if (alpha(x, y) > 8) fail(`${config.storeIcon} has artwork at (${x},${y}); the outer 16px must stay transparent`);
    }
    if (alpha(64, 64) < 200) fail(`${config.storeIcon} is transparent in the middle`);
    else ok(`${config.storeIcon} keeps its transparent margin`);
  }
}

function checkJustifications() {
  const j = config.justify;
  if (!j) return;
  step(`Every permission is explained in ${j.file}, and nothing more`);
  const declared = [...(manifest.permissions ?? [])];
  if (j.hostAs && manifest.host_permissions?.length) declared.push(j.hostAs);
  // Bounded to the section, or a stray bold word later in the file would read
  // as a permission.
  const section = (read(j.file).split(j.after)[1] ?? '').split(j.until)[0];
  const written = [...section.matchAll(new RegExp(j.name, 'gm'))].map((m) => m[1]);
  for (const p of declared) if (!written.includes(p)) fail(`manifest declares ${p}, ${j.file} does not explain it`);
  for (const w of written) {
    if (!declared.includes(w) && !(j.extra ?? []).includes(w)) fail(`${j.file} explains ${w}, which the manifest does not declare`);
  }
  ok(`explained: ${declared.join(', ')}`);
}

function checkVersion() {
  step('The version is the same number everywhere');
  if (existsSync('CHANGELOG.md') && !read('CHANGELOG.md').includes(`## [${version}]`)) {
    fail(`CHANGELOG.md has no entry for ${version}`);
  }
  if (existsSync('package.json')) {
    const v = JSON.parse(read('package.json')).version;
    if (v !== version) fail(`package.json says ${v}, manifest says ${version}`);
  }
  for (const { file, pattern } of config.versionIn ?? []) {
    const m = read(file).match(new RegExp(pattern));
    if (!m) fail(`${file} no longer declares a version matching ${pattern}`);
    else if (m[1] !== version) fail(`${file} says ${m[1]}, manifest says ${version}`);
  }
  ok(`version ${version}`);
}

// ----------------------------------------------------------------- package --

function build() {
  step(`Package ${zipName}`);
  const prefix = config.zip.split('{version}')[0];
  for (const f of readdirSync('.')) {
    if (f.startsWith(prefix) && f.endsWith('.zip')) rmSync(f);
  }
  execFileSync('zip', ['-rq', zipName, ...config.files, '-x', '*.DS_Store'], { stdio: 'inherit' });
  console.log(execFileSync('unzip', ['-Z1', zipName], { encoding: 'utf8' }).trim().replace(/^/gm, '  '));
}

// A rejection costs a review cycle of days, so the store's reasons are checked
// here, against the files that are actually going up.
function checkPackage(zip) {
  step(`Check ${zip} against the store`);
  const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((n) => n && !n.endsWith('/'));
  const packed = new Set(listing);

  // Only what webext.json lists. A stray test or dotfile is a bigger review
  // surface and a wider licence question.
  const inList = (n) => config.files.some((f) => n === f || n.startsWith(f.replace(/\/?$/, '/')));
  for (const n of listing) {
    if (!inList(n)) fail(`unexpected file in the package: ${n}`);
    if (/(^|\/)\./.test(n)) fail(`hidden file in the package: ${n}`);
  }

  // Everything the extension names has to be inside, or it installs and then
  // fails where only the user sees it. The manifest names some; the rest are
  // named by code (importScripts, scripting files, tabs and offscreen URLs) and
  // by the pages themselves.
  const named = manifestFiles();
  for (const f of listing.filter((n) => n.endsWith('.js'))) {
    const body = read(f);
    for (const m of body.matchAll(/importScripts\(([^)]*)\)|files:\s*\[([^\]]*)\]/g)) {
      for (const s of (m[1] ?? m[2]).matchAll(/['"]([^'"]+)['"]/g)) named.add(s[1]);
    }
    for (const m of body.matchAll(/\burl:\s*['"]([\w./-]+\.html)['"]/g)) named.add(m[1]);
  }
  for (const page of listing.filter((n) => n.endsWith('.html'))) {
    for (const m of read(page).matchAll(/(?:src|href)=["']([^"':]+\.(?:js|css|png|svg))["']/g)) {
      named.add(new URL(m[1], `file:///${page}`).pathname.slice(1));
    }
  }
  for (const f of named) if (!packed.has(f)) fail(`named but not packed: ${f}`);

  // The listing makes claims about remote code, network use and HTML
  // injection. Each exception is declared in webext.json by file name.
  const allow = config.allow ?? {};
  const rules = [
    ['eval', /\beval\s*\(|new\s+Function\s*\(/, 'eval or new Function'],
    ['network', /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/, 'a network call'],
    ['html', /\.(inner|outer)HTML\s*=|insertAdjacentHTML|document\.write/, 'HTML injection'],
  ];
  const urls = (config.urls ?? []).map((u) => new RegExp(u));
  for (const f of listing.filter((n) => n.endsWith('.js'))) {
    let body = read(f);
    for (const shape of config.ignore ?? []) body = body.replace(new RegExp(shape, 'g'), '');
    for (const [key, pattern, why] of rules) {
      if (pattern.test(body) && !(allow[key] ?? []).includes(f)) fail(`${f} contains ${why}, and webext.json does not allow it there`);
    }
    for (const url of body.match(/https?:\/\/[^\s'"`)]+/g) ?? []) {
      if (!urls.some((u) => u.test(url))) fail(`${f} names a remote URL webext.json does not list: ${url}`);
    }
  }

  console.log(`${listing.length} files packed, version ${version}`);
  console.log(`  permissions: ${(manifest.permissions ?? []).join(', ') || 'none'}`);
  console.log(`  hosts: ${(manifest.host_permissions ?? []).join(', ') || 'none'}`);
}

// --------------------------------------------------------------------- run --

const [command = 'validate', arg] = process.argv.slice(2);
if (command === 'validate') {
  checkManifest(); checkParse(); checkSvg(); checkDependencies();
  checkAssets(); checkJustifications(); checkVersion();
  build(); checkPackage(zipName);
} else if (command === 'package') {
  build(); checkPackage(zipName);
} else if (command === 'check') {
  checkPackage(arg ?? zipName);
} else {
  console.error('usage: node tools/webext.mjs [validate|package|check [zip]]');
  process.exit(2);
}

if (failed) { console.error(`\nwebext ${command}: FAILED`); process.exit(1); }
console.log(`\nwebext ${command}: everything passes${command === 'validate' ? '' : `\n${zipName}`}`);
