import { json, requireRole } from "./auth.js";
import { roadKm, estimateFare } from "./fares.js";
import { getRoute } from "./routes.js";

const ACTIVE = "('searching','driver_assigned','arrived','in_trip')";
const DRIVER_ACTIVE = "('driver_assigned','arrived','in_trip')";
const NEARBY_KM = 5;
export const SEARCH_TIMEOUT_S = 600; // Driver မတွေ့ရင် ၁၀ မိနစ်နဲ့ အလိုအလျောက် ပိတ်

// Cron မလိုဘဲ - ခရီးစဉ်ကို ကြည့်တဲ့အခါ သက်တမ်းကုန်တာတွေ ပိတ်ပေးတယ် (Event မှတ်တမ်းနဲ့အတူ)
export async function expireStale(env, customerId = null) {
  const scope = customerId ? "AND customer_id = ?" : "";
  const args = customerId ? [customerId] : [];
  const where = `status='searching' AND created_at < unixepoch() - ${SEARCH_TIMEOUT_S} ${scope}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO booking_events (booking_id, event) SELECT id, 'expired' FROM bookings WHERE ${where}`).bind(...args),
    env.DB.prepare(`UPDATE bookings SET status='cancelled' WHERE ${where}`).bind(...args),
  ]);
}

const NEXT = { driver_assigned: "arrived", arrived: "in_trip", in_trip: "completed" };

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const inMyanmar = (lat, lng) => lat >= 9 && lat <= 29 && lng >= 92 && lng <= 102;
const body = async (r) => { try { return await r.json(); } catch { return {}; } };

async function logEvent(env, bookingId, event, actorId) {
  await env.DB.prepare("INSERT INTO booking_events (booking_id, event, actor_id) VALUES (?,?,?)")
    .bind(bookingId, event, actorId).run();
}

// ---------- Customer ----------
async function createBooking(request, env) {
  const { user, error } = await requireRole(request, env, "customer");
  if (error) return error;
  const b = await body(request);
  const vt = ["bike", "car"].includes(b.vehicle_type) ? b.vehicle_type : "taxi";
  const [pLat, pLng, dLat, dLng] = [num(b.pickup_lat), num(b.pickup_lng), num(b.drop_lat), num(b.drop_lng)];
  if ([pLat, pLng, dLat, dLng].includes(null) || !inMyanmar(pLat, pLng) || !inMyanmar(dLat, dLng))
    return json({ error: "နေရာ တည်နေရာ မှန်ကန်မှုမရှိပါ" }, 400);

  await expireStale(env, user.id);
  const km = (await getRoute(env, pLat, pLng, dLat, dLng)).km;
  if (km < 0.2) return json({ error: "ခရီးအကွာအဝေး တိုလွန်းပါတယ်" }, 400);
  const f = await estimateFare(env, vt, km);
  if (!f) return json({ error: "ဒီယာဉ်အမျိုးအစား စျေးနှုန်း မသတ်မှတ်ရသေးပါ" }, 400);

  // Active booking မရှိမှသာ ထည့် (တစ်ကြိမ်တည်း SQL နဲ့ race မဖြစ်စေ)
  const r = await env.DB.prepare(
    `INSERT INTO bookings (customer_id, vehicle_type, pickup_lat, pickup_lng, pickup_text,
       drop_lat, drop_lng, drop_text, distance_km, fare_estimate)
     SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS
       (SELECT 1 FROM bookings WHERE customer_id = ? AND status IN ${ACTIVE})`
  ).bind(user.id, vt, pLat, pLng, String(b.pickup_text || "").slice(0, 120),
         dLat, dLng, String(b.drop_text || "").slice(0, 120),
         Math.round(km * 10) / 10, f.fare, user.id).run();

  if (r.meta.changes !== 1) return json({ error: "လက်ရှိ ခရီးစဉ်တစ်ခု ရှိနေပါတယ်" }, 409);
  const id = r.meta.last_row_id;
  await logEvent(env, id, "created", user.id);
  return json({ booking_id: id, distance_km: Math.round(km * 10) / 10, fare_estimate: f.fare, status: "searching" }, 201);
}

