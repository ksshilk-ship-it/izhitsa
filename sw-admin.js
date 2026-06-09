// Ижица Admin Service Worker
const CACHE_NAME = 'izhitsa-admin-v1';
const URLS_TO_CACHE = [
  './izhitsa-admin.html',
  './manifest-admin.json',
  './'
];

// Install event - cache files
self.addEventListener('install', event => {
  console.log('[Service Worker] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching essential files');
        return cache.addAll(URLS_TO_CACHE).catch(err => {
          console.warn('[Service Worker] Some files could not be cached:', err);
          // Continue even if some files fail
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
  console.log('[Service Worker] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  const { request } = event;
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip external URLs
  if (!request.url.startsWith(self.location.origin)) {
    return;
  }
  
  // Network first for API calls and dynamic content
  if (request.url.includes('/api/') || request.url.includes('firebase')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache successful responses
          if (response && response.status === 200) {
            const cache = caches.open(CACHE_NAME);
            cache.then(c => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request)
            .then(response => response || new Response('Offline', {status: 503}));
        })
    );
    return;
  }
  
  // Cache first for static assets
  event.respondWith(
    caches.match(request)
      .then(response => {
        if (response) {
          return response;
        }
        
        return fetch(request)
          .then(response => {
            // Cache successful HTML responses
            if (response && response.status === 200 && 
                (request.url.endsWith('.html') || request.url.endsWith('/'))) {
              const cache = caches.open(CACHE_NAME);
              cache.then(c => c.put(request, response.clone()));
            }
            return response;
          })
          .catch(() => {
            // Return offline page if available
            return caches.match('./izhitsa-admin.html');
          });
      })
  );
});

// Handle messages from clients
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
