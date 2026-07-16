import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { Expense } from './api/client';
import { haptics } from './haptics';

// ─── Геймификация: достижения с прикольными названиями ───────────────────────
export type Achievement = {
  id: string;
  emoji: string;
  title: string;
  desc: string;       // условие / описание
  secret?: boolean;   // условие скрыто, пока не получено
};

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'tour',      emoji: '🎓', title: 'Экскурсовод',                 desc: 'Пройти вводный тур целиком, без пропусков.' },
  { id: 'first',     emoji: '👶', title: 'Первый шаг',                  desc: 'Внести самый первый расход.' },
  { id: 'week',      emoji: '📅', title: 'Неделя дисциплины',           desc: 'Вносить расходы каждый день 7 дней подряд.' },
  { id: 'month30',   emoji: '🔥', title: 'Марафонец',                   desc: 'Вести учёт 30 дней подряд.' },
  { id: 'redline',   emoji: '🏎️', title: 'Стрелку до отсечки',          desc: 'Барометр выше 160% три дня подряд.' },
  { id: 'fast10',    emoji: '✍️', title: 'Помедленней, я записываю!',   desc: 'Внести больше 10 расходов за один день.' },
  { id: 'shelves',   emoji: '🗂️', title: 'У меня всё по полочкам',      desc: 'Создать 5 своих категорий.' },
  { id: 'variety',   emoji: '🎨', title: 'Всего понемногу',             desc: 'Расходы из 5 разных категорий за один день.' },
  { id: 'century',   emoji: '💯', title: 'Сотка',                       desc: 'Внести 100 расходов за всё время.' },
  { id: 'onplan',    emoji: '🎯', title: 'Точно по плану',              desc: 'Закрыть месяц, уложившись в план (барометр ≤ 100%).' },
  { id: 'goal',      emoji: '🏆', title: 'Мечты сбываются',             desc: 'Накопить на цель на 100%.' },
  { id: 'family',    emoji: '🤝', title: 'Вместе веселее',              desc: 'Вести бюджет вдвоём или большей семьёй.' },
  { id: 'midnight',  emoji: '🌙', title: 'Успеть до полуночи!',         desc: 'Внести расход в интервале 23:50–00:00.', secret: true },
  { id: 'earlybird', emoji: '🌅', title: 'Ранняя пташка',              desc: 'Внести расход до 7 утра.', secret: true },
  { id: 'receipt',   emoji: '🧾', title: 'Чекист',                      desc: 'Распознать чек с помощью ИИ.', secret: true },
];

const KEY = 'achievements_v1';
let _unlocked: Record<string, number> = {};   // id → время получения (мс)
const _queue: string[] = [];                   // очередь тостов о новых ачивках
const listeners = new Set<() => void>();
function notify() { listeners.forEach(l => l()); }

export async function initAchievements() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) _unlocked = JSON.parse(raw);
  } catch { /* keep empty */ }
  notify();
}

export function isUnlocked(id: string) { return !!_unlocked[id]; }
export function unlockedCount() { return Object.keys(_unlocked).length; }

export function unlock(id: string): boolean {
  if (_unlocked[id] || !ACHIEVEMENTS.some(a => a.id === id)) return false;
  _unlocked[id] = Date.now();
  _queue.push(id);
  haptics.success();
  notify();
  SecureStore.setItemAsync(KEY, JSON.stringify(_unlocked)).catch(() => {});
  return true;
}

// Тосты о новых достижениях достаёт по одному компонент-оповещение
export function nextToast(): string | null { return _queue.shift() ?? null; }
export function getAchievement(id: string) { return ACHIEVEMENTS.find(a => a.id === id) ?? null; }

export function useAchievements() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { unlocked: _unlocked, total: ACHIEVEMENTS.length, count: Object.keys(_unlocked).length };
}

// ─── Вычисление достижений по данным ─────────────────────────────────────────