async function cancelBooking(request, env, id) {
  const { user, error } = await requireRole(request, env, "customer");
  if (error) return error;
  const r = await env.DB.prepare(
    `UPDATE bookings SET status='cancelled'
     WHERE id=? AND customer_id=? AND status IN ('searching','driver_assigned','arrived')`
  ).bind(id, user.id).run();
  if (r.meta.changes !== 1) return json({ error: "ပယ်ဖျက်၍ မရတော့ပါ" }, 409);
  await logEvent(env, id, "cancelled_by_customer", user.id);
  return json({ ok: true });
}

// ---------- Driver ----------
async function setOnline(request, env) {
  const { user, error } = await requireRole(request, env, "driver");
  if (error) return error;
  const b = await body(request);
  const online = b.online ? 1 : 0;
  const lat = num(b.lat), lng = num(b.lng);
  if (online && (lat === null || lng === null || !inMyanmar(lat, lng)))
    return json({ error: "GPS တည်နေရာ လိုအပ်ပါတယ်" }, 400);
  const r = await env.DB.prepare(
    `UPDATE drivers SET is_online=?, lat=COALESCE(?,lat), lng=COALESCE(?,lng), location_updated_at=unixepoch()
     WHERE profile_id=? AND status='approved'`
  ).bind(online, lat, lng, user.id).run();
  return json({ ok: r.meta.changes === 1, online: !!online });
}

async function updateLocation(request, env) {
  const { user, error } = await requireRole(request, env, "driver");
  if (error) return error;
  const b = await body(request);
  const lat = num(b.lat), lng = num(b.lng);
  if (lat === null || lng === null || !inMyanmar(lat, lng)) return json({ error: "တည်နေရာ မှားနေပါတယ်" }, 400);
  await env.DB.prepare(
    "UPDATE drivers SET lat=?, lng=?, location_updated_at=unixepoch() WHERE profile_id=? AND status='approved'"
  ).bind(lat, lng, user.id).run();
  return json({ ok: true });
}

async function nearbyRequests(request, env) {
  const { user, error } = await requireRole(request, env, "driver");
  if (error) return error;
  const d = await env.DB.prepare(
    "SELECT vehicle_type, lat, lng, is_online FROM drivers WHERE profile_id=? AND status='approved'"
  ).bind(user.id).first();
  if (!d || !d.is_online || d.lat == null) return json({ requests: [] });

  const dLat = NEARBY_KM / 111, dLng = NEARBY_KM / (111 * Math.cos((d.lat * Math.PI) / 180));
  const { results } = await env.DB.prepare(
    `SELECT id, pickup_lat, pickup_lng, pickup_text, drop_text, distance_km, fare_estimate, created_at
     FROM bookings
     WHERE status='searching' AND vehicle_type=?
       AND pickup_lat BETWEEN ? AND ? AND pickup_lng BETWEEN ? AND ?
       AND created_at > unixepoch() - ${SEARCH_TIMEOUT_S}
     ORDER BY created_at DESC LIMIT 20`
  ).bind(d.vehicle_type, d.lat - dLat, d.lat + dLat, d.lng - dLng, d.lng + dLng).all();

  const withDist = results.map((r) => ({ ...r, pickup_away_km: Math.round(roadKm(d.lat, d.lng, r.pickup_lat, r.pickup_lng) * 10) / 10 }))
    .sort((a, b) => a.pickup_away_km - b.pickup_away_km);
  return json({ requests: withDist });
}

async function acceptBooking(request, env, id) {
  const { user, error } = await requireRole(request, env, "driver");
  if (error) return error;
  // Atomic: Driver တစ်ဦးသာ ရမယ်၊ Driver က Online + Approved + ယာဉ်အမျိုးအစားတူ + ခရီးစဉ်မရှိ
  const r = await env.DB.prepare(
    `UPDATE bookings SET driver_id=?, status='driver_assigned'
     WHERE id=? AND status='searching'
       AND vehicle_type = (SELECT vehicle_type FROM drivers WHERE profile_id=? AND status='approved' AND is_online=1)
       AND NOT EXISTS (SELECT 1 FROM bookings WHERE driver_id=? AND status IN ${DRIVER_ACTIVE})`
  ).bind(user.id, id, user.id, user.id).run();
  if (r.meta.changes !== 1) return json({ error: "ဒီခရီးစဉ်ကို လက်ခံ၍ မရတော့ပါ" }, 409);
  await logEvent(env, id, "accepted", user.id);
  return json({ ok: true, status: "driver_assigned" });
}

