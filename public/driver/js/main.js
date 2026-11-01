import { api, getToken, setToken } from "./api.js";

const $ = (s) => document.querySelector(s);
const YANGON = [16.8409, 96.1735];
const STATUS = {
  driver_assigned: "ခရီးသည်ဆီ သွားနေပါတယ်",
  arrived: "ခရီးသည်ကို စောင့်နေပါတယ်",
  in_trip: "ခရီးစဉ် စတင်နေပါတယ်",
};
const NEXT = {
  driver_assigned: ["arrived", "ရောက်ပြီ"],
  arrived: ["in_trip", "ခရီးစတင်မယ်"],
  in_trip: ["completed", "ခရီးပြီးဆုံးပြီ"],
};
const IDLE_MS = 20000, TRIP_MS = 8000, TICK_MS = 5000;

let map, meM, pickM, dropM;
let online = false, last = null, watchId = null, lastSent = 0;
let timer = null, busy = false, trip = null, registerMode = false;

const dot = (c) => ({ radius: 9, color: "#fff", weight: 3, fillColor: c, fillOpacity: 1 });

/* ---------- Login / Register ---------- */
function showAuth() {
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
}

$("#toggleAuth").onclick = () => {
  registerMode = !registerMode;
  ["#name", "#vehicle", "#plate"].forEach((s) => $(s).classList.toggle("hidden", !registerMode));
  $("#name").required = registerMode;
  $("#authBtn").textContent = registerMode ? "စာရင်းသွင်းမယ်" : "ဝင်မယ်";
  $("#toggleAuth").textContent = registerMode ? "အကောင့်ရှိပြီးသား - ဝင်မယ်" : "Driver အဖြစ် စာရင်းသွင်းမယ်";
  $("#authMsg").textContent = "";
};

$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  const msg = $("#authMsg");
  msg.className = "msg";
  msg.textContent = "";
  try {
    const body = { phone: $("#phone").value.trim(), password: $("#password").value };
    if (registerMode)
      Object.assign(body, { name: $("#name").value.trim(), role: "driver",
        vehicle_type: $("#vehicle").value, plate: $("#plate").value.trim() });
    const d = await api(registerMode ? "/auth/register" : "/auth/login", { method: "POST", body });
    if (registerMode) {          // Driver က Admin အတည်ပြုချက် စောင့်ရမယ်
      $("#toggleAuth").click();          // Login ပုံစံသို့ ပြောင်း (ဒါက စာကို ဖျက်လို့ အရင်လုပ်)
      msg.className = "msg ok";
      msg.textContent = d.message;
      return;
    }
    if (d.user.role !== "driver") throw new Error("ဒီ App က Driver အတွက်သာ ဖြစ်ပါတယ်");
    setToken(d.token);
    startApp();
  } catch (err) {
    msg.textContent = err.message;
  }
};

$("#logout").onclick = async () => {
  if (trip) return alert("ခရီးစဉ်ပြီးမှ ထွက်ပါ");
  if (online) await goOffline();
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  setToken(null);
  clearInterval(timer);
  showAuth();
};

