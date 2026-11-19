/**
 * 앱스토어 결제 확인 — App Store Server API v2 · StoreKit 2 서명 거래(JWS).
 *
 * 흐름 (purchase.verify store=apple):
 *  1) 앱(StoreKit 2)이 산 직후 Transaction.jwsRepresentation(= signedTransaction)과 transactionId를 보낸다.
 *     앱은 구매할 때 appAccountToken = 게임 계정 id(UUID)를 넣는다 → 서버가 '이 계정의 결제'인지 확인한다.
 *  2) 서버 키(DV_APPLE_IAP_KEY_ID · DV_APPLE_IAP_ISSUER_ID · DV_APPLE_IAP_PRIVATE_KEY)가 있으면
 *     App Store Server API(GET /inApps/v1/transactions/{id})로 애플에서 직접 받은 서명 거래를 쓴다(운영 · 샌드박스 순서).
 *     키가 없으면 앱이 보낸 signedTransaction을 쓴다(서명은 똑같이 확인 — 위조는 못 하지만 환불 직후 상태는 모른다).
 *  3) JWS 확인: 머리 alg ES256 + x5c 사슬 → 마지막 인증서 = Apple Root CA - G3(아래에 박아 둔 원본과 바이트 비교),
 *     각 서명 · 유효 기간(서명 시각 signedDate 기준) · 애플 OID → 잎 키로 JWS 서명 확인.
 *  4) 거래 확인: bundleId = online.laboon.dorong · 소모성 상품 · 환불(revocationDate) 없음 · appAccountToken 일치.
 * 서버 알림(App Store Server Notifications v2)도 같은 JWS 확인을 쓴다(dv-iap/apple).
 */
import { b64Decode, b64urlEncode, bs, fail, utf8 } from './fail.ts';
import { OID, importEcKey, verifyChain } from './x509.ts';

/** Apple Root CA - G3 (https://www.apple.com/certificateauthority/AppleRootCA-G3.cer)
 *  SHA-256 63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79 · 2039-04-30까지 */
export const APPLE_ROOT_G3 = 'MIICQzCCAcmgAwIBAgIILcX8iNLFS5UwCgYIKoZIzj0EAwMwZzEbMBkGA1UEAwwSQXBwbGUgUm9vdCBDQSAtIEczMSYwJAYDVQQLDB1BcHBsZSBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTETMBEGA1UECgwKQXBwbGUgSW5jLjELMAkGA1UEBhMCVVMwHhcNMTQwNDMwMTgxOTA2WhcNMzkwNDMwMTgxOTA2WjBnMRswGQYDVQQDDBJBcHBsZSBSb290IENBIC0gRzMxJjAkBgNVBAsMHUFwcGxlIENlcnRpZmljYXRpb24gQXV0aG9yaXR5MRMwEQYDVQQKDApBcHBsZSBJbmMuMQswCQYDVQQGEwJVUzB2MBAGByqGSM49AgEGBSuBBAAiA2IABJjpLz1AcqTtkyJygRMc3RCV8cWjTnHcFBbZDuWmBSp3ZHtfTjjTuxxEtX/1H7YyYl3J6YRbTzBPEVoA/VhYDKX1DyxNB0cTddqXl5dvMVztK517IDvYuVTZXpmkOlEKMaNCMEAwHQYDVR0OBBYEFLuw3qFYM4iapIqZ3r6966/ayySrMA8GA1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMDA2gAMGUCMQCD6cHEFl4aXTQY2e3v9GwOAEZLuN+yRhHFD/3meoyhpmvOwgPUnPWTxnS4at+qIxUCMG1mihDK1A3UT82NQz60imOlM27jbdoXt2QfyFMm+YhidDkLF1vLUagM6BgD56KyKA==';
export const BUNDLE_ID = 'online.laboon.dorong';

