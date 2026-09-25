// Was: just enough to satisfy PWA installability, with a single generic
// offline fallback page — deliberately not caching the actual app, on the
// reasoning that a data-driven app can't meaningfully work offline anyway.
//
// Extended (Sep 2026, Kat's request via Joshua): field collectors need
// Payments to actually OPEN with zero signal from the very start of their
// day — not just keep working if it happened to already be open when
// signal dropped (that part was already handled client-side, see
// lib/offline-payment-queue.ts). Opening the page at all first requires
// the page's own code/markup to be available with no network — that's
// what's added below. It does NOT change how any data loads: Supabase
// calls still always go straight to the network exactly as before, and
// still fail/queue exactly as lib/offline-payment-queue.ts already
// handles — this only ever caches the APP ITSELF (its static build output
// and the pages someone has actually opened before), never API data.
const SHELL_CACHE = '1125corp-shell-v2';
const STATIC_CACHE = '1125corp-static-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL_CACHE && key !== STATIC_CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only ever same-origin GETs — this must never intercept a POST/PATCH/
  // DELETE, and never a cross-origin request (Supabase, Semaphore, etc.).
  // Data always goes straight to the network, unintercepted; this service
  // worker only ever helps the app's OWN code/markup open offline.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Next.js's build output is content-hashed — a new deploy always ships
  // new filenames, so caching these forever the first time they're seen
  // carries no staleness risk (there's nothing to invalidate: an old
  // hashed file is simply never referenced again after the next deploy).
  // This is what actually makes a previously-opened page's JS available
  // with zero signal, not just its HTML shell.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) =>
        cache.match(req).then((cached) => cached || fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  if (req.mode !== 'navigate') return;

  // Page navigations: network first, always — so anyone with signal
  // always gets the current version, never a stale cached one. Only on a
  // genuine network failure does it fall back to whatever this exact URL
  // last successfully loaded as, so a page has to actually be opened once
  // online before it can open offline later. Falls further back to the
  // same generic offline.html as before for any page never visited.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const resClone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() =>
        caches.open(SHELL_CACHE).then((cache) =>
          cache.match(req).then((cached) => cached || cache.match(OFFLINE_URL))
        )
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
