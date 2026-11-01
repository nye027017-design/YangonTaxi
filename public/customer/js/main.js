import { api, getToken, setToken } from "./api.js";
import { IC, PIN, vehicleIcon, pinIcon, carMarker, meIcon } from "./icons.js";
import { registerSW, setupInstall } from "/shared/pwa.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const YANGON = [16.8409, 96.1735];
const NOPICK = "ရွေးရန် နှိပ်ပါ", MAPPT = "မြေပုံပေါ်ရွေးထားတဲ့နေရာ";
const VEH = { taxi: "Taxi", bike: "Bike" };
const NEAR_MS = 30000;   // အနီးက Driver စာရင်း ၃၀ စက္ကန့်တစ်ကြိမ် (Free plan Request သက်သာစေရန်)

let map, pickM, dropM, driverM, meM, line, nearLayer;
let pick = null, drop = null, pickLbl = "", dropLbl = "", step = "pickup", vehicle = "taxi", quotes = {};
let quoteSeq = 0, routeNote = "", routeSrc = "estimate", routeFor = null, timer = null, nearT = null;
let wasActive = false, cancelledByMe = false, lastStatus = null, cur = null, stars = 0, registerMode = false;
let view = "Book", tab = "home", nearEta = {}, nearLoaded = false;

/* ---------- အိုင်ကွန်များ ဖြည့် ---------- */
$$("[data-ic]").forEach((e) => (e.innerHTML = IC[e.dataset.ic] || ""));
$$("[data-vi]").forEach((e) => (e.innerHTML = vehicleIcon(e.dataset.vi)));
$("#centerPin").innerHTML = PIN;
registerSW("/customer/sw.js");
setupInstall();

/* ---------- ဘုံ Helper ---------- */
const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const money = (n) => Number(n || 0).toLocaleString() + " ကျပ်";
const km = (a, b, c, d) => {
  const r = (x) => (x * Math.PI) / 180, R = 6371;
  const x = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x)) * 1.3;
};
const eta = (a, b, c, d) => Math.max(1, Math.round((km(a, b, c, d) / 22) * 60)); // ~22 km/h ခန့်မှန်း
const fmtDist = (k) => (k < 1 ? `${Math.max(50, Math.round((k * 1000) / 50) * 50)} m` : `${k.toFixed(1)} km`);
const fmtDate = (ts) => new Date(ts * 1000).toLocaleString("en-GB", { timeZone: "Asia/Yangon", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

function flash(text) {
  const t = h("div", "toast", text);
  $("#app").append(t);
  setTimeout(() => t.remove(), 2600);
}

/* ---------- မျက်နှာပြင် ပြောင်းခြင်း ---------- */
function show(v) {
  view = v;
  ["Book", "Pick", "Search", "Trip"].forEach((n) => $("#v" + n).classList.toggle("hidden", n !== v));
  $("#vDone").classList.toggle("hidden", v !== "Done");
  $("#sheet").classList.toggle("hidden", v === "Done");
  $("#centerPin").classList.toggle("hidden", v !== "Pick");
  $(".search").classList.toggle("hidden", v !== "Book" && v !== "Pick");
  $("#app").classList.toggle("withnav", v === "Book");
  $("#tabbar").classList.toggle("hidden", v !== "Book");
  if (v !== "Book") { resetPages(); nearLayer && nearLayer.clearLayers(); }
}

function resetPages() {
  tab = "home";
  $("#pgActivity").classList.add("hidden");
  $("#pgAccount").classList.add("hidden");
  $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === "home"));
}