async function advanceStatus(request, env, id) {
  const { user, error } = await requireRole(request, env, "driver");
  if (error) return error;
  const b = await body(request);
  const to = b.status;
  const from = Object.keys(NEXT).find((k) => NEXT[k] === to);
  if (!from) return json({ error: "Status မှားနေပါတယ်" }, 400);

  let r;
  if (to === "completed") {
    // ပြီးဆုံးချိန်: ငွေပမာဏနဲ့ ကော်မရှင်ကို တစ်ကြိမ်တည်း SQL နဲ့ သတ်မှတ် (WHERE status='in_trip' ကြောင့် နှစ်ခါတင်လည်း တစ်ခါပဲ)
    r = await env.DB.prepare(
      `UPDATE bookings SET status='completed', completed_at=unixepoch(),
         fare_final = fare_estimate,
         commission = CAST(ROUND(fare_estimate * (SELECT commission_percent FROM fare_rules
            WHERE vehicle_type = bookings.vehicle_type AND active=1 ORDER BY id DESC LIMIT 1) / 100.0) AS INTEGER)
       WHERE id=? AND driver_id=? AND status='in_trip'`
    ).bind(id, user.id).run();
  } else {
    r = await env.DB.prepare("UPDATE bookings SET status=? WHERE id=? AND driver_id=? AND status=?")
      .bind(to, id, user.id, from).run();
  }
  if (r.meta.changes !== 1) return json({ error: "Status ပြောင်း၍ မရပါ" }, 409);
  await logEvent(env, id, to, user.id);
  return json({ ok: true, status: to });
}

async function releaseBooking(request, env, id) {
  const { user, error } = await requireRole(request, env, "driver");
  if (error) return error;
  const r = await env.DB.prepare(
    `UPDATE bookings SET driver_id=NULL, status='searching'
     WHERE id=? AND driver_id=? AND status IN ('driver_assigned','arrived')`
  ).bind(id, user.id).run();
  if (r.meta.changes !== 1) return json({ error: "ပြန်လွှတ်၍ မရပါ" }, 409);
  await logEvent(env, id, "released_by_driver", user.id);
  return json({ ok: true });
}

// ---------- ဘုံ ----------
async function activeBooking(request, env) {
  const { user, error } = await requireRole(request, env, "customer", "driver");
  if (error) return error;
  if (user.role === "customer") await expireStale(env, user.id);
  const col = user.role === "customer" ? "customer_id" : "driver_id";
  const b = await env.DB.prepare(
    `SELECT b.*, dp.name AS driver_name, dp.phone AS driver_phone, dr.plate AS driver_plate,
            dr.lat AS driver_lat, dr.lng AS driver_lng,
            cp.name AS customer_name, cp.phone AS customer_phone
     FROM bookings b
     LEFT JOIN profiles dp ON dp.id = b.driver_id
     LEFT JOIN drivers dr ON dr.profile_id = b.driver_id
     JOIN profiles cp ON cp.id = b.customer_id
     WHERE b.${col} = ? AND b.status IN ${ACTIVE} ORDER BY b.id DESC LIMIT 1`
  ).bind(user.id).first();
  if (b && b.driver_id) {   // Driver ရဲ့ ခရီးအရေအတွက်/ကြယ် - မရလည်း ခရီးစဉ်ကိုယ်တိုင် ဆက်အလုပ်လုပ်ရမယ်
    try {
      b.driver_trips = (await env.DB.prepare("SELECT COUNT(*) AS t FROM bookings WHERE driver_id=? AND status='completed'").bind(b.driver_id).first()).t;
      b.driver_rating = (await env.DB.prepare("SELECT ROUND(AVG(rating),1) AS r FROM bookings WHERE driver_id=? AND rating IS NOT NULL").bind(b.driver_id).first()).r;
    } catch {}
  }
  return json({ booking: b || null });
}

async function adminList(request, env) {
  const { error } = await requireRole(request, env, "admin");
  if (error) return error;
  await expireStale(env);
  const { results } = await env.DB.prepare(
    `SELECT b.id, cp.name AS customer_name, dp.name AS driver_name, b.vehicle_type, b.status,
            b.distance_km, b.fare_estimate, b.fare_final, b.commission, b.created_at
     FROM bookings b JOIN profiles cp ON cp.id = b.customer_id
     LEFT JOIN profiles dp ON dp.id = b.driver_id
     ORDER BY b.id DESC LIMIT 100`
  ).all();
  return json({ bookings: results });
}

