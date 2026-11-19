// Google / Apple sign-in for 도롱도롱 느림마을.
//
// The app gets an ID token from the phone's own Google or Apple sign-in sheet and sends it here.
// We check the token's signature and audience, then link that outside account to a village:
//   - the outside account already has a village  → hand back a new device token + that village's save ("existing")
//   - this phone's village has no such link yet  → link it ("linked")
//   - no village on this phone                   → make a new one tied to the account ("new")
// Apple needs a one-time nonce: { op: "nonce" } returns a signed raw nonce; the app sends sha256(raw) to Apple and raw back to us.
//
// Secrets: DV_GOOGLE_CLIENT_IDS (comma list: web, android, iOS client IDs), DV_APPLE_CLIENT_IDS (optional; defaults to the bundle id).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are built in.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const SB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BUNDLE_ID = "online.laboon.dorong";
const list = (k: string) => (Deno.env.get(k) || "").split(",").map((s) => s.trim()).filter(Boolean);
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const APPLE_JWKS = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
const NONCE_TTL = 10 * 60_000;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
class Fail extends Error { constructor(public code: string, public status = 400) { super(code); } }

const enc = new TextEncoder();
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode("dv-apple-nonce:" + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg))));
}
async function issueNonce() {
  const body = `${b64url(crypto.getRandomValues(new Uint8Array(16)))}.${(Date.now() + NONCE_TTL).toString(36)}`;
  return `${body}.${await hmac(body)}`;
}
async function useNonce(raw: string) {
  const m = /^([A-Za-z0-9_-]{22})\.([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(raw || "");
  if (!m || (await hmac(`${m[1]}.${m[2]}`)) !== m[3]) throw new Fail("apple_nonce", 401);
  const exp = parseInt(m[2], 36);
  if (!(exp > Date.now())) throw new Fail("apple_nonce", 401);
  const { data, error } = await SB.rpc("dv_nonce_use", { p_key: await sha256(raw), p_exp: new Date(exp).toISOString() });
  if (error || data !== true) throw new Fail("apple_nonce", 401);
}

async function googleSub(token: string) {
  const aud = list("DV_GOOGLE_CLIENT_IDS");
  if (!aud.length) throw new Fail("google_setup", 503);
  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, { issuer: ["accounts.google.com", "https://accounts.google.com"], audience: aud, clockTolerance: 60 });
    const sub = String(payload.sub || "");
    if (!/^\d{5,40}$/.test(sub)) throw 0;
    return sub;
  } catch { throw new Fail("google_token", 401); }
}
async function appleSub(token: string, raw: string) {
  const aud = list("DV_APPLE_CLIENT_IDS");
  await useNonce(raw);
  try {
    const { payload } = await jwtVerify(token, APPLE_JWKS, { issuer: "https://appleid.apple.com", audience: aud.length ? aud : [BUNDLE_ID], clockTolerance: 60 });
    if (String(payload.nonce || "") !== (await sha256(raw))) throw 0;
    const sub = String(payload.sub || "");
    if (!/^[0-9a-zA-Z.\-_]{6,120}$/.test(sub)) throw 0;
    return sub;
  } catch { throw new Fail("apple_token", 401); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, err: "method" }, 405);
  let b: any;
  try { b = await req.json(); } catch { return json({ ok: false, err: "body" }, 400); }
  try {
    if (b.op === "nonce") return json({ ok: true, nonce: await issueNonce() });
    if (b.op === "login") {
      const p = b.provider;
      if (p !== "google" && p !== "apple") throw new Fail("provider");
      const tok = String(b.idToken || "");
      if (tok.length < 20 || tok.length > 8000) throw new Fail("token");
      const sub = p === "google" ? await googleSub(tok) : await appleSub(tok, String(b.nonce || ""));
      const { data, error } = await SB.rpc("dv_auth_link", {
        p_provider: p, p_sub: sub, p_token: b.token ? String(b.token) : null,
        p_nick: String(b.nick || "").slice(0, 16), p_vname: String(b.vname || "").slice(0, 20), p_rep: Number.isFinite(+b.rep) ? Math.trunc(+b.rep) : 0,
      });
      if (error) throw new Fail("server", 500);
      return json({ ok: true, ...data });
    }
    return json({ ok: false, err: "op" }, 400);
  } catch (e) {
    if (e instanceof Fail) return json({ ok: false, err: e.code }, e.status);
    return json({ ok: false, err: "server" }, 500);
  }
});
