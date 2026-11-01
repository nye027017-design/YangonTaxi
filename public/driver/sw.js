// Yangon Taxi Driver — Service Worker (Network-first: အင်တာနက်ရှိရင် အသစ်ယူ၊ မရှိရင် သိမ်းထားသည့်ဖိုင်ကို ပြ)
// ကုဒ်ပြောင်းပြီး Deploy လုပ်တိုင်း VERSION ကို တိုးပါ (ဖုန်းတွေက ဖိုင်အသစ်ကို ချက်ချင်းရစေရန်)
const VERSION = 'v1';
const CACHE = `ygn-driver-${VERSION}`;
const HOME = '/driver/';
const PRECACHE = [
  '/driver/',
  '/driver/manifest.webmanifest',
  '/driver/css/app.css',
  '/driver/js/main.js',
  '/driver/js/api.js',
  '/driver/icons/icon-192.png',
  '/shared/theme.css',
  '/shared/pwa.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ygn-driver-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // API နဲ့ တခြား Site (မြေပုံ Tile၊ Leaflet) ကို မထိ — ဒီအက်ပ်ရဲ့ ဖိုင်များကိုသာ ကိုင်တွယ်
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await cache.match(HOME)) || Response.error();
    return Response.error();
  }
}
