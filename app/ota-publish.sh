#!/usr/bin/env bash
# Publish the current site as an OTA update for installed apps of this store version.
#   ./ota-publish.sh          build www → write ota/ at the repo root (commit + push to put it live)
#   ./ota-publish.sh --dry    only report what would be published
# Store version = dorong.config.json "version". Bump it (and "build") only for a new store release.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
node scripts/apply-config.mjs >/dev/null
./sync.sh >/dev/null
node scripts/ota-build.mjs "$@"
