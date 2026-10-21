// Service worker: keeps the tuner available offline.
//
// The whole app is one HTML file plus the manifest and icons, so the worker
// simply stores those files when it installs and answers from that store
// afterwards. Each build stamps a new VERSION (a hash of the files), which
// makes the browser install the new worker and its fresh copy. The page then
// offers "Update" and, when tapped, tells the waiting worker to take over.
//
// This file is a template: the build (vite.config.ts) fills in VERSION and FILES.

const VERSION = '__VERSION__';
const CACHE = `tuner-${VERSION}`;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
  // Do not activate automatically: the page asks the user first (see main.ts).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('tuner-') && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') event.source?.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Opening the app (any page navigation inside its scope): serve the stored app.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) ?? (await cache.match('./')) ?? fetch(req);
      })(),
    );
    return;
  }

  // Everything else: stored copy first, network as a fallback.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      return hit ?? fetch(req);
    })(),
  );
});