function goTab(name) {
  tab = name;
  $$(".tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === name));
  $("#pgActivity").classList.toggle("hidden", name !== "activity");
  $("#pgAccount").classList.toggle("hidden", name !== "account");
  $("#sheet").classList.toggle("hidden", name !== "home");
  $(".search").classList.toggle("hidden", name !== "home");
  if (name === "activity") loadHistory();
  if (name === "home" && map) { map.invalidateSize(); loadNearby(); }
}
$$(".tab").forEach((t) => (t.onclick = () => goTab(t.dataset.tab)));

const stopTimers = () => { clearInterval(timer); clearInterval(nearT); timer = nearT = null; };

/* ---------- Splash / Login ---------- */
function showSplash() {
  stopTimers();
  $("#app").classList.add("hidden");
  $("#auth").classList.add("hidden");
  $("#splash").classList.remove("hidden");
}

function setMode(reg) {
  registerMode = reg;
  $("#name").classList.toggle("hidden", !reg);
  $("#name").required = reg;
  $("#password").autocomplete = reg ? "new-password" : "current-password";
  $("#authTitle").textContent = reg ? "စာရင်းသွင်းမယ်" : "ဝင်မယ်";
  $("#authSub").textContent = reg ? "ဖုန်းနံပါတ်နဲ့ အကောင့်အသစ် ဖွင့်ပါ" : "ဖုန်းနံပါတ်နဲ့ Password ထည့်ပါ";
  $("#authBtn").textContent = reg ? "စာရင်းသွင်းမယ်" : "ဝင်မယ်";
  $("#toggleAuth").textContent = reg ? "အကောင့်ရှိပြီးသား - ဝင်မယ်" : "စာရင်းသွင်းမယ်";
  $("#authMsg").textContent = "";
}

function showAuth(reg = false) {
  stopTimers();
  $("#app").classList.add("hidden");
  $("#splash").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  setMode(reg);
}

$("#startBtn").onclick = () => showAuth(true);
$("#loginLink").onclick = () => showAuth(false);
$("#authBack").onclick = showSplash;
$("#toggleAuth").onclick = () => setMode(!registerMode);

$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#authMsg").textContent = "";
  $("#authBtn").disabled = true;
  try {
    const body = { phone: $("#phone").value.trim(), password: $("#password").value };
    if (registerMode) Object.assign(body, { name: $("#name").value.trim(), role: "customer" });
    const d = await api(registerMode ? "/auth/register" : "/auth/login", { method: "POST", body });
    if (d.user.role !== "customer") throw new Error("ဒီ App က ခရီးသည်အတွက်သာ ဖြစ်ပါတယ်");
    setToken(d.token);
    $("#password").value = "";
    startApp(d.user);
  } catch (err) { $("#authMsg").textContent = err.message; }
  $("#authBtn").disabled = false;
};

$("#logout").onclick = async () => {
  if (!confirm("အကောင့်မှ ထွက်မလား?")) return;
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  setToken(null);
  showSplash();
};

function fillAccount(u) {
  $("#accName").textContent = u.name;
  $("#accPhone").textContent = u.phone;
  $("#accAvatar").textContent = (u.name || "?").trim().charAt(0).toUpperCase();
}

/* ---------- မြေပုံ ---------- */
function initMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false }).setView(YANGON, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap" }).addTo(map);
  nearLayer = L.layerGroup().addTo(map);
  map.on("moveend", () => { if (picking) onMove(); });
  map.on("click", onMapClick);
  $(".grab").onclick = () => $("#sheet").classList.toggle("min");
}

const sheetH = () => $("#sheet").offsetHeight + ($("#app").classList.contains("withnav") ? 64 : 0);
function fit(pts) {
  if (!pts.length) return;
  map.fitBounds(pts, { paddingTopLeft: [40, 90], paddingBottomRight: [40, sheetH() + 30], maxZoom: 16 });
}

function drawLine(a, b, coords, kmTxt) {
  line && line.remove();
  line = null;
  if (!a || !b) return;
  const A = L.latLng(a), B = L.latLng(b);
  line = coords && coords.length > 1
    ? L.polyline(coords, { color: "#0d9f55", weight: 5, lineJoin: "round" })
    : L.polyline([A, B], { color: "#0d9f55", weight: 4, dashArray: "2 8", lineCap: "round" });
  line.addTo(map).bindTooltip(kmTxt || km(A.lat, A.lng, B.lat, B.lng).toFixed(1) + " km",
    { permanent: true, direction: "center", className: "dtip" });
}

