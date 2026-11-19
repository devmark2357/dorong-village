#!/usr/bin/env bash
# Build the app's web folder (www/) from the live site files at the repo root, then add the app-only scripts.
# Idempotent: www/ is wiped and recreated every run. Run scripts/apply-config.mjs first (it writes www-config/).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DST="$HERE/www"
[[ -f "$ROOT/index.html" ]] || { echo "ERROR: $ROOT/index.html not found" >&2; exit 1; }
[[ -f "$HERE/www-config/dv-config.js" ]] || { echo "ERROR: run node scripts/apply-config.mjs first" >&2; exit 1; }
rm -rf "$DST"; mkdir -p "$DST"
# the game and its pictures/sounds; leave out the server, the worker, the outfit templates and web-only files
( cd "$ROOT" && tar --exclude=./app --exclude=./server --exclude=./worker --exclude=./otpl --exclude=./ota --exclude=./.git --exclude=./.github \
    --exclude=./CNAME --exclude=./sw.js --exclude=./manifest.webmanifest --exclude='./ver.txt' -cf - . ) | ( cd "$DST" && tar xf - )
cp "$HERE/www-config/dv-config.js" "$DST/dv-config.js"
cp "$HERE/native/native.js" "$DST/native.js"
# load the app config + native bridge before the game; no service worker inside the app
node - "$DST/index.html" <<'NODE'
const fs = require('fs'), f = process.argv[2]; let s = fs.readFileSync(f, 'utf8');
const sw = /<script>if\("serviceWorker" in navigator\)[\s\S]*?<\/script>/;
if (!sw.test(s)) { console.error('ERROR: service worker snippet not found'); process.exit(1); }
s = s.replace(sw, '');
s = s.replace(/<link rel="manifest"[^>]*>/, '');
const at = s.indexOf('<script>window.DV_BUILD=');
if (at < 0) { console.error('ERROR: DV_BUILD marker not found'); process.exit(1); }
s = s.slice(0, at) + '<script src="dv-config.js"></script><script src="native.js"></script>' + s.slice(at);
fs.writeFileSync(f, s);
NODE
echo "synced $(find "$DST" -type f | wc -l) files ($(du -sh "$DST" | cut -f1)) -> $DST"
