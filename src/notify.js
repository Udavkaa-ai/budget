// Семейные уведомления: копим изменения автора и шлём одно сводное.
//
// Раньше каждый POST слал отдельный пуш («Марина внёс изменения» × 7).
// Теперь изменения одного автора копятся, пока он вносит (тишина QUIET мс,
// но не дольше MAX мс), и уходит одно уведомление «Марина · 3 расхода · 2 450 ₽».
//
// E2E-семьи: сервер сумм не знает. Клиент прикладывает к синхронизации
// зашифрованную ключом семьи сводку (hint), сервер пересылает её как есть —
// расшифровывает только устройство получателя (service worker / приложение).

const QUIET = 60_000;
const MAX = 5 * 60_000;
const MAX_HINTS = 12;                 // лимит размера пуш-пейлоада (~4 КБ)

const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const fmtR = n => `${Math.round(n).toLocaleString('ru-RU')} ₽`;
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };

// items: [[сумма, 'ДД.ММ.ГГГГ', категория]]; тот же формат собирают клиенты
// (public/sw.js и android/src/push.ts повторяют эту функцию)
export function summarize(by, items, extra = { upd: 0, del: 0 }) {
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

export function createNotifier({ getSubs, send }) {
  const pending = new Map();

  function flush(key) {
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    clearTimeout(p.timer);
    const subs = getSubs(p.family, p.by);
    if (!subs.length) return;
    const base = { url: '/', by: p.by, tag: `upd:${p.by}` };
    if (p.e2e) {
      // Текст-заглушка на случай, если устройство не смогло расшифровать
      const n = p.records;
      send(subs, {
        ...base, e2e: true, hints: p.hints.slice(-MAX_HINTS),
        title: `💸 ${p.by}`,
        body: `Новые записи в бюджете: ${n}`,
      });
    } else {
      send(subs, { ...base, ...summarize(p.by, p.items), items: p.items.slice(-40) });
    }
  }

  function add(family, by, part) {
    const key = `${family}|${by}`;
    let p = pending.get(key);
    if (!p) { p = { family, by, e2e: !!part.e2e, items: [], hints: [], records: 0, first: Date.now(), timer: null }; pending.set(key, p); }
    if (part.items) p.items.push(...part.items);
    if (part.hint) p.hints.push(part.hint);
    p.records += part.records || part.items?.length || 0;
    clearTimeout(p.timer);
    const wait = Math.max(0, Math.min(QUIET, p.first + MAX - Date.now()));
    p.timer = setTimeout(() => flush(key), wait);
  }

  return { add, flush, pending };
}
