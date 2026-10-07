// Service Worker — network-first: всегда свежие файлы, кэш только при офлайне
const CACHE = 'budget-v39';
const STATIC = [
  '/', '/style.css', '/app.js', '/e2e.js', '/finik-rig.js', '/manifest.json',
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
    e.waitUntil(caches.open(META).then(async c => {
      await c.put('/__self', new Response(e.data.name || ''));
      // Ключ семьи (E2E) — чтобы расшифровать сводку в пуше. Пусто — стираем.
      if ('key' in e.data) {
        if (e.data.key) await c.put('/__k', new Response(e.data.key));
        else await c.delete('/__k');
      }
    }));
  }
});
async function getSelfName() {
  try { const r = await caches.match('/__self'); return r ? await r.text() : null; }
  catch { return null; }
}

// ─── Сводка в уведомлении ─────────────────────────────────────────────────────
// Повторяет summarize() из src/notify.js: «Марина · 3 расхода · 2 450 ₽»,
// «за 5–6 окт · Продукты 1 200 ₽, Кафе 450 ₽».
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtR = n => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
function summarize(by, items, extra = { upd: 0, del: 0 }) {
  const n = items.reduce((k, it) => k + (Number(it[3]) || 1), 0);   // it[3] — штук в сжатой строке
  const sum = items.reduce((s, it) => s + (Number(it[0]) || 0), 0);
  const days = [...new Set(items.map(it => it[1]).filter(Boolean))]
    .sort((a, b) => a.split('.').reverse().join('').localeCompare(b.split('.').reverse().join('')));
  const dd = d => { const [x, m] = d.split('.'); return `${+x} ${MON[+m - 1] || ''}`; };
  const when = !days.length ? '' : days.length === 1 ? dd(days[0])
    : days[0].slice(3) === days[days.length - 1].slice(3) ? `${+days[0].split('.')[0]}–${dd(days[days.length - 1])}`
    : `${dd(days[0])} – ${dd(days[days.length - 1])}`;
  const tail = [extra.upd ? `изменено ${extra.upd}` : '', extra.del ? `удалено ${extra.del}` : ''].filter(Boolean).join(', ');
  if (!n) return { title: `💸 ${by}`, body: tail ? `Правки в расходах: ${tail}` : 'Правки в расходах' };
  const cats = {};
  for (const it of items) cats[it[2] || 'Прочее'] = (cats[it[2] || 'Прочее'] || 0) + (Number(it[0]) || 0);
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const catTxt = top.slice(0, 3).map(([c, v]) => `${c} ${fmtR(v)}`).join(', ') + (top.length > 3 ? '…' : '');
  return {
    title: `💸 ${by} · ${n} ${plural(n, 'расход', 'расхода', 'расходов')} · ${fmtR(sum)}`,
    body: [when ? `за ${when}` : '', catTxt, tail].filter(Boolean).join(' · '),
  };
}

// Расшифровка сводок E2E ключом семьи (тот же формат, что в e2e.js: iv(12)+ct, base64)
async function decryptHints(hints) {
  const r = await caches.open(META).then(c => c.match('/__k')).catch(() => null);
  const hex = r ? await r.text() : '';
  if (!hex || !hints?.length) return null;
  const bytes = new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const out = { items: [], upd: 0, del: 0 };
  for (const h of hints) {
    try {
      const packed = Uint8Array.from(atob(h), c => c.charCodeAt(0));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.slice(0, 12) }, key, packed.slice(12));
      const j = JSON.parse(new TextDecoder().decode(plain));
      out.items.push(...(j.items || [])); out.upd += j.upd || 0; out.del += j.del || 0;
    } catch { /* чужой ключ или битый блоб */ }
  }
  return out;
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    const data = e.data?.json() || {};
    const selfName = await getSelfName();
    // Своё же действие — не уведомляем
    if (data.by && selfName && data.by === selfName) return;
    let title = data.title || 'ФИНИК', body = data.body || '';
    let acc = null;                     // накопленная сводка для склейки
    if (data.e2e) {
      acc = await decryptHints(data.hints).catch(() => null);
      if (acc && !acc.items.length && !acc.upd && !acc.del) acc = null;
    } else if (Array.isArray(data.items)) {
      acc = { items: data.items, upd: 0, del: 0 };
    }
    // Ещё не смахнули прошлое уведомление того же автора — дописываем в него,
    // а не плодим новые строки
    if (acc && data.tag) {
      const prev = (await self.registration.getNotifications({ tag: data.tag }))[0];
      const p = prev?.data?.acc;
      if (p) acc = { items: [...p.items, ...acc.items].slice(-200), upd: p.upd + acc.upd, del: p.del + acc.del };
    }
    if (acc) ({ title, body } = summarize(data.by || 'Семья', acc.items, acc));
    await self.registration.showNotification(title, {
      body,
      icon: '/icon-512.png',
      badge: '/icon-512.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/', acc },
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
