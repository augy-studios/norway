// Bump CACHE on every deploy that changes anything this worker serves. The
// browser compares this file byte for byte, so a version left alone means no
// new worker is ever installed and nobody is ever prompted to reload.
const CACHE = "norway-v20";
const API_CACHE = "norway-api-v15";

const ASSETS = [
  "/",
  "/index.html",
  "/assets/css/theme.css",
  "/assets/css/home.css",
  "/assets/js/icons.js",
  "/assets/js/ui.js",
  "/assets/js/theme.js",
  "/assets/js/update.js",
  "/assets/js/home.js",
  "/stats",
  "/stats/",
  "/stats/index.html",
  "/stats/stats.css",
  "/stats/stats.js",
  "/entities",
  "/entities/",
  "/entities/index.html",
  "/entities/entities.css",
  "/entities/entities.js",
  "/weather",
  "/weather/",
  "/weather/index.html",
  "/weather/weather.css",
  "/weather/weather.js",
  "/bank",
  "/bank/",
  "/bank/index.html",
  "/bank/bank.css",
  "/bank/bank.js",
  "/library",
  "/library/",
  "/library/index.html",
  "/library/library.css",
  "/library/library.js",
  "/404.html",
  "/404.css",
  "/manifest.json",
  "/TAN-main.png",
  "/TAN-192.png",
  "/TAN-512.png",
  "/favicon.ico",
];

/* -- Install: cache the whole app shell so every page works offline --
   No skipWaiting() here. A new worker downloads, installs, and then waits;
   the only thing that promotes it is the reader pressing Reload on the
   update bar (see the message handler below). Activating on install would
   swap the cache out from under a page that is still running the old JS. */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

/* -- Activate: clean old caches --
   No clients.claim() here either, for the same reason. */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
});

/* -- Message: the reader accepted the update -- */

self.addEventListener('message', event => {
  const type = typeof event.data === 'string' ? event.data : event.data?.type;

  // The only place either of these is ever called.
  if (type === 'skip-waiting') {
    event.waitUntil(self.skipWaiting().then(() => self.clients.claim()));
  }
});

/* -- Fetch: strategy per route -- */

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin API calls: serve fresh data when online, fall back to the
  // last successful response (so pages still show data offline), and cache
  // successful responses as we go.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(staleWhileOfflineApi(request));
    return;
  }

  // Google Fonts - cache-first (immutable)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navigations and same-origin static assets - cache-first, with an
  // app-shell fallback for navigations so direct offline navigation to any
  // page still renders something. Nothing here refreshes in the background:
  // this worker serves the shell it installed with, in full, until a new
  // worker is accepted from the update bar. Otherwise a reader could end up
  // on new HTML running old JS, which is the mismatch the bar exists to stop.
  event.respondWith(cacheFirst(request));
});

/* -- Strategies -- */

// Only ever read this worker's own cache. While a new worker is installed
// and waiting, its precache sits alongside this one, and an unscoped
// caches.match() could hand out the new build piecemeal.
function matchOwn(request) {
  return caches.match(request, { cacheName: CACHE });
}

async function offlineShell() {
  return (await matchOwn('/index.html')) || (await matchOwn('/'));
}

async function staleWhileOfflineApi(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: API_CACHE });
    if (cached) return cached;
    return new Response(
      JSON.stringify({ success: false, error: 'You appear to be offline and no cached data is available yet.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function cacheFirst(request) {
  const cached = await matchOwn(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === 'navigate') {
      const shell = await offlineShell();
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503 });
  }
}
