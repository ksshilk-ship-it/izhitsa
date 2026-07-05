// Service Worker для Ижица — Администратор
// Версия кеша — меняйте при каждом значимом обновлении, чтобы старый кеш
// не мешал новым пользователям получить актуальную версию.
const CACHE_NAME = 'izhitsa-admin-v1';

// Файлы, которые нужны для запуска приложения без интернета.
// './' и './index.html' — на случай разных вариантов открытия по ссылке.
const CORE_ASSETS = [
  './',
  './izhitsa-admin.html',
  './manifest-admin.json',
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
          CORE_ASSETS.map((url) =>
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
// запросов (сам HTML), и cache-first для статики (иконки/манифест) ──
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Не трогаем запросы к Firestore/сторонним API — только свои файлы.
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) {
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
            return caches.match('./izhitsa-admin.html');
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
