// 도롱도롱 느림마을 — native bridge (app build only; the web never loads this file).
// Talks to Capacitor plugins directly (Capacitor.nativePromise) so nothing needs bundling.
// The game reads window.DVN: ads, store purchases, analytics, push, OTA and the force-update gate.
// Plugins: AdMob · NativePurchases · CapacitorUpdater · FirebaseAnalytics · FirebaseMessaging · FbEvents · InstallReferrer
(function () {
  'use strict';
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var PLAT = C.getPlatform();
  var APP = window.DV_APP || {};
  var SB_URL = 'https://fnkqtklhwzcoduyqbjlc.supabase.co', SB_KEY = 'sb_publishable_DCw15F8TBgld71sGtQe8wA_U8bYormG';
  function has(n) { try { return !!(C.nativePromise && (C.isPluginAvailable ? C.isPluginAvailable(n) : true)); } catch (_) { return false; } }
  function call(n, m, o) { return has(n) ? C.nativePromise(n, m, o || {}) : Promise.reject(new Error('no-plugin ' + n)); }
  function on(n, ev, fn) { try { return C.addListener(n, ev, fn); } catch (_) { return { remove: function () {} }; } }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) {} return null; }
  function cmpVer(a, b) { var x = String(a || '').split('.'), y = String(b || '').split('.'); for (var i = 0; i < 3; i++) { var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0); if (d) return d; } return 0; }
  function fn(path, body) {
    return fetch(SB_URL + path, { method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function report(msg) { try { if (window.errSend) window.errSend('error', '[native] ' + msg, ''); } catch (_) {} }

  var DVN = window.DVN = { plat: PLAT, nativeVer: APP.version || '0.0.0', ota: 0 };
  window.DV_NATIVE_VER = DVN.nativeVer;

  // ---------- analytics: Firebase (GA4) + Meta app events ----------
  DVN.ev = function (name, params) {
    params = params || {};
    if (has('FirebaseAnalytics')) call('FirebaseAnalytics', 'logEvent', { name: name, params: params }).catch(function () {});
    if (has('FbEvents')) call('FbEvents', 'logEvent', { name: name, params: params }).catch(function () {});
  };
  DVN.evPurchase = function (sku, krw, key) {
    if (has('FirebaseAnalytics')) call('FirebaseAnalytics', 'logEvent', { name: 'purchase', params: { value: krw, currency: 'KRW', transaction_id: String(key || '').slice(-36), items: [{ item_id: sku, price: krw, quantity: 1 }] } }).catch(function () {});
    if (has('FbEvents')) call('FbEvents', 'logPurchase', { amount: krw, currency: 'KRW', params: { fb_content_id: sku } }).catch(function () {});
  };
  // first launch: where the install came from (Android)
  if (!ls('dv_ref') && PLAT === 'android' && has('InstallReferrer')) {
    call('InstallReferrer', 'get').then(function (r) {
      ls('dv_ref', '1');
      var q = String((r && r.referrer) || ''), p = {};
      q.split('&').forEach(function (kv) { var a = kv.split('='); if (/^utm_(source|medium|campaign)$/.test(a[0])) p[a[0]] = decodeURIComponent(a[1] || '').slice(0, 90); });
      DVN.ev('install_referrer', p);
    }).catch(function () {});
  }

  // ---------- version: what the store installed (OTA bundles keep the native number) ----------
  var verP = has('CapacitorUpdater') ? Promise.race([
    call('CapacitorUpdater', 'getBuiltinVersion').then(function (r) { var v = String((r && r.version) || ''); if (/^\d+\.\d+\.\d+$/.test(v)) DVN.nativeVer = window.DV_NATIVE_VER = v; }).catch(function () {}),
    new Promise(function (res) { setTimeout(res, 1500); })]) : Promise.resolve();

  // ---------- remote config (same dv_config the game reads) ----------
  var cfgP = fn('/rest/v1/rpc/dv_config', {}).catch(function () { return {}; });

  // ---------- force update: dv.config min_version_<plat> ----------
  function storeUrl(cfg) {
    var u = cfg && cfg.store_url && cfg.store_url[PLAT];
    if (u) return u;
    return PLAT === 'android' ? 'https://play.google.com/store/apps/details?id=online.laboon.dorong' : 'https://apps.apple.com/kr/search?term=%EB%8A%90%EB%A6%BC%EB%A7%88%EC%9D%84';
  }
  Promise.all([verP, cfgP]).then(function (a) {
    var cfg = a[1] || {}, min = cfg['min_version_' + PLAT];
    if (!min || cmpVer(DVN.nativeVer, min) >= 0) return;
    var en = (document.documentElement.lang || 'ko') !== 'ko';
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;background:rgba(246,214,220,.97);color:#5b3b31;font:16px/1.5 "Gowun Dodum",system-ui,sans-serif;text-align:center';
    box.innerHTML = '<b style="font-size:21px">' + (en ? 'A new version is here' : '새 버전이 나왔어요') + '</b><span>' + (en ? 'Please update to keep playing.' : '스토어에서 업데이트하면 이어서 놀 수 있어요.') + '</span>' +
      '<a href="' + storeUrl(cfg) + '" style="background:#ee8496;color:#fff;border-radius:99px;padding:12px 28px;text-decoration:none;font-weight:700">' + (en ? 'Update' : '업데이트하기') + '</a>';
    document.body.appendChild(box);
  });

  // ---------- OTA (capgo updater, manual mode, self-hosted) ----------
  // dv.config.ota[plat] = [{ ota: n, url: '<manifest json>', sha256, min_native, max_native }]
  // manifest = { ota, native, base: 'https://…/ota', files: [[path, sha256, size], …] } — files the app already has are copied, the rest downloaded.
  var BAD = 'dv_ota_bad', NEXT = 'dv_ota_next';
  function sha256hex(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (d) { return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }); }
  function otaNum(v) { var m = /-ota(\d+)$/.exec(String(v || '')); return m ? +m[1] : 0; }
  function bad() { try { return JSON.parse(ls(BAD) || '[]'); } catch (_) { return []; } }
  DVN.otaReady = function () { // the game calls this once its title screen is up
    if (!has('CapacitorUpdater')) return Promise.resolve();
    return call('CapacitorUpdater', 'notifyAppReady').then(function (r) {
      DVN.ota = otaNum(r && r.bundle && r.bundle.version);
      var want = +(ls(NEXT) || 0);
      if (want && want !== DVN.ota) return call('CapacitorUpdater', 'getFailedUpdate').then(function (f) {
        if (otaNum(f && f.bundle && f.bundle.version) === want) { var b = bad(); b.push(want); ls(BAD, JSON.stringify(b.slice(-20))); ls(NEXT, null); report('ota ' + want + ' rolled back'); }
      }).catch(function () {});
      if (want) ls(NEXT, null);
    }).catch(function () {});
  };
  function otaCheck(cfg) {
    if (!has('CapacitorUpdater')) return;
    var list = (cfg && cfg.ota && cfg.ota[PLAT]) || [];
    var fit = list.filter(function (e) {
      return e && e.ota > DVN.ota && /^https:\/\//.test(e.url || '') && /^[0-9a-f]{64}$/.test(e.sha256 || '') && bad().indexOf(e.ota) < 0 &&
        (!e.min_native || cmpVer(DVN.nativeVer, e.min_native) >= 0) && (!e.max_native || cmpVer(DVN.nativeVer, e.max_native) <= 0);
    }).sort(function (a, b) { return b.ota - a.ota; })[0];
    if (!fit) return;
    var name = DVN.nativeVer + '-ota' + fit.ota;
    fetch(fit.url, { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error('manifest ' + r.status); return r.text(); })
      .then(function (t) { return sha256hex(t).then(function (h) { if (h !== fit.sha256) throw new Error('manifest sha256'); return JSON.parse(t); }); })
      .then(function (m) {
        if (m.ota !== fit.ota || !/^https:\/\//.test(m.base || '')) throw new Error('manifest mismatch');
        var base = m.base.replace(/\/+$/, '');
        var files = m.files.map(function (f) {
          if (!f[0] || f[0].charAt(0) === '/' || f[0].split('/').indexOf('..') >= 0 || !/^[0-9a-f]{64}$/.test(f[1])) throw new Error('bad file');
          return { file_name: f[0], file_hash: f[1], download_url: base + '/files/' + f[1] };
        });
        return call('CapacitorUpdater', 'download', { url: fit.url, version: name, manifest: files });
      })
      .then(function (b) { ls(NEXT, String(fit.ota)); return call('CapacitorUpdater', 'next', { id: b.id }); })
      .catch(function (e) { report('ota ' + (e && e.message || e)); });
  }

  // ---------- ads (AdMob): rewarded on request, one gentle interstitial ----------
  var AD = (APP.ads && APP.ads[PLAT]) || {}, adInit = null, rwLoaded = false, ivLoaded = false, adOff = false;
  var TEST_RW = PLAT === 'ios' ? 'ca-app-pub-3940256099942544/1712485313' : 'ca-app-pub-3940256099942544/5224354917';
  var TEST_IV = PLAT === 'ios' ? 'ca-app-pub-3940256099942544/4411468910' : 'ca-app-pub-3940256099942544/1033173712';
  var adTest = !AD.rewarded; // no real unit yet → Google's test ads
  function adStart() {
    if (adInit) return adInit;
    adInit = call('AdMob', 'initialize', { initializeForTesting: adTest }).then(function () {
      return call('AdMob', 'requestConsentInfo', {}).then(function (i) { if (i && i.isConsentFormAvailable && i.status === 'REQUIRED') return call('AdMob', 'showConsentForm').catch(function () {}); }).catch(function () {});
    }).then(function () { prepRw(); prepIv(); return true; }, function () { adInit = null; return false; });
    return adInit;
  }
  function prepRw() { return call('AdMob', 'prepareRewardVideoAd', { adId: AD.rewarded || TEST_RW, isTesting: adTest }).then(function () { rwLoaded = true; }, function () { rwLoaded = false; }); }
  function prepIv() { return call('AdMob', 'prepareInterstitial', { adId: AD.interstitial || TEST_IV, isTesting: adTest }).then(function () { ivLoaded = true; }, function () { ivLoaded = false; }); }
  DVN.ads = {
    ok: function () { return has('AdMob') && !adOff; },
    reward: function () { // → Promise<'earned'|'skipped'|'noFill'|'off'>
      if (!DVN.ads.ok()) return Promise.resolve('off');
      return adStart().then(function (ok) {
        if (!ok) return 'off';
        return (rwLoaded ? Promise.resolve() : Promise.race([prepRw(), new Promise(function (r) { setTimeout(r, 9000); })])).then(function () {
          if (!rwLoaded) return 'noFill';
          return new Promise(function (res) {
            var earned = false, fin = false, subs = [];
            function end(r) { if (fin) return; fin = true; subs.forEach(function (s) { try { s.remove(); } catch (_) {} }); rwLoaded = false; prepRw(); window.dispatchEvent(new Event('dv-ad-closed')); res(r); }
            subs.push(on('AdMob', 'onRewardedVideoAdReward', function () { earned = true; }));
            subs.push(on('AdMob', 'onRewardedVideoAdDismissed', function () { end(earned ? 'earned' : 'skipped'); }));
            subs.push(on('AdMob', 'onRewardedVideoAdFailedToShow', function () { end(earned ? 'earned' : 'noFill'); }));
            call('AdMob', 'showRewardVideoAd').then(function () { earned = true; }, function () { end(earned ? 'earned' : 'noFill'); });
          });
        });
      });
    },
    inter: function () {
      if (!DVN.ads.ok() || !ivLoaded) { if (DVN.ads.ok()) adStart(); return Promise.resolve(false); }
      ivLoaded = false;
      return call('AdMob', 'showInterstitial').then(function () { prepIv(); window.dispatchEvent(new Event('dv-ad-closed')); return true; }, function () { prepIv(); return false; });
    },
    warm: function () { if (DVN.ads.ok()) adStart(); }
  };

  // ---------- store purchases (NativePurchases: Play Billing / StoreKit 2) ----------
  var NP = 'NativePurchases', IAP = APP.iap || {}, prices = {}, txns = {};
  var ONCE = {}; ONCE[IAP.start || 'dorong.start'] = 1; ONCE[IAP.noad || 'dorong.noad'] = 1;
  var ALL = Object.keys(IAP.honey || {}).concat([IAP.start, IAP.noad, IAP.pass30, IAP.outfit]).filter(Boolean);
  function skuOf(id) { id = String(id || '').replace(/^online\.laboon\.dorong\./, ''); return ALL.indexOf(id) >= 0 ? id : null; }
  function receiptOf(t) { return (PLAT === 'ios' ? t.jwsRepresentation : t.purchaseToken) || ''; }
  function errKind(e) { var c = String((e && e.code) || ''), m = String((e && (e.message || e.errorMessage)) || e || ''); if (c === 'USER_CANCELED' || /cancel/i.test(m)) return 'cancelled'; if (/already.?owned/i.test(m) || c === 'ITEM_ALREADY_OWNED') return 'owned'; if (/pending/i.test(m)) return 'pending'; return 'failed'; }
  if (has(NP)) call(NP, 'configure', { autoFinishTransactions: false }).catch(function () {});
  function loadPrices() {
    if (!has(NP) || Object.keys(prices).length) return Promise.resolve(prices);
    return call(NP, 'getProducts', { productIdentifiers: ALL, productType: 'inapp' }).then(function (r) {
      (r.products || []).forEach(function (p) { var s = skuOf(p.identifier); if (s && p.priceString) prices[s] = p.priceString; });
      return prices;
    }).catch(function () { return prices; });
  }
  function finish(sku, receipt) {
    var t = txns[receipt]; delete txns[receipt];
    if (PLAT === 'ios') return t && t.transactionId ? call(NP, 'finishTransaction', { transactionId: String(t.transactionId) }).catch(function () {}) : Promise.resolve();
    return (ONCE[sku] ? (t && t.isAcknowledged ? Promise.resolve() : call(NP, 'acknowledgePurchase', { purchaseToken: receipt })) : call(NP, 'consumePurchase', { purchaseToken: receipt })).catch(function () {});
  }
  function verify(sku, receipt, t, token) {
    return fn('/functions/v1/dv-iap', { op: 'verify', token: token, product: sku, store: PLAT === 'ios' ? 'apple' : 'google', receipt: receipt, txid: t && t.transactionId ? String(t.transactionId) : null })
      .then(function (r) { if (!r || !r.ok) { var e = new Error((r && r.err) || 'verify'); e.kind = 'verify'; throw e; } return r; });
  }
  DVN.iap = {
    ok: function () { return has(NP); },
    prices: loadPrices,
    price: function (sku) { return prices[sku] || null; },
    // → Promise<{ok, sku, key, fresh} | {ok:false, err}>; player = { id: uuid, token }
    buy: function (sku, player) {
      if (!has(NP)) return Promise.resolve({ ok: false, err: 'unavailable' });
      if (!player || !player.id || !player.token) return Promise.resolve({ ok: false, err: 'account' });
      var tag = PLAT === 'ios' ? String(player.id).toLowerCase() : String(player.id).replace(/-/g, '');
      return call(NP, 'purchaseProduct', { productIdentifier: sku, productType: 'inapp', quantity: 1, appAccountToken: tag, isConsumable: false, autoAcknowledgePurchases: false })
        .then(function (t) {
          if (PLAT === 'android' && t.purchaseState && t.purchaseState !== '1') return { ok: false, err: 'pending' };
          var rc = receiptOf(t); if (!rc) return { ok: false, err: 'failed' };
          txns[rc] = t;
          return verify(sku, rc, t, player.token).then(function (r) {
            return finish(sku, rc).then(function () {
              var m = /honey(\d+)$/.exec(sku);
              DVN.evPurchase(sku, krwOf(sku), r.key);
              return { ok: true, sku: sku, key: r.key, fresh: r.fresh };
            });
          });
        })
        .catch(function (e) { if (e && e.kind === 'verify') { report('iap verify ' + e.message); return { ok: false, err: 'verify', msg: e.message }; } return { ok: false, err: errKind(e) }; });
    },
    // purchases that were paid but not finished (app closed mid-way) → verified list
    pending: function (player) {
      if (!has(NP) || !player || !player.token) return Promise.resolve([]);
      var found = [];
      function add(t) { var s = skuOf(t.productIdentifier), rc = receiptOf(t); if (!s || !rc) return; if (PLAT === 'android' && t.purchaseState && t.purchaseState !== '1') return; txns[rc] = t; found.push([s, rc, t]); }
      var p = call(NP, 'getUnfinishedTransactions').then(function (r) { (r.transactions || []).forEach(add); }).catch(function () {});
      if (PLAT === 'android') p = p.then(function () { return call(NP, 'getPurchases', { productType: 'inapp' }).then(function (r) { (r.purchases || []).forEach(function (t) { var s = skuOf(t.productIdentifier); if (s && (!ONCE[s] || t.isAcknowledged === false)) add(t); }); }).catch(function () {}); });
      return p.then(function () {
        return Promise.all(found.map(function (f) { return verify(f[0], f[1], f[2], player.token).then(function (r) { return finish(f[0], f[1]).then(function () { return { sku: f[0], key: r.key }; }); }, function () { return null; }); }));
      }).then(function (l) { return l.filter(Boolean); });
    },
    // Apple requires a restore button for one-time items (start pack, ad removal)
    restore: function (player) {
      if (!has(NP) || !player || !player.token) return Promise.resolve([]);
      return (PLAT === 'ios' ? call(NP, 'restorePurchases').catch(function () {}) : Promise.resolve())
        .then(function () { return call(NP, 'getPurchases', PLAT === 'ios' ? { onlyCurrentEntitlements: true } : { productType: 'inapp' }); })
        .then(function (r) {
          return Promise.all((r.purchases || []).map(function (t) {
            var s = skuOf(t.productIdentifier), rc = receiptOf(t); if (!s || !rc || !ONCE[s]) return null;
            return verify(s, rc, t, player.token).then(function (v) { return { sku: s, key: v.key }; }, function () { return null; });
          }));
        }).then(function (l) { return l.filter(Boolean); }).catch(function () { return []; });
    }
  };
  var KRW = { 'dorong.honey280': 1200, 'dorong.honey1500': 5900, 'dorong.honey3300': 12000, 'dorong.honey8800': 29000, 'dorong.honey19000': 59000, 'dorong.start': 1200, 'dorong.noad': 12000, 'dorong.pass30': 5900, 'dorong.outfit': 9900 };
  function krwOf(s) { return KRW[s] || 0; }

  // ---------- push (FCM): asked only when the player turns it on ----------
  DVN.push = {
    ok: function () { return has('FirebaseMessaging'); },
    enable: function (token, lang) {
      if (!has('FirebaseMessaging')) return Promise.resolve(false);
      return call('FirebaseMessaging', 'requestPermissions').then(function (p) {
        if (!p || p.receive !== 'granted') return false;
        return call('FirebaseMessaging', 'getToken').then(function (t) {
          if (!t || !t.token || !token) return !!(t && t.token);
          return fn('/rest/v1/rpc/dv_push_token', { p_token: token, p_fcm: t.token, p_platform: PLAT, p_lang: lang || 'ko' }).then(function () { return true; }, function () { return true; });
        });
      }).catch(function () { return false; });
    }
  };

  // after the game has loaded: OTA check in the background, ad SDK warm-up a little later
  window.addEventListener('load', function () {
    Promise.all([verP, cfgP]).then(function (a) { var cfg = a[1] || {}; adOff = !!(cfg.ads && cfg.ads.off); otaCheck(cfg); });
    setTimeout(function () { DVN.ads.warm(); }, 8000);
  });
})();
