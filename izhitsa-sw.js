// Ижица Service Worker v2 — офлайн кеш для PWA
const CACHE_NAME = 'izhitsa-v2';

// Все файлы которые кешируются при установке
const PRECACHE_FILES = [
  './izhitsa-shop.html',
  './izhitsa-admin.html',
  './izhitsa-workshop.html',
  './manifest-shop.json',
  './manifest-admin.json',
  './manifest-workshop.json',
  './icon-shop-192.svg',
  './icon-shop-512.svg',
  './icon-shop-180.svg',
  './icon-admin-192.svg',
  './icon-admin-512.svg',
  './icon-admin-180.svg',
  './icon-workshop-192.svg',
  './icon-workshop-512.svg',
  './icon-workshop-180.svg',
];

// Внешние ресурсы (шрифты, Firebase SDK)
const EXTERNAL_CACHE = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
  'https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;700;900&family=Golos+Text:wght@400;500;600&display=swap',
];

// ── INSTALL: кешируем все файлы ──
self.addEventListener('install', function(event) {
  console.log('[SW] Installing...');
  self.skipWaiting(); // Активируемся сразу
  
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // Кешируем локальные файлы (обязательно)
      var localPromises = PRECACHE_FILES.map(function(url) {
        return cache.add(url).catch(function(e) {
          console.log('[SW] Failed to cache:', url, e);
        });
      });
      // Кешируем внешние ресурсы (необязательно — если офлайн, пропускаем)
      var externalPromises = EXTERNAL_CACHE.map(function(url) {
        return cache.add(url).catch(function() {});
      });
      return Promise.all(localPromises.concat(externalPromises));
    })
  );
});

// ── ACTIVATE: удаляем старые кеши ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { 
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name); 
          })
      );
    }).then(function() {
      return self.clients.claim(); // Берём контроль над всеми вкладками
    })
  );
});

// ── FETCH: отвечаем из кеша, обновляем в фоне ──
self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  
  // Firestore API — только сеть, никогда не кешировать
  if (url.includes('firestore.googleapis.com') || 
      url.includes('firebase.google.com') ||
      url.includes('googleapis.com/google.firestore') ||
      event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      // Запрос в сеть для обновления кеша
      var networkFetch = fetch(event.request).then(function(networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          var responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(function() {
        // Нет сети — возвращаем кеш
        return cachedResponse;
      });

      // Если есть в кеше — отдаём сразу (стратегия cache-first)
      // Параллельно обновляем в фоне
      return cachedResponse || networkFetch;
    })
  );
});

// ── Уведомление клиентов об обновлении ──
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
