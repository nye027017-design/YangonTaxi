import { api, getToken, setToken } from "./api.js";

const $ = (s) => document.querySelector(s);
const fmt = (n) => Number(n || 0).toLocaleString();
const ST = { searching: "ရှာနေ", driver_assigned: "လက်ခံပြီး", arrived: "ရောက်ပြီ", in_trip: "ခရီးစဉ်", completed: "ပြီးဆုံး", cancelled: "ပယ်ဖျက်" };
const DST = { pending: "စောင့်ဆိုင်း", approved: "အတည်ပြုပြီး", suspended: "ရပ်ဆိုင်း" };

let tab = "summary", timer = null;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(text, cls, onclick) {
  const b = h("button", cls, text);
  b.onclick = onclick;
  return b;
}

/* ---------- Login / Setup ---------- */
function showAuth() {
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  clearInterval(timer);
}
const authMsg = (t, ok) => { $("#authMsg").textContent = t; $("#authMsg").className = "msg" + (ok ? " good" : ""); };

$("#toggleSetup").onclick = () => {
  const s = $("#setupForm");
  s.classList.toggle("hidden");
  $("#loginForm").classList.toggle("hidden", !s.classList.contains("hidden"));
  authMsg("");
};

$("#loginForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const d = await api("/auth/login", { method: "POST", body: { phone: $("#phone").value.trim(), password: $("#password").value } });
    if (d.user.role !== "admin") throw new Error("Admin မဟုတ်ပါ");
    setToken(d.token);
    startApp();
  } catch (err) { authMsg(err.message); }
};

$("#setupForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api("/auth/setup-admin", { method: "POST", body: {
      setup_key: $("#sKey").value, name: $("#sName").value.trim(),
      phone: $("#sPhone").value.trim(), password: $("#sPass").value } });
    $("#toggleSetup").click();
    $("#phone").value = $("#sPhone").value;
    authMsg("Admin ဖန်တီးပြီးပါပြီ။ အခု ဝင်ပါ။", true);
  } catch (err) { authMsg(err.message); }
};

$("#logout").onclick = async () => {
  try { await api("/auth/logout", { method: "POST" }); } catch {}
  setToken(null);
  showAuth();
};

/* ---------- Tabs ---------- */
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => {
  tab = b.dataset.tab;
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
  load();
}));
$("#refresh").onclick = () => load();

async function load() {
  const c = $("#content");
  try {
    if (tab === "summary") renderSummary(c, await api("/admin/summary"));
    else if (tab === "drivers") renderDrivers(c, (await api("/admin/drivers")).drivers);
    else if (tab === "bookings") renderBookings(c, (await api("/admin/bookings")).bookings);
    else if (tab === "fares" && !c.querySelector("[data-editing]")) renderFares(c, (await api("/admin/fares")).fares);
  } catch (err) {
    if (err.status === 401 || err.status === 403) return showAuth();
    c.replaceChildren(h("p", "msg", err.message));
  }
}

/* ---------- ခြုံငုံ ---------- */
function renderSummary(c, s) {
  const stat = (n, label) => { const d = h("div", "stat"); d.append(h("b", "", n), h("span", "", label)); return d; };
  const g = h("div", "cards");
  g.append(
    stat(fmt(s.pending_drivers), "အတည်ပြုရန် စောင့်နေတဲ့ Driver"),
    stat(fmt(s.online_drivers), "Online Driver"),
    stat(fmt(s.active_bookings), "လက်ရှိ ခရီးစဉ်"),
    stat(fmt(s.trips_24h), "ပြီးဆုံးတဲ့ ခရီးစဉ် (၂၄ နာရီ)"),
    stat(fmt(s.fare_24h), "ခရီးစရိတ်စုစုပေါင်း (၂၄ နာရီ)"),
    stat(fmt(s.commission_24h), "ကော်မရှင် (၂၄ နာရီ)"),
  );
  c.replaceChildren(g);
}

