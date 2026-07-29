// Чистая логика регулярных платежей: ключи периодов, остаток к оплате, подписи.
// Идентична вебовой реализации в public/app.js (recur*). Меняешь тут — меняй там.
import type { RecurringItem, RecurringFreq } from './api/client';

export const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']; // getDay(): 0 = воскресенье

export const FREQ_LABEL: Record<RecurringFreq, string> = {
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
};

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ym = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

// Понедельник недели, к которой относится дата (локальная полночь)
export function mondayOf(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (d.getDay() + 6) % 7; // 0 = понедельник
  d.setDate(d.getDate() - shift);
  return d;
}

const freqOf = (i: RecurringItem): RecurringFreq => i.freq || 'monthly';
const timesOf = (i: RecurringItem): number => Math.max(1, i.times || 1);

// Ключ текущего периода платежа
export function periodKey(item: RecurringItem, now: Date): string {
  const f = freqOf(item);
  if (f === 'daily') return ymd(now);
  if (f === 'weekly') return ymd(mondayOf(now));
  return ym(now);
}

// Сколько раз уже внесено в текущем периоде (со старым форматом lastPaid без paidCount — считаем оплаченным полностью)
export function paidInPeriod(item: RecurringItem, now: Date): number {
  if (item.lastPaid !== periodKey(item, now)) return 0;
  return item.paidCount ?? timesOf(item);
}

export function remaining(item: RecurringItem, now: Date): number {
  return Math.max(0, timesOf(item) - paidInPeriod(item, now));
}

// Дата платежа для расхода (DD.MM.YYYY) в текущем периоде
export function dueDate(item: RecurringItem, now: Date): string {
  const f = freqOf(item);
  let d: Date;
  if (f === 'daily') {
    d = now;
  } else if (f === 'weekly') {
    const base = mondayOf(now);
    // day: 0=вс..6=сб (getDay). Смещение от понедельника: Пн→0 … Сб→5, Вс→6
    d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + ((item.day + 6) % 7));
  } else {
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    d = new Date(now.getFullYear(), now.getMonth(), Math.min(Math.max(item.day, 1), dim));
  }
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

// «Дней до платежа» для сортировки и подписи (может быть отрицательным — просрочено)
export function daysUntil(item: RecurringItem, now: Date): number {
  const f = freqOf(item);
  if (f === 'daily') return 0;
  if (f === 'weekly') return item.day - now.getDay(); // −6..6: <0 просрочено на этой неделе, >0 ещё будет
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.min(item.day, dim) - now.getDate();
}

export function dueLabel(item: RecurringItem, now: Date): string {
  const rem = remaining(item, now);
  if (freqOf(item) === 'daily') return rem > 1 ? `сегодня · осталось ${rem}` : 'сегодня';
  const diff = daysUntil(item, now);
  const base = diff === 0 ? 'сегодня' : diff > 0 ? `через ${diff} дн.` : `просрочено ${-diff} дн.`;
  return rem > 1 ? `${base} · осталось ${rem}` : base;
}

// Краткое описание расписания для строки списка
export function scheduleLabel(item: RecurringItem): string {
  const f = freqOf(item);
  const t = timesOf(item);
  const times = t > 1 ? ` ×${t}` : '';
  if (f === 'daily') return `каждый день${times}`;
  if (f === 'weekly') return `по ${WEEKDAYS_SHORT[((item.day % 7) + 7) % 7]}${times}`;
  return `${item.day}-го${times}`;
}
