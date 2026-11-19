#!/usr/bin/env node
// dorong.config.json → native files + www/dv-config.js.
//   node scripts/apply-config.mjs            (check build: empty IDs become Google's test IDs / placeholders)
//   node scripts/apply-config.mjs --release  (store build: stops if any ID or Firebase file is missing)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = JSON.parse(fs.readFileSync(path.join(HERE, 'dorong.config.json'), 'utf8'));
const RELEASE = process.argv.includes('--release');
const missing = [];
const need = (v, what) => { if (!v) missing.push(what); return v; };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rd = (p) => fs.readFileSync(path.join(HERE, p), 'utf8');
const wr = (p, s) => { fs.mkdirSync(path.dirname(path.join(HERE, p)), { recursive: true }); fs.writeFileSync(path.join(HERE, p), s); };
const sub1 = (s, re, to, what) => { if (!re.test(s)) throw new Error(`apply-config: pattern not found (${what})`); return s.replace(re, to); };

const LABEL = '느림마을';
const TEST_ADMOB = { android: 'ca-app-pub-3940256099942544~3347511713', ios: 'ca-app-pub-3940256099942544~1458002511' };
const admobAndroid = need(C.admob.androidApp, 'admob.androidApp') || TEST_ADMOB.android;
const admobIos = need(C.admob.iosApp, 'admob.iosApp') || TEST_ADMOB.ios;
const fbId = need(C.facebook.appId, 'facebook.appId') || '0';
const fbTok = need(C.facebook.clientToken, 'facebook.clientToken') || '0';
need(C.login.googleWeb, 'login.googleWeb');
const gIos = need(C.login.googleIos, 'login.googleIos');
const gScheme = gIos ? 'com.googleusercontent.apps.' + gIos.replace(/\.apps\.googleusercontent\.com$/, '') : 'com.googleusercontent.apps.placeholder';
for (const k of ['rewardedAndroid', 'rewardedIos', 'interstitialAndroid', 'interstitialIos']) need(C.admob[k], 'admob.' + k);

// ---- Android ----
let s = rd('android/app/src/main/res/values/strings.xml');
s = sub1(s, /(<string name="app_name">)[^<]*(<\/string>)/, `$1${LABEL}$2`, 'app_name');
s = sub1(s, /(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${LABEL}$2`, 'title_activity_main');
s = sub1(s, /(<string name="facebook_app_id"[^>]*>)[^<]*(<\/string>)/, `$1${esc(fbId)}$2`, 'facebook_app_id');
s = sub1(s, /(<string name="facebook_client_token"[^>]*>)[^<]*(<\/string>)/, `$1${esc(fbTok)}$2`, 'facebook_client_token');
wr('android/app/src/main/res/values/strings.xml', s);
s = rd('android/app/src/main/AndroidManifest.xml');
s = sub1(s, /(android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"\s*android:value=")[^"]*(")/, `$1${admobAndroid}$2`, 'admob app id');
wr('android/app/src/main/AndroidManifest.xml', s);
s = rd('android/app/build.gradle');
s = sub1(s, /versionCode \d+/, `versionCode ${C.build}`, 'versionCode');
s = sub1(s, /versionName "[^"]*"/, `versionName "${C.version}"`, 'versionName');
wr('android/app/build.gradle', s);

// ---- iOS ----
s = rd('ios/App/App/Info.plist');
const plistStr = (key, val) => { s = sub1(s, new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${esc(val)}$2`, key); };
plistStr('CFBundleDisplayName', LABEL);
plistStr('CFBundleName', LABEL);
plistStr('FacebookDisplayName', LABEL);
plistStr('GADApplicationIdentifier', admobIos);
plistStr('FacebookAppID', fbId);
plistStr('FacebookClientToken', fbTok);
s = sub1(s, /(<key>FacebookAutoLogAppEventsEnabled<\/key>\s*)<(true|false)\/>/, '$1<true/>', 'fb autolog');
s = sub1(s, /(<string>)com\.googleusercontent\.apps\.[^<]*(<\/string>)/, `$1${gScheme}$2`, 'google url scheme');
wr('ios/App/App/Info.plist', s);
s = rd('ios/App/App.xcodeproj/project.pbxproj');
s = s.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${C.version};`).replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${C.build};`);
wr('ios/App/App.xcodeproj/project.pbxproj', s);

// ---- Firebase files (real ones live in app/firebase/, sent from the Firebase console) ----
const fb = (src, dst, placeholder, what) => {
  const p = path.join(HERE, 'firebase', src);
  if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(HERE, dst)); return; }
  missing.push(what);
  wr(dst, placeholder);
};
fb('google-services.json', 'android/app/google-services.json', JSON.stringify({
  project_info: { project_number: '000000000000', project_id: 'dorong-placeholder', storage_bucket: 'dorong-placeholder.appspot.com' },
  client: [{ client_info: { mobilesdk_app_id: '1:000000000000:android:0000000000000000', android_client_info: { package_name: C.appId } },
    oauth_client: [], api_key: [{ current_key: 'placeholder-not-a-real-key' }], services: { appinvite_service: { other_platform_oauth_client: [] } } }],
  configuration_version: '1',
}, null, 2), 'firebase/google-services.json');
fb('GoogleService-Info.plist', 'ios/App/App/GoogleService-Info.plist', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>API_KEY</key><string>placeholder-not-a-real-key</string>
<key>GCM_SENDER_ID</key><string>000000000000</string>
<key>BUNDLE_ID</key><string>${C.appId}</string>
<key>PROJECT_ID</key><string>dorong-placeholder</string>
<key>GOOGLE_APP_ID</key><string>1:000000000000:ios:0000000000000000</string>
<key>IS_ANALYTICS_ENABLED</key><false/>
</dict></plist>
`, 'firebase/GoogleService-Info.plist');

// ---- what the game reads (www/dv-config.js, loaded before the game) ----
const web = {
  version: C.version, build: C.build,
  login: C.login,
  ads: { android: { rewarded: C.admob.rewardedAndroid, interstitial: C.admob.interstitialAndroid }, ios: { rewarded: C.admob.rewardedIos, interstitial: C.admob.interstitialIos } },
  iap: C.iap,
};
wr('www-config/dv-config.js', `// generated by scripts/apply-config.mjs — do not edit\nwindow.DV_RELEASE=true;window.DV_APP=${JSON.stringify(web)};window.DV_LOGIN=window.DV_APP.login;\n`);

if (missing.length) {
  const msg = `apply-config: not filled yet → ${missing.join(', ')}`;
  if (RELEASE) { console.error('ERROR ' + msg); process.exit(1); }
  console.warn('WARN ' + msg + ' (check build uses test IDs / placeholders)');
}
console.log(`apply-config: ${C.appId} ${C.version} (${C.build})${RELEASE ? ' release' : ''}`);