/* ---------- Driver ---------- */
function renderDrivers(c, list) {
  c.replaceChildren();
  if (!list.length) return c.append(h("p", "", "Driver မရှိသေးပါ"));
  for (const d of list) {
    const it = h("div", "item");
    const t = h("p", "", `${d.name} · ${d.phone}`);
    t.style.fontWeight = "600";
    const line = h("p", "sub");
    const badge = h("span", "badge " + d.status, DST[d.status] || d.status);
    line.append(badge, ` ${d.vehicle_type} · ${d.plate || "-"}${d.is_online ? " · Online" : ""}`);
    it.append(t, line, h("p", "sub", `ခရီး ${d.trips} ခု · ကော်မရှင်စုစုပေါင်း ${fmt(d.commission_total)} ကျပ်`));
    const row = h("div", "btns");
    const set = (status, ask) => async () => {
      if (ask && !confirm(ask)) return;
      try { await api("/admin/drivers/status", { method: "POST", body: { driver_id: d.id, status } }); load(); }
      catch (err) { alert(err.message); }
    };
    if (d.status === "pending") row.append(btn("အတည်ပြုမယ်", "ok", set("approved")));
    if (d.status === "approved") row.append(btn("ရပ်ဆိုင်းမယ်", "danger", set("suspended", `${d.name} ကို ရပ်ဆိုင်းမလား?`)));
    if (d.status === "suspended") row.append(btn("ပြန်ဖွင့်မယ်", "ok", set("approved")));
    it.append(row);
    c.append(it);
  }
}

/* ---------- ခရီးစဉ် ---------- */
function renderBookings(c, list) {
  c.replaceChildren();
  if (!list.length) return c.append(h("p", "", "ခရီးစဉ် မရှိသေးပါ"));
  for (const b of list) {
    const it = h("div", "item");
    const t = h("p", "");
    t.append(h("span", "badge " + b.status, ST[b.status] || b.status), ` #${b.id} · ${b.vehicle_type}`);
    it.append(t,
      h("p", "sub", `ခရီးသည် ${b.customer_name} → Driver ${b.driver_name || "-"}`),
      h("p", "sub", `${b.distance_km ?? "-"} km · ခန့်မှန်း ${fmt(b.fare_estimate)}` +
        (b.fare_final != null ? ` · ကောက်ခံ ${fmt(b.fare_final)} · ကော်မရှင် ${fmt(b.commission)}` : "")),
      h("p", "sub", new Date(b.created_at * 1000).toLocaleString("en-GB")));
    c.append(it);
  }
}

/* ---------- စျေးနှုန်း ---------- */
function renderFares(c, fares) {
  c.replaceChildren();
  for (const vt of ["taxi", "bike"]) {
    const f = fares.find((x) => x.vehicle_type === vt) || {};
    const it = h("div", "item fare");
    it.dataset.editing = "";
    const fields = {};
    it.append(h("p", "", vt.toUpperCase()));
    it.firstChild.style.fontWeight = "600";
    for (const [key, label] of [["base_fare", "စတင်ခ (ကျပ်)"], ["per_km", "တစ် km ခ (ကျပ်)"], ["commission_percent", "ကော်မရှင် (%)"]]) {
      const l = h("label", "", label);
      const i = document.createElement("input");
      i.type = "number"; i.inputMode = "numeric"; i.value = f[key] ?? "";
      fields[key] = i;
      it.append(l, i);
    }
    it.append(btn("သိမ်းမယ်", "", async (e) => {
      e.target.disabled = true;
      try {
        await api("/admin/fares", { method: "POST", body: {
          vehicle_type: vt,
          base_fare: Number(fields.base_fare.value), per_km: Number(fields.per_km.value),
          commission_percent: Number(fields.commission_percent.value) } });
        alert("သိမ်းပြီးပါပြီ");
      } catch (err) { alert(err.message); }
      e.target.disabled = false;
    }));
    c.append(it);
  }
  c.append(h("p", "sub", "စျေးနှုန်းအသစ်က ခရီးစဉ်အသစ်တွေကိုသာ သက်ရောက်ပါတယ်။"));
}

/* ---------- စတင် ---------- */
function startApp() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  load();
  clearInterval(timer);
  timer = setInterval(() => { if (tab !== "fares") load(); }, 15000);
}

(async function init() {
  if (!getToken()) return showAuth();
  try {
    const { user } = await api("/auth/me");
    if (user.role !== "admin") { setToken(null); return showAuth(); }
    startApp();
  } catch { showAuth(); }
})();
