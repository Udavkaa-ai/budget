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
 */
export function getFamilySummary() {
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  const byUser = {};
  const byCategory = {};
  let total = 0;

  for (const exp of data.expenses) {
    const [, month, year] = exp.date.split('.').map(Number);
    
    if (month === curMonth && year === curYear) {
      const user = exp.user || 'Неизвестно';
      
      // По пользователям
      if (!byUser[user]) {
        byUser[user] = { total: 0, byCategory: {} };
      }
      byUser[user].total += exp.amount;
      byUser[user].byCategory[exp.category] = (byUser[user].byCategory[exp.category] || 0) + exp.amount;
      
      // Общее по категориям
      byCategory[exp.category] = (byCategory[exp.category] || 0) + exp.amount;
      total += exp.amount;
    }
  }

  return { byUser, byCategory, total, monthName: getMonthName() };
}

/**
 * Экспорт всех данных
 */
export function exportData() {
  return {
    expenses: data.expenses,
    exportedAt: new Date().toISOString(),
    totalRecords: data.expenses.length
  };
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

function getMonthName() {
  const months = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];
  const now = new Date();
  return `${months[now.getMonth()]} ${now.getFullYear()}`;
}

// Сохранение при выходе
process.on('SIGINT', async () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    await saveData();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    await saveData();
  }
  process.exit(0);
});
