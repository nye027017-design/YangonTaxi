import { api, getToken, setToken } from "./api.js";

const $ = (s) => document.querySelector(s);
const STATUS = {
  searching: "Driver ရှာနေပါတယ်...",
  driver_assigned: "Driver လက်ခံပြီး လာနေပါတယ်",
  arrived: "Driver ရောက်ရှိပါပြီ",
  in_trip: "ခရီးစဉ် စတင်နေပါတယ်",
};
const YANGON = [16.8409, 96.1735];

let map, pickM, dropM, driverM;
let pick = null, drop = null, step = "pickup", vehicle = "taxi";
let timer = null, wasActive = false, registerMode = false;
let lastStatus = null, cancelledByMe = false;

/* ---------- Login / Register ---------- */
function showAuth() {
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
}

$("#toggleAuth").onclick = () => {
  registerMode = !registerMode;
  $("#name").classList.toggle("hidden", !registerMode);
  $("#name").required = registerMode;
  $("#authBtn").textContent = registerMode ? "စာရင်းသွင်းမယ်" : "ဝင်မယ်";
  $("#toggleAuth").textContent = registerMode ? "အကောင့်ရှိပြီးသား - ဝင်မယ်" : "စာရင်းသွင်းမယ်";
  $("#authMsg").textContent = "";
};

$("#authForm").onsubmit = async (e) => {
  e.preventDefault();
  $("#authMsg").textContent = "";
  try {
    const body = { phone: $("#phone").value.trim(), password: $("#password").value };
    if (registerMode) Object.assign(body, { name: $("#name").value.trim(), role: "customer" });
    const d = await api(registerMode ? "/auth/register" : "/auth/login", { method: "POST", body });
    if (d.user.role !== "customer") throw new Error("ဒီ App က ခရီးသည်အတွက်သာ ဖြစ်ပါတယ်");
    setToken(d.token);
    startApp();
  } catch (err) {
    $("#authMsg").textContent = err.message;
  }
};

$("#logout").onclick = async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  setToken(null);
  clearInterval(timer);
  showAuth();
};

/* ---------- မြေပုံ ---------- */
function initMap() {
  if (map) return;
  map = L.map("map").setView(YANGON, 13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  map.on("click", (e) => setPoint(e.latlng));
}

const dot = (color) => ({ radius: 9, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 });

function setPoint(ll, which = step) {
  if (which === "pickup") {
    pick = ll;
    pickM ? pickM.setLatLng(ll) : (pickM = L.circleMarker(ll, dot("#188038")).addTo(map));
    setStep("drop");
  } else {
    drop = ll;
    dropM ? dropM.setLatLng(ll) : (dropM = L.circleMarker(ll, dot("#d93025")).addTo(map));
  }
  refreshEstimate();
}

function setStep(s) {
  step = s;
  $("#chipPick").classList.toggle("on", s === "pickup");
  $("#chipDrop").classList.toggle("on", s === "drop");
  $("#hint").textContent = s === "pickup"
    ? "မြေပုံပေါ်မှာ ခေါ်မယ့်နေရာကို ထိပါ"
    : "မြေပုံပေါ်မှာ သွားမယ့်နေရာကို ထိပါ";
}
$("#chipPick").onclick = () => setStep("pickup");
$("#chipDrop").onclick = () => setStep("drop");

$("#gps").onclick = () => {
  if (!navigator.geolocation) return ($("#bookMsg").textContent = "GPS မရနိုင်ပါ");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const ll = L.latLng(p.coords.latitude, p.coords.longitude);
      map.setView(ll, 16);
      setPoint(ll, "pickup");
    },
    () => ($("#bookMsg").textContent = "GPS ခွင့်ပြုချက် ပေးပါ (Browser Settings)"),
    { enableHighAccuracy: true, timeout: 10000 }
  );
};

function setVehicle(v) {
  vehicle = v;
  $("#vTaxi").classList.toggle("on", v === "taxi");
  $("#vBike").classList.toggle("on", v === "bike");
  refreshEstimate();
}
$("#vTaxi").onclick = () => setVehicle("taxi");
$("#vBike").onclick = () => setVehicle("bike");

const payload = () => ({
  vehicle_type: vehicle,
  pickup_lat: pick.lat, pickup_lng: pick.lng, pickup_text: "",
  drop_lat: drop.lat, drop_lng: drop.lng, drop_text: "",
});

