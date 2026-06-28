// Service Worker — network-first: всегда свежие файлы, кэш только при офлайне
const CACHE = 'budget-v7';
const STATIC = ['/', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  // Предзаполняем кэш и сразу активируемся (не ждём закрытия вкладок)
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  // Удаляем старые кэши
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Семейный бюджет', {
      body: data.body || '',
      icon: '/icon-512.png',
      badge: '/icon-512.png',
      data: { url: data.url || '/' },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', e => {
  // API и Socket.IO — только сеть, без кэша
  if (e.request.url.includes('/api/') || e.request.url.includes('/socket.io/')) {
    return;
  }

  // Статика: network-first — берём свежее из сети, при ошибке берём из кэша
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Сохраняем свежую копию в кэше
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
