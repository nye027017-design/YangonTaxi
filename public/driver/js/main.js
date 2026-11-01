import { api, getToken, setToken } from "./api.js"; 

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const YANGON = [16.8409, 96.1735];
const money = (n) => Number(n || 0).toLocaleString() + " ကျပ်";
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const TXT = { driver_assigned: ["ခရီးသည်ဆီ သွားနေပါတယ်", "ရောက်ပြီ", 0], arrived: ["ခရီးသည်ကို စောင့်နေပါတယ်", "ခရီးစတင်မယ်", 1], in_trip: ["ခရီးစဉ် စတင်နေပါတယ်", "ခရီးပြီးဆုံးပြီ", 2] };
const NEXT = { driver_assigned: "arrived", arrived: "in_trip", in_trip: "completed" };

let map, meM, pickM, dropM, line, routeFor = null, shownStatus = null;
let online = false, last = null, watchId = null, timer = null, busy = false, trip = null;
let registerMode = false, showingDone = false, seen = new Set(), wake = null, actx = null, earn = null, toastT = null;

/* ---------- ကူညီမှုများ ---------- */
function toast(msg, ok) {
  let t = $("#toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.append(t); }
  t.className = "toast" + (ok ? " ok" : ""); t.textContent = msg;
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), ok ? 4000 : 8000);
}
const show = (v) => {
  $("#app").dataset.v = v;
  $("#vIdle").classList.toggle("hidden", v !== "Idle");
  $("#vTrip").classList.toggle("hidden", v !== "Trip");
  $("#vDone").classList.toggle("hidden", v !== "Done");
};
const pinIcon = (c) => L.divIcon({ className: "", iconSize: [30, 40], iconAnchor: [15, 40],
  html: `<svg viewBox="0 0 24 32" width="30" height="40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="${c}" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>` });

function unlockAudio() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch {} }
function beep() {   // ခရီးစဉ်သစ်ရောက်ရင် အသံ + တုန်ခါမှု
  try {
    if (actx) [880, 1175, 880].forEach((f, i) => {
      const t = actx.currentTime + i * 0.22, o = actx.createOscillator(), g = actx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.start(t); o.stop(t + 0.21);
    });
  } catch {}
  navigator.vibrate?.([250, 120, 250]);
}
async function keepAwake() {   // Online ဖြစ်နေစဉ် မျက်နှာပြင် မမှိန်စေ (မှိန်ရင် GPS/ခေါ်ဆိုမှု ရပ်တတ်လို့)
  try { if (online && "wakeLock" in navigator && !wake) { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => (wake = null)); } } catch {}
}
const releaseWake = () => { try { wake?.release(); } catch {} wake = null; };

/* ---------- Login ---------- */
function showAuth() { clearTimeout(timer); $("#app").classList.add("hidden"); $("#auth").classList.remove("hidden"); }

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
  const msg = $("#authMsg"); msg.className = "msg"; msg.textContent = "";
  try {
    const body = { phone: $("#phone").value.trim(), password: $("#password").value };
    if (registerMode) Object.assign(body, { name: $("#name").value.trim(), role: "driver", vehicle_type: $("#vehicle").value, plate: $("#plate").value.trim() });
    const d = await api(registerMode ? "/auth/register" : "/auth/login", { method: "POST", body });
    if (registerMode) { $("#toggleAuth").click(); msg.className = "msg ok"; msg.textContent = d.message; return; }
    if (d.user.role !== "driver") throw new Error("ဒီ App က Driver အတွက်သာ ဖြစ်ပါတယ်");
    setToken(d.token); startApp();
  } catch (err) { msg.textContent = err.message; }
};

async function logout() {
  if (trip) return toast("ခရီးစဉ်ပြီးမှ ထွက်ပါ");
  if (online) await goOffline();
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  setToken(null); showAuth();
}

