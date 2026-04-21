// ============================================================
//  EduChat Service Worker — PWA Install + Offline Shell
// ============================================================

const CACHE_NAME    = 'educhat-v1';
const OFFLINE_URL   = '/index.html';

// Files to cache for offline shell
const PRECACHE = [
    '/',
    '/index.html',
    '/chat.html',
    '/chat.css',
    '/chat.js',
    '/login.css',
    '/login.js',
    '/call-styles.css',
    '/emojiPicker.css',
    '/emojiPicker.js',
    '/driveFileShare.js',
    '/memoryCache.js',
    '/sessionCache.js',
    '/cacheManager.js',
    '/hybridCache.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

// ── Install: pre-cache shell ────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE);
        }).then(() => self.skipWaiting())
    );
});

// ── Activate: clean old caches ──────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((k) => k !== CACHE_NAME)
                    .map((k) => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: cache-first for shell, network-first for API ─────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET, Firebase, Google APIs — always network
    if (
        event.request.method !== 'GET' ||
        url.hostname.includes('firestore.googleapis.com') ||
        url.hostname.includes('firebase') ||
        url.hostname.includes('googleapis.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('accounts.google.com')
    ) {
        return;
    }

    // Cache-first for local app shell files
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request)
                .then((response) => {
                    // Cache valid responses
                    if (response && response.status === 200 && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Offline fallback — show login page
                    if (event.request.destination === 'document') {
                        return caches.match(OFFLINE_URL);
                    }
                });
        })
    );
});