async function refreshEstimate() {
  $("#bookMsg").textContent = "";
  if (!pick || !drop) { $("#est").textContent = ""; $("#bookBtn").disabled = true; return; }
  try {
    const d = await api("/estimate", { method: "POST", body: payload() });
    $("#est").textContent = `${d.distance_km} km · ခန့်မှန်းခ ${d.fare_estimate.toLocaleString()} ကျပ်`;
    $("#bookBtn").disabled = false;
  } catch (err) {
    $("#est").textContent = "";
    $("#bookBtn").disabled = true;
    $("#bookMsg").textContent = err.message;
  }
}

/* ---------- Booking ---------- */
$("#bookBtn").onclick = async () => {
  $("#bookBtn").disabled = true;
  try {
    await api("/bookings", { method: "POST", body: payload() });
    startPolling();
  } catch (err) {
    $("#bookMsg").textContent = err.message;
    $("#bookBtn").disabled = false;
    if (err.status === 409) startPolling(); // ခရီးစဉ်ရှိပြီးသား - ပြန်ပြ
  }
};

$("#cancelBtn").onclick = async () => {
  if (!confirm("ခရီးစဉ်ကို ပယ်ဖျက်မလား?")) return;
  try {
    await api(`/bookings/${currentId}/cancel`, { method: "POST" });
    cancelledByMe = true;
    await poll();
  } catch (err) { alert(err.message); }
};

let currentId = null;

async function poll() {
  let b;
  try { b = (await api("/bookings/active")).booking; }
  catch (err) { if (err.status === 401) showAuth(); return; }

  if (b) {
    wasActive = true;
    currentId = b.id;
    lastStatus = b.status;
    $("#bookPanel").classList.add("hidden");
    $("#trackPanel").classList.remove("hidden");
    $("#trackStatus").textContent = STATUS[b.status] || b.status;
    $("#trackInfo").textContent = b.driver_name
      ? `${b.driver_name} · ${b.driver_plate || ""}`
      : `ခန့်မှန်းခ ${(b.fare_estimate || 0).toLocaleString()} ကျပ် · ၁၀ မိနစ်အတွင်း Driver မတွေ့ရင် အလိုအလျောက် ပိတ်ပါမယ်`;
    const call = $("#callBtn");
    if (b.driver_phone) { call.href = "tel:" + b.driver_phone; call.classList.remove("hidden"); }
    else call.classList.add("hidden");
    $("#cancelBtn").classList.toggle("hidden", b.status === "in_trip");

    if (b.driver_lat != null) {
      const ll = [b.driver_lat, b.driver_lng];
      driverM ? driverM.setLatLng(ll) : (driverM = L.circleMarker(ll, dot("#1a73e8")).addTo(map));
    }
  } else {
    clearInterval(timer);
    timer = null;
    if (wasActive) {
      wasActive = false;
      if (cancelledByMe) {
        alert("ခရီးစဉ်ကို ပယ်ဖျက်ပြီးပါပြီ");
        resetBooking();
      } else if (lastStatus === "searching") {
        // Driver မတွေ့လို့ ပိတ်သွား - နေရာတွေကို ထားပေးထားမယ်၊ ပြန်မှာရုံပဲ
        alert("Driver မတွေ့လို့ ခရီးစဉ်ကို ပိတ်လိုက်ပါတယ်။ ခဏနေပြီး ထပ်မှာကြည့်ပါ။");
        refreshEstimate();
      } else {
        alert("ခရီးစဉ် ပြီးဆုံးပါပြီ");
        resetBooking();
      }
      cancelledByMe = false;
    }
    $("#trackPanel").classList.add("hidden");
    $("#bookPanel").classList.remove("hidden");
  }
}

function startPolling() {
  clearInterval(timer);
  poll();
  timer = setInterval(poll, 5000);
}

function resetBooking() {
  [pickM, dropM, driverM].forEach((m) => m && m.remove());
  pickM = dropM = driverM = null;
  pick = drop = null;
  setStep("pickup");
  $("#est").textContent = "";
  $("#bookBtn").disabled = true;
}

/* ---------- စတင် ---------- */
function startApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  initMap();
  setTimeout(() => map.invalidateSize(), 50);
  startPolling();
}

(async function init() {
  if (!getToken()) return showAuth();
  try {
    const { user } = await api("/auth/me");
    if (user.role !== "customer") { setToken(null); return showAuth(); }
    startApp();
  } catch { showAuth(); }
})();
