import { handleAuth, requireRole, json } from "./auth.js";
import { handleBookings } from "./bookings.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith("/api/")) {
      try {
        if (path === "/api/health") {
          try {
            const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM profiles").first();
            return json({ ok: true, db: true, profiles: r.n });
          } catch (e) {
            return json({ ok: false, db: false, detail: String(e.message || e) }, 500);
          }
        }
        if (path.startsWith("/api/auth/")) return await handleAuth(request, env, path);

        const b = await handleBookings(request, env, path);
        if (b) return b;

        // Admin သီးသန့် route (နောက်အဆင့်တွေမှာ ဒီပုံစံနဲ့ ဆက်ထည့်မယ်)
        if (path === "/api/admin/drivers/pending" && request.method === "GET") {
          const { error } = await requireRole(request, env, "admin");
          if (error) return error;
          const { results } = await env.DB.prepare(
            `SELECT p.id, p.name, p.phone, d.vehicle_type, d.plate
             FROM drivers d JOIN profiles p ON p.id = d.profile_id
             WHERE d.status = 'pending'`).all();
          return json({ drivers: results });
        }

        if (path === "/api/admin/drivers/approve" && request.method === "POST") {
          const { error } = await requireRole(request, env, "admin");
          if (error) return error;
          const { driver_id } = await request.json().catch(() => ({}));
          const r = await env.DB.prepare("UPDATE drivers SET status='approved' WHERE profile_id = ?")
            .bind(driver_id).run();
          return json({ ok: r.meta.changes === 1 });
        }

        return json({ error: "မတွေ့ပါ" }, 404);
      } catch (e) {
        console.error(e);
        return json({ error: "Server အမှား", ...(env.DEBUG === "1" && { detail: String(e.message || e) }) }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
