/* Mi cuaderno de estudio — service worker (PWA)
   Sube el número de VERSION cuando quieras forzar que todos reciban cambios. */
const VERSION = 'v1';
const CACHE = 'cuaderno-' + VERSION;
const BASE = ['/', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

/* Librerías externas que sí conviene guardar para abrir más rápido o sin internet */
const CDN_OK = [
  'https://www.gstatic.com/firebasejs/',
  'https://cdnjs.cloudflare.com/',
  'https://cdn.jsdelivr.net/',
  'https://fonts.googleapis.com/css',
  'https://fonts.gstatic.com/'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => Promise.all(BASE.map(u => c.add(u).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('cuaderno-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* Nunca interceptar funciones de Netlify, Firestore, login ni APIs de Google */
  if (url.pathname.startsWith('/.netlify/')) return;
  if (url.origin !== self.location.origin && !CDN_OK.some(p => req.url.startsWith(p))) return;

  /* Librerías externas: usa la copia guardada y actualízala por detrás */
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.match(req).then(hit => {
        const red = fetch(req).then(r => {
          if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
          return r;
        }).catch(() => hit);
        return hit || red;
      })
    );
    return;
  }

  /* Archivos propios: primero la red (siempre lo último), si no hay internet, la copia guardada */
  e.respondWith(
    fetch(req).then(r => {
      if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    }).catch(() =>
      caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('/') : undefined))
    )
  );
});
