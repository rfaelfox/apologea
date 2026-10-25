/* APOLOGEA Handy-App – Service Worker
   Hält nur die Programmdateien für den schnellen Start bereit. Daten und Bilder kommen immer aus OneDrive.
   Programmdateien werden bei jedem Start beim Server nachgefragt, damit Aktualisierungen sofort ankommen. */
const CACHE = 'apologea-app-1.1.1';
const SHELL = ['./', './index.html', './app.css', './app.js', './store.js', './import.js', './drive.js', './auth.js', './config.js', './manifest.webmanifest', './icon-192.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // OneDrive/Microsoft nie zwischenspeichern
  // Netz zuerst und ohne Browser-Zwischenspeicher; nur ohne Verbindung die gespeicherte Kopie
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
    if (r.ok && !url.search) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
