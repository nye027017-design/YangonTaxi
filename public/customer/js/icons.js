// SVG အိုင်ကွန်များ — Marker၊ ယာဉ်ရွေးချယ်ခလုတ်၊ Radar တွေမှာ မျှသုံး
export const CAR = `<svg viewBox="0 0 32 20" fill="currentColor" aria-hidden="true">
  <rect x="14" y="0" width="4" height="2.2" rx=".6"/>
  <path d="M7 8.5 10.4 3.2c.4-.7 1-1 1.8-1h7.6c.8 0 1.4.3 1.8 1L25 8.5z"/>
  <rect x="1" y="8" width="30" height="8.5" rx="3.2"/>
  <path fill="#fff" d="M11 8 12.9 4.6h2.6V8zM17 8V4.6h2.4L21.2 8z" opacity=".92"/>
  <circle cx="8" cy="16.4" r="3.2" fill="#14231b"/><circle cx="24" cy="16.4" r="3.2" fill="#14231b"/>
  <circle cx="8" cy="16.4" r="1.2" fill="#fff"/><circle cx="24" cy="16.4" r="1.2" fill="#fff"/>
</svg>`;

export const BIKE = `<svg viewBox="0 0 32 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="6.5" cy="14" r="4.2"/><circle cx="25.5" cy="14" r="4.2"/>
  <path d="M6.5 14 11.5 6h5l3.5 8h5.5M11.5 6H9M15 6l2 8h3"/>
  <path d="M19 4.5h3l2.5 9.5" />
</svg>`;

export const vehicleIcon = (type) => (type === "bike" ? BIKE : CAR);

export const PIN = `<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="currentColor" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>`;

// ခေါ်မယ့်/သွားမယ့်နေရာ ပင်
export const pinIcon = (color) => L.divIcon({
  className: "", iconSize: [30, 40], iconAnchor: [15, 40],
  html: `<div style="color:${color};width:30px;height:40px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))">${PIN}</div>`,
});

// မြေပုံပေါ်က Driver ကား (အစိမ်းရောင် အဝိုင်းထဲ ကားပုံ)
export const carMarker = (type, mine = false) => L.divIcon({
  className: "", iconSize: [38, 38], iconAnchor: [19, 19],
  html: `<div class="cm${mine ? " mine" : ""}">${vehicleIcon(type)}</div>`,
});

// "ကျွန်ုပ်နေရာ" အပြာအစက် (mockup မှာလို)
export const meIcon = L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="me"></div>' });

export const IC = {
  call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
  sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  gps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>',
};