function showMe(ll) {
  meM ? meM.setLatLng(ll) : (meM = L.marker(ll, { icon: meIcon, interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(map));
}

/* ---------- အနီးက Driver များ (မြေပုံပေါ် ကားပုံ + ရောက်ချိန်) ---------- */
async function loadNearby() {
  if (!map || view !== "Book" || tab !== "home" || document.hidden || !getToken()) return;
  const c = pick || map.getCenter();
  try {
    const r = await api(`/nearby?lat=${c.lat}&lng=${c.lng}`);
    if (view !== "Book") return;
    nearEta = r.eta || {};
    nearLoaded = true;
    nearLayer.clearLayers();
    for (const d of r.drivers) L.marker([d.lat, d.lng], { icon: carMarker(d.type), interactive: false, keyboard: false }).addTo(nearLayer);
    renderOpts();
  } catch (err) { if (err.status === 401) showAuth(); }
}
function startNearby() { clearInterval(nearT); loadNearby(); nearT = setInterval(loadNearby, NEAR_MS); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadNearby(); });

/* ---------- ခေါ်မယ့်/သွားမယ့်နေရာ ---------- */
function setPoint(ll, which = step, label = MAPPT) {
  if (which === "pickup") {
    pick = ll; pickLbl = label;
    pickM ? pickM.setLatLng(ll) : (pickM = L.marker(ll, { icon: pinIcon("#0d9f55") }).addTo(map));
    setStep("drop");
    loadNearby();
  } else {
    drop = ll; dropLbl = label;
    dropM ? dropM.setLatLng(ll) : (dropM = L.marker(ll, { icon: pinIcon("#d93025") }).addTo(map));
  }
  renderRows();
  quote();
}

function setStep(s) {
  step = s;
  $("#rowPick").classList.toggle("on", s === "pickup");
  $("#rowDrop").classList.toggle("on", s === "drop");
}
$("#rowPick").onclick = () => startPick("pickup");
$("#rowDrop").onclick = () => startPick("drop");

function renderRows() {
  $("#pickTxt").textContent = pick ? pickLbl : NOPICK;
  $("#dropTxt").textContent = drop ? dropLbl : NOPICK;
}

$("#gps").onclick = () => {
  if (!navigator.geolocation) return ($("#bookMsg").textContent = "GPS မရနိုင်ပါ");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const ll = L.latLng(p.coords.latitude, p.coords.longitude);
      map.setView(ll, 16);
      showMe(ll);
      if (!$("#vBook").classList.contains("hidden")) setPoint(ll, "pickup", "လက်ရှိတည်နေရာ");
    },
    () => ($("#bookMsg").textContent = "GPS ခွင့်ပြုချက် ပေးပါ (Browser Settings)"),
    { enableHighAccuracy: true, timeout: 10000 });
};

/* ---------- စျေးနှုန်း ရွေးချယ်မှု ---------- */
const payload = (v) => ({
  vehicle_type: v, pickup_lat: pick.lat, pickup_lng: pick.lng, pickup_text: pickLbl,
  drop_lat: drop.lat, drop_lng: drop.lng, drop_text: dropLbl,
});

async function quote() {
  $("#bookMsg").textContent = "";
  if (!pick || !drop) { quotes = {}; renderOpts(); drawLine(null); return; }
  drawLine(pick, drop);
  fit([pick, drop]);
  const mine = ++quoteSeq;
  try {
    const r = await api("/estimate", { method: "POST", body: payload(vehicle) });
    if (mine !== quoteSeq) return;
    const q = (f) => (f == null ? null : { fare_estimate: f, distance_km: r.distance_km, duration_min: r.duration_min });
    quotes = { taxi: q(r.fares.taxi), bike: q(r.fares.bike) };
    routeSrc = r.source; routeNote = r.note || "";
    if (r.route) drawLine(pick, drop, r.route, r.distance_km.toFixed(1) + " km");   // လမ်းအတိုင်း အကွေ့ကောက်ပြ
  } catch { if (mine !== quoteSeq) return; quotes = {}; }
  renderOpts();
}

function renderOpts() {
  $$(".opt").forEach((o) => {
    const v = o.dataset.v, q = quotes[v];
    o.classList.toggle("on", v === vehicle);
    o.querySelector(".p").textContent = q ? money(q.fare_estimate) : "-";
    o.querySelector(".k").textContent = nearEta[v] ? `${nearEta[v]} မိနစ်` : nearLoaded ? "Driver မရှိသေး" : "";
  });
  $("#bookBtn").disabled = !quotes[vehicle];
  const q0 = quotes.taxi || quotes.bike;
  $("#tripDist").classList.toggle("hidden", !q0);
  if (q0) $("#tripDist").textContent = `ခရီးအကွာအဝေး ${q0.distance_km} km${routeSrc === "road" ? "" : " (ခန့်မှန်း)"} · ~${q0.duration_min} မိနစ်${routeSrc !== "road" && routeNote ? " · [" + routeNote + "]" : ""}`;
}
$$(".opt").forEach((o) => (o.onclick = () => { vehicle = o.dataset.v; renderOpts(); }));

