// Enhanced Service Worker with Push Notifications

const CACHE_NAME = 'chat-app-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/chat.html',
    '/login.html',
    '/chat.css',
    '/call-styles.css',
    '/login.css',
    '/emojiPicker.css',
    '/manifest.json',
    '/icon-192.png'
];

// Install event
self.addEventListener('install', event => {
    console.log('🔧 Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('✅ Cache opened');
            return cache.addAll(urlsToCache).catch(error => {
                console.warn('⚠️ Some assets failed to cache:', error);
                // Don't fail install if some assets can't be cached
            });
        })
    );
    self.skipWaiting(); // Force activation
});

// Activate event
self.addEventListener('activate', event => {
    console.log('🚀 Service Worker activating...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('🗑️ Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim(); // Claim all clients
});

// Fetch event - Cache first, fallback to network
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip chrome extensions and other origins
    if (event.request.url.includes('chrome-extension')) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then(response => {
            if (response) {
                // Return cached response
                return response;
            }

            return fetch(event.request).then(response => {
                // Check if valid response
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                // Clone the response
                const responseToCache = response.clone();

                // Cache the new response
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            }).catch(() => {
                // Return offline page if available
                return caches.match('/index.html');
            });
        })
    );
});

// =======================================
// PUSH NOTIFICATIONS
// =======================================

// Handle push notifications
self.addEventListener('push', event => {
    console.log('📬 Push notification received:', event);

    if (!event.data) {
        console.log('⚠️ Push event has no data');
        return;
    }

    let notificationData = {};

    try {
        notificationData = event.data.json();
    } catch (e) {
        notificationData = {
            title: 'New Notification',
            body: event.data.text()
        };
    }

    const {
        title = 'Chat App Notification',
        body = '',
        icon = '/icon-192.png',
        badge = '/icon-192.png',
        tag = 'default-notification',
        requireInteraction = true,
        actions = [],
        data = {}
    } = notificationData;

    const notificationOptions = {
        body: body,
        icon: icon,
        badge: badge,
        tag: tag,
        requireInteraction: requireInteraction,
        actions: actions,
        data: data,
        vibrate: [200, 100, 200]
    };

    event.waitUntil(
        self.registration.showNotification(title, notificationOptions)
            .then(() => {
                console.log('✅ Notification displayed:', title);
            })
            .catch(error => {
                console.error('❌ Error displaying notification:', error);
            })
    );
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
    console.log('👆 Notification clicked:', event.notification.tag);
    event.notification.close();

    const data = event.notification.data || {};
    const action = event.action;

    // Open app window
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // Check if app is already open
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                
                // Focus existing window
                if ('focus' in client) {
                    // Send message to client
                    client.postMessage({
                        type: 'notificationClick',
                        action: action,
                        data: data,
                        notification: {
                            tag: event.notification.tag,
                            title: event.notification.title,
                            body: event.notification.body
                        }
                    });
                    return client.focus();
                }
            }

            // If no window open, open new one
            if (clients.openWindow) {
                return clients.openWindow('/').then(client => {
                    if (client) {
                        client.postMessage({
                            type: 'notificationClick',
                            action: action,
                            data: data
                        });
                    }
                    return client;
                });
            }
        })
    );
});

// Handle notification close
self.addEventListener('notificationclose', event => {
    console.log('✖️ Notification closed:', event.notification.tag);
    
    const data = event.notification.data || {};
    
    // Send close event to clients if needed
    clients.matchAll().then(clientList => {
        clientList.forEach(client => {
            client.postMessage({
                type: 'notificationClose',
                data: data
            });
        });
    });
});

// =======================================
// BACKGROUND SYNC
// =======================================

// Handle background sync for messages
self.addEventListener('sync', event => {
    console.log('🔄 Background sync event:', event.tag);

    if (event.tag === 'sync-messages') {
        event.waitUntil(
            syncMessages().then(() => {
                console.log('✅ Messages synced');
            }).catch(error => {
                console.error('❌ Sync failed:', error);
                throw error; // Retry sync
            })
        );
    }
});

async function syncMessages() {
    try {
        // This would normally sync pending messages from IndexedDB
        console.log('Syncing messages...');
        // Implementation depends on your IndexedDB structure
        return Promise.resolve();
    } catch (error) {
        console.error('Error during sync:', error);
        throw error;
    }
}

// =======================================
// MESSAGE HANDLING FROM CLIENTS
// =======================================

// Receive messages from clients
self.addEventListener('message', event => {
    console.log('💬 Service Worker received message:', event.data);

    const { type, payload } = event.data;

    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;

        case 'GET_VERSION':
            event.ports[0].postMessage({ version: '1.0.0' });
            break;

        case 'CLEAR_CACHE':
            caches.delete(CACHE_NAME).then(() => {
                event.ports[0].postMessage({ status: 'Cache cleared' });
            });
            break;

        case 'REQUEST_NOTIFICATION':
            handleNotificationRequest(payload);
            break;

        default:
            console.log('Unknown message type:', type);
    }
});

function handleNotificationRequest(payload) {
    const {
        title = 'Notification',
        body = '',
        icon = '/icon-192.png',
        tag = 'default',
        actions = [],
        data = {}
    } = payload;

    self.registration.showNotification(title, {
        body: body,
        icon: icon,
        tag: tag,
        actions: actions,
        data: data
    });
}

// =======================================
// PERIODIC BACKGROUND SYNC (Optional)
// =======================================

// For periodic tasks (requires more permission)
/*
self.addEventListener('periodicsync', event => {
    if (event.tag === 'check-messages') {
        event.waitUntil(
            checkForNewMessages().then(() => {
                console.log('✅ Checked for new messages');
            })
        );
    }
});

async function checkForNewMessages() {
    // Implementation for checking new messages periodically
    return Promise.resolve();
}
*/

// =======================================
// HELPER FUNCTIONS
// =======================================

// Log service worker status
console.log('🔵 Service Worker loaded and ready');

self.addEventListener('install', () => {
    console.log('🟡 Service Worker installing');
});

self.addEventListener('activate', () => {
    console.log('🟢 Service Worker activated');
});

self.addEventListener('controllerchange', () => {
    console.log('🔄 Service Worker controller changed');
});
