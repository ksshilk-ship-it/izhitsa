// Ижица Admin Service Worker
const CACHE_NAME = 'izhitsa-admin-v1';
const URLS_TO_CACHE = [
  './izhitsa-admin.html',
  './manifest-admin.json'
];

// Install event - cache files
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching files');
        return cache.addAll(URLS_TO_CACHE).catch(() => {
          // Continue even if caching fails
          console.warn('[SW] Cache failed, continuing anyway');
        });
      })
      .then(() => {
        console.log('[SW] Skipping waiting');
        self.skipWaiting();
      })
  );
});

// Activate event
self.addEventListener('activate', event => {
  console.log('[SW] Activating');
  event.waitUntil(
    caches.keys().then(names => {
      return Promise.all(
        names.map(name => {
          if (name !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event
self.addEventListener('fetch', event => {
  const {request} = event;
  
  if (request.method !== 'GET') return;
  
  // Network first for everything
  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response || response.status !== 200) return response;
        
        // Cache successful responses
        const cache = caches.open(CACHE_NAME);
        cache.then(c => c.put(request, response.clone()));
        return response;
      })
      .catch(() => {
        // Fallback to cache on offline
        return caches.match(request)
          .then(cached => cached || caches.match('./izhitsa-admin.html'));
      })
  );
});
