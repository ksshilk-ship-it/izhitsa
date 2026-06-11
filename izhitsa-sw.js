// Ижица Service Worker v4 — network-first для HTML, cache-first для статики
// ВАЖНО: увеличивай версию при каждом обновлении файлов
const CACHE_NAME = 'izhitsa-v4';
const BUILD_DATE = '2026-06-11';

const HTML_FILES = [
  './izhitsa-shop.html',
  './izhitsa-admin.html', 
  './izhitsa-workshop.html',
  './izhitsa-install.html',
];

// INSTALL — кешируем при первой загрузке
self.addEventListener('install', function(event) {
  console.log('[SW v4] Installing...');
  self.skipWaiting(); // Активируемся немедленно, не ждём закрытия старых вкладок
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        HTML_FILES.map(function(url) {
          // Всегда загружаем свежую версию при install
          return fetch(url + '?v=' + BUILD_DATE, {cache: 'no-store'})
            .then(function(r) { if(r.ok) cache.put(url, r); })
            .catch(function(){});
        })
      );
    })
  );
});

// ACTIVATE — удаляем ВСЕ старые кеши
self.addEventListener('activate', function(event) {
  console.log('[SW v4] Activating, clearing old caches...');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_NAME; })
          .map(function(k){ console.log('[SW] Deleting cache:', k); return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// FETCH — network-first для HTML, cache-first для остального
self.addEventListener('fetch', function(event) {
  if(event.request.method !== 'GET') return;
  var url = event.request.url;
  
  // Firestore — только сеть, никогда не кешировать
  if(url.includes('firestore.googleapis.com') || 
     url.includes('firebase.google.com') ||
     url.includes('googleapis.com/google.firestore')) return;

  var isHTML = url.endsWith('.html') || HTML_FILES.some(function(f){
    return url.includes(f.replace('./',''));
  });

  if(isHTML) {
    // Network-first: всегда пробуем сеть для HTML
    event.respondWith(
      fetch(event.request, {cache: 'no-cache'})
        .then(function(response) {
          if(response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, clone); });
          }
          return response;
        })
        .catch(function() {
          // Нет сети — отдаём из кеша
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-first для статики (иконки, манифесты)
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        var networkFetch = fetch(event.request)
          .then(function(r) {
            if(r && r.status === 200) {
              caches.open(CACHE_NAME).then(function(c){ c.put(event.request, r.clone()); });
            }
            return r;
          }).catch(function(){ return cached; });
        return cached || networkFetch;
      })
    );
  }
});

self.addEventListener('message', function(event) {
  if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