$("#bookBtn").onclick = async () => {
  $("#bookBtn").disabled = true;
  try { await api("/bookings", { method: "POST", body: payload(vehicle) }); startPolling(); }
  catch (err) { $("#bookMsg").textContent = err.message; $("#bookBtn").disabled = false; if (err.status === 409) startPolling(); }
};

$$("[data-cancel]").forEach((b) => (b.onclick = async () => {
  if (!confirm("ခရီးစဉ်ကို ပယ်ဖျက်မလား?") || !cur) return;
  try { await api(`/bookings/${cur.id}/cancel`, { method: "POST" }); cancelledByMe = true; await poll(); }
  catch (err) { alert(err.message); }
}));

/* ---------- ခရီးစဉ် ခြေရာခံ ---------- */
let shownStatus = null;

function renderActive(b) {
  cur = b; wasActive = true; lastStatus = b.status;
  const P = [b.pickup_lat, b.pickup_lng], D = [b.drop_lat, b.drop_lng];
  if (!pickM) pickM = L.marker(P, { icon: pinIcon("#0d9f55") }).addTo(map);
  if (!dropM) dropM = L.marker(D, { icon: pinIcon("#d93025") }).addTo(map);
  pickM.setLatLng(P); dropM.setLatLng(D);
  if (routeFor !== b.id || !line) {
    routeFor = b.id;
    drawLine(P, D);
    api("/estimate", { method: "POST", body: { pickup_lat: P[0], pickup_lng: P[1], drop_lat: D[0], drop_lng: D[1] } })
      .then((r) => { if (routeFor === b.id && r.route) drawLine(P, D, r.route, r.distance_km.toFixed(1) + " km"); })
      .catch(() => {});
  }

  if (b.status === "searching") {
    show("Search"); $("#pill").classList.add("hidden");
  } else {
    show("Trip");
    const phone = b.driver_phone || "";
    $("#avatar").textContent = (b.driver_name || "?").trim().charAt(0).toUpperCase();
    $("#dName").textContent = b.driver_name || "";
    $("#dPlate").textContent = `${VEH[b.vehicle_type] || "Taxi"} · ${b.driver_plate || "-"}`;
    $("#dRate").textContent = b.driver_rating ? `★ ${b.driver_rating} · ခရီး ${b.driver_trips} ကြိမ်` : b.driver_trips ? `ခရီး ${b.driver_trips} ကြိမ်` : "အမှတ် မရှိသေးပါ";
    $("#tripVeh").innerHTML = vehicleIcon(b.vehicle_type);
    $("#callBtn").href = "tel:" + phone;
    $("#smsBtn").href = "sms:" + phone;
    $("#tripFare").textContent = money(b.fare_estimate);
    $("#cancelTrip").classList.toggle("hidden", b.status === "in_trip");

    const has = b.driver_lat != null;
    let pillT, pillS, bnT, bnS;
    if (b.status === "driver_assigned") {
      const ok = has && km(b.driver_lat, b.driver_lng, P[0], P[1]);
      pillT = "Driver လာနေပါတယ်"; pillS = b.pickup_text || "ခေါ်မယ့်နေရာ";
      bnT = "Driver ရောက်ဖို့ ခဏစောင့်ပါ";
      bnS = has ? `ခန့်မှန်း ${eta(b.driver_lat, b.driver_lng, P[0], P[1])} မိနစ် · ${fmtDist(ok)}` : "Driver လာနေပါပြီ";
    } else if (b.status === "arrived") {
      pillT = "Driver ရောက်ပါပြီ"; pillS = b.pickup_text || "ခေါ်မယ့်နေရာ";
      bnT = "Driver ရောက်ရှိပါပြီ"; bnS = "ခေါ်မယ့်နေရာမှာ စောင့်နေပါတယ်";
    } else {
      const ok = has && km(b.driver_lat, b.driver_lng, D[0], D[1]);
      pillT = "ခရီးစဉ် ဆောင်ရွက်နေပါတယ်"; pillS = b.drop_text ? "သွားမယ့်နေရာ - " + b.drop_text : "ခရီးဆုံးသို့";
      bnT = "ခရီးဆုံးသို့ သွားနေပါတယ်";
      bnS = has ? `ခန့်မှန်း ${eta(b.driver_lat, b.driver_lng, D[0], D[1])} မိနစ် · ${fmtDist(ok)}` : "ခရီးစဉ် စတင်နေပါတယ်";
    }
    $("#pillT").textContent = pillT; $("#pillS").textContent = pillS;
    $("#bnT").textContent = bnT; $("#bnS").textContent = bnS;
    $("#pill").classList.remove("hidden");

    if (has) {
      const ll = [b.driver_lat, b.driver_lng];
      driverM ? driverM.setLatLng(ll) : (driverM = L.marker(ll, { icon: carMarker(b.vehicle_type, true), zIndexOffset: 500 }).addTo(map));
    }
  }
  if (shownStatus !== b.status) { shownStatus = b.status; setTimeout(() => fit([P, D]), 60); }
}

