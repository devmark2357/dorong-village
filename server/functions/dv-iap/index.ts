// Store purchases for 도롱도롱 느림마을: the app buys through Google Play / the App Store, then sends the receipt here.
// We confirm it with the store, record it once (dv.purchases, unique per store order) and tell the app what to give.
// Google: purchaseToken → Play Developer API (service account), then consume / acknowledge.
// Apple: StoreKit 2 signed transaction (JWS) checked against Apple's root; with server keys we also fetch it from Apple.
// Secrets: DV_GOOGLE_SA_JSON · DV_APPLE_IAP_KEY_P8 · DV_APPLE_IAP_KEY_ID · DV_APPLE_ISSUER_ID (Apple ones optional).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { Fail, fail, sha256 } from "./fail.ts";
import { getProductPurchase, checkPlay, settle, googleReady } from "./google.ts";
import { appleApiReady, bundleId, checkTxn, fetchTransaction, verifyAppleJws, type AppleTxn } from "./apple.ts";

const SB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
// what each product is; "once" = non-consumable (start pack, ad removal)
const PRODUCTS: Record<string, { once?: boolean }> = {
  "dorong.honey280": {}, "dorong.honey1500": {}, "dorong.honey3300": {}, "dorong.honey8800": {}, "dorong.honey19000": {},
  "dorong.start": { once: true }, "dorong.noad": { once: true }, "dorong.pass30": {}, "dorong.outfit": {},
};
const skuOf = (s: string) => { const x = String(s || "").replace(/^online\.laboon\.dorong\./, ""); return PRODUCTS[x] ? x : null; };

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function me(token: string): Promise<string> {
  const { data, error } = await SB.rpc("dv_iap_me", { p_token: token });
  if (error || !data) fail("bad_token", "다시 접속해 주세요", 401);
  return String(data);
}
async function record(player: string, store: string, sku: string, order: string, tokenHash: string, test: boolean) {
  const { data, error } = await SB.rpc("dv_iap_record", { p_player: player, p_store: store, p_product: sku, p_order: order, p_token_hash: tokenHash, p_test: test });
  if (error) fail("server", "결제 기록 실패", 500);
  if (!data?.ok) fail(data?.err || "pay_owner", "이 계정의 결제가 아니에요", 403);
  return data as { ok: true; key: string; fresh: boolean };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, err: "method" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, err: "body" }, 400); }
  try {
    if (b.op !== "verify") fail("op", "op");
    const player = await me(String(b.token || ""));
    const sku = skuOf(b.product); if (!sku) fail("product", "없는 상품이에요");
    const receipt = String(b.receipt || "");
    if (receipt.length < 10 || receipt.length > 20000) fail("receipt", "결제 정보가 없어요");
    if (b.store === "google") {
      if (!googleReady()) fail("pay_setup", "결제 서버 설정 전이에요", 503);
      const g = await getProductPurchase(sku!, receipt);
      const c = checkPlay(g, player);
      const r = await record(player, "google", sku!, c.orderId || "tok:" + (await sha256(receipt)), await sha256(receipt), c.test);
      await settle(sku!, receipt, !!PRODUCTS[sku!].once);
      return json({ ok: true, sku, key: r.key, fresh: r.fresh, test: c.test });
    }
    if (b.store === "apple") {
      const txId = b.txid ? String(b.txid) : null;
      const t = appleApiReady() && txId ? await verifyAppleJws<AppleTxn>(await fetchTransaction(txId)) : await verifyAppleJws<AppleTxn>(receipt);
      const c = checkTxn(t, { bundle: bundleId(), accountId: player, transactionId: txId });
      if (skuOf(c.productId) !== sku) fail("pay_mismatch", "상품이 맞지 않아요");
      const r = await record(player, "apple", sku!, c.originalId && PRODUCTS[sku!].once ? c.originalId : c.txId, await sha256(receipt), c.test);
      return json({ ok: true, sku, key: r.key, fresh: r.fresh, test: c.test });
    }
    fail("store", "store");
  } catch (e) {
    if (e instanceof Fail) return json({ ok: false, err: e.code, msg: e.message }, e.status);
    console.warn("dv-iap", e);
    return json({ ok: false, err: "server" }, 500);
  }
});
