// PWA — Service Worker မှတ်ပုံတင်ခြင်းနဲ့ "ဖုန်းထဲ App ထည့်သွင်းရန်" ခလုတ်
export function registerSW(path) {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(path).catch((e) => console.warn("Service worker မတက်ပါ", e));
  });
}

// Browser က ခွင့်ပြုမှသာ [data-install] ခလုတ်ကို ပြ။ iPhone မှာ Install prompt မရှိလို့ [data-ios-hint] စာကိုပြ
export function setupInstall() {
  const buttons = [...document.querySelectorAll("[data-install]")];
  const hints = [...document.querySelectorAll("[data-ios-hint]")];
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) return;

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    buttons.forEach((b) => b.classList.remove("hidden"));
  });
  buttons.forEach((b) => b.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    deferred = null;
    buttons.forEach((x) => x.classList.add("hidden"));
  }));
  window.addEventListener("appinstalled", () => buttons.forEach((b) => b.classList.add("hidden")));
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) hints.forEach((h) => h.classList.remove("hidden"));
}
