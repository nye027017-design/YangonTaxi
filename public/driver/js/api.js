const KEY = "taxi_driver_token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) headers.Authorization = "Bearer " + t;
  const r = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  if (!r.ok || data === null) {
    if (r.status === 401) setToken(null);
    const msg = data?.error || `Server က မမှန်ကန်တဲ့ အဖြေပြန်လာပါတယ် (HTTP ${r.status})`;
    throw Object.assign(new Error(data?.detail ? `${msg}: ${data.detail}` : msg), { status: r.status });
  }
  return data;
}
