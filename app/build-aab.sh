#!/usr/bin/env bash
# app config → www (site files + native bridge) → cap sync android → gradle bundleRelease. Prints the AAB path.
# Env: ANDROID_HOME, DORONG_KEYSTORE_PROPERTIES (keystore.properties outside the repo), RELEASE=1 (stop if any store ID is missing).
# Version: dorong.config.json "version" / "build" (apply-config writes them into Gradle and Xcode).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
[[ -n "${DORONG_KEYSTORE_PROPERTIES:-}" && -f "$DORONG_KEYSTORE_PROPERTIES" ]] || { echo "ERROR: DORONG_KEYSTORE_PROPERTIES not set or missing (release would be unsigned)" >&2; exit 1; }
[[ -d node_modules/@capacitor/android ]] || npm ci
if [[ "${RELEASE:-0}" == "1" ]]; then node scripts/apply-config.mjs --release; else node scripts/apply-config.mjs; fi
./sync.sh
npx cap sync android
echo "sdk.dir=${ANDROID_HOME:?ANDROID_HOME not set}" > android/local.properties
INIT=()
[[ "${DORONG_NO_MAVEN_MIRROR:-1}" == "1" ]] || INIT=(--init-script "$HERE/scripts/maven-mirror.init.gradle")
cd android
./gradlew --no-daemon "${INIT[@]}" clean bundleRelease
AAB="$HERE/android/app/build/outputs/bundle/release/app-release.aab"
[[ -f "$AAB" ]] || { echo "ERROR: AAB not produced" >&2; exit 1; }
echo "AAB: $AAB ($(du -h "$AAB" | cut -f1))"
