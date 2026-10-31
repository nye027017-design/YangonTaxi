const KEY = "taxi_driver_token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const t = getToken();
  if (t) headers.Authorization = "Bearer " + t;
  const r = await fetch("/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401) setToken(null);
    throw Object.assign(new Error(data.error || "အမှားတစ်ခု ဖြစ်သွားပါတယ်"), { status: r.status });
  }
  return data;
}
