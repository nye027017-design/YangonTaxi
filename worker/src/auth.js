const ITER = 100000; // Workers PBKDF2 အများဆုံး
const SESSION_DAYS = 30;
const enc = new TextEncoder();

const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array(hex.match(/.{2}/g).map((h) => parseInt(h, 16)));

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations: ITER }, key, 256);
  return toHex(bits);
}

async function sha256(text) {
  return toHex(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

const normPhone = (p) => String(p || "").replace(/[\s-]/g, "");
const validPhone = (p) => /^(\+?95|0)?9\d{7,9}$/.test(p);

async function createSession(env, profileId) {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const expires = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.prepare("INSERT INTO sessions (token_hash, profile_id, expires_at) VALUES (?,?,?)")
    .bind(await sha256(token), profileId, expires).run();
  return token;
}

async function createProfile(env, { phone, name, password, role }) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);
  const r = await env.DB.prepare(
    "INSERT INTO profiles (phone, name, role, password_hash, salt) VALUES (?,?,?,?,?)")
    .bind(phone, name, role, hash, salt).run();
  return r.meta.last_row_id;
}

// Request ထဲက Token ကို စစ်ပြီး user ပြန်ပေး (မရှိရင် null)
export async function getUser(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  const th = await sha256(h.slice(7));
  return await env.DB.prepare(
    `SELECT p.id, p.phone, p.name, p.role FROM sessions s
     JOIN profiles p ON p.id = s.profile_id
     WHERE s.token_hash = ? AND s.expires_at > unixepoch()`).bind(th).first();
}

export async function requireRole(request, env, ...roles) {
  const user = await getUser(request, env);
  if (!user) return { error: json({ error: "ဝင်ရောက်ရန် လိုအပ်ပါတယ်" }, 401) };
  if (roles.length && !roles.includes(user.role)) return { error: json({ error: "ခွင့်ပြုချက်မရှိပါ" }, 403) };
  return { user };
}

async function body(request) {
  try { return await request.json(); } catch { return {}; }
}

export async function handleAuth(request, env, path) {
  const method = request.method;

  if (path === "/api/auth/register" && method === "POST") {
    const b = await body(request);
    const phone = normPhone(b.phone);
    const name = String(b.name || "").trim();
    const role = b.role === "driver" ? "driver" : "customer"; // admin ကို register နဲ့ မဖန်တီးနိုင်
    if (!validPhone(phone)) return json({ error: "ဖုန်းနံပါတ် မှန်ကန်မှုမရှိပါ" }, 400);
    if (!name || name.length > 60) return json({ error: "နာမည် ထည့်ပါ" }, 400);
    if (String(b.password || "").length < 6) return json({ error: "Password အနည်းဆုံး ၆ လုံး" }, 400);

    const exists = await env.DB.prepare("SELECT 1 FROM profiles WHERE phone = ?").bind(phone).first();
    if (exists) return json({ error: "ဒီဖုန်းနံပါတ် စာရင်းသွင်းပြီးသားပါ" }, 409);

    const id = await createProfile(env, { phone, name, password: b.password, role });
    if (role === "driver") {
      await env.DB.prepare("INSERT INTO drivers (profile_id, vehicle_type, plate) VALUES (?,?,?)")
        .bind(id, ["bike", "car"].includes(b.vehicle_type) ? b.vehicle_type : "taxi", String(b.plate || "").slice(0, 20)).run();
      return json({ ok: true, message: "စာရင်းသွင်းပြီးပါပြီ။ Admin အတည်ပြုပြီးမှ အလုပ်လုပ်နိုင်ပါမယ်။" }, 201);
    }
    const token = await createSession(env, id);
    return json({ token, user: { id, phone, name, role } }, 201);
  }

  if (path === "/api/auth/login" && method === "POST") {
    const b = await body(request);
    const phone = normPhone(b.phone);
    const p = await env.DB.prepare("SELECT * FROM profiles WHERE phone = ?").bind(phone).first();
    const bad = json({ error: "ဖုန်းနံပါတ် သို့မဟုတ် Password မှားနေပါတယ်" }, 401);
    if (!p) return bad;
    const hash = await hashPassword(String(b.password || ""), p.salt);
    if (!safeEqual(hash, p.password_hash)) return bad;

    if (p.role === "driver") {
      const d = await env.DB.prepare("SELECT status FROM drivers WHERE profile_id = ?").bind(p.id).first();
      if (!d || d.status !== "approved")
        return json({ error: d?.status === "suspended" ? "အကောင့် ရပ်ဆိုင်းထားပါတယ်" : "Admin အတည်ပြုချက် စောင့်ဆိုင်းနေပါတယ်" }, 403);
    }
    const token = await createSession(env, p.id);
    return json({ token, user: { id: p.id, phone: p.phone, name: p.name, role: p.role } });
  }

  if (path === "/api/auth/me" && method === "GET") {
    const user = await getUser(request, env);
    return user ? json({ user }) : json({ error: "ဝင်ရောက်ရန် လိုအပ်ပါတယ်" }, 401);
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const h = request.headers.get("Authorization") || "";
    if (h.startsWith("Bearer "))
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(h.slice(7))).run();
    return json({ ok: true });
  }

  // Admin ပထမဆုံးတစ်ယောက် ဖန်တီးရန် (ADMIN_SETUP_KEY secret လိုတယ်၊ Admin မရှိသေးမှသာ အလုပ်လုပ်)
  if (path === "/api/auth/setup-admin" && method === "POST") {
    const b = await body(request);
    if (!env.ADMIN_SETUP_KEY || !safeEqual(String(b.setup_key || ""), env.ADMIN_SETUP_KEY))
      return json({ error: "ခွင့်ပြုချက်မရှိပါ" }, 403);
    const has = await env.DB.prepare("SELECT 1 FROM profiles WHERE role='admin' LIMIT 1").first();
    if (has) return json({ error: "Admin ရှိပြီးသားပါ" }, 409);
    const phone = normPhone(b.phone);
    if (!validPhone(phone) || String(b.password || "").length < 8)
      return json({ error: "ဖုန်းနံပါတ် မှန်ရမယ်၊ Password အနည်းဆုံး ၈ လုံး" }, 400);
    await createProfile(env, { phone, name: String(b.name || "Admin"), password: b.password, role: "admin" });
    return json({ ok: true }, 201);
  }

  return json({ error: "မတွေ့ပါ" }, 404);
}
