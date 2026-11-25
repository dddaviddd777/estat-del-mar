// Service worker: permet obrir l'app sense connexió.
// Les dades del mar NO es guarden aquí (les desa l'app amb la seva hora), només els fitxers de l'app.
// La línia de costa i les sortides (data/costa.json, data/sortides*.json) es desen la primera vegada que es fan servir.
const VERSION = 'mar-v33';
const SHELL = [
  './', 'index.html', 'css/style.css', 'css/mar.css', 'manifest.webmanifest',
  'js/app.js', 'js/marine.js', 'js/store.js', 'js/buoy.js', 'js/coast.js', 'js/route.js', 'js/routeui.js', 'js/routepdf.js', 'js/exits.js', 'js/layers.js', 'js/places.js', 'js/services.js', 'js/mappanel.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const isLib = url.hostname === 'cdnjs.cloudflare.com'; // Leaflet (el mapa)
  if (!sameOrigin && !isFont && !isLib) return; // les APIs de previsió van sempre a la xarxa

  // Primer la xarxa (per tenir sempre la darrera versió); si no n'hi ha, la còpia desada.
  e.respondWith(
    fetch(e.request, sameOrigin ? { cache: 'no-cache' } : undefined) // no-cache: comprova sempre si hi ha versió nova (GitHub Pages diu max-age=600)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
