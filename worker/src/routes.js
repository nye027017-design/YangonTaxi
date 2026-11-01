import { roadKm } from "./fares.js";

// OpenRouteService နဲ့ လမ်းအတိုင်း အကွာအဝေး/အချိန်/လမ်းကြောင်း ယူ။ Key မရှိ/Limit ပြည့်/Error ဆိုရင် မျဉ်းဖြောင့် × ၁.၃ နဲ့ အစားထိုး
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

export async function getRoute(env, pLat, pLng, dLat, dLng) {
  const key = [pLat, pLng, dLat, dLng].map((x) => x.toFixed(5)).join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;

  let v = null;
  if (env.ORS_API_KEY) {
    try {
      const base = env.ORS_BASE_URL || "https://api.heigit.org/openrouteservice";   // api.openrouteservice.org အဟောင်းကို ပိတ်ပြီ
      const r = await fetch(`${base}/v2/directions/driving-car/geojson`, {
        method: "POST",
        headers: { Authorization: env.ORS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [[pLng, pLat], [dLng, dLat]] }),
      });
      if (r.ok) {
        const f = (await r.json()).features?.[0];
        const sum = f?.properties?.summary;
        if (sum && f.geometry?.coordinates?.length > 1) {
          v = {
            km: sum.distance / 1000,
            minutes: Math.max(1, Math.round(sum.duration / 60)),
            coords: f.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
            source: "road",
          };
        }
      }
    } catch {}
  }
  if (!v) {
    const km = roadKm(pLat, pLng, dLat, dLng);
    return { km, minutes: Math.max(1, Math.round((km / 22) * 60)), coords: null, source: "estimate" };
  }
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}
