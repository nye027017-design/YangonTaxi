import { api, getToken, setToken } from "./api.js";
import { registerSW, setupInstall } from "/shared/pwa.js";

registerSW("/driver/sw.js");
setupInstall();

const $ = (s) => document.querySelector(s);
const YANGON = [16.8409, 96.1735];
const STATUS = {
  driver_assigned: "ခရီးသည်ဆီ သွားပါ",
  arrived: "ခရီးသည်ကို စောင့်နေပါတယ်",
  in_trip: "ခရီးစဉ် စတင်နေပါတယ်",
};
const NEXT = {
  driver_assigned: ["arrived", "ရောက်ပြီ"],
  arrived: ["in_trip", "ခရီးစတင်မယ်"],
  in_trip: ["completed", "ခရီးပြီးဆုံးပြီ"],
};
const IDLE_MS = 20000, TRIP_MS = 8000, TICK_MS = 5000, COUNT_S = 30;

let map, meM, pickM, dropM;
let online = false, last = null, watchId = null, lastSent = 0;
let timer = null, busy = false, trip = null, registerMode = false, hadTrip = false;
let shownReq = null, cdT = null, cdEnd = 0;
const declined = new Set();   // ငြင်း/အချိန်ကုန်တဲ့ ခရီးစဉ်များ (ဒီ Device မှာသာ ပြန်မပြ)

const dot = (c) => ({ radius: 9, color: "#fff", weight: 3, fillColor: c, fillOpacity: 1 });
const money = (n) => Number(n || 0).toLocaleString();
const mins = (km) => Math.max(1, Math.round((km / 22) * 60));   // ~22 km/h
const roadKm = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3;
};
const setMode = (m) => ($("#app").dataset.mode = m);
const initial = (n) => (n || "?").trim().charAt(0).toUpperCase();

/* ---------- Login / Register ---------- */
function showAuth() {
  clearInterval(timer); clearInterval(cdT);
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
}

$("#toggleAuth").onclick = () => {
  registerMode = !registerMode;
  ["#name", "#vehicle", "#plate"].forEach((s) => $(s).classList.toggle("hidden", !registerMode));
  $("#name").required = registerMode;
  $("#password").autocomplete = registerMode ? "new-password" : "current-password";
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
    $("#password").value = "";
    startApp(d.user);
  } catch (err) {
    msg.textContent = err.message;
  }
};

$("#logout").onclick = async () => {
  if (trip) return alert("ခရီးစဉ်ပြီးမှ ထွက်ပါ");
  if (online) await goOffline();
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  setToken(null);
  showAuth();
};