const env = (k: string) => (typeof Deno !== 'undefined' ? Deno.env.get(k) ?? '' : '');
export const bundleId = () => env('DV_APPLE_BUNDLE_ID') || BUNDLE_ID;

export interface JwsOpts { roots?: Uint8Array[]; now?: number }
/**
 * 애플 서명 JWS 확인 → 본문. 사슬 유효 기간은 본문의 signedDate(없으면 지금) 기준 —
 * 애플 공식 라이브러리와 같다(오래된 거래도 그때 유효한 인증서로 서명됐으면 믿는다).
 */
export async function verifyAppleJws<T = Record<string, unknown>>(jws: string, o: JwsOpts = {}): Promise<T> {
  const parts = String(jws ?? '').split('.');
  if (parts.length !== 3) fail('apple_jws', '애플 결제 정보가 올바르지 않아요', 400);
  let head: { alg?: string; x5c?: string[] }, body: Record<string, unknown>;
  try {
    const dec = new TextDecoder();
    head = JSON.parse(dec.decode(b64Decode(parts[0]))); body = JSON.parse(dec.decode(b64Decode(parts[1])));
  } catch { return fail('apple_jws', '애플 결제 정보가 올바르지 않아요', 400); }
  if (head.alg !== 'ES256' || !Array.isArray(head.x5c)) fail('apple_jws', '애플 결제 정보가 올바르지 않아요', 400);
  const signedAt = Number(body.signedDate) || (o.now ?? Date.now());
  const roots = o.roots ?? [b64Decode(APPLE_ROOT_G3)];
  let leaf;
  try {
    leaf = await verifyChain(head.x5c!, { roots, at: signedAt, leafOid: OID.appleReceiptLeaf, intermediateOid: OID.appleWwdrIntermediate, length: 3 });
  } catch (e) {
    console.warn('apple jws chain', String((e as Error).message));
    return fail('apple_sig', '애플 서명을 확인하지 못했어요', 400);
  }
  if (leaf.curve !== OID.p256) fail('apple_sig', '애플 서명을 확인하지 못했어요', 400);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await importEcKey(leaf), bs(b64Decode(parts[2])), bs(utf8(`${parts[0]}.${parts[1]}`)));
  if (!ok) fail('apple_sig', '애플 서명을 확인하지 못했어요', 400);
  return body as T;
}

/** StoreKit 2 거래 (JWSTransactionDecodedPayload 중 쓰는 것) */
export interface AppleTxn {
  transactionId: string; originalTransactionId?: string; bundleId: string; productId: string;
  purchaseDate?: number; signedDate?: number; quantity?: number; type?: string; appAccountToken?: string;
  environment?: 'Production' | 'Sandbox' | 'Xcode' | 'LocalTesting'; revocationDate?: number; revocationReason?: number;
  storefront?: string; price?: number; currency?: string; inAppOwnershipType?: string;
}
export interface TxnCheck { txId: string; originalId: string | null; productId: string; test: boolean; purchaseTime: number | null }
/** 거래 내용 확인(순수) — 실패하면 Fail */
export function checkTxn(t: AppleTxn, o: { bundle: string; accountId: string; transactionId?: string | null; allowSandbox?: boolean }): TxnCheck {
  if (t.bundleId !== o.bundle) fail('pay_bundle', '이 앱의 결제가 아니에요', 400);
  if (!/^\d{1,30}$/.test(String(t.transactionId ?? ''))) fail('pay_invalid', '확인할 수 없는 결제예요', 400);
  if (o.transactionId && String(t.transactionId) !== String(o.transactionId)) fail('pay_mismatch', '결제 번호가 맞지 않아요', 400);
  if (t.type && !['Consumable', 'Non-Consumable', 'Non-Renewing Subscription'].includes(t.type)) fail('product', '없는 상품이에요', 400);
  if (t.revocationDate) fail('pay_state', '환불·취소된 결제예요', 400);
  const test = t.environment !== 'Production';
  if (test && o.allowSandbox === false) fail('pay_sandbox', '테스트 결제는 받지 않아요', 400);
  if (t.appAccountToken && t.appAccountToken.toLowerCase() !== o.accountId.toLowerCase()) fail('pay_owner', '이 계정의 결제가 아니에요', 403);
  return { txId: String(t.transactionId), originalId: t.originalTransactionId ? String(t.originalTransactionId) : null, productId: String(t.productId), test, purchaseTime: Number(t.purchaseDate) || null };
}