/* ---------- မြေပုံ / GPS ---------- */
function initMap() {
  if (map) return;
  map = L.map("map").setView(YANGON, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function onPosition(p) {
  last = { lat: p.coords.latitude, lng: p.coords.longitude };
  meM ? meM.setLatLng([last.lat, last.lng]) : (meM = L.circleMarker([last.lat, last.lng], dot("#1a73e8")).addTo(map));
}

const getPos = () => new Promise((res, rej) =>
  navigator.geolocation
    ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
    : rej(new Error("GPS မရနိုင်ပါ")));

async function goOnline() {
  $("#reqMsg").textContent = "";
  try {
    const p = await getPos();
    onPosition(p);
    await api("/driver/online", { method: "POST", body: { online: true, lat: last.lat, lng: last.lng } });
    watchId = navigator.geolocation.watchPosition(onPosition, () => {}, { enableHighAccuracy: true });
    online = true;
    lastSent = Date.now();
    map.setView([last.lat, last.lng], 15);
    renderOnlineUI();
    tick();
  } catch (err) {
    $("#reqMsg").textContent = err.code ? "GPS ခွင့်ပြုချက် ပေးပါ (Browser Settings)" : err.message;
  }
}

async function goOffline() {
  try { await api("/driver/online", { method: "POST", body: { online: false } }); } catch {}
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  online = false;
  renderOnlineUI();
  $("#reqList").replaceChildren();
}

$("#onlineBtn").onclick = () => {
  if (trip) return alert("ခရီးစဉ်ပြီးမှ Offline လုပ်ပါ");
  online ? goOffline() : goOnline();
};

function renderOnlineUI() {
  const b = $("#onlineBtn");
  b.textContent = online ? "Online" : "Offline";
  b.classList.toggle("on", online);
  $("#reqHint").textContent = online ? "အနီးအနားက ခရီးစဉ်များ (၅ km)" : "Online ဖွင့်ပြီး ခရီးစဉ်တွေ စောင့်ပါ";
}

/* ---------- ၅ စက္ကန့်တစ်ကြိမ် ---------- */
async function tick() {
  if (busy) return;
  busy = true;
  try {
    trip = (await api("/bookings/active")).booking;
    $("#reqMsg").textContent = ""; $("#tripMsg").textContent = "";
    if (online && last && Date.now() - lastSent >= (trip ? TRIP_MS : IDLE_MS)) {
      lastSent = Date.now();
      api("/driver/location", { method: "POST", body: last }).catch(() => {});
    }
    if (trip) renderTrip();
    else { clearTripUI(); if (online) await renderRequests(); }
  } catch (err) {
    if (err.status === 401) { clearInterval(timer); showAuth(); }
    else { const m = "Server အမှား: " + err.message; $("#reqMsg").textContent = m; $("#tripMsg").textContent = m; }
  } finally { busy = false; }
}

/* ---------- ခရီးစဉ်စာရင်း ---------- */
async function renderRequests() {
  const { requests } = await api("/driver/requests");
  const list = $("#reqList");
  list.replaceChildren();
  $("#reqHint").textContent = requests.length ? "အနီးအနားက ခရီးစဉ်များ (၅ km)" : "ခရီးစဉ်အသစ် စောင့်နေပါတယ်...";
  for (const r of requests) {
    const el = document.createElement("div");
    el.className = "req";
    const p = document.createElement("p");
    p.textContent = `ခေါ်မယ့်နေရာ ${r.pickup_away_km} km အကွာ · ခရီး ${r.distance_km} km · ${r.fare_estimate.toLocaleString()} ကျပ်`;
    const btn = document.createElement("button");
    btn.textContent = "လက်ခံမယ်";
    btn.onclick = async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try { await api(`/bookings/${r.id}/accept`, { method: "POST" }); await tick(); }
      catch (err) { $("#reqMsg").textContent = err.message; btn.disabled = false; tick(); }
    };
    el.onclick = () => showPoints(r.pickup_lat, r.pickup_lng, null, null);
    el.append(p, btn);
    list.append(el);
  }
}

function showPoints(pLat, pLng, dLat, dLng) {
  pickM ? pickM.setLatLng([pLat, pLng]) : (pickM = L.circleMarker([pLat, pLng], dot("#188038")).addTo(map));
  if (dLat != null) {
    dropM ? dropM.setLatLng([dLat, dLng]) : (dropM = L.circleMarker([dLat, dLng], dot("#d93025")).addTo(map));
    map.fitBounds([[pLat, pLng], [dLat, dLng]], { padding: [40, 40] });
  } else map.setView([pLat, pLng], 15);
}

/* ---------- လက်ရှိခရီးစဉ် ---------- */
function renderTrip() {
  $("#reqPanel").classList.add("hidden");
  $("#tripPanel").classList.remove("hidden");
  $("#tripStatus").textContent = STATUS[trip.status] || trip.status;
  $("#tripInfo").textContent = `${trip.customer_name} · ${trip.distance_km} km · ${(trip.fare_estimate || 0).toLocaleString()} ကျပ်`;
  const call = $("#callBtn");
  call.href = "tel:" + trip.customer_phone;
  call.classList.remove("hidden");
  const [, label] = NEXT[trip.status];
  $("#nextBtn").textContent = label;
  $("#releaseBtn").classList.toggle("hidden", trip.status === "in_trip");
  showPoints(trip.pickup_lat, trip.pickup_lng, trip.drop_lat, trip.drop_lng);
}

function clearTripUI() {
  $("#tripPanel").classList.add("hidden");
  $("#reqPanel").classList.remove("hidden");
  [pickM, dropM].forEach((m) => m && m.remove());
  pickM = dropM = null;
}

$("#nextBtn").onclick = async () => {
  const [to] = NEXT[trip.status];
  const fare = trip.fare_estimate || 0;
  $("#nextBtn").disabled = true;
  try {
    await api(`/bookings/${trip.id}/status`, { method: "POST", body: { status: to } });
    if (to === "completed") alert(`ခရီးပြီးဆုံးပါပြီ။ ကောက်ခံရန် ${fare.toLocaleString()} ကျပ်`);
  } catch (err) { $("#tripMsg").textContent = err.message; }
  $("#nextBtn").disabled = false;
  tick();
};

$("#releaseBtn").onclick = async () => {
  if (!confirm("ဒီခရီးစဉ်ကို ပြန်လွှတ်မလား?")) return;
  try { await api(`/bookings/${trip.id}/release`, { method: "POST" }); }
  catch (err) { $("#tripMsg").textContent = err.message; }
  tick();
};

/* ---------- စတင် ---------- */
function startApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  initMap();
  setTimeout(() => map.invalidateSize(), 50);
  renderOnlineUI();
  clearInterval(timer);
  tick();
  timer = setInterval(tick, TICK_MS);
}

(async function init() {
  if (!getToken()) return showAuth();
  try {
    const { user } = await api("/auth/me");
    if (user.role !== "driver") { setToken(null); return showAuth(); }
    startApp();
  } catch { showAuth(); }
})();
