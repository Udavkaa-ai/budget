// Чистая логика регулярных платежей: ключи периодов, остаток к оплате, подписи.
// Идентична вебовой реализации в public/app.js (recur*). Меняешь тут — меняй там.
import type { RecurringItem, RecurringFreq, Expense } from './api/client';

export const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']; // getDay(): 0 = воскресенье
export const WEEKDAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Пн … Вс — порядок для UI и подписей

export const FREQ_LABEL: Record<RecurringFreq, string> = {
  daily: 'Каждый день',
  weekly: 'По дням недели',
  monthly: 'Каждый месяц',
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

const freqOf = (i: RecurringItem): RecurringFreq => i.freq || 'monthly';
const timesOf = (i: RecurringItem): number => Math.max(1, i.times || 1);

// Выбранные дни недели (getDay 0–6). Легаси-платежи без days используют одиночный day.
export function weekdaysOf(item: RecurringItem): number[] {
  if (item.days && item.days.length) return item.days;
  if (freqOf(item) === 'weekly') return [item.day];
  return [];
}

// Недельные и ежедневные учитываются по дню (период = дата), месячные — по месяцу.
export function periodKey(item: RecurringItem, now: Date): string {
  return freqOf(item) === 'monthly' ? ym(now) : ymd(now);
}

// Платёж «активен сегодня»: ежедневный — всегда; недельный — если сегодня один из выбранных дней.
export function dueToday(item: RecurringItem, now: Date): boolean {
  const f = freqOf(item);
  if (f === 'weekly') return weekdaysOf(item).includes(now.getDay());
  return true; // daily / monthly — по своему периоду
}

// Сколько раз уже внесено в текущем периоде (старый формат без paidCount — считаем оплаченным полностью)
export function paidInPeriod(item: RecurringItem, now: Date): number {
  if (item.lastPaid !== periodKey(item, now)) return 0;
  return item.paidCount ?? timesOf(item);
}

export function remaining(item: RecurringItem, now: Date): number {
  if (freqOf(item) === 'weekly' && !dueToday(item, now)) return 0;
  return Math.max(0, timesOf(item) - paidInPeriod(item, now));
}

// Дата платежа для расхода (DD.MM.YYYY): ежедневный/недельный — сегодня, месячный — свой день месяца
export function dueDate(item: RecurringItem, now: Date): string {
  let d: Date;
  if (freqOf(item) === 'monthly') {
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    d = new Date(now.getFullYear(), now.getMonth(), Math.min(Math.max(item.day, 1), dim));
  } else {
    d = now;
  }
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// «Дней до платежа» для сортировки/подписи (для месячных; ежедневные и недельные показываются только когда due → 0)
export function daysUntil(item: RecurringItem, now: Date): number {
  if (freqOf(item) !== 'monthly') return 0;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.min(item.day, dim) - now.getDate();
}

export function dueLabel(item: RecurringItem, now: Date): string {
  const rem = remaining(item, now);
  if (freqOf(item) !== 'monthly') return rem > 1 ? `сегодня · осталось ${rem}` : 'сегодня';
  const diff = daysUntil(item, now);
  const base = diff === 0 ? 'сегодня' : diff > 0 ? `через ${diff} дн.` : `просрочено ${-diff} дн.`;
  return rem > 1 ? `${base} · осталось ${rem}` : base;
}

// Человеческое описание набора дней недели: «по будням» / «по выходным» / «каждый день» / «Пн, Ср, Пт»
export function formatDays(days: number[]): string {
  const set = new Set(days);
  if (set.size >= 7) return 'каждый день';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'по будням';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'по выходным';
  const names = WEEKDAYS_ORDER.filter(d => set.has(d)).map(d => WEEKDAYS_SHORT[d]);
  return 'по ' + (names.join(', ') || '—');
}

// Краткое описание расписания для строки списка
export function scheduleLabel(item: RecurringItem): string {
  const f = freqOf(item);
  const t = timesOf(item);
  const times = t > 1 ? ` ×${t}` : '';
  if (f === 'daily') return `каждый день${times}`;
  if (f === 'weekly') return `${formatDays(weekdaysOf(item))}${times}`;
  return `${item.day}-го${times}`;
}

// ─── Автопоиск повторяющихся платежей (локально, приватно, работает с E2E) ──────

export interface RecurringSuggestion {
  key: string;               // ключ для дедупа/скрытия
  name: string;
  amount: number;
  category: string;
  user: string;
  freq: RecurringFreq;
  day: number;
  days: number[];
  times: number;
  count: number;             // сколько раз встретился в истории
}

const norm = (s: string) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const dayMs = 86400000;

function parseDMY(s: string): Date | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
function monday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function modeNum(arr: number[]): number {
  const c = new Map<number, number>(); let best = arr[0], bestN = 0;
  for (const v of arr) { const n = (c.get(v) || 0) + 1; c.set(v, n); if (n > bestN) { bestN = n; best = v; } }
  return best;
}
function modeStr(arr: string[]): string {
  const c = new Map<string, number>(); let best = arr[0] || '', bestN = 0;
  for (const v of arr) { const n = (c.get(v) || 0) + 1; c.set(v, n); if (n > bestN) { bestN = n; best = v; } }
  return best;
}
const dkey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function suggestionKey(name: string, category: string, amount: number): string {
  return `${norm(name)}|${category}|${amount}`;
}

// Определить частоту по набору дат появления расхода
function classify(dates: Date[]): { freq: RecurringFreq; day: number; days: number[]; times: number } | null {
  const seen = new Set<string>();
  const distinct = dates.filter(d => { const k = dkey(d); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.getTime() - b.getTime());
  if (distinct.length < 3) return null;
  const range = Math.round((distinct[distinct.length - 1].getTime() - distinct[0].getTime()) / dayMs);
  if (range < 5) return null;

  // Месячный: примерно раз в месяц на стабильное число
  const months = new Set(distinct.map(d => `${d.getFullYear()}-${d.getMonth()}`));
  if (months.size >= 3 && distinct.length <= months.size * 1.6) {
    const dom = distinct.map(d => d.getDate());
    const day = modeNum(dom);
    if (dom.filter(x => Math.abs(x - day) <= 3).length >= dom.length * 0.7) {
      return { freq: 'monthly', day, days: [], times: Math.max(1, Math.round(dates.length / months.size)) };
    }
  }

  // Недельный/ежедневный по покрытию дней недели
  const weeks = new Set(distinct.map(d => dkey(monday(d))));
  if (weeks.size < 2) return null;
  const wdWeeks = new Map<number, Set<string>>();
  for (const d of distinct) {
    const wd = d.getDay();
    if (!wdWeeks.has(wd)) wdWeeks.set(wd, new Set());
    wdWeeks.get(wd)!.add(dkey(monday(d)));
  }
  const active: number[] = [];
  for (const [wd, wset] of wdWeeks) if (wset.size / weeks.size >= 0.5) active.push(wd);
  if (active.length === 0) return null;

  const perDate = new Map<string, number>();
  for (const d of dates) {
    if (!active.includes(d.getDay())) continue;
    perDate.set(dkey(d), (perDate.get(dkey(d)) || 0) + 1);
  }
  const times = Math.max(1, Math.round(median([...perDate.values()])));
  if (active.length >= 7) return { freq: 'daily', day: 0, days: [], times };
  const days = WEEKDAYS_ORDER.filter(w => active.includes(w));
  return { freq: 'weekly', day: days[0], days, times };
}

// Найти похожие на регулярные платежи в истории расходов (порог — минимум повторений)
export function detectRecurring(
  expenses: Expense[], existing: RecurringItem[], minCount = 3, dismissed: string[] = [],
): RecurringSuggestion[] {
  const skip = new Set([
    ...existing.map(i => suggestionKey(i.name, i.category, i.amount)),
    ...dismissed,
  ]);
  const groups = new Map<string, { d: Date; user: string }[]>();
  const meta = new Map<string, { name: string; category: string; amount: number }>();
  for (const e of expenses) {
    const d = parseDMY(e.date);
    if (!d || !(e.amount > 0)) continue;
    const name = (e.description || e.category || '').trim();
    if (!name) continue;
    const key = suggestionKey(name, e.category, e.amount);
    if (!groups.has(key)) { groups.set(key, []); meta.set(key, { name, category: e.category, amount: e.amount }); }
    groups.get(key)!.push({ d, user: e.user });
  }

  const out: RecurringSuggestion[] = [];
  for (const [key, arr] of groups) {
    if (arr.length < minCount || skip.has(key)) continue;
    const detected = classify(arr.map(x => x.d));
    if (!detected) continue;
    const m = meta.get(key)!;
    out.push({ key, name: m.name, amount: m.amount, category: m.category, user: modeStr(arr.map(x => x.user)), count: arr.length, ...detected });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 8);
}
