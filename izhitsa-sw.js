// Ижица Service Worker — офлайн-режим для shop-модуля
// Кэширует HTML-приложение и Firebase SDK, чтобы приложение запускалось без интернета.

const CACHE_NAME = 'izhitsa-shop-v5';
const CACHE_URLS = [
  './izhitsa-shop.html',
  './manifest-shop.json',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

// Установка — кэшируем критичные файлы сразу.
// Каждый файл кэшируется независимо: сам izhitsa-shop.html — первым и
// обязательным, остальные — по возможности (если один не подтянулся,
// это не должно ломать кэширование остальных).
self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      var mainPage = cache.add('./izhitsa-shop.html').catch(function(err) {
        console.log('[SW] Не удалось закэшировать izhitsa-shop.html при установке:', err);
      });
      var rest = CACHE_URLS.filter(function(u) { return u !== './izhitsa-shop.html'; })
        .map(function(url) {
          return cache.add(url).catch(function(err) {
            console.log('[SW] Не удалось закэшировать (не критично):', url, err);
          });
        });
      return Promise.all([mainPage].concat(rest));
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

function _offlineFallback() {
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
}

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

  // HTML-страница и манифест — Network First, НО с тайм-аутом.
  //
  // ГЛАВНАЯ НАЙДЕННАЯ ПРИЧИНА "белый экран при слабом интернете": раньше
  // запрос к сети не имел тайм-аута вообще — при медленном (не отсутствующем,
  // а именно медленном/нестабильном) соединении браузер мог ждать ответ
  // сервера очень долго, и всё это время пользователь видел пустой белый
  // экран, хотя рабочая версия уже давно лежала в кэше и могла бы
  // показаться мгновенно. Теперь сеть и тайм-аут (3 сек) идут наперегонки:
  // если сеть не успела — сразу отдаём то, что есть в кэше, а сеть
  // продолжает грузиться в фоне и обновит кэш к следующему разу.
  if (event.request.mode === 'navigate' || url.indexOf('.html') >= 0 || url.indexOf('manifest') >= 0) {
    event.respondWith(
      (function() {
        var TIMEOUT_MS = 3000;
        var cachedPromise = caches.match(event.request);
        var networkPromise = fetch(event.request, { cache: 'no-store' }).then(function(resp) {
          var respClone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, respClone); });
          return resp;
        });
        var timeoutPromise = new Promise(function(resolve) {
          setTimeout(function() { resolve('__TIMEOUT__'); }, TIMEOUT_MS);
        });
        return Promise.race([networkPromise, timeoutPromise]).then(function(result) {
          if (result === '__TIMEOUT__') {
            return cachedPromise.then(function(cached) {
              if (cached) return cached;
              // Кэша нет вовсе — тогда всё же ждём сеть до конца, деваться некуда.
              return networkPromise.catch(function() { return _offlineFallback(); });
            });
          }
          return result;
        }).catch(function() {
          return cachedPromise.then(function(cached) {
            return cached || _offlineFallback();
          });
        });
      })()
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
