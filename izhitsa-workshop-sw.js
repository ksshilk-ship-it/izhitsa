// Ижица Service Worker — офлайн-режим для workshop-модуля
// Кэширует HTML-приложение и Firebase SDK, чтобы приложение запускалось без интернета.

const CACHE_NAME = 'izhitsa-workshop-v1';
const CACHE_URLS = [
  './izhitsa-workshop.html',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(CACHE_URLS).catch(function(err) {
        console.log('[SW workshop] Частичная ошибка кэширования:', err);
      });
    })
  );
});

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

self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  if (url.indexOf('firestore.googleapis.com') >= 0 ||
      (url.indexOf('googleapis.com') >= 0 && url.indexOf('firebasejs') < 0)) {
    return;
  }

  if (url.indexOf('gstatic.com/firebasejs') >= 0) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        return fetch(event.request).then(function(resp) {
          var respClone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, respClone); });
          return resp;
        });
      })
    );
    return;
  }

  if (event.request.mode === 'navigate' || url.indexOf('.html') >= 0) {
    event.respondWith(
      fetch(event.request).then(function(resp) {
        var respClone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, respClone); });
        return resp;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          return caches.match('./izhitsa-workshop.html');
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var fetchPromise = fetch(event.request).then(function(resp) {
        var respClone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, respClone); });
        return resp;
      }).catch(function() { return cached; });
      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
