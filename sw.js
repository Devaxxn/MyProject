/* Neon Drift service worker — offline play with network-first code updates. */
'use strict';

const CACHE = 'neon-drift-v8';
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './game.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
];
const CACHE_FIRST = ['icons/'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(PRECACHE.map(url =>
        c.add(new Request(url, { cache: 'reload' })) // bypass stale HTTP cache
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // icons & manifest: cache-first (immutable in practice)
  if (CACHE_FIRST.some(p => url.pathname.includes(p))) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request))
    );
    return;
  }

  // code & documents: network-first so updates land immediately; cache keeps offline play alive
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (!res.ok) throw new Error('http ' + res.status); // 404/500 etc -> serve from cache instead
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
