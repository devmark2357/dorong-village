#!/usr/bin/env node
// App Store Connect setup through the official API (run by .github/workflows/asc.yml with the ASC_* secrets).
//   node scripts/asc.mjs <assets-dir> meta      → app info, version texts, screenshots, preview, IAPs, age rating, review contact
//   node scripts/asc.mjs <assets-dir> status    → print what is filled and which build is ready
//   node scripts/asc.mjs <assets-dir> submit    → attach the newest valid build, submit IAPs + version for review
// Every step checks what already exists first, so the script can be run again safely.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [, , DIR, CMD = 'status'] = process.argv;
const BUNDLE = 'online.laboon.dorong';
const { ASC_KEY_ID: KID, ASC_ISSUER_ID: ISS, ASC_KEY_P8: P8 } = process.env;
if (!KID || !ISS || !P8) { console.error('ASC_* env missing'); process.exit(1); }
const S = JSON.parse(fs.readFileSync(path.join(DIR, 'ios.json'), 'utf8'));
const LIST = JSON.parse(fs.readFileSync(path.join(DIR, 'listing.json'), 'utf8'));
const CFG = JSON.parse(fs.readFileSync(new URL('../dorong.config.json', import.meta.url), 'utf8'));

const b64u = (b) => Buffer.from(b).toString('base64url');
let tok = null, tokAt = 0;
function token() {
  const now = Math.floor(Date.now() / 1000);
  if (tok && now - tokAt < 900) return tok;
  const h = b64u(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: ISS, iat: now, exp: now + 1100, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: P8, dsaEncoding: 'ieee-p1363' });
  tok = h + '.' + p + '.' + b64u(sig); tokAt = now; return tok;
}
async function api(method, url, body) {
  const u = url.startsWith('http') ? url : 'https://api.appstoreconnect.apple.com' + url;
  for (let a = 0; a < 4; a++) {
    const r = await fetch(u, { method, headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (a + 1))); continue; }
    const t = await r.text(); const j = t ? JSON.parse(t) : {};
    if (!r.ok) { const e = new Error(`${method} ${url} → ${r.status} ${(j.errors || []).map((x) => x.code + ': ' + x.detail).join(' | ')}`); e.status = r.status; throw e; }
    return j;
  }
  throw new Error(`${method} ${url} → retries exhausted`);
}
const get = (u) => api('GET', u), post = (u, b) => api('POST', u, b), patch = (u, b) => api('PATCH', u, b);
async function all(u) { let out = [], next = u; while (next) { const j = await get(next); out = out.concat(j.data || []); next = j.links && j.links.next; } return out; }
const soft = async (what, fn) => { try { return await fn(); } catch (e) { console.log(`  ! ${what}: ${e.message}`); return null; } };

async function upload(kind, createBody, file) {
  const buf = fs.readFileSync(file);
  createBody.data.attributes = { ...(createBody.data.attributes || {}), fileName: path.basename(file), fileSize: buf.length };
  const c = await post('/v1/' + kind, createBody);
  for (const op of c.data.attributes.uploadOperations) {
    const part = buf.subarray(op.offset, op.offset + op.length);
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    const r = await fetch(op.url, { method: op.method, headers, body: part });
    if (!r.ok) throw new Error(`upload part ${r.status}`);
  }
  const md5 = crypto.createHash('md5').update(buf).digest('hex');
  await patch(`/v1/${kind}/${c.data.id}`, { data: { type: kind, id: c.data.id, attributes: { uploaded: true, sourceFileChecksum: md5 } } });
  return c.data.id;
}