/* ---------- မြေပုံ / GPS ---------- */
function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false }).setView(YANGON, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function onPosition(p) {
  last = { lat: p.coords.latitude, lng: p.coords.longitude };
  meM ? meM.setLatLng([last.lat, last.lng]) : (meM = L.circleMarker([last.lat, last.lng], dot("#2f7df6")).addTo(map));
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
  hideRequest();
  renderOnlineUI();
}

$("#onlineBtn").onclick = () => {
  if (trip) return alert("ခရီးစဉ်ပြီးမှ Offline လုပ်ပါ");
  online ? goOffline() : goOnline();
};
$("#findBtn").onclick = () => { if (!online) $("#onlineBtn").click(); };

function renderOnlineUI() {
  const b = $("#onlineBtn");
  b.textContent = online ? "Online" : "Offline";
  b.classList.toggle("on", online);
  b.setAttribute("aria-checked", String(online));
  $("#stateTxt").textContent = online ? "ခရီးစဉ်တွေ စောင့်နေပါတယ်" : "Offline - ခရီးမလက်ခံပါ";
  const f = $("#findBtn");
  f.textContent = online ? "ခရီးစဉ် ရှာနေပါတယ်..." : "Online ဖွင့်မယ်";
  f.classList.toggle("searching", online);
  $("#reqHint").textContent = online ? "အနီးအနားက ခရီးစဉ်များ (၅ km) ကို စောင့်နေပါတယ်" : "Online ဖွင့်ပြီး ခရီးစဉ်တွေ စောင့်ပါ";
}

/* ---------- ၅ စက္ကန့်တစ်ကြိမ် ---------- */
async function tick() {
  if (busy) return;
  busy = true;
  try {
    trip = (await api("/bookings/active")).booking;
    if (online && last && Date.now() - lastSent >= (trip ? TRIP_MS : IDLE_MS)) {
      lastSent = Date.now();
      api("/driver/location", { method: "POST", body: last }).catch(() => {});
    }
    if (trip) { hadTrip = true; hideRequest(); renderTrip(); }
    else {
      if (hadTrip) { hadTrip = false; refreshStats(); }
      clearTripUI();
      if (online) await renderRequests(); else hideRequest();
    }
  } catch (err) {
    if (err.status === 401) { clearInterval(timer); showAuth(); }
  } finally { busy = false; }
}

async function refreshStats() {
  try {
    const s = await api("/driver/stats");
    $("#stTrips").textContent = s.trips;
    $("#stEarn").textContent = money(s.earned);
  } catch {}
}

/* ---------- ခရီးတောင်းဆိုမှု (၃၀ စက္ကန့် Countdown) ---------- */
async function renderRequests() {
  const { requests } = await api("/driver/requests");
  const r = requests.find((x) => !declined.has(x.id));   // အနီးဆုံးကို ဦးစွာ
  if (!r) return hideRequest();
  showRequest(r);
}

function showRequest(r) {
  setMode("request");
  $("#idleBox").classList.add("hidden");
  $("#reqCard").classList.remove("hidden");
  $("#countdown").classList.remove("hidden");
  $("#rcAway").textContent = `${mins(r.pickup_away_km)} မိနစ်အကွာ · ${r.pickup_away_km} km`;
  $("#rcAv").textContent = initial(r.customer_name);
  $("#rcName").textContent = r.customer_name || "ခရီးသည်";
  $("#rcFare").textContent = `${money(r.fare_estimate)} ကျပ်`;
  $("#rcPick").textContent = r.pickup_text || "ခေါ်မယ့်နေရာ";
  $("#rcDrop").textContent = r.drop_text || "သွားမယ့်နေရာ";
  $("#rcTrip").textContent = `ခရီး ${r.distance_km} km · ~${mins(r.distance_km)} မိနစ်`;
  if (shownReq !== r.id) {
    shownReq = r.id;
    showPoints(r.pickup_lat, r.pickup_lng, null, null);
    cdEnd = Date.now() + COUNT_S * 1000;
    clearInterval(cdT);
    paintCountdown();
    cdT = setInterval(paintCountdown, 250);
  }
}

function paintCountdown() {
  const left = Math.max(0, (cdEnd - Date.now()) / 1000);
  $("#cdNum").textContent = Math.ceil(left);
  $("#cdRing").style.strokeDashoffset = 283 * (1 - left / COUNT_S);
  if (left <= 0 && shownReq != null) { declined.add(shownReq); hideRequest(); tick(); }
}

function hideRequest() {
  clearInterval(cdT);
  shownReq = null;
  $("#reqCard").classList.add("hidden");
  $("#countdown").classList.add("hidden");
  $("#idleBox").classList.remove("hidden");
}

$("#declineBtn").onclick = () => {
  if (shownReq != null) declined.add(shownReq);
  hideRequest();
  tick();
};

$("#acceptBtn").onclick = async () => {
  const id = shownReq;
  if (id == null) return;
  const b = $("#acceptBtn");
  b.disabled = true;
  try {
    await api(`/bookings/${id}/accept`, { method: "POST" });
    hideRequest();
  } catch (err) {
    $("#reqMsg").textContent = err.message;   // တခြား Driver က ယူသွားပြီ စသည်
    declined.add(id);
    hideRequest();
  }
  b.disabled = false;
  tick();
};

function showPoints(pLat, pLng, dLat, dLng) {
  pickM ? pickM.setLatLng([pLat, pLng]) : (pickM = L.circleMarker([pLat, pLng], dot("#0d9f55")).addTo(map));
  if (dLat != null) {
    dropM ? dropM.setLatLng([dLat, dLng]) : (dropM = L.circleMarker([dLat, dLng], dot("#d93025")).addTo(map));
    map.fitBounds([[pLat, pLng], [dLat, dLng]], { paddingTopLeft: [40, 110], paddingBottomRight: [40, 300] });
  } else map.setView([pLat, pLng], 15);
}

/* ---------- လက်ရှိခရီးစဉ် ---------- */
function renderTrip() {
  setMode("trip");
  $("#reqPanel").classList.add("hidden");
  $("#tripPanel").classList.remove("hidden");
  $("#tripStatus").textContent = STATUS[trip.status] || trip.status;
  let away = "";
  if (last) {
    if (trip.status === "driver_assigned") away = `${mins(roadKm(last.lat, last.lng, trip.pickup_lat, trip.pickup_lng))} မိနစ်အကွာ`;
    else if (trip.status === "in_trip") away = `ခရီးဆုံးအထိ ${mins(roadKm(last.lat, last.lng, trip.drop_lat, trip.drop_lng))} မိနစ်`;
    else away = "ရောက်ရှိပြီ";
  }
  $("#tripAway").textContent = away;
  $("#tcAv").textContent = initial(trip.customer_name);
  $("#tcName").textContent = trip.customer_name || "ခရီးသည်";
  $("#tcFare").textContent = `${money(trip.fare_estimate)} ကျပ်`;
  $("#callBtn").href = "tel:" + trip.customer_phone;
  $("#smsBtn").href = "sms:" + trip.customer_phone;
  $("#tripInfo").textContent = `${trip.pickup_text || "ခေါ်မယ့်နေရာ"} → ${trip.drop_text || "သွားမယ့်နေရာ"} · ${trip.distance_km} km`;
  const [, label] = NEXT[trip.status];
  $("#nextBtn").textContent = label;
  $("#releaseBtn").classList.toggle("hidden", trip.status === "in_trip");
  showPoints(trip.pickup_lat, trip.pickup_lng, trip.drop_lat, trip.drop_lng);
}

function clearTripUI() {
  $("#tripPanel").classList.add("hidden");
  $("#reqPanel").classList.remove("hidden");
  if (shownReq == null) {
    setMode("idle");
    [pickM, dropM].forEach((m) => m && m.remove());
    pickM = dropM = null;
  }
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
function startApp(user) {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  if (user) { $("#meName").textContent = user.name; $("#meAv").textContent = initial(user.name); }
  initMap();
  setTimeout(() => map.invalidateSize(), 50);
  renderOnlineUI();
  refreshStats();
  clearInterval(timer);
  tick();
  timer = setInterval(tick, TICK_MS);
}

(async function init() {
  if (!getToken()) return showAuth();
  try {
    const { user } = await api("/auth/me");
    if (user.role !== "driver") { setToken(null); return showAuth(); }
    startApp(user);
  } catch { showAuth(); }
})();
