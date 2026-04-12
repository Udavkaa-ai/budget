// Service Worker — network-first: всегда свежие файлы, кэш только при офлайне
const CACHE = 'budget-v4';
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