const app = (await get(`/v1/apps?filter[bundleId]=${BUNDLE}`)).data[0];
if (!app) throw new Error('app not found');
console.log('app', app.id, app.attributes.name);
const versions = await all(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=50`);
const ver = versions.find((v) => ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'READY_FOR_REVIEW'].includes(v.attributes.appStoreState)) || versions[0];
console.log('version', ver.id, ver.attributes.versionString, ver.attributes.appStoreState);

async function meta() {
  // version number + copyright
  if (ver.attributes.versionString !== CFG.version || ver.attributes.copyright !== S.copyright)
    await soft('version', () => patch(`/v1/appStoreVersions/${ver.id}`, { data: { type: 'appStoreVersions', id: ver.id, attributes: { versionString: CFG.version, copyright: S.copyright } } }));
  await soft('content rights', () => patch(`/v1/apps/${app.id}`, { data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } } }));

  // app info: categories + name/subtitle/privacy per language
  const infos = await all(`/v1/apps/${app.id}/appInfos`);
  const info = infos.find((i) => i.attributes.appStoreState !== 'READY_FOR_SALE') || infos[0];
  await soft('categories', () => patch(`/v1/appInfos/${info.id}`, { data: { type: 'appInfos', id: info.id, relationships: {
    primaryCategory: { data: { type: 'appCategories', id: 'GAMES' } },
    primarySubcategoryOne: { data: { type: 'appCategories', id: 'GAMES_SIMULATION' } },
    primarySubcategoryTwo: { data: { type: 'appCategories', id: 'GAMES_CASUAL' } } } } }));
  const ilocs = await all(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  for (const [l, L] of Object.entries(S.loc)) {
    const attrs = { name: LIST[l].name, subtitle: L.subtitle, privacyPolicyUrl: S.urls.privacy };
    const ex = ilocs.find((x) => x.attributes.locale === L.asc);
    if (ex) await soft('appInfoLoc ' + l, () => patch(`/v1/appInfoLocalizations/${ex.id}`, { data: { type: 'appInfoLocalizations', id: ex.id, attributes: attrs } }));
    else await soft('appInfoLoc ' + l, () => post('/v1/appInfoLocalizations', { data: { type: 'appInfoLocalizations', attributes: { locale: L.asc, ...attrs }, relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } } } }));
    console.log('  info', l);
  }

  // version texts + screenshots (+ preview for Korean)
  let vlocs = await all(`/v1/appStoreVersions/${ver.id}/appStoreVersionLocalizations`);
  for (const [l, L] of Object.entries(S.loc)) {
    const attrs = { description: LIST[l].full, keywords: L.keywords, promotionalText: L.promo, supportUrl: S.urls.support, marketingUrl: S.urls.marketing };
    let ex = vlocs.find((x) => x.attributes.locale === L.asc);
    if (ex) await soft('verLoc ' + l, () => patch(`/v1/appStoreVersionLocalizations/${ex.id}`, { data: { type: 'appStoreVersionLocalizations', id: ex.id, attributes: attrs } }));
    else ex = (await soft('verLoc ' + l, () => post('/v1/appStoreVersionLocalizations', { data: { type: 'appStoreVersionLocalizations', attributes: { locale: L.asc, ...attrs }, relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } })) || {}).data;
    if (!ex) continue;
    const sets = await all(`/v1/appStoreVersionLocalizations/${ex.id}/appScreenshotSets`);
    let set = sets.find((s) => s.attributes.screenshotDisplayType === 'APP_IPHONE_67');
    if (!set) set = (await post('/v1/appScreenshotSets', { data: { type: 'appScreenshotSets', attributes: { screenshotDisplayType: 'APP_IPHONE_67' }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: ex.id } } } } })).data;
    const have = await all(`/v1/appScreenshotSets/${set.id}/appScreenshots`);
    if (have.length === 0) {
      for (let i = 1; i <= 8; i++) {
        const f = path.join(DIR, l, `ios69_0${i}.jpg`); if (!fs.existsSync(f)) continue;
        await soft(`shot ${l} ${i}`, () => upload('appScreenshots', { data: { type: 'appScreenshots', relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } } } }, f));
      }
    }
    const pv = path.join(DIR, 'video', `preview_${l}.mp4`);
    if (fs.existsSync(pv)) {
      const psets = await all(`/v1/appStoreVersionLocalizations/${ex.id}/appPreviewSets`);
      let ps = psets.find((s) => s.attributes.previewType === 'IPHONE_67');
      if (!ps) ps = (await post('/v1/appPreviewSets', { data: { type: 'appPreviewSets', attributes: { previewType: 'IPHONE_67' }, relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: ex.id } } } } })).data;
      const hp = await all(`/v1/appPreviewSets/${ps.id}/appPreviews`);
      if (hp.length === 0) await soft('preview ' + l, () => upload('appPreviews', { data: { type: 'appPreviews', attributes: { previewFrameTimeCode: '00:00:01:00', mimeType: 'video/mp4' }, relationships: { appPreviewSet: { data: { type: 'appPreviewSets', id: ps.id } } } } }, pv));
    }
    console.log('  version texts/shots', l, have.length ? '(shots already there)' : '');
  }

  // age rating: no objectionable content; guestbook stamps = user-generated content; ads shown
  const ar = await soft('age rating get', () => get(`/v1/appInfos/${info.id}/ageRatingDeclaration`));
  if (ar && ar.data) {
    const want = {};
    for (const [k, v] of Object.entries(ar.data.attributes)) {
      if (typeof v === 'string' || v === null) {
        if (['alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'horrorOrFearThemes', 'matureOrSuggestiveThemes', 'medicalOrTreatmentInformation', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity', 'sexualContentOrNudity', 'violenceCartoonOrFantasy', 'violenceRealistic', 'violenceRealisticProlongedGraphicOrSadistic', 'gunsOrOtherWeapons'].includes(k)) want[k] = 'NONE';
      } else if (typeof v === 'boolean' || v === undefined) want[k] = ['advertising', 'userGeneratedContent'].includes(k);
    }
    for (const k of ['gambling', 'unrestrictedWebAccess', 'lootBox', 'messagingAndChat', 'parentalControls', 'ageAssurance', 'healthOrWellnessTopics', 'socialMedia']) want[k] = false;
    for (const k of ['ageRatingOverride', 'ageRatingOverrideV2', 'koreaAgeRatingOverride', 'gracRatingClassificationNumber', 'developerAgeRatingInfoUrl', 'socialMediaAgeRestricted']) delete want[k];
    for (const k of ['advertising', 'userGeneratedContent']) want[k] = true;
    if ('kidsAgeBand' in ar.data.attributes) want.kidsAgeBand = null;
    console.log('  age rating fields', Object.keys(ar.data.attributes).join(','));
    await soft('age rating', () => patch(`/v1/ageRatingDeclarations/${ar.data.id}`, { data: { type: 'ageRatingDeclarations', id: ar.data.id, attributes: want } }));
  }

  // review contact: same contact as the team's other live app
  const rd = await soft('review detail', () => get(`/v1/appStoreVersions/${ver.id}/appStoreReviewDetail`));
  if (!rd || !rd.data) {
    let contact = null;
    for (const other of (await all('/v1/apps?limit=50')).filter((a) => a.id !== app.id)) {
      const vs = await all(`/v1/apps/${other.id}/appStoreVersions?filter[platform]=IOS&limit=5`);
      for (const v of vs) { const d = await soft('other review', () => get(`/v1/appStoreVersions/${v.id}/appStoreReviewDetail`)); if (d && d.data && d.data.attributes.contactEmail) { contact = d.data.attributes; break; } }
      if (contact) break;
    }
    if (contact) await soft('review detail create', () => post('/v1/appStoreReviewDetails', { data: { type: 'appStoreReviewDetails', attributes: {
      contactFirstName: contact.contactFirstName, contactLastName: contact.contactLastName, contactPhone: contact.contactPhone, contactEmail: contact.contactEmail,
      demoAccountRequired: false, notes: 'No login is required: tap "Guest" on the start screen. Google / Apple sign-in are optional and only used to keep the village across devices.\nIn-app purchases are in the shop (honey jar icon). "Restore purchases" is in Options.' },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } }));
    console.log('  review contact', contact ? 'copied' : 'NOT FOUND');
  }

  // in-app purchases
  const terr = (await all('/v1/territories?limit=200')).map((t) => t.id).filter((t) => t !== 'CHN');
  const iaps = await all(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`);
  const shot = path.join(DIR, 'ko', 'ios69_01.jpg');
  for (const p of S.iap) {
    let it = iaps.find((x) => x.attributes.productId === p.id);
    if (!it) it = (await soft('iap create ' + p.id, () => post('/v2/inAppPurchases', { data: { type: 'inAppPurchases', attributes: { name: p.en[0], productId: p.id, inAppPurchaseType: p.type, reviewNote: 'Bought from the shop (honey jar icon). Price shown in the game comes from the store.' }, relationships: { app: { data: { type: 'apps', id: app.id } } } } })) || {}).data;
    if (!it) continue;
    const locs = await all(`/v2/inAppPurchases/${it.id}/inAppPurchaseLocalizations`);
    for (const [lc, key] of [['ko', 'ko'], ['en-US', 'en']]) if (!locs.find((x) => x.attributes.locale === lc))
      await soft(`iap loc ${p.id} ${lc}`, () => post('/v1/inAppPurchaseLocalizations', { data: { type: 'inAppPurchaseLocalizations', attributes: { locale: lc, name: p[key][0], description: p[key][1] }, relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: it.id } } } } }));
    const sched = await soft('price sched get', () => get(`/v2/inAppPurchases/${it.id}/iapPriceSchedule`));
    if (!sched || !sched.data) {
      const pts = await all(`/v2/inAppPurchases/${it.id}/pricePoints?filter[territory]=KOR&limit=200`);
      const pt = pts.find((x) => Math.round(parseFloat(x.attributes.customerPrice)) === p.krw);
      if (!pt) console.log('  ! no KOR price point for', p.krw);
      else await soft('price ' + p.id, () => post('/v1/inAppPurchasePriceSchedules', { data: { type: 'inAppPurchasePriceSchedules', relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: it.id } }, baseTerritory: { data: { type: 'territories', id: 'KOR' } },
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${p0}' }] } } },
        included: [{ type: 'inAppPurchasePrices', id: '${p0}', attributes: { startDate: null }, relationships: { inAppPurchasePricePoint: { data: { type: 'inAppPurchasePricePoints', id: pt.id } } } }] }));
    }
    const av = await soft('avail get', () => get(`/v2/inAppPurchases/${it.id}/inAppPurchaseAvailability`));
    if (!av || !av.data) await soft('avail ' + p.id, () => post('/v1/inAppPurchaseAvailabilities', { data: { type: 'inAppPurchaseAvailabilities', attributes: { availableInNewTerritories: true },
      relationships: { inAppPurchase: { data: { type: 'inAppPurchases', id: it.id } }, availableTerritories: { data: terr.map((id) => ({ type: 'territories', id })) } } } }));
    const rs = await soft('review shot get', () => get(`/v2/inAppPurchases/${it.id}/appStoreReviewScreenshot`));
    if (!rs || !rs.data) await soft('review shot ' + p.id, () => upload('inAppPurchaseAppStoreReviewScreenshots', { data: { type: 'inAppPurchaseAppStoreReviewScreenshots', relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: it.id } } } } }, shot));
    console.log('  iap', p.id, it.attributes.state || '');
  }
}

