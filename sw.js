// 限樣系統 Service Worker
// 策略：app shell 走 stale-while-revalidate，drive thumbnail 走 cache-first
const CACHE_VERSION = 'v8';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const THUMB_CACHE = `thumb-v1`;

const SHELL_FILES = [
  './',
  './index.html',
  './app.js?v=19',
  './style.css?v=15',
  './config.js?v=19',
  './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES).catch(() => {}))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![SHELL_CACHE, THUMB_CACHE].includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 不攔 GAS API（走網路，由 app 端 SWR 負責）
  if (url.hostname.includes('script.google.com')) return;

  // Drive thumbnail / Drive 影片下載 → cache-first
  if (url.hostname.includes('drive.google.com') || url.hostname.includes('googleusercontent.com')) {
    e.respondWith(
      caches.open(THUMB_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        try {
          const res = await fetch(e.request);
          if (res && res.ok) cache.put(e.request, res.clone()).catch(() => {});
          return res;
        } catch (err) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // 同源 app shell → stale-while-revalidate
  if (url.origin === location.origin) {
    e.respondWith(
      caches.open(SHELL_CACHE).then(async cache => {
        const cached = await cache.match(e.request);
        const networkPromise = fetch(e.request).then(res => {
          if (res && res.ok) cache.put(e.request, res.clone()).catch(() => {});
          return res;
        }).catch(() => cached);
        return cached || networkPromise;
      })
    );
  }
});
