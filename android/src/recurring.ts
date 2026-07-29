// Чистая логика регулярных платежей: ключи периодов, остаток к оплате, подписи.
// Идентична вебовой реализации в public/app.js (recur*). Меняешь тут — меняй там.
import type { RecurringItem, RecurringFreq } from './api/client';

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
