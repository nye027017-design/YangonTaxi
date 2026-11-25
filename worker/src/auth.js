// Google ID token verify + our own JWT (HS256) — Web Crypto သက်သက်၊ npm package မလိုပါ

import { json } from "./http.js";
import { upsertGoogleUser, getUserById, publicUser } from "./db.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const JWT_TTL_SECONDS = 7 * 24 * 3600; // ၇ ရက်

// ---------- base64url ----------
function b64urlEncode(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const encodeJson = (obj) => b64urlEncode(enc.encode(JSON.stringify(obj)));
const decodeJson = (part) => JSON.parse(dec.decode(b64urlDecode(part)));

// ---------- our JWT (HS256) ----------
function hmacKey(secret, usage) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function signJWT(payload, secret, ttl = JWT_TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const data = `${encodeJson({ alg: "HS256", typ: "JWT" })}.${encodeJson({ ...payload, iat: now, exp: now + ttl })}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), enc.encode(data));
  return `${data}.${b64urlEncode(new Uint8Array(sig))}`;
}

// မှန်ရင် payload ပြန်ပေး၊ မှားရင် null
export async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    if (decodeJson(h).alg !== "HS256") return null;
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), b64urlDecode(s), enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const payload = decodeJson(p);
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------- Google ID token (RS256) ----------
let jwksCache = { keys: null, expires: 0 };

async function getGoogleKeys(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && jwksCache.keys && now < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error("Cannot fetch Google keys");
  const { keys } = await res.json();
  jwksCache = { keys, expires: now + 3600 * 1000 };
  return keys;
}

export async function verifyGoogleIdToken(idToken, clientId) {
  const parts = String(idToken).split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h, p, s] = parts;

  const header = decodeJson(h);
  if (header.alg !== "RS256") throw new Error("Unexpected alg");

  let keys = await getGoogleKeys();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await getGoogleKeys(true); // Google key လည်သွားနိုင်လို့ တစ်ခါပြန်ယူ
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("Unknown signing key");

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), enc.encode(`${h}.${p}`));
  if (!valid) throw new Error("Bad signature");

  const claims = decodeJson(p);
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error("Bad issuer");
  if (claims.aud !== clientId) throw new Error("Bad audience");
  if (!claims.exp || claims.exp < now) throw new Error("Token expired");
  if (!claims.sub || !claims.email) throw new Error("Missing claims");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("Email not verified");
  return claims;
}

// ---------- middleware ----------
// Authorization: Bearer <jwt> ကို စစ်ပြီး { uid, role } ပြန်ပေး၊ မှားရင် null
export async function requireAuth(request, env) {
  const header = request.headers.get("Authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m || !env.JWT_SECRET) return null;
  return verifyJWT(m[1], env.JWT_SECRET);
}

// ---------- route handlers ----------
// POST /api/auth/google   body: { credential: "<Google ID token>" }
export async function handleGoogleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400, request, env);
  }
  const credential = body && body.credential;
  if (typeof credential !== "string" || !credential) {
    return json({ error: "credential လိုအပ်ပါတယ်" }, 400, request, env);
  }
  if (!env.GOOGLE_CLIENT_ID || !env.JWT_SECRET) {
    return json({ error: "Server မသတ်မှတ်ရသေးပါ (GOOGLE_CLIENT_ID / JWT_SECRET)" }, 500, request, env);
  }

  let claims;
  try {
    claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID);
  } catch {
    return json({ error: "Google login မအောင်မြင်ပါ" }, 401, request, env);
  }

  const adminEmails = (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isAdmin = adminEmails.includes(claims.email.toLowerCase());

  const user = await upsertGoogleUser(
    env.DB,
    { googleId: claims.sub, email: claims.email, name: claims.name, avatar: claims.picture },
    isAdmin
  );

  const token = await signJWT({ uid: user.id, role: user.role }, env.JWT_SECRET);
  return json({ token, user: publicUser(user) }, 200, request, env);
}

// GET /api/me
export async function handleMe(request, env) {
  const auth = await requireAuth(request, env);
  if (!auth) return json({ error: "Unauthorized" }, 401, request, env);
  const user = await getUserById(env.DB, auth.uid);
  if (!user) return json({ error: "User not found" }, 401, request, env);
  return json({ user: publicUser(user) }, 200, request, env);
}
