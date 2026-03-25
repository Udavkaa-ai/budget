import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let data = {
  expenses: [],
  settings: {},
  meta: { created: new Date().toISOString(), version: 1 }
};

let saveTimeout = null;
const DEBOUNCE_MS = 2000;

/**
 * Загрузка данных при старте
 */
export async function loadData() {
  try {
    if (existsSync(config.dataFile)) {
      const raw = await readFile(config.dataFile, 'utf-8');
      data = JSON.parse(raw);
      data.settings = data.settings || {};
      console.log(`📂 Загружено ${data.expenses.length} записей`);
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
 * Автоматически помечает постоянные расходы по ключевым словам
 */
export async function appendExpenses(expenses) {
  const timestamp = new Date().toISOString();

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
      isFixed,
      createdAt: timestamp
    });
  }

  debouncedSave();
}

/**
 * Настройки
 */
export function getSettings() {
  return data.settings || {};
}

export async function updateSetting(key, value) {
  data.settings = data.settings || {};
  data.settings[key] = value;
  debouncedSave();
}

/**
 * Статистика за текущий месяц
 */
export function getMonthSummary() {
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const byCategory = {};
  let total = 0;

  for (const exp of data.expenses) {
    const [day, month, year] = exp.date.split('.').map(Number);

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
export function getTodaySummary(userName = null) {
  const today = formatDate(new Date());

  let todayExpenses = data.expenses.filter(e => e.date === today);

  if (userName) {
    todayExpenses = todayExpenses.filter(e => e.user === userName);
  }

  const total = todayExpenses.reduce((sum, e) => sum + e.amount, 0);

  return { expenses: todayExpenses, total, date: today };
}

/**
 * Расходы семьи за конкретный день (сгруппированы по пользователям)
 */
export function getFamilyDay(dateStr) {
  const expenses = data.expenses.filter(e => e.date === dateStr);

  const byUser = {};
  let total = 0;

  for (const exp of expenses) {
    const user = exp.user || 'Неизвестно';
    if (!byUser[user]) {
      byUser[user] = { expenses: [], total: 0 };
    }
    byUser[user].expenses.push(exp);
    byUser[user].total += exp.amount;
    total += exp.amount;
  }

  return { byUser, total, date: dateStr };
}

/**
 * Расходы семьи за сегодня
 */
export function getFamilyToday() {
  return getFamilyDay(formatDate(new Date()));
}

/**
 * Расходы семьи за месяц (сгруппированы по пользователям)
 * @param {number|null} targetMonth - месяц (1-12), null = текущий
 * @param {number|null} targetYear - год, null = текущий
 * @param {boolean} excludeFixed - исключить постоянные расходы
 */
export function getFamilySummary(targetMonth = null, targetYear = null, excludeFixed = false) {
  const now = new Date();
  const curMonth = targetMonth || (now.getMonth() + 1);
  const curYear = targetYear || now.getFullYear();

  const byUser = {};
  const byCategory = {};
  let total = 0;

  for (const exp of data.expenses) {
    const [, month, year] = exp.date.split('.').map(Number);

    if (month === curMonth && year === curYear) {
      if (excludeFixed && exp.isFixed) continue;

      const user = exp.user || 'Неизвестно';

      if (!byUser[user]) {
        byUser[user] = { total: 0, byCategory: {} };
      }
      byUser[user].total += exp.amount;
      byUser[user].byCategory[exp.category] = (byUser[user].byCategory[exp.category] || 0) + exp.amount;

      byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;
      total += exp.amount;
    }
  }

  return {
    byUser, byCategory, total,
    month: curMonth, year: curYear,
    monthName: getMonthName(curMonth, curYear),
    excludeFixed,
  };
}

/**
 * Данные для диаграммы: расходы по дням и пользователям
 * @param {number|null} targetMonth - месяц (1-12), null = текущий
 * @param {number|null} targetYear - год, null = текущий
 * @param {number|null} startDayOverride - принудительный день начала
 * @param {boolean} excludeFixed - исключить постоянные расходы
 */
export function getChartData(targetMonth = null, targetYear = null, startDayOverride = null, excludeFixed = false) {
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
      const [day, month, year] = exp.date.split('.').map(Number);
      if (month === curMonth && year === curYear && day < minDay) {
        minDay = day;
      }
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

  const trackingDays = endDay - startDay + 1;

  return {
    labels, userExpenses, trackingDays, daysInMonth,
    month: curMonth, year: curYear,
    monthName: getMonthName(curMonth, curYear),
  };
}

/**
 * Экспорт в CSV формате
 */
export function exportCSV() {
  const header = 'Дата;Категория;Описание;Сумма;Кто;Постоянный;Создано\n';
  const rows = data.expenses.map(e =>
    `${e.date};${e.category};${e.description};${e.amount};${e.user};${e.isFixed ? 'да' : 'нет'};${e.createdAt}`
  ).join('\n');
  return header + rows;
}

// Helpers
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

/**
 * Все расходы по конкретной категории за месяц
 */
export function getCategoryExpenses(category, month = null, year = null) {
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return data.expenses
    .filter(exp => {
      const [, em, ey] = exp.date.split('.').map(Number);
      return exp.category === category && em === m && ey === y;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Все расходы за месяц, отсортированные по дате
 */
export function getExpensesForMonth(month = null, year = null) {
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return data.expenses
    .filter(exp => {
      const [, em, ey] = exp.date.split('.').map(Number);
      return em === m && ey === y;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Переключить isFixed для конкретной записи
 */
export async function toggleExpenseFixed(id) {
  const exp = data.expenses.find(e => e.id === id);
  if (!exp) return null;
  exp.isFixed = !exp.isFixed;
  debouncedSave();
  return exp.isFixed;
}

/**
 * Ретроактивно проставить isFixed по ключевым словам для всех записей
 * Возвращает количество помеченных записей
 */
export async function retagFixedExpenses() {
  let tagged = 0;
  for (const exp of data.expenses) {
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
 * Принудительно сохранить данные (вызывается при завершении из index.js)
 */
export async function flushData() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    await saveData();
  }
}
