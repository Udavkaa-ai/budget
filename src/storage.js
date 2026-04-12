import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let data = {
  expenses: [],
  settings: {},
  goals: [],
  meta: { created: new Date().toISOString(), version: 1 }
};

let saveTimeout = null;
const DEBOUNCE_MS = 2000;

// Нормализует familyId — если не задан, возвращает 'family1' (обратная совместимость)
function fam(familyId) {
  return familyId || 'family1';
}

// Возвращает family-специфичный раздел settings
function familySettings(familyId) {
  const f = fam(familyId);
  if (!data.settings[f]) data.settings[f] = {};
  return data.settings[f];
}

/**
 * Загрузка данных при старте + миграция старого формата
 */
export async function loadData() {
  try {
    if (existsSync(config.dataFile)) {
      const raw = await readFile(config.dataFile, 'utf-8');
      data = JSON.parse(raw);
      data.settings = data.settings || {};
      data.goals = data.goals || [];

      // ── Миграция: добавить поле family к расходам без него ──
      let migrated = false;
      for (const exp of data.expenses) {
        if (!exp.family) { exp.family = 'family1'; migrated = true; }
      }
      for (const goal of data.goals) {
        if (!goal.family) { goal.family = 'family1'; migrated = true; }
      }

      // ── Миграция: перенести budgetPlan/cashflow из root settings в family1 ──
      const s = data.settings;
      if ((s.budgetPlan !== undefined || s.cashflow !== undefined) && !s.family1) {
        s.family1 = {
          budgetPlan: s.budgetPlan,
          cashflow: s.cashflow || {},
        };
        delete s.budgetPlan;
        delete s.cashflow;
        migrated = true;
      }

      if (migrated) {
        console.log('📦 Данные мигрированы в формат multi-family');
        await saveData();
      }

      console.log(`📂 Загружено ${data.expenses.length} записей, ${data.goals.length} целей`);
    } else {
      await saveData();
      console.log('📂 Создан новый файл данных');
    }
  } catch (err) {
    console.error('Ошибка загрузки данных:', err);
  }
}

/**
 * Сохранение с debounce
 */
function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await saveData();
  }, DEBOUNCE_MS);
}

/**
 * Принудительное сохранение
 */
