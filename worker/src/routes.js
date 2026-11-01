import { roadKm } from "./fares.js";

// OpenRouteService နဲ့ လမ်းအတိုင်း အကွာအဝေး/အချိန်/လမ်းကြောင်း ယူ။ Key မရှိ/Limit ပြည့်/Error ဆိုရင် မျဉ်းဖြောင့် × ၁.၃ နဲ့ အစားထိုး
const cache = new Map();
const TTL_MS = 10 * 60 * 1000;

export async function getRoute(env, pLat, pLng, dLat, dLng) {
  const key = [pLat, pLng, dLat, dLng].map((x) => x.toFixed(5)).join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;

  let v = null, note = "ORS_API_KEY မရှိပါ (Secret မထည့်ရသေး၊ ဒါမှမဟုတ် Deploy မလုပ်ရသေး)";
  if (env.ORS_API_KEY) {
    note = "";
    try {
      const base = env.ORS_BASE_URL || "https://api.heigit.org/openrouteservice";   // api.openrouteservice.org အဟောင်းကို ပိတ်ပြီ
      const r = await fetch(`${base}/v2/directions/driving-car/geojson`, {
        method: "POST",
        headers: { Authorization: env.ORS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: [[pLng, pLat], [dLng, dLat]], radiuses: [2000, 2000] }),   // လမ်းပေါ်မှာ မရှိတဲ့နေရာ (လေဆိပ်၊ ပန်းခြံ) ဆိုရင် ၂ km အတွင်း အနီးဆုံးလမ်းကို ရှာ
      });
      if (!r.ok) note = `ORS HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`;
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
        } else note = "ORS အဖြေပုံစံ မမှန်ပါ";
      }
    } catch (e) { note = "ORS ချိတ်မရ: " + String(e.message || e).slice(0, 100); }
  }
  if (!v) {
    const km = roadKm(pLat, pLng, dLat, dLng);
    return { km, minutes: Math.max(1, Math.round((km / 22) * 60)), coords: null, source: "estimate", note };
  }
  cache.set(key, { t: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}
