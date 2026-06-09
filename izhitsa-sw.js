// Ижица Service Worker — офлайн кеш
const CACHE = 'izhitsa-v1';
const FILES = [
  'izhitsa-shop.html',
  'izhitsa-admin.html', 
  'izhitsa-workshop.html',
  'https://fonts.googleapis.com/css2?family=Unbounded:wght@400;600;700;900&family=Golos+Text:wght@400;500;600&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return Promise.allSettled(FILES.map(function(f){ return cache.add(f).catch(function(){}); }));
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // Only cache GET requests for our domain and Firebase CDN
  if(e.request.method !== 'GET') return;
  var url = e.request.url;
  
  // For Firestore API — network only (don't cache API calls)
  if(url.includes('firestore.googleapis.com') || url.includes('firebase.google.com')) return;
  
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var networkFetch = fetch(e.request).then(function(response) {
        if(response.ok) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache){ cache.put(e.request, clone); });
        }
        return response;
      }).catch(function(){ return cached; });
      // Return cache immediately if available, update in background
      return cached || networkFetch;
    })
  );
});
