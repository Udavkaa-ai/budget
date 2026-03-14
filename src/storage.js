import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let data = {
  expenses: [],
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
 */
export async function appendExpenses(expenses) {
  const timestamp = new Date().toISOString();
  
  for (const exp of expenses) {
    data.expenses.push({
      id: generateId(),
      date: exp.date,
      category: exp.category,
      description: exp.description,
      amount: exp.amount,
      user: exp.user || '',
      createdAt: timestamp
    });
  }
  
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
 * Расходы семьи за сегодня (сгруппированы по пользователям)
 */
export function getFamilyToday() {
  const today = formatDate(new Date());
  const todayExpenses = data.expenses.filter(e => e.date === today);
  
  const byUser = {};
  let total = 0;
  
  for (const exp of todayExpenses) {
    const user = exp.user || 'Неизвестно';
    if (!byUser[user]) {
      byUser[user] = { expenses: [], total: 0 };
    }
    byUser[user].expenses.push(exp);
    byUser[user].total += exp.amount;
    total += exp.amount;
  }
  
  return { byUser, total, date: today };
}

/**
 * Расходы семьи за месяц (сгруппированы по пользователям)
 * @param {number|null} targetMonth - месяц (1-12), null = текущий
 * @param {number|null} targetYear - год, null = текущий
 */
export function getFamilySummary(targetMonth = null, targetYear = null) {
  const now = new Date();
  const curMonth = targetMonth || (now.getMonth() + 1);
  const curYear = targetYear || now.getFullYear();

  const byUser = {};
  const byCategory = {};
  let total = 0;

  for (const exp of data.expenses) {
    const [, month, year] = exp.date.split('.').map(Number);

    if (month === curMonth && year === curYear) {
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

  return { byUser, byCategory, total, month: curMonth, year: curYear, monthName: getMonthName(curMonth, curYear) };
}

/**
 * Данные для диаграммы: расходы по дням и пользователям
 */
/**
 * @param {number|null} targetMonth - месяц (1-12), null = текущий
 * @param {number|null} targetYear - год, null = текущий
 * @param {number|null} startDayOverride - принудительный день начала
 */
export function getChartData(targetMonth = null, targetYear = null, startDayOverride = null) {
  const now = new Date();
  const curMonth = targetMonth || (now.getMonth() + 1);
  const curYear = targetYear || now.getFullYear();
  const daysInMonth = new Date(curYear, curMonth, 0).getDate();

  // Для текущего месяца — до сегодня, для прошлых — весь месяц
  const isCurrentMonth = curMonth === (now.getMonth() + 1) && curYear === now.getFullYear();
  const endDay = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;

  // Если override не задан — находим первый день с данными
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

  return { labels, userExpenses, trackingDays, month: curMonth, year: curYear, monthName: getMonthName(curMonth, curYear) };
}

/**
 * Экспорт в CSV формате
 */
export function exportCSV() {
  const header = 'Дата;Категория;Описание;Сумма;Кто;Создано\n';
  const rows = data.expenses.map(e => 
    `${e.date};${e.category};${e.description};${e.amount};${e.user};${e.createdAt}`
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

function getMonthName(month = null, year = null) {
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
 * Принудительно сохранить данные (вызывается при завершении из index.js)
 */
export async function flushData() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    await saveData();
  }
}
