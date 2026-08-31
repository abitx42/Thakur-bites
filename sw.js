// Thakur Bites Staff Hub — Service Worker Offline Asset Cache
const CACHE_NAME = 'tb-staff-hub-v2';
const STATIC_ASSETS = [
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/auth.js',
  './js/firebase.js',
  './js/views/kitchenView.js',
  './js/views/pickupView.js',
  './js/views/adminView.js',
  './js/views/analyticsView.js',
  './js/views/securityCenterView.js',
  './js/views/tvDisplayView.js',
  './js/views/escapeHtml.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('SW cache addAll notice:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network first, falling back to cache
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
