const CACHE = 'badangttae-v1';
const ASSETS = [
  '/seatime/',
  '/seatime/index.html',
  '/seatime/manifest.json',
  '/seatime/logo.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // GAS/API 요청은 캐시 안 함 — 항상 네트워크
  if (e.request.url.includes('script.google.com') ||
      e.request.url.includes('open-meteo.com') ||
      e.request.url.includes('khoa.go.kr')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
