#!/usr/bin/env node
// Turn app/www (made by sync.sh) into an OTA bundle on the site:
//   ota/files/<sha256>   every file of the bundle, named by its content hash (shared between bundles)
//   ota/m/<n>.json       the manifest the app downloads { ota, native, base, files: [[path, sha256, size], …] }
//   ota/index.json       { all: [{ ota, url, sha256, min_native, max_native, at }, …] } — the app reads this
// A bundle only goes to apps whose store version equals dorong.config.json "version" (min_native = max_native),
// because it was built against that version's native plugins.
//   node scripts/ota-build.mjs            → next number
//   node scripts/ota-build.mjs --dry      → print what would change, write nothing
//   node scripts/ota-build.mjs --base     → record the store build's files for this version (before each store release)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(HERE, '..');
const WWW = path.join(HERE, 'www');
const OTA = path.join(ROOT, 'ota');
const BASE = 'https://dorong.laboon.online/ota';
const DRY = process.argv.includes('--dry');
const C = JSON.parse(fs.readFileSync(path.join(HERE, 'dorong.config.json'), 'utf8'));

if (!fs.existsSync(path.join(WWW, 'index.html')) || !fs.existsSync(path.join(WWW, 'native.js'))) {
  console.error('ERROR: run ./sync.sh first (app/www is missing or not an app build)'); process.exit(1);
}
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile()) out.push(p);
  }
  return out;
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const files = walk(WWW).sort().map((p) => {
  const b = fs.readFileSync(p);
  return { rel: path.relative(WWW, p).split(path.sep).join('/'), hash: sha(b), size: b.length, buf: b };
});

// --base: record what the store build of this version ships (run on the exact commit the AAB/IPA is built from).
// Apps copy matching files from their built-in bundle, so only files that differ from it are hosted.
const basePath = path.join(OTA, 'base', C.version + '.json');
if (process.argv.includes('--base')) {
  fs.mkdirSync(path.dirname(basePath), { recursive: true });
  fs.writeFileSync(basePath, JSON.stringify(Object.fromEntries(files.map((f) => [f.rel, f.hash]))) + '\n');
  console.log(`ota: baseline for app ${C.version} — ${files.length} files → ota/base/${C.version}.json`);
  process.exit(0);
}
const base = fs.existsSync(basePath) ? JSON.parse(fs.readFileSync(basePath, 'utf8')) : null;
if (!base) console.warn(`WARN no ota/base/${C.version}.json — hosting every file`);

const idxPath = path.join(OTA, 'index.json');
const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : { all: [] };
const last = idx.all.reduce((m, e) => Math.max(m, e.ota), 0);
const n = last + 1;

// skip if nothing changed since the last bundle for this native version
const prev = idx.all.filter((e) => e.min_native === C.version).sort((a, b) => b.ota - a.ota)[0];
if (prev) {
  const pm = JSON.parse(fs.readFileSync(path.join(OTA, 'm', prev.ota + '.json'), 'utf8'));
  const same = pm.files.length === files.length && pm.files.every((f, i) => f[0] === files[i].rel && f[1] === files[i].hash);
  if (same) { console.log(`ota: no change since #${prev.ota} — nothing to publish`); process.exit(0); }
}

if (!prev && base && Object.keys(base).length === files.length && files.every((f) => base[f.rel] === f.hash)) {
  console.log(`ota: same as the store build of ${C.version} — nothing to publish`); process.exit(0);
}
const fresh = files.filter((f) => !(base && base[f.rel] === f.hash) && !fs.existsSync(path.join(OTA, 'files', f.hash)));
const manifest = JSON.stringify({ ota: n, native: C.version, base: BASE, files: files.map((f) => [f.rel, f.hash, f.size]) });
const entry = { ota: n, url: `${BASE}/m/${n}.json`, sha256: sha(Buffer.from(manifest)), min_native: C.version, max_native: C.version, at: new Date().toISOString() };

console.log(`ota #${n} for app ${C.version}: ${files.length} files, ${fresh.length} new (${(fresh.reduce((s, f) => s + f.size, 0) / 1048576).toFixed(1)} MB to host)`);
if (DRY) process.exit(0);

fs.mkdirSync(path.join(OTA, 'files'), { recursive: true });
fs.mkdirSync(path.join(OTA, 'm'), { recursive: true });
for (const f of fresh) fs.writeFileSync(path.join(OTA, 'files', f.hash), f.buf);
fs.writeFileSync(path.join(OTA, 'm', n + '.json'), manifest);
idx.all = [...idx.all, entry].sort((a, b) => b.ota - a.ota).slice(0, 10);
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1) + '\n');
console.log(`ota: wrote ota/m/${n}.json and ota/index.json`);
