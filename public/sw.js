/* Avinox Calc service worker — network-first with cache fallback.
   Network-first keeps deploys fresh; the cache only serves when the
   network is unavailable (offline app shell).
   Bump CACHE whenever the shell changes: it is what purges the previous
   copy on the next activation, so a device that was left on an older
   deploy cannot keep serving it. */
const CACHE = 'avinox-calc-v3';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/route-file.js',
    '/avinox-proto-parser.js',
    '/manifest.webmanifest',
    '/assets/logo-full.png',
    '/assets/logo-mark.png',
    '/assets/favicon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.ok && new URL(event.request.url).origin === self.location.origin) {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/')))
    );
});
