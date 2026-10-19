var CACHE_NAME = 'cannalife-v1';
var STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  // Skip non-GET and Supabase API requests — always go to network
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;
  if (event.request.url.includes('paystack')) return;

  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        // Cache successful responses for static assets
        if (response && response.status === 200 && response.type === 'basic') {
          var url = new URL(event.request.url);
          if (url.pathname.match(/\.(png|svg|ico|css|js|woff2?)$/)) {
            var cloned = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, cloned);
            });
          }
        }
        return response;
      })
      .catch(function() {
        // Offline fallback — serve cached index.html for navigation
        return caches.match('/index.html');
      })
  );
});
