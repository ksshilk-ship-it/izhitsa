// Ижица Service Worker v3 — network-first для HTML, cache-first для статики
const CACHE_NAME = 'izhitsa-v3';

const HTML_FILES = [
  './izhitsa-shop.html',
  './izhitsa-admin.html',
  './izhitsa-workshop.html',
  './izhitsa-install.html',
];

const STATIC_FILES = [
  './manifest-shop.json',
  './manifest-admin.json',
  './manifest-workshop.json',
];

// ── INSTALL ──
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        HTML_FILES.concat(STATIC_FILES).map(function(url) {
          return cache.add(url).catch(function(){});
        })
      );
    })
  );
});

// ── ACTIVATE ──
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys
        .filter(function(k){ return k !== CACHE_NAME; })
        .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// ── FETCH ──
self.addEventListener('fetch', function(event) {
  if(event.request.method !== 'GET') return;
  var url = event.request.url;

  // Firestore — только сеть
  if(url.includes('firestore.googleapis.com') ||
     url.includes('firebase.google.com') ||
     url.includes('googleapis.com/google.firestore')) return;

  // HTML файлы — network-first (всегда свежая версия если есть сеть)
  var isHtml = HTML_FILES.some(function(f){
    return url.endsWith(f.replace('./',''));
  }) || url.endsWith('.html');

  if(isHtml) {
    event.respondWith(
      fetch(event.request).then(function(response) {
        if(response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, clone); });
        }
        return response;
      }).catch(function() {
        // Нет сети — отдаём из кеша
        return caches.match(event.request);
      })
    );
    return;
  }

  // Всё остальное — cache-first
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var networkFetch = fetch(event.request).then(function(response) {
        if(response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, clone); });
        }
        return response;
      }).catch(function(){ return cached; });
      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', function(event) {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
