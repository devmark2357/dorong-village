/**
 * 구글 플레이 결제 확인 (Google Play Developer API v3, 서비스 계정) — 리턴 1990 google.ts를 옮김.
 * 필요: 함수 비밀값 DV_GOOGLE_SA_JSON(서비스 계정 키 JSON 전체), 그리고 Play Console → 사용자 및 권한에 그 서비스 계정을
 * "재무 데이터 보기 · 주문 관리" 권한으로 초대. 키는 코드·깃에 넣지 않는다.
 */
import { b64Decode, b64urlEncode, bs, fail, utf8 } from './fail.ts';

const env = (k: string) => (typeof Deno !== 'undefined' ? Deno.env.get(k) ?? '' : '');
export const PACKAGE = 'online.laboon.dorong';
export const packageName = () => env('DV_GOOGLE_PACKAGE') || PACKAGE;
export const googleReady = () => !!(env('DV_GOOGLE_SA_JSON') || env('GOOGLE_SA_JSON'));
let cached: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const raw = env('DV_GOOGLE_SA_JSON') || env('GOOGLE_SA_JSON');
  if (!raw) fail('pay_setup', '결제 서버 설정 전이에요 (관리자 문의)', 503);
  const sa = JSON.parse(raw) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const head = b64urlEncode(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64urlEncode(utf8(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud, iat: now, exp: now + 3600 })));
  const der = b64Decode(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
  const key = await crypto.subtle.importKey('pkcs8', bs(der), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64urlEncode(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, bs(utf8(`${head}.${body}`))));
  const r = await fetch(aud, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${head}.${body}.${sig}`, signal: AbortSignal.timeout(10_000) });
  const j = await r.json(); if (!j.access_token) fail('pay_auth', '결제 서버 인증 실패', 502);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export interface ProductPurchase {
  purchaseState?: number;        // 0 결제됨 · 1 취소 · 2 보류
  consumptionState?: number;     // 0 미소비 · 1 소비됨
  acknowledgementState?: number;
  orderId?: string;
  purchaseTimeMillis?: string;
  purchaseType?: number;         // 0 테스트(라이선스 테스터) · 1 프로모 · 2 리워드
  obfuscatedExternalAccountId?: string;
  quantity?: number;
  regionCode?: string;
}
const API = () => env('DV_GOOGLE_API') || 'https://androidpublisher.googleapis.com';   // 시험용 바꿔치기
const base = (productId: string, token: string) =>
  `${API()}/androidpublisher/v3/applications/${packageName()}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;

export async function getProductPurchase(productId: string, token: string): Promise<ProductPurchase> {
  const r = await fetch(base(productId, token), { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(10_000) });
  if (r.status === 404 || r.status === 400 || r.status === 410) fail('pay_invalid', '확인할 수 없는 결제예요', 400);
  if (!r.ok) fail('pay_google', `구글 결제 확인 실패 (${r.status})`, 502);
  return await r.json();
}
/** 소모성 상품 소비 → 같은 상품을 다시 살 수 있다(지급은 서버 지갑이 기억한다). 소비 = 확인 처리라 3일 자동 환불도 막는다 */
export async function consume(productId: string, token: string) {
  const r = await fetch(`${base(productId, token)}:consume`, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(10_000) });
  return r.ok;
}

/** 비소모성(once — 시작 패키지 · AP 무제한) 확인 처리: 3일 자동 환불을 막고 계속 「가진 상품」으로 남긴다(W-27) */
export async function acknowledge(productId: string, token: string) {
  const r = await fetch(`${base(productId, token)}:acknowledge`, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000) });
  return r.ok;
}
/** 지급 뒤 스토어 정리(W-27): 소모성 = consume(다시 살 수 있게) · 비소모성 = acknowledge(가진 채로). 이미 했으면 구글이 오류를 줘도 괜찮다 */
export const settle = (storeProduct: string, token: string, once: boolean) => (once ? acknowledge(storeProduct, token) : consume(storeProduct, token)).catch(() => false);

/** 결제 상태 확인(순수) — accountId: 앱이 결제 때 obfuscatedAccountId로 넣은 계정 id(하이픈 없이) */
export function checkPlay(g: ProductPurchase, accountId: string): { test: boolean; orderId: string | null; purchaseTime: number | null } {
  if (g.purchaseState !== 0) fail('pay_state', g.purchaseState === 2 ? '결제가 아직 보류 중이에요' : '취소된 결제예요');
  if (g.obfuscatedExternalAccountId && g.obfuscatedExternalAccountId !== accountId.replace(/-/g, '')) fail('pay_owner', '이 계정의 결제가 아니에요', 403);
  return { test: g.purchaseType === 0, orderId: g.orderId ?? null, purchaseTime: g.purchaseTimeMillis ? Number(g.purchaseTimeMillis) : null };
}