/* ---------- မြေပုံ / GPS ---------- */
function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false }).setView(YANGON, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
}
function onPos(p) {
  const first = !last;
  last = { lat: p.coords.latitude, lng: p.coords.longitude };
  meM ? meM.setLatLng([last.lat, last.lng]) : (meM = L.marker([last.lat, last.lng], { icon: L.divIcon({ className: "", html: '<div class="me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map));
  if (first) map.setView([last.lat, last.lng], 15);
}
const getPos = () => new Promise((res, rej) =>
  navigator.geolocation ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 }) : rej(new Error("GPS မရနိုင်ပါ")));

$("#gps").onclick = async () => {
  try { if (!last) onPos(await getPos()); map.setView([last.lat, last.lng], 16); } catch { toast("GPS ခွင့်ပြုချက် ပေးပါ (Browser Settings)"); }
};

/* ---------- Online / Offline ---------- */
function setOnlineUI() {
  $("#stat").classList.toggle("on", online);
  $("#statTxt").textContent = online ? "Online" : "Offline";
  const b = $("#onlineBtn"); b.textContent = online ? "OFF" : "GO"; b.classList.toggle("on", online);
  $("#idleTitle").textContent = online ? "ခရီးစဉ်အသစ် စောင့်နေပါတယ်..." : "Offline ဖြစ်နေပါတယ်";
  $("#idleSub").textContent = online ? "အနီးအနား ၅ km အတွင်း" : "GO ကိုနှိပ်ပြီး ခရီးစဉ်တွေ စတင်စောင့်ပါ";
}

async function goOnline() {
  unlockAudio();
  $("#reqMsg").textContent = "";
  try {
    onPos(await getPos());
    await api("/driver/online", { method: "POST", body: { online: true, lat: last.lat, lng: last.lng } });
    watchId = navigator.geolocation.watchPosition(onPos, () => {}, { enableHighAccuracy: true });
    online = true; seen = new Set();
    setOnlineUI(); keepAwake();
    tick().then(schedule);
  } catch (err) { toast(err.code ? "GPS ခွင့်ပြုချက် ပေးပါ (Browser Settings)" : err.message); }
}

async function goOffline() {
  try { await api("/driver/online", { method: "POST", body: { online: false } }); } catch {}
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; online = false;
  releaseWake(); setOnlineUI(); schedule();
  $("#reqList").replaceChildren();
}

$("#onlineBtn").onclick = () => {
  if (trip) return toast("ခရီးစဉ်ပြီးမှ Offline လုပ်ပါ");
  online ? goOffline() : goOnline();
};

/* ---------- Poll (Request သက်သာအောင် တစ်ခုတည်း၊ အခြေအနေအလိုက် ကြိမ်နှုန်း) ---------- */
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const d = await api("/driver/poll", { method: "POST", body: online && last ? last : {} });
    trip = d.booking;
    $("#reqMsg").textContent = ""; $("#tripMsg").textContent = "";
    if (trip) { showingDone = false; renderTrip(); }
    else if (!showingDone) { clearTripUI(); show("Idle"); if (online) renderRequests(d.requests); }
  } catch (err) {
    if (err.status === 401) showAuth();
    else { const m = "Server အမှား: " + err.message; $("#reqMsg").textContent = m; $("#tripMsg").textContent = m; }
  } finally { busy = false; }
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden || $("#app").classList.contains("hidden")) return;
  if (!online && !trip) return;
  timer = setTimeout(async () => { await tick(); schedule(); }, trip ? 5000 : 10000);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || $("#app").classList.contains("hidden")) return;
  keepAwake(); tick().then(schedule);
});

