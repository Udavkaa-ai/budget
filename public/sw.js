// Service Worker — network-first: всегда свежие файлы, кэш только при офлайне
const CACHE = 'budget-v22';
const STATIC = [
  '/', '/style.css', '/app.js', '/e2e.js', '/manifest.json',
  '/vendor/chart.umd.min.js', '/vendor/hammer.min.js',
  '/vendor/chartjs-plugin-zoom.min.js', '/vendor/chartjs-plugin-datalabels.min.js',
];

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

// Имя текущего пользователя — страница присылает его через postMessage.
// Храним в Cache (переживает перезапуск воркера), чтобы не показывать
// уведомления о собственных записях — они нужны только про партнёра.
const META = 'budget-meta';
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'set-self') {
    e.waitUntil(caches.open(META).then(c => c.put('/__self', new Response(e.data.name || ''))));
  }
});
async function getSelfName() {
  try { const r = await caches.match('/__self'); return r ? await r.text() : null; }
  catch { return null; }
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const data = e.data?.json() || {};
    const selfName = await getSelfName();
    // Своё же действие — не уведомляем
    if (data.by && selfName && data.by === selfName) return;
    await self.registration.showNotification(data.title || 'Семейный бюджет', {
      body: data.body || '',
      icon: '/icon-512.png',
      badge: '/icon-512.png',
      data: { url: data.url || '/' },
      vibrate: [100, 50, 100],
    });
  })());
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
  // Перехватываем только GET своего origin. Чужие домены (Google-шрифты, GIS)
  // отдаём браузеру напрямую — иначе opaque-ответы кэшируются криво и на
  // мобильном PWA ломали загрузку внешних скриптов.
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

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
