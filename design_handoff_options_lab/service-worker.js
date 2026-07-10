// Options Lab service worker.
// Strategy: cache-first for the app shell + same-origin assets, network-first for HTML.
// Bumping CACHE_VERSION purges old caches.
const CACHE_VERSION = 'options-lab-v19';
const APP_SHELL = [
  './',
  './index.html',
  './tokens.css',
  './manifest.webmanifest',
  './atoms.jsx',
  './charts.jsx',
  './obsidian3.jsx',
  './option-chain.jsx',
  './tweaks-panel.jsx',
  './surface3d.js',
  './iv-surface.js',
  './products.js',
  './data-live.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // Use addAll-equivalent that tolerates per-file failures (e.g. dev environments)
    await Promise.all(APP_SHELL.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
    ));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // IB proxy (/api/*, data-live.js 打 localhost:8720): 絕不快取，直接走網路 —
  // 快取到舊行情比沒有行情更糟。
  if (url.pathname.startsWith('/api/')) return;

  // Cross-origin (CDN React/Three.js etc.): pass through, but also stash in cache.
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // HTML: network-first so users get fresh content when online.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Static assets: cache-first.
  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return new Response('offline', { status: 503 });
  }
}
async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    return new Response('offline', { status: 503 });
  }
}
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit || new Response('offline', { status: 503 }));
  return hit || fetchPromise;
}
