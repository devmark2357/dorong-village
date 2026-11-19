/**
 * 최소 X.509 · ASN.1(DER) — 애플 JWS(x5c) 인증서 사슬 확인용. 외부 라이브러리 없이 WebCrypto만 쓴다.
 * 지원: ECDSA 인증서(P-256 · P-384, ecdsa-with-SHA256/384) — 애플 App Store 서명 사슬이 전부 이것이다.
 * 확인하는 것: 사슬 순서(발급자 이름 = 위 인증서 주체), 각 서명, 유효 기간, 마지막 인증서 = 고정한 루트(바이트 그대로 비교),
 *             필요한 확장 OID(애플: 잎 1.2.840.113635.100.6.11.1 · 중간 1.2.840.113635.100.6.2.1).
 */
import { b64Decode, bs } from './fail.ts';

export interface Der { tag: number; start: number; hdr: number; len: number; end: number; buf: Uint8Array }
export function der(buf: Uint8Array, off = 0): Der {
  if (off + 2 > buf.length) throw new Error('asn1: short');
  const tag = buf[off]; let len = buf[off + 1], hdr = 2;
  if (len & 0x80) {
    const n = len & 0x7f; if (n < 1 || n > 4 || off + 2 + n > buf.length) throw new Error('asn1: length');
    len = 0; for (let i = 0; i < n; i++) len = len * 256 + buf[off + 2 + i];
    hdr += n;
  }
  const end = off + hdr + len; if (end > buf.length) throw new Error('asn1: overrun');
  return { tag, start: off, hdr, len, end, buf };
}
export function children(n: Der): Der[] {
  const out: Der[] = []; let p = n.start + n.hdr;
  while (p < n.end) { const c = der(n.buf, p); out.push(c); p = c.end; }
  return out;
}
export const bytes = (n: Der) => n.buf.slice(n.start, n.end);          // 머리 포함 전체(TLV)
export const content = (n: Der) => n.buf.slice(n.start + n.hdr, n.end); // 내용만
export function oid(n: Der): string {
  const c = content(n); if (n.tag !== 0x06 || !c.length) throw new Error('asn1: not oid');
  const parts = [Math.floor(c[0] / 40), c[0] % 40]; let v = 0;
  for (let i = 1; i < c.length; i++) { v = v * 128 + (c[i] & 0x7f); if (!(c[i] & 0x80)) { parts.push(v); v = 0; } }
  return parts.join('.');
}
function time(n: Der): number {
  const s = new TextDecoder().decode(content(n));
  const m = n.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new Error('asn1: time');
  let y = Number(m[1]); if (n.tag === 0x17) y += y >= 50 ? 1900 : 2000;
  return Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

export const OID = {
  ecPublicKey: '1.2.840.10045.2.1', p256: '1.2.840.10045.3.1.7', p384: '1.3.132.0.34',
  ecdsaSha256: '1.2.840.10045.4.3.2', ecdsaSha384: '1.2.840.10045.4.3.3',
  appleReceiptLeaf: '1.2.840.113635.100.6.11.1', appleWwdrIntermediate: '1.2.840.113635.100.6.2.1',
} as const;

export interface Cert {
  der: Uint8Array; tbs: Uint8Array; sigAlg: string; sig: Uint8Array;
  issuer: Uint8Array; subject: Uint8Array; notBefore: number; notAfter: number;
  spki: Uint8Array; keyAlg: string; curve: string | null; exts: string[];
}
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export function parseCert(input: Uint8Array | string): Cert {
  const buf = typeof input === 'string' ? b64Decode(input) : input;
  const top = der(buf); if (top.tag !== 0x30 || top.end !== buf.length) throw new Error('x509: not a certificate');
  const [tbs, alg, sigBits] = children(top);
  const t = children(tbs); let i = 0;
  if (t[i].tag === 0xa0) i++;                     // [0] version
  i++;                                            // serialNumber
  i++;                                            // signature AlgorithmIdentifier (tbs 안)
  const issuer = t[i++]; const validity = children(t[i++]); const subject = t[i++]; const spki = t[i++];
  const exts: string[] = [];
  for (; i < t.length; i++) {
    if (t[i].tag !== 0xa3) continue;              // [3] extensions
    for (const e of children(children(t[i])[0])) exts.push(oid(children(e)[0]));
  }
  const keyAlg = children(spki)[0]; const ka = children(keyAlg);
  const sb = content(sigBits); if (sigBits.tag !== 0x03 || sb[0] !== 0) throw new Error('x509: signature bits');
  return {
    der: buf, tbs: bytes(tbs), sigAlg: oid(children(alg)[0]), sig: sb.slice(1),
    issuer: bytes(issuer), subject: bytes(subject), notBefore: time(validity[0]), notAfter: time(validity[1]),
    spki: bytes(spki), keyAlg: oid(ka[0]), curve: ka[1]?.tag === 0x06 ? oid(ka[1]) : null, exts,
  };
}

/** DER ECDSA 서명(SEQUENCE{r, s}) → WebCrypto가 받는 r||s (각 size 바이트) */
export function ecdsaDerToRaw(sig: Uint8Array, size: number): Uint8Array {
  const s = der(sig); if (s.tag !== 0x30) throw new Error('ecdsa: sig');
  const out = new Uint8Array(size * 2);
  children(s).forEach((n, k) => {
    let c = content(n); while (c.length > size && c[0] === 0) c = c.slice(1);
    if (c.length > size) throw new Error('ecdsa: int');
    out.set(c, k * size + (size - c.length));
  });
  return out;
}
const curveInfo = (curve: string | null) => (curve === OID.p256 ? { namedCurve: 'P-256', size: 32 } : curve === OID.p384 ? { namedCurve: 'P-384', size: 48 } : null);
export async function importEcKey(c: Cert): Promise<CryptoKey> {
  const ci = curveInfo(c.curve); if (c.keyAlg !== OID.ecPublicKey || !ci) throw new Error('x509: unsupported key');
  return await crypto.subtle.importKey('spki', bs(c.spki), { name: 'ECDSA', namedCurve: ci.namedCurve }, false, ['verify']);
}
/** child가 parent의 키로 서명됐는지 */
export async function signedBy(child: Cert, parent: Cert): Promise<boolean> {
  const hash = child.sigAlg === OID.ecdsaSha256 ? 'SHA-256' : child.sigAlg === OID.ecdsaSha384 ? 'SHA-384' : null;
  const ci = curveInfo(parent.curve); if (!hash || !ci) return false;
  if (!eq(child.issuer, parent.subject)) return false;
  try {
    return await crypto.subtle.verify({ name: 'ECDSA', hash }, await importEcKey(parent), bs(ecdsaDerToRaw(child.sig, ci.size)), bs(child.tbs));
  } catch { return false; }
}

export interface ChainRule { roots: Uint8Array[]; at: number; leafOid?: string; intermediateOid?: string; length?: number }
/** x5c(잎 → … → 루트, base64 DER) 확인 → 잎 인증서. 실패하면 이유를 담은 Error */
export async function verifyChain(x5c: string[], r: ChainRule): Promise<Cert> {
  if (!Array.isArray(x5c) || x5c.length < 2 || x5c.length > 5) throw new Error('chain: length');
  if (r.length && x5c.length !== r.length) throw new Error('chain: length');
  const certs = x5c.map((c) => parseCert(String(c)));
  const root = certs[certs.length - 1];
  if (!r.roots.some((t) => eq(t, root.der))) throw new Error('chain: untrusted root');
  for (const c of certs) if (!(c.notBefore <= r.at && r.at <= c.notAfter)) throw new Error('chain: expired');
  for (let i = 0; i < certs.length - 1; i++) if (!(await signedBy(certs[i], certs[i + 1]))) throw new Error(`chain: signature ${i}`);
  if (r.leafOid && !certs[0].exts.includes(r.leafOid)) throw new Error('chain: leaf oid');
  if (r.intermediateOid && certs.length >= 3 && !certs[1].exts.includes(r.intermediateOid)) throw new Error('chain: intermediate oid');
  return certs[0];
}