async function status() {
  const builds = await all(`/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=10`);
  for (const b of builds) console.log('build', b.attributes.version, b.attributes.processingState, b.attributes.uploadedDate);
  for (const p of await all(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`)) console.log('iap', p.attributes.productId, p.attributes.state);
}

async function submit() {
  const builds = await all(`/v1/builds?filter[app]=${app.id}&filter[preReleaseVersion.version]=${CFG.version}&sort=-uploadedDate&limit=10`);
  const b = builds.find((x) => x.attributes.processingState === 'VALID');
  if (!b) { console.log('no processed build yet:', builds.map((x) => x.attributes.version + ':' + x.attributes.processingState).join(', ')); process.exit(2); }
  await soft('encryption', () => patch(`/v1/builds/${b.id}`, { data: { type: 'builds', id: b.id, attributes: { usesNonExemptEncryption: false } } }));
  await patch(`/v1/appStoreVersions/${ver.id}`, { data: { type: 'appStoreVersions', id: ver.id, relationships: { build: { data: { type: 'builds', id: b.id } } } } });
  console.log('build attached', b.attributes.version);
  for (const p of await all(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`))
    if (p.attributes.state === 'READY_TO_SUBMIT') await soft('iap submit ' + p.attributes.productId, () => post('/v1/inAppPurchaseSubmissions', { data: { type: 'inAppPurchaseSubmissions', relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: p.id } } } } }));
  const rs = await post('/v1/reviewSubmissions', { data: { type: 'reviewSubmissions', attributes: { platform: 'IOS' }, relationships: { app: { data: { type: 'apps', id: app.id } } } } });
  await post('/v1/reviewSubmissionItems', { data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.data.id } }, appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } } } } });
  await patch(`/v1/reviewSubmissions/${rs.data.id}`, { data: { type: 'reviewSubmissions', id: rs.data.id, attributes: { submitted: true } } });
  console.log('submitted for review');
}

if (CMD === 'meta') await meta();
else if (CMD === 'submit') await submit();
await status();