/* ---------- ခရီးစဉ်စာရင်း ---------- */
function renderRequests(list) {
  const fresh = list.filter((r) => !seen.has(r.id));
  fresh.forEach((r) => seen.add(r.id));
  if (fresh.length) { beep(); toast("ခရီးစဉ်အသစ် ရောက်လာပါပြီ!", true); }
  $("#idleTitle").textContent = list.length ? `ခရီးစဉ် ${list.length} ခု ရှိပါတယ်` : "ခရီးစဉ်အသစ် စောင့်နေပါတယ်...";
  const box = $("#reqList"); box.replaceChildren();
  for (const r of list) {
    const el = document.createElement("div"); el.className = "req";
    const g = document.createElement("div"); g.className = "grow";
    const b = document.createElement("b"); b.textContent = money(r.fare_estimate);
    const s = document.createElement("small"); s.textContent = `ခေါ်မယ့်နေရာ ${r.pickup_away_km} km အကွာ · ခရီး ${r.distance_km} km`;
    const s2 = document.createElement("small"); s2.textContent = `${r.pickup_text || "-"} → ${r.drop_text || "-"}`;
    g.append(b, s, s2);
    const btn = document.createElement("button"); btn.textContent = "လက်ခံမယ်";
    btn.onclick = async (e) => {
      e.stopPropagation(); btn.disabled = true;
      try { await api(`/bookings/${r.id}/accept`, { method: "POST" }); await tick(); schedule(); }
      catch (err) { toast(err.message); btn.disabled = false; tick(); }
    };
    el.onclick = () => { setPins([r.pickup_lat, r.pickup_lng], null); map.setView([r.pickup_lat, r.pickup_lng], 15); };
    el.append(g, btn); box.append(el);
  }
}

function setPins(P, D) {
  pickM ? pickM.setLatLng(P) : (pickM = L.marker(P, { icon: pinIcon("#188038") }).addTo(map));
  if (D) dropM ? dropM.setLatLng(D) : (dropM = L.marker(D, { icon: pinIcon("#d93025") }).addTo(map));
}
function setLine(P, D, coords) {
  line && line.remove();
  line = coords && coords.length > 1
    ? L.polyline(coords, { color: "#0b9d58", weight: 5, lineJoin: "round" }).addTo(map)
    : L.polyline([P, D], { color: "#0b9d58", weight: 4, dashArray: "2 8", lineCap: "round" }).addTo(map);
}

/* ---------- လက်ရှိခရီးစဉ် ---------- */
function renderTrip() {
  show("Trip");
  const [title, label, step] = TXT[trip.status];
  const P = [trip.pickup_lat, trip.pickup_lng], D = [trip.drop_lat, trip.drop_lng];
  $("#tripStatus").textContent = title;
  $$(".steps i").forEach((x, i) => x.classList.toggle("done", i <= step));
  $$(".steps u").forEach((x, i) => x.classList.toggle("done", i < step));
  $("#avatar").textContent = (trip.customer_name || "?").trim().charAt(0).toUpperCase();
  $("#cName").textContent = trip.customer_name || "";
  $("#cInfo").textContent = `${trip.distance_km} km · ကောက်ခံရန် ${money(trip.fare_estimate)}`;
  $("#callBtn").href = "tel:" + (trip.customer_phone || "");
  $("#rtFrom").textContent = trip.pickup_text || "ခေါ်မယ့်နေရာ";
  $("#rtTo").textContent = trip.drop_text || "သွားမယ့်နေရာ";
  const dest = trip.status === "in_trip" ? D : P;
  $("#navBtn").href = `https://www.google.com/maps/dir/?api=1&destination=${dest[0]},${dest[1]}&travelmode=driving`;
  $("#releaseBtn").classList.toggle("hidden", trip.status === "in_trip");
  $("#nextBtn").textContent = label;

  setPins(P, D);
  if (routeFor !== trip.id) {   // လမ်းကြောင်း (လမ်းအတိုင်း) တစ်ကြိမ်ယူ
    routeFor = trip.id; setLine(P, D, null);
    api("/estimate", { method: "POST", body: { pickup_lat: P[0], pickup_lng: P[1], drop_lat: D[0], drop_lng: D[1] } })
      .then((r) => { if (routeFor === trip.id && r.route) setLine(P, D, r.route); }).catch(() => {});
  }
  if (shownStatus !== trip.status) { shownStatus = trip.status; setTimeout(() => map.fitBounds([P, D], { paddingTopLeft: [40, 80], paddingBottomRight: [40, $(".sheet").offsetHeight + 30], maxZoom: 16 }), 60); }
}

function clearTripUI() {
  [pickM, dropM].forEach((m) => m && m.remove()); pickM = dropM = null;
  line && line.remove(); line = null; routeFor = null; shownStatus = null;
}