function dmyOrdinal(s: string): number | null {
  const p = (s || '').split('.').map(Number);
  if (p.length < 3 || !p[0] || !p[1] || !p[2]) return null;
  return Math.floor(Date.UTC(p[2], p[1] - 1, p[0]) / 86400000);
}

function longestRun(ordinals: number[]): number {
  const uniq = [...new Set(ordinals)].sort((a, b) => a - b);
  let best = 0, cur = 0, prev: number | null = null;
  for (const o of uniq) {
    cur = prev !== null && o === prev + 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
    prev = o;
  }
  return best;
}

// Событийные ачивки при добавлении расхода (время создания)
export function checkOnAddExpense(opts: { receipt?: boolean } = {}) {
  const now = new Date();
  const h = now.getHours(), m = now.getMinutes();
  if (h === 23 && m >= 50) unlock('midnight');
  if (h < 7) unlock('earlybird');
  if (opts.receipt) unlock('receipt');
}

// Пакетная проверка по загруженным данным (вызывается на экране достижений и после добавления)
export function evaluateFromData(ctx: {
  expenses: Expense[];
  plannedMonthly: number;
  customCatCount: number;
  goals: { saved: number; target: number }[];
  users: string[];
}) {
  try {
    const exp = ctx.expenses || [];
    if (exp.length >= 1) unlock('first');
    if (exp.length >= 100) unlock('century');
    if (ctx.customCatCount >= 5) unlock('shelves');
    if (ctx.users.length >= 2) unlock('family');
    if (ctx.goals.some(g => g.target > 0 && g.saved >= g.target)) unlock('goal');

    // По дням: количество и разнообразие
    const byDay = new Map<string, Expense[]>();
    for (const e of exp) {
      if (!e.date) continue;
      if (!byDay.has(e.date)) byDay.set(e.date, []);
      byDay.get(e.date)!.push(e);
    }
    for (const [, items] of byDay) {
      if (items.length >= 10) unlock('fast10');
      if (new Set(items.map(i => i.category)).size >= 5) unlock('variety');
    }

    // Серии подряд
    const ords = [...byDay.keys()].map(dmyOrdinal).filter((v): v is number => v !== null);
    const streak = longestRun(ords);
    if (streak >= 7) unlock('week');
    if (streak >= 30) unlock('month30');

    // Барометр > 160% три дня подряд (в любом месяце)
    if (ctx.plannedMonthly > 0) {
      const byMonth = new Map<string, Expense[]>();
      for (const e of exp) {
        const p = (e.date || '').split('.');
        if (p.length < 3) continue;
        const key = `${p[2]}-${p[1]}`;
        if (!byMonth.has(key)) byMonth.set(key, []);
        byMonth.get(key)!.push(e);
      }
      for (const [key, items] of byMonth) {
        const [y, mo] = key.split('-').map(Number);
        const dim = new Date(y, mo, 0).getDate();
        const perDay: number[] = Array(dim + 1).fill(0);
        for (const e of items) {
          const d = parseInt((e.date || '').split('.')[0]);
          if (d >= 1 && d <= dim) perDay[d] += e.amount;
        }
        let cum = 0, run = 0;
        for (let d = 1; d <= dim; d++) {
          cum += perDay[d];
          const planToDate = ctx.plannedMonthly * d / dim;
          const pct = planToDate > 0 ? cum / planToDate * 100 : 0;
          run = pct > 160 ? run + 1 : 0;
          if (run >= 3) { unlock('redline'); break; }
        }
      }

      // Уложился в план: завершённый прошлый месяц, факт ≤ план
      const now = new Date();
      const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      for (const [key, items] of byMonth) {
        if (key === curKey) continue;
        const total = items.reduce((s, e) => s + e.amount, 0);
        if (total > 0 && total <= ctx.plannedMonthly) { unlock('onplan'); break; }
      }
    }
  } catch { /* оценка достижений не должна ронять экран */ }
}