async function saveData() {
  try {
    const dir = dirname(config.dataFile);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(config.dataFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Ошибка сохранения:', err);
  }
}

/**
 * Добавить расходы
 */
export async function appendExpenses(expenses, familyId) {
  const timestamp = new Date().toISOString();
  const f = fam(familyId);

  for (const exp of expenses) {
    const descLower = (exp.description || '').toLowerCase();
    const isFixed = config.fixedKeywords.some(kw => descLower.includes(kw));

    data.expenses.push({
      id: generateId(),
      date: exp.date,
      category: exp.category,
      description: exp.description,
      amount: exp.amount,
      user: exp.user || '',
      family: f,
      isFixed,
      createdAt: timestamp
    });
  }

  debouncedSave();
}

/**
 * Настройки (общие — без family scope)
 */
export function getSettings(familyId) {
  // Возвращаем family-специфичные настройки плюс базовые поля
  const fs = familySettings(familyId);
  return {
    ...(data.settings._global || {}),
    ...fs,
  };
}

export async function updateSetting(key, value, familyId) {
  const fs = familySettings(familyId);
  fs[key] = value;
  debouncedSave();
}

/**
 * Статистика за текущий месяц (используется Telegram-ботом)
 */
export function getMonthSummary(familyId) {
  const f = fam(familyId);
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const byCategory = {};
  let total = 0;

  for (const exp of data.expenses) {
    if (fam(exp.family) !== f) continue;
    const [, month, year] = exp.date.split('.').map(Number);
    if (month === curMonth && year === curYear) {
      byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;
      total += exp.amount;
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  );

  return { total, byCategory: sorted, monthName: getMonthName() };
}

/**
 * Расходы за сегодня
 */
export function getTodaySummary(userName = null, familyId) {
  const f = fam(familyId);
  const today = formatDate(new Date());

  let todayExpenses = data.expenses.filter(
    e => e.date === today && fam(e.family) === f
  );

  if (userName) {
    todayExpenses = todayExpenses.filter(e => e.user === userName);
  }

  const total = todayExpenses.reduce((sum, e) => sum + e.amount, 0);
  return { expenses: todayExpenses, total, date: today };
}

/**
 * Расходы семьи за конкретный день
 */
export function getFamilyDay(dateStr, familyId) {
  const f = fam(familyId);
  const expenses = data.expenses.filter(
    e => e.date === dateStr && fam(e.family) === f
  );

  const byUser = {};
  let total = 0;

  for (const exp of expenses) {
    const user = exp.user || 'Неизвестно';
    if (!byUser[user]) byUser[user] = { expenses: [], total: 0 };
    byUser[user].expenses.push(exp);
    byUser[user].total += exp.amount;
    total += exp.amount;
  }

  return { byUser, total, date: dateStr };
}

/**
 * Расходы семьи за сегодня
 */
export function getFamilyToday(familyId) {
  return getFamilyDay(formatDate(new Date()), familyId);
}

/**
 * Расходы семьи за месяц (сводка)
 */
export function getFamilySummary(targetMonth = null, targetYear = null, excludeFixed = false, familyId) {
  const f = fam(familyId);
  const now = new Date();
  const curMonth = targetMonth || (now.getMonth() + 1);
  const curYear = targetYear || now.getFullYear();

  const byUser = {};
  const byCategory = {};
  let total = 0;

  for (const exp of data.expenses) {
    if (fam(exp.family) !== f) continue;
    const [, month, year] = exp.date.split('.').map(Number);
    if (month !== curMonth || year !== curYear) continue;
    if (excludeFixed && exp.isFixed) continue;

    const user = exp.user || 'Неизвестно';
    if (!byUser[user]) byUser[user] = { total: 0, byCategory: {} };
    byUser[user].total += exp.amount;
    byUser[user].byCategory[exp.category] = (byUser[user].byCategory[exp.category] || 0) + exp.amount;

    byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;
    total += exp.amount;
  }

  return {
    byUser, byCategory, total,
    month: curMonth, year: curYear,
    monthName: getMonthName(curMonth, curYear),
    excludeFixed,
  };
}

/**
 * Данные для диаграммы
 */
export function getChartData(targetMonth = null, targetYear = null, startDayOverride = null, excludeFixed = false, familyId) {
  const f = fam(familyId);
  const now = new Date();
  const curMonth = targetMonth || (now.getMonth() + 1);
  const curYear = targetYear || now.getFullYear();
  const daysInMonth = new Date(curYear, curMonth, 0).getDate();

  const isCurrentMonth = curMonth === (now.getMonth() + 1) && curYear === now.getFullYear();
  const endDay = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;

  let startDay = startDayOverride;
  if (!startDay) {
    let minDay = endDay;
    for (const exp of data.expenses) {
      if (fam(exp.family) !== f) continue;
      const [day, month, year] = exp.date.split('.').map(Number);
      if (month === curMonth && year === curYear && day < minDay) minDay = day;
    }
    startDay = minDay;
  }

  const labels = [];
  const fullDates = [];
  for (let d = startDay; d <= endDay; d++) {
    const dateStr = `${String(d).padStart(2, '0')}.${String(curMonth).padStart(2, '0')}.${curYear}`;
    fullDates.push(dateStr);
    labels.push(String(d));
  }

  const dailyByUser = {};
  for (const exp of data.expenses) {
    if (fam(exp.family) !== f) continue;
    const [day, month, year] = exp.date.split('.').map(Number);
    if (month === curMonth && year === curYear && day >= startDay && day <= endDay) {
      if (excludeFixed && exp.isFixed) continue;
      const user = exp.user || 'Неизвестно';
      if (!dailyByUser[user]) dailyByUser[user] = {};
      dailyByUser[user][exp.date] = (dailyByUser[user][exp.date] || 0) + exp.amount;
    }
  }

  const userExpenses = {};
  for (const [user, dateMap] of Object.entries(dailyByUser)) {
    userExpenses[user] = fullDates.map(date => dateMap[date] || 0);
  }

  return {
    labels, userExpenses,
    trackingDays: endDay - startDay + 1, daysInMonth,
    month: curMonth, year: curYear,
    monthName: getMonthName(curMonth, curYear),
  };
}

/**
 * Экспорт в CSV
 */
export function exportCSV(familyId) {
  const f = fam(familyId);
  const header = 'Дата;Категория;Описание;Сумма;Кто;Постоянный;Создано\n';
  const rows = data.expenses
    .filter(e => fam(e.family) === f)
    .map(e =>
      `${e.date};${e.category};${e.description};${e.amount};${e.user};${e.isFixed ? 'да' : 'нет'};${e.createdAt}`
    ).join('\n');
  return header + rows;
}

/**
 * Импорт из CSV
 */
export async function importFromCSV(csvText, familyId) {
  const f = fam(familyId);
  const lines = csvText.replace(/\r/g, '').split('\n').filter(Boolean);
  const dataLines = lines[0].startsWith('Дата') ? lines.slice(1) : lines;

  const existing = new Set(
    data.expenses
      .filter(e => fam(e.family) === f)
      .map(e => `${e.date}|${e.category}|${e.amount}|${e.description}`)
  );

  let imported = 0;
  let skipped = 0;

  for (const line of dataLines) {
    const parts = line.split(';');
    if (parts.length < 4) { skipped++; continue; }

    const [date, category, description, amountStr, user = '', fixedStr = 'нет', createdAt = ''] = parts;
    const amount = parseFloat(amountStr);

    if (!date || !category || isNaN(amount) || amount <= 0) { skipped++; continue; }

    const key = `${date}|${category}|${amount}|${description}`;
    if (existing.has(key)) { skipped++; continue; }

    existing.add(key);
    data.expenses.push({
      id: generateId(),
      date: date.trim(),
      category: category.trim(),
      description: description.trim(),
      amount,
      user: user.trim(),
      family: f,
      isFixed: fixedStr.trim() === 'да',
      createdAt: createdAt.trim() || new Date().toISOString(),
    });
    imported++;
  }

  if (imported > 0) debouncedSave();
  return { imported, skipped };
}

/**
 * Все расходы по конкретной категории за месяц
 */
export function getCategoryExpenses(category, month = null, year = null, familyId) {
  const f = fam(familyId);
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return data.expenses
    .filter(exp => {
      const [, em, ey] = exp.date.split('.').map(Number);
      return fam(exp.family) === f && exp.category === category && em === m && ey === y;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Все расходы за месяц
 */
export function getExpensesForMonth(month = null, year = null, familyId) {
  const f = fam(familyId);
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return data.expenses
    .filter(exp => {
      const [, em, ey] = exp.date.split('.').map(Number);
      return fam(exp.family) === f && em === m && ey === y;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Переключить isFixed
 */
export async function toggleExpenseFixed(id, familyId) {
  const f = fam(familyId);
  const exp = data.expenses.find(e => e.id === id && fam(e.family) === f);
  if (!exp) return null;
  exp.isFixed = !exp.isFixed;
  debouncedSave();
  return exp.isFixed;
}

/**
 * Ретроактивно проставить isFixed по ключевым словам
 */
export async function retagFixedExpenses(familyId) {
  const f = fam(familyId);
  let tagged = 0;
  for (const exp of data.expenses) {
    if (fam(exp.family) !== f) continue;
    const descLower = (exp.description || '').toLowerCase();
    const shouldBeFixed = config.fixedKeywords.some(kw => descLower.includes(kw));
    if (shouldBeFixed && !exp.isFixed) {
      exp.isFixed = true;
      tagged++;
    }
  }
  if (tagged > 0) debouncedSave();
  return tagged;
}

/**
 * Удалить расход
 */
export async function deleteExpense(id, familyId) {
  const f = fam(familyId);
  const index = data.expenses.findIndex(e => e.id === id && fam(e.family) === f);
  if (index === -1) return null;
  const [deleted] = data.expenses.splice(index, 1);
  debouncedSave();
  return deleted;
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export function getGoals(familyId) {
  const f = fam(familyId);
  return (data.goals || []).filter(g => fam(g.family) === f);
}

export async function addGoal({ name, targetAmount, emoji = '🎯', createdBy = '', familyId }) {
  if (!data.goals) data.goals = [];
  const goal = {
    id: generateId(),
    name,
    targetAmount,
    emoji,
    family: fam(familyId),
    contributions: [],
    createdAt: new Date().toISOString(),
    createdBy,
  };
  data.goals.push(goal);
  debouncedSave();
  return goal;
}

export async function contributeToGoal(goalId, user, amount, familyId) {
  const f = fam(familyId);
  const goal = (data.goals || []).find(g => g.id === goalId && fam(g.family) === f);
  if (!goal) return null;
  goal.contributions.push({ user, amount: Number(amount), addedAt: new Date().toISOString() });
  debouncedSave();
  return goal;
}

export async function deleteGoal(goalId, familyId) {
  const f = fam(familyId);
  const idx = (data.goals || []).findIndex(g => g.id === goalId && fam(g.family) === f);
  if (idx === -1) return null;
  const [deleted] = data.goals.splice(idx, 1);
  debouncedSave();
  return deleted;
}

// ─── Budget plan ──────────────────────────────────────────────────────────────

export function getBudgetPlan(familyId) {
  return familySettings(familyId).budgetPlan || {};
}

export async function saveBudgetPlan(plan, familyId) {
  familySettings(familyId).budgetPlan = plan;
  debouncedSave();
}

// ─── Cashflow ─────────────────────────────────────────────────────────────────

export function getCashflow(ym, familyId) {
  return familySettings(familyId).cashflow?.[ym] || {};
}

export async function saveCashflow(ym, cfData, familyId) {
  const fs = familySettings(familyId);
  fs.cashflow = fs.cashflow || {};
  fs.cashflow[ym] = cfData;
  debouncedSave();
}

/** Суммарные расходы за каждый день месяца: { '01.04.2026': 5200, ... } */
export function getMonthDailyTotals(month, year, familyId) {
  const f = fam(familyId);
  const result = {};
  for (const exp of data.expenses) {
    if (fam(exp.family) !== f) continue;
    const parts = exp.date.split('.');
    if (parts.length !== 3) continue;
    const [, m, y] = parts.map(Number);
    if (m === month && y === year) {
      result[exp.date] = (result[exp.date] || 0) + exp.amount;
    }
  }
  return result;
}

/**
 * Принудительно сохранить данные (при завершении)
 */
export async function flushData() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    await saveData();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${date.getFullYear()}`;
}

export function getMonthName(month = null, year = null) {
  const months = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return `${months[m - 1]} ${y}`;
}
