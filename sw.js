// SELF-DESTRUCT SERVICE WORKER
// This SW clears ALL caches and forces page reload
// After this, no caching will happen

self.addEventListener('install', function(e) {
  self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    // Delete ALL caches
    caches.keys().then(function(names) {
      return Promise.all(names.map(function(name) { return caches.delete(name); }));
    }).then(function() {
      return self.clients.claim(); // Take control
    }).then(function() {
      // Tell all open tabs to reload
      return self.clients.matchAll().then(function(clients) {
        clients.forEach(function(client) { 
          client.postMessage({type: 'force-reload'}); 
        });
      });
    })
  );
});

// NEVER cache anything - always go to network
self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request));
});
