// Minimal service worker — just enough to satisfy PWA installability
// (Chrome/Edge require a registered SW with a fetch handler) without
// pretending this data-driven app can meaningfully work offline. Network
// requests always go to the network first; only a tiny offline fallback
// page is served from cache if the network is truly unreachable.
const CACHE_NAME = '1125corp-shell-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(CACHE_NAME).then((cache) => cache.match(OFFLINE_URL))
    )
  );
});

// Web Push — shows an OS-level notification (lock screen / notification
// tray) even when the app isn't open. The payload is JSON sent by
// app/api/push/send: { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }

  event.waitUntil(
    self.registration.showNotification(data.title || '1125Corp', {
      body: data.body || '',
      icon: '/image/1125_Corp_Logo.png',
      badge: '/image/1125_Corp_Logo.png',
      data: { url: data.url || '/notifications' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/notifications';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
