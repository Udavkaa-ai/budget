import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { config } from './config.js';

let data = {
  expenses: [],
  settings: {},
  goals: [],
  invites: {},
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
 * Бюджетные настройки семьи.
 * Берём из family settings, иначе — из глобального конфига.
 */
export function getFamilyBudgetSettings(familyId) {
  const fs = familySettings(familyId);
  return {
    plannedMonthly: fs.plannedMonthly ?? config.plannedMonthly,
    familyName:     fs.familyName    ?? '',
  };
}

/** Сохранить бюджетные настройки семьи */
export async function saveFamilyBudgetSettings(familyId, { plannedMonthly, familyName }) {
  const fs = familySettings(familyId);
  if (plannedMonthly !== undefined) fs.plannedMonthly = plannedMonthly;
  if (familyName     !== undefined) fs.familyName     = familyName;
  debouncedSave();
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
      data.invites = data.invites || {};

      let migrated = false;

      // ── Миграция: перенести пользователей из config в data.users ──
      if (!data.users) {
        data.users = config.webUsers.map((u, i) => ({
          login: u.login,
          password: u.password,
          name: u.name,
          family: u.family || 'family1',
          isAdmin: i === 0, // первый пользователь становится администратором
        }));
        migrated = true;
      }

      // ── Миграция: добавить поле family к расходам без него ──
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
    data.expenses.push({
      id: generateId(),
      date: exp.date,
      category: exp.category,
      description: exp.description,
      amount: exp.amount,
      user: exp.user || '',
      family: f,
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
export function getCategoryExpenses(category, month = null, year = null, familyId, userName = null) {
  const f = fam(familyId);
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return data.expenses
    .filter(exp => {
      const [, em, ey] = exp.date.split('.').map(Number);
      if (fam(exp.family) !== f) return false;
      if (exp.category !== category) return false;
      if (em !== m || ey !== y) return false;
      if (userName && exp.user !== userName) return false;
      return true;
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

// ─── Daily Feed ───────────────────────────────────────────────────────────────

export function getTodayFeed(familyId, localDateStr) {
  const f = fam(familyId);
  const prefix = localDateStr || new Date().toISOString().slice(0, 10);
  const entries = (data.expenses || [])
    .filter(e => fam(e.family) === f && e.createdAt && e.createdAt.startsWith(prefix))
    .map(({ id, date, category, description, amount, user, createdAt }) => ({
      type: 'expense', id, date, category, description, amount, user, createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { entries };
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

// ─── User management ──────────────────────────────────────────────────────────

/** Найти пользователя по логину (включая пароль — для авторизации) */
export function getUserByLogin(login) {
  return (data.users || []).find(u => u.login === login) || null;
}

/** Статистика по каждому пользователю: количество записей и дата последней */
export function getUserStats(month, year) {
  // DD.MM.YYYY (with possible missing leading zeros) → YYYYMMDD for correct sort
  const toSortKey = (d) => {
    const [dd, mm, yyyy] = d.split('.');
    return `${yyyy}${mm.padStart(2,'0')}${dd.padStart(2,'0')}`;
  };

  const mm = month ? String(month).padStart(2, '0') : null;
  const yyyy = year ? String(year) : null;

  return (data.users || []).map(u => {
    const familyId = u.family || 'family1';
    const allExp = (data.expenses || []).filter(
      e => e.user === u.name && fam(e.family) === fam(familyId)
    );
    // Filter to selected month if provided; keep all for lastDate
    const periodExp = mm && yyyy
      ? allExp.filter(e => {
          const parts = e.date.split('.');
          return parts[1]?.padStart(2,'0') === mm && parts[2] === yyyy;
        })
      : allExp;
    const lastExp = [...allExp].sort((a, b) => toSortKey(b.date).localeCompare(toSortKey(a.date)))[0];
    return {
      name: u.name,
      login: u.login,
      family: familyId,
      isAdmin: u.isAdmin || false,
      isGoogle: !!u.googleId,
      expenseCount: periodExp.length,
      lastDate: lastExp ? lastExp.date.split('.').map((p,i) => i<2 ? p.padStart(2,'0') : p).join('.') : null,
    };
  });
}

/** Список всех пользователей без паролей */
export function getUsers() {
  return (data.users || []).map(({ password: _p, ...u }) => u);
}

/** Создать нового пользователя */
export async function addUser({ login, password, name, family, isAdmin = false }) {
  if (!data.users) data.users = [];
  if (data.users.find(u => u.login === login)) {
    throw new Error('Логин уже занят');
  }
  const user = {
    login: login.trim(),
    password,
    name: name.trim(),
    family: (family || 'family1').trim(),
    isAdmin,
  };
  data.users.push(user);
  debouncedSave();
  const { password: _p, ...safe } = user;
  return safe;
}

/** Обновить данные пользователя */
export async function updateUser(login, { password, name, family }) {
  const user = (data.users || []).find(u => u.login === login);
  if (!user) return null;
  if (password) user.password = password;
  if (name)     user.name = name.trim();
  if (family)   user.family = family.trim();
  debouncedSave();
  const { password: _p, ...safe } = user;
  return safe;
}

/** Удалить пользователя */
export async function deleteUser(login) {
  if (!data.users) return null;
  const idx = data.users.findIndex(u => u.login === login);
  if (idx === -1) return null;
  const [deleted] = data.users.splice(idx, 1);
  debouncedSave();
  return deleted;
}

export function getUserByGoogleId(googleId) {
  return (data.users || []).find(u => u.googleId === googleId) || null;
}

export async function createGoogleUser({ googleId, email, name, picture }) {
  if (!data.users) data.users = [];
  const familyId = 'fam_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const user = {
    login: `g_${googleId}`,
    googleId,
    email,
    name: name || email.split('@')[0],
    picture: picture || '',
    family: familyId,
    isAdmin: false,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  debouncedSave();
  return user;
}

export async function updateUserFamily(login, familyId) {
  const user = (data.users || []).find(u => u.login === login);
  if (!user) return null;
  user.family = familyId;
  debouncedSave();
  return user;
}

export function createInvite(familyId, createdBy) {
  if (!data.invites) data.invites = {};
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (data.invites[code]);
  data.invites[code] = { family: familyId, createdBy, expiresAt: Date.now() + 48 * 60 * 60 * 1000 };
  debouncedSave();
  return code;
}

export function getInvite(code) {
  const invite = (data.invites || {})[code?.toUpperCase()];
  if (!invite || invite.expiresAt < Date.now()) return null;
  return invite;
}

export function consumeInvite(code) {
  if (data.invites?.[code?.toUpperCase()]) {
    delete data.invites[code.toUpperCase()];
    debouncedSave();
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
