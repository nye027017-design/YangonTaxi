import { json, requireRole } from "./auth.js";
import { expireStale } from "./bookings.js";

const body = async (r) => { try { return await r.json(); } catch { return {}; } };
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

export async function handleAdmin(request, env, path) {
  if (!path.startsWith("/api/admin/")) return null;
  const { error } = await requireRole(request, env, "admin");
  if (error) return error;
  const m = request.method;

  if (path === "/api/admin/summary" && m === "GET") {
    await expireStale(env);
    const s = await env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM drivers WHERE status='pending') AS pending_drivers,
        (SELECT COUNT(*) FROM drivers WHERE status='approved' AND is_online=1) AS online_drivers,
        (SELECT COUNT(*) FROM bookings WHERE status IN ('searching','driver_assigned','arrived','in_trip')) AS active_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status='completed' AND completed_at > unixepoch()-86400) AS trips_24h,
        (SELECT COALESCE(SUM(fare_final),0) FROM bookings WHERE status='completed' AND completed_at > unixepoch()-86400) AS fare_24h,
        (SELECT COALESCE(SUM(commission),0) FROM bookings WHERE status='completed' AND completed_at > unixepoch()-86400) AS commission_24h`
    ).first();
    return json(s);
  }

  if (path === "/api/admin/drivers" && m === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.name, p.phone, d.vehicle_type, d.plate, d.status, d.is_online,
        (SELECT COUNT(*) FROM bookings b WHERE b.driver_id=p.id AND b.status='completed') AS trips,
        (SELECT COALESCE(SUM(commission),0) FROM bookings b WHERE b.driver_id=p.id AND b.status='completed') AS commission_total
       FROM drivers d JOIN profiles p ON p.id = d.profile_id
       ORDER BY (d.status='pending') DESC, p.id DESC`
    ).all();
    return json({ drivers: results });
  }

  if (path === "/api/admin/drivers/status" && m === "POST") {
    const b = await body(request);
    if (!["approved", "suspended"].includes(b.status)) return json({ error: "Status မှားနေပါတယ်" }, 400);
    const r = await env.DB.prepare(
      "UPDATE drivers SET status=?, is_online=CASE WHEN ?='suspended' THEN 0 ELSE is_online END WHERE profile_id=?"
    ).bind(b.status, b.status, b.driver_id).run();
    if (r.meta.changes !== 1) return json({ error: "Driver မတွေ့ပါ" }, 404);
    if (b.status === "suspended")   // ရပ်ဆိုင်းရင် Login Token အားလုံး ပယ်
      await env.DB.prepare("DELETE FROM sessions WHERE profile_id=?").bind(b.driver_id).run();
    return json({ ok: true });
  }

  if (path === "/api/admin/fares" && m === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT vehicle_type, base_fare, per_km, commission_percent FROM fare_rules WHERE active=1 ORDER BY vehicle_type"
    ).all();
    return json({ fares: results });
  }

  if (path === "/api/admin/fares" && m === "POST") {
    const b = await body(request);
    if (!["taxi", "bike"].includes(b.vehicle_type)) return json({ error: "ယာဉ်အမျိုးအစား မှားနေပါတယ်" }, 400);
    if (!int(b.base_fare, 0, 1000000) || !int(b.per_km, 0, 1000000) || !int(b.commission_percent, 0, 100))
      return json({ error: "ဂဏန်းတွေကို အပြည့်ကိန်းနဲ့ မှန်မှန်ထည့်ပါ (ကော်မရှင် 0-100)" }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE fare_rules SET active=0 WHERE vehicle_type=?").bind(b.vehicle_type),
      env.DB.prepare("INSERT INTO fare_rules (vehicle_type, base_fare, per_km, commission_percent, active) VALUES (?,?,?,?,1)")
        .bind(b.vehicle_type, b.base_fare, b.per_km, b.commission_percent),
    ]);
    return json({ ok: true });
  }

  return null; // ကျန် /api/admin/... ကို index.js ထဲက Route တွေ ဆက်ကိုင်မယ်
}
