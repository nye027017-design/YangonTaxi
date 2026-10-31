// အကွာအဝေး (km) - မျဥ်းဖြောင့် Haversine × 1.3 (လမ်းကွေ့ခန့်မှန်း)
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const roadKm = (a, b, c, d) => haversineKm(a, b, c, d) * 1.3;

export async function estimateFare(env, vehicleType, km) {
  const rule = await env.DB.prepare(
    "SELECT base_fare, per_km, commission_percent FROM fare_rules WHERE vehicle_type = ? AND active = 1 ORDER BY id DESC LIMIT 1"
  ).bind(vehicleType).first();
  if (!rule) return null;
  const raw = rule.base_fare + rule.per_km * km;
  return { fare: Math.round(raw / 100) * 100, commission_percent: rule.commission_percent };
}
