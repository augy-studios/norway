const CACHE = "norway-v14";
const API_CACHE = "norway-api-v14";

const ASSETS = [
  "/",
  "/index.html",
  "/assets/css/theme.css",
  "/assets/css/home.css",
  "/assets/js/icons.js",
  "/assets/js/theme.js",
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

/* -- Install: cache the whole app shell so every page works offline -- */

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* -- Activate: clean old caches -- */

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(k => k !== CACHE && k !== API_CACHE)
            .map(k => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
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
    event.respondWith(cacheFirst(request, CACHE));
    return;
  }

  // Navigations - cache-first with app-shell fallback so direct offline
  // navigation to any page still renders something.
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Same-origin static assets - cache-first
  event.respondWith(cacheFirst(request, CACHE));
});

/* -- Strategies -- */

async function navigationHandler(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Still try to refresh the cache in the background when online.
    fetch(request).then(res => {
      if (res.ok) caches.open(CACHE).then(cache => cache.put(request, res));
    }).catch(() => {});
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match('/index.html')) || (await caches.match('/'));
  }
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

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (request.mode === 'navigate') {
      return (await caches.match('/index.html')) || (await caches.match('/'));
    }
    return new Response('Offline', { status: 503 });
  }
}
