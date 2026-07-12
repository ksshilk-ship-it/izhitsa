// Service Worker для Ижица — Администратор
// Версия кеша — меняйте при каждом значимом обновлении, чтобы старый кеш
// не мешал новым пользователям получить актуальную версию.
const CACHE_NAME = 'izhitsa-admin-v2';

// Файлы, которые нужны для запуска приложения без интернета.
// './' и './index.html' — на случай разных вариантов открытия по ссылке.
const CORE_ASSETS = [
  './',
  './izhitsa-admin.html',
  './manifest-admin.json',
];

// Firebase SDK — версионированные статичные файлы с CDN. Раньше этот SW их
// вообще не трогал (см. фильтр "!req.url.startsWith(self.location.origin)"
// ниже), поэтому даже когда сам HTML грузился из кеша офлайн, приложение
// всё равно падало на попытке подгрузить firebase-app-compat.js без сети —
// белый экран просто наступал чуть позже, уже после отрисовки страницы.
const FIREBASE_ASSETS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

// ── INSTALL: кешируем основные файлы сразу при установке ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // addAll может упасть, если хотя бы один файл недоступен (например,
        // иконки ещё не залиты) — поэтому кешируем по одному, игнорируя ошибки
        // отдельных файлов, чтобы не сломать установку целиком.
        return Promise.all(
          CORE_ASSETS.concat(FIREBASE_ASSETS).map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] Не удалось закешировать при установке:', url, err);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: удаляем старые версии кеша ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: стратегия network-first с откатом на кеш для навигационных
// запросов (сам HTML), cache-first для Firebase SDK, и cache-first для
// остальной своей статики (иконки/манифест) ──
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  // Firestore API — идёт напрямую в сеть, офлайн-очередь сам Firestore
  // разруливает через свой offline persistence.
  if (req.url.indexOf('firestore.googleapis.com') >= 0) {
    return;
  }

  // Firebase SDK с gstatic.com — версионированные файлы, кешируем их
  // Cache First, чтобы приложение могло инициализировать Firebase офлайн.
  if (req.url.indexOf('gstatic.com/firebasejs') >= 0) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((networkResp) => {
          const respClone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
          return networkResp;
        });
      })
    );
    return;
  }

  // Остальные сторонние запросы (не свои файлы и не Firebase SDK) не трогаем.
  if (!req.url.startsWith(self.location.origin)) {
    return;
  }

  // Навигационные запросы (открытие страницы) и сам HTML-файл:
  // сначала пробуем сеть (чтобы всегда получать актуальную версию,
  // если есть интернет), а если сети нет — берём последнюю сохранённую
  // копию из кеша. Именно это отсутствовало и вызывало белый экран офлайн.
  if (req.mode === 'navigate' || req.url.includes('izhitsa-admin.html')) {
    event.respondWith(
      fetch(req)
        .then((networkResp) => {
          // Обновляем кеш свежей версией на будущее
          const respClone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
          return networkResp;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached) return cached;
            // Последний шанс — отдать закешированную главную страницу
            return caches.match('./izhitsa-admin.html').then((mainCached) => {
              if (mainCached) return mainCached;
              // Совсем крайний случай: даже главная страница не закешировалась
              // (первый в жизни офлайн-запуск на этом устройстве).
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
          })
        )
    );
    return;
  }

  // Остальные свои файлы (иконки, манифест): сначала кеш, затем сеть,
  // и если получили что-то новое из сети — обновляем кеш.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((networkResp) => {
          const respClone = networkResp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, respClone));
          return networkResp;
        })
        .catch(() => cached);
    })
  );
});

// ── Позволяем странице попросить SW сразу активироваться без ожидания
// закрытия всех вкладок (используется в скрипте регистрации в HTML) ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