$("#nextBtn").onclick = async () => {
  if (!trip) return;
  const to = NEXT[trip.status], fare = trip.fare_estimate;
  $("#nextBtn").disabled = true;
  try {
    await api(`/bookings/${trip.id}/status`, { method: "POST", body: { status: to } });
    if (to === "completed") {
      showingDone = true; trip = null; clearTripUI();
      $("#dnFare").textContent = money(fare); show("Done"); loadEarnings();
    }
  } catch (err) { $("#tripMsg").textContent = err.message; }
  $("#nextBtn").disabled = false;
  tick();
};

$("#releaseBtn").onclick = async () => {
  if (!trip || !confirm("ဒီခရီးစဉ်ကို ပြန်လွှတ်မလား?")) return;
  try { await api(`/bookings/${trip.id}/release`, { method: "POST" }); }
  catch (err) { $("#tripMsg").textContent = err.message; }
  tick();
};

$("#doneBtn").onclick = () => { showingDone = false; show("Idle"); tick().then(schedule); };

/* ---------- ဝင်ငွေ + Menu ---------- */
async function loadEarnings() {
  try {
    earn = await api("/driver/trips");
    $("#earnChip").textContent = "ဒီနေ့ " + money(earn.today.fare);
    $("#mTrips").textContent = earn.today.trips;
    $("#mFare").textContent = Number(earn.today.fare).toLocaleString();
  } catch {}
}

function earnHtml() {
  if (!earn) return "<p class='sub'>ခဏစောင့်ပါ...</p>";
  const box = (t, d) => `<p class="sub" style="margin:8px 2px 6px"><b>${t}</b></p><div class="grid3">
    <div class="st"><b>${d.trips}</b><small>ခရီး</small></div><div class="st"><b>${money(d.fare)}</b><small>ကောက်ခံငွေ</small></div>
    <div class="st"><b>${money(d.comm)}</b><small>ကော်မရှင် (ပေးရန်)</small></div><div class="st"><b>${money(d.fare - d.comm)}</b><small>ကျန်ငွေ</small></div></div>`;
  const rows = earn.trips.map((x) => `<div class="card"><small>${new Date(x.completed_at * 1000).toLocaleString("en-GB")}</small><b>${esc(x.pickup_text || "-")} → ${esc(x.drop_text || "-")}</b><div class="row"><span>${x.distance_km ?? "-"} km</span><b>${money(x.fare_final)}</b></div></div>`).join("");
  return box("ဒီနေ့", earn.today) + box("ရက် ၇ ရက်", earn.week) + `<p class="sub" style="margin:8px 2px"><b>နောက်ဆုံးခရီးများ</b></p>` + (rows || "<p class='sub'>ခရီး မရှိသေးပါ</p>");
}

$("#nav").onclick = async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $$("#nav button").forEach((x) => x.classList.toggle("on", x === b));
  const t = b.dataset.t, panel = $("#panel");
  if (t === "home") { panel.classList.add("hidden"); setTimeout(() => map.invalidateSize(), 50); return; }
  panel.classList.remove("hidden");
  if (t === "earn") {
    $("#panelTitle").textContent = "ဝင်ငွေ"; $("#panelBody").innerHTML = earnHtml();
    await loadEarnings(); if (!panel.classList.contains("hidden") && $("#panelTitle").textContent === "ဝင်ငွေ") $("#panelBody").innerHTML = earnHtml();
  } else {
    $("#panelTitle").textContent = "အကောင့်";
    let u = {}; try { u = (await api("/auth/me")).user; } catch {}
    $("#panelBody").innerHTML = `<div class="card"><b>${esc(u.name)}</b><small>${esc(u.phone)}</small></div><button id="out2" class="primary" style="background:#d93025">ထွက်မယ်</button>`;
    $("#out2").onclick = logout;
  }
};

/* ---------- စတင် ---------- */
function startApp() {
  $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden");
  initMap(); setTimeout(() => map.invalidateSize(), 50);
  setOnlineUI(); loadEarnings();
  tick().then(schedule);
}

(async function init() {
  if (!getToken()) return showAuth();
  try {
    const { user } = await api("/auth/me");
    if (user.role !== "driver") { setToken(null); return showAuth(); }
    startApp();
  } catch { showAuth(); }
})();