$("#shareBtn").onclick = async () => {
  if (!cur) return;
  const lat = cur.driver_lat ?? cur.pickup_lat, lng = cur.driver_lng ?? cur.pickup_lng;
  const text = `Yangon Taxi ခရီးစဉ်\nDriver: ${cur.driver_name || "-"} · ${cur.driver_plate || "-"}\n${cur.pickup_text || "ခေါ်မယ့်နေရာ"} → ${cur.drop_text || "သွားမယ့်နေရာ"}\nတည်နေရာ: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  try {
    if (navigator.share) await navigator.share({ title: "Yangon Taxi", text });
    else { await navigator.clipboard.writeText(text); flash("ခရီးစဉ်အချက်အလက်ကို ကူးယူပြီးပါပြီ"); }
  } catch (e) { if (e.name !== "AbortError") flash("မျှဝေ၍ မရပါ"); }
};

async function poll() {
  let b;
  try { b = (await api("/bookings/active")).booking; }
  catch (err) { if (err.status === 401) showAuth(); return; }
  if (b) return renderActive(b);

  clearInterval(timer); timer = null;
  if (!wasActive) return show("Book");
  wasActive = false; shownStatus = null;
  $("#pill").classList.add("hidden");

  if (cancelledByMe) { cancelledByMe = false; alert("ခရီးစဉ်ကို ပယ်ဖျက်ပြီးပါပြီ"); return resetAll(); }
  if (lastStatus === "searching") {      // Driver မတွေ့လို့ ပိတ်သွား - နေရာတွေ ထားပေး
    alert("Driver မတွေ့လို့ ခရီးစဉ်ကို ပိတ်လိုက်ပါတယ်။ ခဏနေပြီး ထပ်မှာကြည့်ပါ။");
    show("Book"); loadNearby(); return quote();
  }
  try {
    const l = (await api("/bookings/latest")).booking;
    if (l && l.status === "completed") return showDone(l);
  } catch {}
  resetAll();
}

function showDone(l) {
  cur = l; stars = 0; paintStars();
  $("#dnInfo").textContent = `${l.driver_name || ""} · ${l.driver_plate || ""} · ${l.distance_km} km`;
  $("#dnFare").textContent = money(l.fare_final ?? l.fare_estimate);
  show("Done");
}

function paintStars() { $$("#stars button").forEach((s, i) => s.classList.toggle("on", i < stars)); }
$$("#stars button").forEach((s, i) => (s.onclick = () => { stars = i + 1; paintStars(); }));

$("#doneBtn").onclick = async () => {
  if (stars && cur) { try { await api(`/bookings/${cur.id}/rate`, { method: "POST", body: { rating: stars } }); } catch {} }
  resetAll();
};

function resetAll() {
  [pickM, dropM, driverM].forEach((m) => m && m.remove());
  pickM = dropM = driverM = null;
  drawLine(null);
  pick = drop = null; quotes = {}; cur = null; routeFor = null; setStep("pickup");
  renderRows(); renderOpts(); show("Book"); loadNearby();
}

function startPolling() { clearInterval(timer); poll(); timer = setInterval(poll, 5000); }

/* ---------- ခရီးမှတ်တမ်း ---------- */
async function loadHistory() {
  const box = $("#histList");
  box.replaceChildren(h("p", "empty", "ခဏစောင့်ပါ..."));
  try {
    const { bookings } = await api("/bookings/history");
    box.replaceChildren();
    if (!bookings.length) return box.append(h("p", "empty", "ခရီးစဉ် မရှိသေးပါ"));
    for (const b of bookings) {
      const done = b.status === "completed";
      const c = h("div", "card hist");
      const top = h("div", "top");
      top.append(h("span", "when", fmtDate(b.created_at)), h("span", "badge " + b.status, done ? "ပြီးဆုံး" : "ပယ်ဖျက်"));
      const a = h("div", "ln"); a.append(h("i", "dot g"), h("span", "", b.pickup_text || "-"));
      const z = h("div", "ln"); z.append(h("i", "dot r"), h("span", "", b.drop_text || "-"));
      const bot = h("div", "bot");
      const meta = [VEH[b.vehicle_type], b.driver_name, b.rating ? "★".repeat(b.rating) : ""].filter(Boolean).join(" · ");
      bot.append(h("b", "", money(done ? (b.fare_final ?? b.fare_estimate) : b.fare_estimate)), h("small", "", meta));
      c.append(top, a, z, bot);
      box.append(c);
    }
  } catch (err) {
    box.replaceChildren(h("p", "empty", err.message));
    if (err.status === 401) showAuth();
  }
}

/* ---------- မြေပုံပေါ် ပင်ရွေးခြင်း + နေရာရှာခြင်း ---------- */
let picking = null, pendingName = null, geoT = null, qT = null;
const NOM = "https://nominatim.openstreetmap.org";
const shortName = (d) => d.name || (d.display_name || "").split(",").slice(0, 2).join(",").trim();

async function revGeo(ll) {
  try { const d = await (await fetch(`${NOM}/reverse?format=jsonv2&zoom=18&accept-language=my,en&lat=${ll.lat}&lon=${ll.lng}`)).json(); return shortName(d) || null; }
  catch { return null; }
}

function startPick(which) {
  picking = which; setStep(which);
  show("Pick");
  $("#centerPin").className = "cpin " + (which === "pickup" ? "g" : "r");
  $("#pickTitle").textContent = (which === "pickup" ? "ခေါ်မယ့်နေရာ" : "သွားမယ့်နေရာ") + " - မြေပုံကို ရွှေ့ပြီး ပင်နဲ့ တည့်အောင် လုပ်ပါ";
  const at = which === "pickup" ? pick : drop;
  if (at) map.setView(at, 16); else onMove();
}

function onMove() {
  const c = map.getCenter();
  const other = picking === "pickup" ? drop : pick;
  $("#pickDist").textContent = other
    ? `${picking === "pickup" ? "သွားမယ့်နေရာ" : "ခေါ်မယ့်နေရာ"}ကနေ ${km(c.lat, c.lng, other.lat, other.lng).toFixed(1)} km (လမ်းအတိုင်း ခန့်မှန်း)` : "";
  pendingName = null;
  $("#pickAddr").textContent = "နေရာအမည် ရှာနေပါတယ်...";
  clearTimeout(geoT);
  geoT = setTimeout(async () => {
    const n = await revGeo(c);
    if (!picking || !map.getCenter().equals(c)) return;
    pendingName = n;
    $("#pickAddr").textContent = n || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  }, 700);
}

function endPick() { picking = null; show("Book"); loadNearby(); }
$("#backPick").onclick = endPick;
$("#confirmPick").onclick = () => {
  const c = map.getCenter(), w = picking;
  setPoint(c, w, pendingName || `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`);
  endPick();
  if (w === "pickup" && !drop) startPick("drop");
};

const PLACES = [   // ခန့်မှန်းတည်နေရာ - ရွေးပြီးရင် ပင်ကို ချိန်ညှိရတယ်
  { name: "ရွှေတိဂုံဘုရား", lat: 16.7983, lng: 96.1495 },
  { name: "ဆူးလေဘုရား", lat: 16.7746, lng: 96.1587 },
  { name: "ရန်ကုန်ဘူတာကြီး", lat: 16.7766, lng: 96.1665 },
  { name: "ရန်ကုန်လေဆိပ်", lat: 16.9073, lng: 96.1332 },
];
const PLACES_NOTE = "နေရာများ (ရွေးပြီး ပင်ကို ချိန်ညှိပါ)";

function showResults(items, note) {
  const b = $("#results");
  b.replaceChildren();
  if (note) { const n = document.createElement("button"); n.textContent = note; n.style.color = "#6f7c75"; b.append(n); }
  for (const x of items) {
    const e = document.createElement("button");
    e.textContent = x.name;
    e.onclick = () => goPlace(x);
    b.append(e);
  }
  b.classList.remove("hidden");
}

function goPlace(x) {
  $("#q").value = ""; $("#results").classList.add("hidden"); $("#q").blur();
  if (!picking) startPick("drop");
  map.setView(L.latLng(x.lat, x.lng), 17);
  setTimeout(onMove, 50);
}

$("#q").onfocus = () => { if (!$("#q").value.trim()) showResults(PLACES, PLACES_NOTE); };
$("#q").oninput = () => {
  clearTimeout(qT);
  const v = $("#q").value.trim();
  if (!v) return showResults(PLACES, PLACES_NOTE);
  if (v.length < 2) return;
  showResults([], "ရှာနေပါတယ်...");
  qT = setTimeout(() => search(v), 500);
};
$("#q").onkeydown = (e) => {
  const v = $("#q").value.trim();
  if (e.key === "Enter" && v.length > 1) { clearTimeout(qT); search(v); }
};

async function geocode(v) {
  try {
    const r = await fetch(`${NOM}/search?format=jsonv2&limit=6&countrycodes=mm&accept-language=my,en&viewbox=95.9,17.1,96.4,16.6&q=${encodeURIComponent(v)}`);
    if (r.ok) { const l = await r.json(); if (l.length) return l.map((x) => ({ name: shortName(x), lat: +x.lat, lng: +x.lon })); }
  } catch {}
  try {   // အရန် Geocoder
    const j = await (await fetch(`https://photon.komoot.io/api/?limit=6&lat=16.84&lon=96.17&q=${encodeURIComponent(v)}`)).json();
    return (j.features || []).map((f) => ({
      name: [f.properties.name, f.properties.street, f.properties.city].filter(Boolean).slice(0, 2).join(", "),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
  } catch { return null; }
}

async function search(v) {
  const list = await geocode(v);
  if ($("#q").value.trim() !== v) return;
  if (list === null) showResults(PLACES, "ရှာလို့မရပါ (အင်တာနက် စစ်ပါ) - အောက်ကနေရာများကို ရွေးနိုင်ပါတယ်");
  else if (!list.length) showResults(PLACES, "မတွေ့ပါ - ပင်နဲ့ ကိုယ်တိုင်ရွေးပါ၊ ဒါမှမဟုတ် အောက်က နေရာများ");
  else showResults(list);
}

async function onMapClick(e) {   // မြေပုံကို တိုက်ရိုက်ထိရင်လည်း နေရာသတ်မှတ်
  $("#results").classList.add("hidden");
  if ($("#vBook").classList.contains("hidden") || tab !== "home") return;
  const w = step;
  setPoint(e.latlng, w);
  const n = await revGeo(e.latlng);
  if (!n) return;
  if (w === "pickup" && pick && pick.equals(e.latlng)) pickLbl = n;
  if (w === "drop" && drop && drop.equals(e.latlng)) dropLbl = n;
  renderRows();
}

function autoLocate() {   // App ဖွင့်တာနဲ့ ခေါ်မယ့်နေရာကို GPS နဲ့ ကြိုထည့်
  navigator.geolocation?.getCurrentPosition((p) => {
    const ll = L.latLng(p.coords.latitude, p.coords.longitude);
    showMe(ll);
    if (pick || $("#vBook").classList.contains("hidden")) return;
    map.setView(ll, 16);
    setPoint(ll, "pickup", "လက်ရှိတည်နေရာ");
  }, () => {}, { timeout: 8000 });
}

/* ---------- စတင် ---------- */
function startApp(user) {
  $("#splash").classList.add("hidden");
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  if (user) fillAccount(user);
  initMap();
  setTimeout(() => map.invalidateSize(), 50);
  renderRows(); renderOpts();
  goTab("home");
  startPolling();
  autoLocate();
  startNearby();
}

(async function init() {
  if (!getToken()) return showSplash();
  try {
    const { user } = await api("/auth/me");
    if (user.role !== "customer") { setToken(null); return showSplash(); }
    startApp(user);
  } catch (err) {
    if (err.status) return showSplash();            // Token သက်တမ်းကုန်/မမှန်
    showAuth(false);                                 // အင်တာနက်မရှိ - Token ကို မဖျက်ဘဲ ပြန်ကြိုးစားခိုင်း
    $("#authMsg").textContent = "အင်တာနက် ချိတ်ဆက်မှု မရှိပါ။ ဆက်သွယ်မှု ရပြီးမှ ပြန်ဝင်ပါ";
  }
})();