async function estimate(request, env) {
  const { user, error } = await requireRole(request, env, "customer", "driver");
  if (error) return error;
  const b = await body(request);
  const [pLat, pLng, dLat, dLng] = [num(b.pickup_lat), num(b.pickup_lng), num(b.drop_lat), num(b.drop_lng)];
  if ([pLat, pLng, dLat, dLng].includes(null) || !inMyanmar(pLat, pLng) || !inMyanmar(dLat, dLng))
    return json({ error: "နေရာ တည်နေရာ မှန်ကန်မှုမရှိပါ" }, 400);
  const r = await getRoute(env, pLat, pLng, dLat, dLng);
  const [taxi, bike, car] = await Promise.all(["taxi", "bike", "car"].map((v) => estimateFare(env, v, r.km)));
  return json({
    distance_km: Math.round(r.km * 10) / 10, duration_min: r.minutes, route: r.coords, source: r.source, note: r.note,
    fares: { taxi: taxi ? taxi.fare : null, bike: bike ? bike.fare : null, car: car ? car.fare : null },
  });
}

async function latestBooking(request, env) {
  const { user, error } = await requireRole(request, env, "customer");
  if (error) return error;
  const b = await env.DB.prepare(
    `SELECT b.*, dp.name AS driver_name, dr.plate AS driver_plate
     FROM bookings b LEFT JOIN profiles dp ON dp.id = b.driver_id
     LEFT JOIN drivers dr ON dr.profile_id = b.driver_id
     WHERE b.customer_id = ? ORDER BY b.id DESC LIMIT 1`).bind(user.id).first();
  return json({ booking: b || null });
}

async function myBookings(request, env) {
  const { user, error } = await requireRole(request, env, "customer");
  if (error) return error;
  const q = (cols) => env.DB.prepare(
    `SELECT id, vehicle_type, pickup_text, drop_text, distance_km, fare_estimate, fare_final, status, ${cols} created_at
     FROM bookings WHERE customer_id = ? ORDER BY id DESC LIMIT 30`).bind(user.id).all();
  let r;
  try { r = await q("rating,"); } catch { r = await q(""); }   // rating Column မရှိသေးရင် မပါဘဲ ပြ
  return json({ bookings: r.results });
}

async function rateBooking(request, env, id) {
  const { user, error } = await requireRole(request, env, "customer");
  if (error) return error;
  const { rating } = await body(request);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: "၁ မှ ၅ ကြား ရွေးပါ" }, 400);
  const r = await env.DB.prepare(
    "UPDATE bookings SET rating=? WHERE id=? AND customer_id=? AND status='completed' AND rating IS NULL"
  ).bind(rating, id, user.id).run();
  return json({ ok: r.meta.changes === 1 });
}

export async function handleBookings(request, env, path) {
  const m = request.method;
  if (path === "/api/estimate" && m === "POST") return estimate(request, env);
  if (path === "/api/bookings" && m === "POST") return createBooking(request, env);
  if (path === "/api/bookings/mine" && m === "GET") return myBookings(request, env);
  if (path === "/api/bookings/latest" && m === "GET") return latestBooking(request, env);
  if (path === "/api/bookings/active" && m === "GET") return activeBooking(request, env);
  if (path === "/api/driver/online" && m === "POST") return setOnline(request, env);
  if (path === "/api/driver/location" && m === "POST") return updateLocation(request, env);
  if (path === "/api/driver/requests" && m === "GET") return nearbyRequests(request, env);
  if (path === "/api/admin/bookings" && m === "GET") return adminList(request, env);

  const x = path.match(/^\/api\/bookings\/(\d+)\/(cancel|accept|status|release|rate)$/);
  if (x && m === "POST") {
    const id = Number(x[1]);
    if (x[2] === "cancel") return cancelBooking(request, env, id);
    if (x[2] === "accept") return acceptBooking(request, env, id);
    if (x[2] === "status") return advanceStatus(request, env, id);
    if (x[2] === "rate") return rateBooking(request, env, id);
    if (x[2] === "release") return releaseBooking(request, env, id);
  }
  return null;
}