// ───────── App Store Server API (서버 키가 있을 때) ─────────
// secret names follow the console instruction doc (DV_APPLE_IAP_KEY_P8 · DV_APPLE_IAP_KEY_ID · DV_APPLE_ISSUER_ID)
const appleKeyId = () => env('DV_APPLE_IAP_KEY_ID');
const appleIssuer = () => env('DV_APPLE_ISSUER_ID') || env('DV_APPLE_IAP_ISSUER_ID');
const appleP8 = () => env('DV_APPLE_IAP_KEY_P8') || env('DV_APPLE_IAP_PRIVATE_KEY');
export const appleApiReady = () => !!(appleKeyId() && appleIssuer() && appleP8());
function pemToDer(pem: string) { return b64Decode(pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '')); }
let tokCache: { t: string; exp: number } | null = null;
/** App Store Server API용 JWT (ES256 · 20분). 키는 App Store Connect → 사용자 및 액세스 → 통합 → 인앱 구매(.p8) */
export async function appStoreToken(now = Date.now()): Promise<string> {
  if (tokCache && tokCache.exp > now + 60_000) return tokCache.t;
  const kid = appleKeyId(), iss = appleIssuer(), pem = appleP8();
  if (!kid || !iss || !pem) fail('pay_setup', '애플 결제 서버 설정 전이에요 (관리자 문의)', 503);
  const iat = Math.floor(now / 1000);
  const h = b64urlEncode(utf8(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' })));
  const b = b64urlEncode(utf8(JSON.stringify({ iss, iat, exp: iat + 1200, aud: 'appstoreconnect-v1', bid: bundleId() })));
  const key = await crypto.subtle.importKey('pkcs8', bs(pemToDer(pem)), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = b64urlEncode(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bs(utf8(`${h}.${b}`))));
  tokCache = { t: `${h}.${b}.${sig}`, exp: now + 1200_000 };
  return tokCache.t;
}
const API_PROD = 'https://api.storekit.itunes.apple.com';
const API_SANDBOX = 'https://api.storekit-sandbox.itunes.apple.com';
/** 거래 하나를 애플에서 직접 받는다(운영 → 없으면 샌드박스). signedTransactionInfo(JWS) */
export async function fetchTransaction(transactionId: string, fetcher: typeof fetch = fetch): Promise<string> {
  if (!/^\d{1,30}$/.test(transactionId)) fail('pay_invalid', '확인할 수 없는 결제예요', 400);
  const tok = await appStoreToken();
  for (const base of [env('DV_APPLE_API') || API_PROD, API_SANDBOX]) {
    let r: Response;
    try { r = await fetcher(`${base}/inApps/v1/transactions/${transactionId}`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(10_000) }); }
    catch { return fail('pay_apple', '애플 결제 서버에 닿지 못했어요', 502); }
    if (r.status === 404) continue;                    // 4040010 TransactionIdNotFound → 샌드박스에서 다시
    if (r.status === 401) fail('pay_auth', '애플 결제 서버 인증 실패 (키 확인)', 502);
    if (!r.ok) fail('pay_apple', `애플 결제 확인 실패 (${r.status})`, 502);
    const j = await r.json() as { signedTransactionInfo?: string };
    if (!j.signedTransactionInfo) fail('pay_apple', '애플 결제 응답이 비었어요', 502);
    return j.signedTransactionInfo!;
  }
  return fail('pay_invalid', '확인할 수 없는 결제예요', 400);
}
