/* Pult. — Service Worker
   ------------------------------------------------------------
   Cache zuerst: Pult. läuft immer aus dem Cache, auch offline. Eine neue
   Version wird nur übernommen, wenn sie in der App ausdrücklich angefordert
   wird (Einstellungen → Über Pult. → Nach Update suchen).

   Der Browser prüft sw.js von sich aus bei jedem Start. Damit dabei nicht
   unbemerkt eine neue Version installiert wird (iPadOS beendet Web-Apps oft,
   dann würde sie beim nächsten Start aktiv), bricht die Installation ab,
   solange die App die Freigabe `update-ok` nicht gesetzt hat.

   Veröffentlichen: VERSION hier UND in version.json erhöhen (samt Changelog). */
'use strict';

const VERSION = '1.0.0';
const CACHE = 'pult-' + VERSION;
const FLAGS = 'pult-flags';          // Freigabe für ein Update (von der App gesetzt)
const ASSETS = [
  './',
  './index.html',
  './version.json',
  './css/pult.css',
  './js/print.js',
  './js/raster.js',
  './js/ausdrucke.js',
  './js/werkzeuge.js',
  './js/schueler.js',
  './js/alltag.js',
  './js/sperre.js',
  './js/sicherung.js',
  './js/einstellungen.js',
  './js/update.js',
  './js/pult.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    /* Umstieg von den alten Service Workern (Netzwerk zuerst, Cache „pult-vN"):
       die kennen keine Freigabe — dann einmalig ohne. */
    const legacy = keys.some(k => /^pult-v\d+$/.test(k));
    if (self.registration.active && !legacy) {
      const ok = await (await caches.open(FLAGS)).match('./update-ok');
      if (!ok) throw new Error('Update nicht angefordert — bleibe bei der installierten Version.');
    }
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })));
    if (legacy || !self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));   // alte Versionen + verbrauchte Freigabe
    await self.clients.claim();
  })());
});

/* Die App bestätigt das Update: wartende Version sofort aktivieren */
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* Update-Prüfung (version.json?fresh=…): immer am Cache vorbei */
  if (url.searchParams.has('fresh')) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match('./index.html');
      if (page) return page;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (e) {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  })());
});
