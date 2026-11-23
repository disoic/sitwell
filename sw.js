/* Sitwell service worker: the app opens offline, and the map remembers areas you've looked at.
   Spot files are kept by the app itself (IndexedDB), so they aren't cached here.
   Pages, scripts and styles come fresh from the network when there is one, so updates arrive at once.
   Change SHELL whenever the fonts, icons or MapLibre change. To switch it off everywhere, replace this
   file with: self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate',
   () => self.registration.unregister()); */
'use strict';
const SHELL = 'sitwell-shell-v2';
const MAP = 'sitwell-map-v1';
const MAP_LIMIT = 800;   // map tiles kept for offline use
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'present.js', 'data.js', 'guide.js', 'core.js', 'manifest.webmanifest',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css', 'icons/icon-192.png',
  'fonts/ibm-plex-sans-latin-400-normal.woff2',  'fonts/ibm-plex-sans-latin-500-normal.woff2',  'fonts/ibm-plex-sans-latin-600-normal.woff2',  'fonts/ibm-plex-sans-latin-ext-400-normal.woff2',  'fonts/ibm-plex-sans-latin-ext-500-normal.woff2',  'fonts/ibm-plex-sans-latin-ext-600-normal.woff2',  'fonts/ibm-plex-serif-latin-400-normal.woff2',  'fonts/ibm-plex-serif-latin-500-normal.woff2',  'fonts/ibm-plex-serif-latin-ext-400-normal.woff2',  'fonts/ibm-plex-serif-latin-ext-500-normal.woff2',
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== MAP).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    if (hit) return hit;
    throw e;
  }
}
async function cacheFirst(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
let mapPuts = 0;
async function trim(cache) {
  const keys = await cache.keys();
  for (let k = 0; k < keys.length - MAP_LIMIT; k++) await cache.delete(keys[k]);
}
// Map style, tiles and labels: from the phone at once if there, refreshed in the background.
async function mapFile(req) {
  const cache = await caches.open(MAP);
  const hit = await cache.match(req);
  const fresh = fetch(req).then(res => {
    if (res.ok) { cache.put(req, res.clone()); if (++mapPuts % 50 === 0) trim(cache); }
    return res;
  });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/data/')) return;
    if (/\.(woff2|png)$/.test(url.pathname) || url.pathname.includes('/vendor/')) { e.respondWith(cacheFirst(req)); return; }
    e.respondWith(networkFirst(req));
    return;
  }
  if (url.hostname === 'tiles.openfreemap.org') e.respondWith(mapFile(req));
});
