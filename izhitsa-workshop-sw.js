// Ижица Service Worker — офлайн-режим для workshop-модуля
// Кэширует HTML-приложение и Firebase SDK, чтобы приложение запускалось без интернета.

const CACHE_NAME = 'izhitsa-workshop-v2';
const CACHE_URLS = [
  './izhitsa-workshop.html',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

// Установка — кэшируем файлы по отдельности.
// Раньше здесь был cache.addAll(CACHE_URLS) — операция "всё или ничего":
// сбой ОДНОГО файла (например, недоступность CDN Firebase в момент
// установки) оставлял кэш полностью пустым, включая сам HTML — и офлайн-
// режим не работал совсем, хотя SW формально "устанавливался" без ошибок.
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      var mainPage = cache.add('./izhitsa-workshop.html').catch(function(err) {
        console.log('[SW workshop] Не удалось закэшировать izhitsa-workshop.html при установке:', err);
      });
      var rest = CACHE_URLS.filter(function(u) { return u !== './izhitsa-workshop.html'; })
        .map(function(url) {
          return cache.add(url).catch(function(err) {
            console.log('[SW workshop] Не удалось закэшировать (не критично):', url, err);
          });
        });
      return Promise.all([mainPage].concat(rest));
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
          return caches.match('./izhitsa-workshop.html').then(function(mainCached) {
            if (mainCached) return mainCached;
            // Крайний случай: даже основной HTML не закэширован (первый в
            // жизни запуск офлайн) — понятное сообщение вместо белого экрана.
            return new Response(
              '<!doctype html><html><head><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width,initial-scale=1">' +
              '<style>body{background:#0d0d12;color:#f0f0f8;font-family:sans-serif;' +
              'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:20px}</style>' +
              '</head><body><div><h2>📴 Нет соединения</h2>' +
              '<p>Приложение ещё ни разу не открывалось онлайн на этом устройстве, поэтому офлайн-версии пока нет.</p>' +
              '<p>Подключитесь к интернету хотя бы один раз, чтобы приложение сохранилось для офлайн-режима.</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
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
