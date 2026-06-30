// Ижица Service Worker — офлайн-режим для shop-модуля
// Кэширует HTML-приложение и Firebase SDK, чтобы приложение запускалось без интернета.

const CACHE_NAME = 'izhitsa-shop-v1';
const CACHE_URLS = [
  './izhitsa-shop.html',
  './manifest-shop.json',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

// Установка — кэшируем критичные файлы сразу
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_URLS).catch(function(err) {
        // Если что-то не закэшировалось (например нет сети при первой установке) — не валим всю установку
        console.log('[SW] Частичная ошибка кэширования:', err);
      });
    })
  );
});

// Активация — чистим старые кэши
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
             .map(function(n) { return caches.delete(n); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// Стратегия: Network First для HTML (чтобы обновления подхватывались сразу при наличии сети),
// Cache First для Firebase SDK (эти файлы версионированы и не меняются),
// при отсутствии сети — отдаём из кэша.
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Не трогаем запросы к Firestore API — они должны идти напрямую в сеть
  // (offline persistence в Firestore сам разберётся с очередью)
  if (url.indexOf('firestore.googleapis.com') >= 0 ||
      url.indexOf('googleapis.com') >= 0 && url.indexOf('firebasejs') < 0) {
    return;
  }

  // Firebase SDK — Cache First (статичные версионированные файлы)
  if (url.indexOf('gstatic.com/firebasejs') >= 0) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(resp) {
          var respClone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, respClone);
          });
          return resp;
        });
      })
    );
    return;
  }

  // HTML-страница и манифест — Network First с fallback на кэш
  if (event.request.mode === 'navigate' || url.indexOf('.html') >= 0 || url.indexOf('manifest') >= 0) {
    event.respondWith(
      fetch(event.request).then(function(resp) {
        var respClone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, respClone);
        });
        return resp;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          // Последний fallback — попробовать отдать главный HTML файл
          return caches.match('./izhitsa-shop.html');
        });
      })
    );
    return;
  }

  // Всё остальное — Cache First с обновлением в фоне
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var fetchPromise = fetch(event.request).then(function(resp) {
        var respClone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, respClone);
        });
        return resp;
      }).catch(function() { return cached; });
      return cached || fetchPromise;
    })
  );
});

// Сообщение от страницы — пропустить ожидание и активироваться сразу
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
