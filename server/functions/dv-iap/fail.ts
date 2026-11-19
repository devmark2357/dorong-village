/** 서버 공용 오류 — 순수 모듈(테스트에서 DB 없이 불러온다)도 쓰도록 core.ts와 따로 둔다 */
export class Fail extends Error {
  constructor(public code: string, msg: string, public status = 400) { super(msg); }
}
export const fail = (code: string, msg: string, status = 400): never => { throw new Fail(code, msg, status); };

// ───────── 바이트 · base64url ─────────
const enc = new TextEncoder();
/** WebCrypto에 넘길 때 (TS 5.7+의 Uint8Array<ArrayBufferLike> 타입 차이를 덮는다 — 실행에는 영향 없음) */
export const bs = (u: Uint8Array) => u as unknown as BufferSource;
export const utf8 = (s: string) => enc.encode(s);
export const b64urlEncode = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const b64Decode = (s: string): Uint8Array => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
export const hex = (b: ArrayBuffer | Uint8Array) => [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('');
export async function sha256(s: string | Uint8Array) {
  return hex(await crypto.subtle.digest('SHA-256', bs(typeof s === 'string' ? utf8(s) : s)));
}
export const safeEq = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
export const randomSecret = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));

// ───────── 요청 값 다듬기 ─────────
export type P = Record<string, unknown>;
export const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
export const int = (v: unknown) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
/** 한국 날짜 (오늘 + n일) */
export const kstDay = (n = 0, now = Date.now()) => new Date(now + 9 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
