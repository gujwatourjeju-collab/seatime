const CACHE = 'badangttae-v6';
const API_CACHE = 'badangttae-api-v1';
const ASSETS = [
  '/seatime/',
  '/seatime/index.html',
  '/seatime/manifest.json',
  '/seatime/logo.png',
];

// API 도메인 목록 (네트워크 우선, 실패 시 캐시)
const API_HOSTS = [
  'api.open-meteo.com',
  'supabase.co',
  'd5.co.kr',
  'dapi.kakao.com',
];

function isApiRequest(url) {
  return API_HOSTS.some(h => url.includes(h));
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE && k !== API_CACHE).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // API 요청: 네트워크 우선, 실패 시 캐시 fallback
  if (isApiRequest(url)) {
    // POST 요청(supabase)은 캐시 불가 → 네트워크만
    if (e.request.method !== 'GET') return;

    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(cached => cached || new Response('{}', { status: 503 })))
    );
    return;
  }

  // 정적 자산: 캐시 우선, 없으면 네트워크
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// 새 버전 감지 → 클라이언트에 알림
self.addEventListener('message', e => {
  if (e.data === 'CHECK_UPDATE') {
    e.source.postMessage({ type: 'SW_VERSION', version: CACHE });
  }
});
