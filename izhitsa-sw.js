// Ижица Service Worker — офлайн-режим для shop-модуля
// Кэширует HTML-приложение и Firebase SDK, чтобы приложение запускалось без интернета.

const CACHE_NAME = 'izhitsa-shop-v4';
const CACHE_URLS = [
  './izhitsa-shop.html',
  './manifest-shop.json',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

// Установка — кэшируем критичные файлы сразу.
// ВАЖНО: раньше здесь был cache.addAll(CACHE_URLS) — а это операция "всё
// или ничего": если хотя бы ОДИН файл из списка не подтягивался (404,
// CORS, обрыв сети), весь кэш оставался пустым — включая сам HTML! Ошибка
// при этом тихо проглатывалась в .catch(), поэтому SW "устанавливался"
// без видимых проблем, а офлайн-режим при этом не работал совсем.
// Теперь каждый файл кэшируется независимо: сам izhitsa-shop.html —
// первым и обязательным, остальные — по возможности.
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

  // HTML-страница и манифест — Network First с fallback на кэш.
  //
  // ГЛАВНАЯ НАЙДЕННАЯ ПРИЧИНА "не подгружается новая версия": fetch() внутри
  // Service Worker по умолчанию сам может быть обслужен из ОБЫЧНОГО HTTP-кэша
  // браузера, а не уйти в сеть по-настоящему — Service Worker этого не видит
  // и искренне думает, что сходил в сеть и получил "свежий" ответ, хотя это
  // был кэш браузера. GitHub Pages может отдавать HTML с заголовками, которые
  // разрешают браузеру кэшировать его. Раньше это означало: даже "Network
  // First" стратегия могла на деле годами показывать одну и ту же версию.
  // Теперь запрос явно помечен cache:'no-store' — это заставляет браузер
  // ВСЕГДА реально дойти до сервера, а не подставить свою кэш-копию.
  if (event.request.mode === 'navigate' || url.indexOf('.html') >= 0 || url.indexOf('manifest') >= 0) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).then(function(resp) {
        var respClone = resp.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, respClone);
        });
        return resp;
      }).catch(function() {
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          return caches.match('./izhitsa-shop.html').then(function(mainCached) {
            if (mainCached) return mainCached;
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
