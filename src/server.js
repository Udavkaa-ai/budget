import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { config } from './config.js';
import {
  loadData,
  appendExpenses,
  getTodaySummary,
  getFamilyDay,
  getFamilyToday,
  getFamilySummary,
  getChartData,
  exportCSV,
  importFromCSV,
  getSettings,
  updateSetting,
  toggleExpenseFixed,
  retagFixedExpenses,
  getCategoryExpenses,
  getExpensesForMonth,
  deleteExpense,
  flushData,
  getGoals,
  addGoal,
  contributeToGoal,
  deleteGoal,
  getBudgetPlan,
  saveBudgetPlan,
  getCashflow,
  saveCashflow,
  getMonthDailyTotals,
  getUserByLogin,
  getUsers,
  addUser,
  updateUser,
  deleteUser,
  getFamilyBudgetSettings,
  saveFamilyBudgetSettings,
  getUserByGoogleId,
  createGoogleUser,
  updateUserFamily,
  createInvite,
  getInvite,
  consumeInvite,
} from './storage.js';
import { parseExpenses, parseImageExpenses, analyzeFinances, CATEGORIES } from './parser.js';
import { generateChartImage } from './chart.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  // Явно указываем транспорты для надёжной работы за Railway-прокси
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.json({ limit: '12mb' }));

// Health check для Railway (должен отвечать до загрузки статики)
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(express.static(join(__dirname, '../public')));

// ─── JWT Auth Middleware ───────────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: 'Недействительный токен' });
  }
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

app.post('/api/auth/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  const user = getUserByLogin(login);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = jwt.sign(
    { login: user.login, name: user.name, family: user.family || 'family1', isAdmin: user.isAdmin || false },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  res.json({ token, name: user.name, login: user.login, isAdmin: user.isAdmin || false });
});

// Public endpoint — tells frontend which auth providers are available
app.get('/api/auth/providers', (_req, res) => {
  res.json({
    google: !!config.googleClientId,
    googleClientId: config.googleClientId || null,
  });
});

// Google OAuth — verifies Google ID token, creates/finds user, returns JWT
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Нет токена' });
  if (!config.googleClientId) return res.status(503).json({ error: 'Google OAuth не настроен' });

  try {
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    const payload = await verifyRes.json();

    if (!verifyRes.ok || payload.error) {
      return res.status(401).json({ error: 'Неверный токен Google' });
    }
    if (payload.aud !== config.googleClientId) {
      return res.status(401).json({ error: 'Неверный client_id' });
    }

    const { sub: googleId, email, name, picture } = payload;

    let user = getUserByGoogleId(googleId);
    if (!user) {
      user = await createGoogleUser({ googleId, email, name, picture });
    }

    const token = jwt.sign(
      { login: user.login, name: user.name, family: user.family, isAdmin: user.isAdmin || false },
      config.jwtSecret,
      { expiresIn: '90d' }
    );

    res.json({ token, name: user.name, login: user.login, isAdmin: user.isAdmin || false });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Ошибка авторизации' });
  }
});

// Create invite link (auth required)
app.post('/api/invite', authMiddleware, (req, res) => {
  const code = createInvite(req.user.family, req.user.login);
  const origin = req.headers.origin || `https://${req.headers.host}`;
  res.json({ code, link: `${origin}/?invite=${code}` });
});

// Join family via invite code (auth required)
app.post('/api/invite/join', authMiddleware, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Нет кода' });

  const invite = getInvite(code);
  if (!invite) return res.status(400).json({ error: 'Код неверный или устарел' });
  if (invite.family === req.user.family) {
    return res.status(400).json({ error: 'Вы уже в этой семье' });
  }

  const user = await updateUserFamily(req.user.login, invite.family);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  consumeInvite(code);
  io.to(invite.family).emit('family:joined', { name: user.name });

  const token = jwt.sign(
    { login: user.login, name: user.name, family: user.family, isAdmin: false },
    config.jwtSecret,
    { expiresIn: '90d' }
  );

  res.json({ token, name: user.name, login: user.login, isAdmin: false });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ name: req.user.name, login: req.user.login, isAdmin: req.user.isAdmin || false });
});

// Список пользователей в той же семье (для фильтров и партнёрских меток)
app.get('/api/users', authMiddleware, (req, res) => {
  const users = getUsers().filter(u => (u.family || 'family1') === req.user.family);
  res.json(users);
});

// ─── Expense Routes ───────────────────────────────────────────────────────────

// Добавить расходы (один или несколько)
app.post('/api/expenses', authMiddleware, async (req, res) => {
  const { expenses } = req.body || {};
  if (!Array.isArray(expenses) || expenses.length === 0) {
    return res.status(400).json({ error: 'Пустой список расходов' });
  }

  const withUser = expenses.map(e => ({ ...e, user: req.user.name }));
  await appendExpenses(withUser, req.user.family);

  // Уведомляем только пользователей той же семьи
  io.to(req.user.family).emit('expense:added', { expenses: withUser, by: req.user.name });

  res.json({ ok: true, count: withUser.length });
});

// Удалить расход
app.delete('/api/expenses/:id', authMiddleware, async (req, res) => {
  const deleted = await deleteExpense(req.params.id, req.user.family);
  if (!deleted) return res.status(404).json({ error: 'Не найдено' });

  io.to(req.user.family).emit('expense:deleted', { id: req.params.id, by: req.user.name });
  res.json({ ok: true });
});

// Переключить isFixed
app.post('/api/expenses/:id/toggle-fixed', authMiddleware, async (req, res) => {
  const result = await toggleExpenseFixed(req.params.id, req.user.family);
  if (result === null) return res.status(404).json({ error: 'Не найдено' });

  io.to(req.user.family).emit('expense:updated', { id: req.params.id, isFixed: result, by: req.user.name });
  res.json({ ok: true, isFixed: result });
});

// ─── View Routes ──────────────────────────────────────────────────────────────

// Мои расходы сегодня
app.get('/api/expenses/today', authMiddleware, (req, res) => {
  res.json(getTodaySummary(req.user.name, req.user.family));
});

// Расходы семьи за день
app.get('/api/expenses/family', authMiddleware, (req, res) => {
  const { date } = req.query;
  if (date) {
    res.json(getFamilyDay(date, req.user.family));
  } else {
    res.json(getFamilyToday(req.user.family));
  }
});

// Расходы за месяц (список)
app.get('/api/expenses/month', authMiddleware, (req, res) => {
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  res.json(getExpensesForMonth(month, year, req.user.family));
});

// Расходы по категории
app.get('/api/expenses/category/:cat', authMiddleware, (req, res) => {
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  res.json(getCategoryExpenses(req.params.cat, month, year, req.user.family));
});

// Сводка за месяц (статистика)
app.get('/api/summary', authMiddleware, (req, res) => {
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  const excludeFixed = req.query.excludeFixed === 'true';
  res.json(getFamilySummary(month, year, excludeFixed, req.user.family));
});

// Данные для диаграммы (PNG)
app.get('/api/chart', authMiddleware, async (req, res) => {
  try {
    const month = req.query.month ? parseInt(req.query.month) : null;
    const year = req.query.year ? parseInt(req.query.year) : null;
    const excludeFixed = req.query.excludeFixed === 'true';

    const img = await generateChartImage(month, year, excludeFixed, req.user.family);
    if (!img) return res.status(404).json({ error: 'Нет данных для диаграммы' });

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    res.send(img);
  } catch (err) {
    console.error('Chart error:', err);
    res.status(500).json({ error: 'Ошибка генерации диаграммы' });
  }
});

// Экспорт CSV
app.get('/api/export', authMiddleware, (req, res) => {
  const csv = exportCSV(req.user.family);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="expenses-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM для Excel
});

// Импорт CSV
app.post('/api/import', authMiddleware, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv?.trim()) return res.status(400).json({ error: 'Пустой CSV' });

  try {
    const result = await importFromCSV(csv, req.user.family);
    io.to(req.user.family).emit('expense:added', { expenses: [], by: req.user.name });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Ошибка импорта: ' + err.message });
  }
});

// ─── Settings Routes ──────────────────────────────────────────────────────────

app.get('/api/settings', authMiddleware, (req, res) => {
  const budget = getFamilyBudgetSettings(req.user.family);
  res.json({
    ...getSettings(req.user.family),
    categories: CATEGORIES,
    plannedMonthly:    budget.plannedMonthly,
    plannedFixed:      budget.plannedFixed,
    fixedExpensesDay:  budget.fixedExpensesDay,
    fixedExpensesList: budget.fixedExpensesList,
  });
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Не указан ключ настройки' });

  await updateSetting(key, value, req.user.family);
  io.to(req.user.family).emit('settings:updated', { key, value, by: req.user.name });
  res.json({ ok: true });
});

// Перепометить постоянные расходы
app.post('/api/settings/retag', authMiddleware, async (req, res) => {
  const count = await retagFixedExpenses(req.user.family);
  io.to(req.user.family).emit('expense:retagged', { count, by: req.user.name });
  res.json({ ok: true, count });
});

// Семья редактирует свой список постоянных расходов (без прав администратора)
app.put('/api/family-budget/fixed-expenses', authMiddleware, async (req, res) => {
  const { fixedExpensesList } = req.body || {};
  if (!Array.isArray(fixedExpensesList)) {
    return res.status(400).json({ error: 'Неверный формат данных' });
  }
  await saveFamilyBudgetSettings(req.user.family, { fixedExpensesList });
  io.to(req.user.family).emit('settings:updated', { by: req.user.name });
  res.json({ ok: true });
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

function adminMiddleware(req, res, next) {
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Нет доступа' });
  next();
}

// Список всех пользователей (без паролей)
app.get('/api/admin/users', authMiddleware, adminMiddleware, (_req, res) => {
  res.json(getUsers());
});

// Создать пользователя
app.post('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  const { login, password, name, family } = req.body || {};
  if (!login?.trim() || !password?.trim() || !name?.trim()) {
    return res.status(400).json({ error: 'Укажите логин, пароль и имя' });
  }
  try {
    const user = await addUser({ login, password, name, family });
    res.json({ ok: true, user });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Обновить пользователя (пароль, имя, семья)
app.patch('/api/admin/users/:login', authMiddleware, adminMiddleware, async (req, res) => {
  const { password, name, family } = req.body || {};
  const updated = await updateUser(req.params.login, { password, name, family });
  if (!updated) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ ok: true, user: updated });
});

// Удалить пользователя
app.delete('/api/admin/users/:login', authMiddleware, adminMiddleware, async (req, res) => {
  if (req.params.login === req.user.login) {
    return res.status(400).json({ error: 'Нельзя удалить себя' });
  }
  const deleted = await deleteUser(req.params.login);
  if (!deleted) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ ok: true });
});

// Принудительное обновление всех клиентов (или только одной семьи)
app.post('/api/admin/force-update', authMiddleware, adminMiddleware, (req, res) => {
  io.emit('app:update');
  console.log(`🔄 Принудительное обновление инициировано пользователем ${req.user.name}`);
  res.json({ ok: true });
});

// Бюджетные настройки конкретной группы (семьи)
app.get('/api/admin/family-settings/:familyId', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getFamilyBudgetSettings(req.params.familyId));
});

app.put('/api/admin/family-settings/:familyId', authMiddleware, adminMiddleware, async (req, res) => {
  const { plannedMonthly, plannedFixed, fixedExpensesDay, fixedExpensesList } = req.body || {};
  await saveFamilyBudgetSettings(req.params.familyId, {
    plannedMonthly:    plannedMonthly    !== undefined ? Number(plannedMonthly)    : undefined,
    plannedFixed:      plannedFixed      !== undefined ? Number(plannedFixed)      : undefined,
    fixedExpensesDay:  fixedExpensesDay  !== undefined ? Number(fixedExpensesDay)  : undefined,
    fixedExpensesList: fixedExpensesList,
  });
  res.json({ ok: true });
});

// ─── Goals Routes ─────────────────────────────────────────────────────────────

app.get('/api/goals', authMiddleware, (req, res) => {
  res.json(getGoals(req.user.family));
});

app.post('/api/goals', authMiddleware, async (req, res) => {
  const { name, targetAmount, emoji } = req.body || {};
  if (!name?.trim() || !targetAmount || targetAmount <= 0) {
    return res.status(400).json({ error: 'Укажите название и сумму цели' });
  }
  const goal = await addGoal({ name: name.trim(), targetAmount, emoji, createdBy: req.user.name, familyId: req.user.family });
  io.to(req.user.family).emit('goals:updated');
  res.json({ ok: true, goal });
});

app.post('/api/goals/:id/contribute', authMiddleware, async (req, res) => {
  const { amount } = req.body || {};
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму' });
  const goal = await contributeToGoal(req.params.id, req.user.name, amount, req.user.family);
  if (!goal) return res.status(404).json({ error: 'Цель не найдена' });
  io.to(req.user.family).emit('goals:updated');
  res.json({ ok: true, goal });
});

app.delete('/api/goals/:id', authMiddleware, async (req, res) => {
  const deleted = await deleteGoal(req.params.id, req.user.family);
  if (!deleted) return res.status(404).json({ error: 'Цель не найдена' });
  io.to(req.user.family).emit('goals:updated');
  res.json({ ok: true });
});

// ─── Budget Plan Routes ────────────────────────────────────────────────────────

app.get('/api/budget-plan', authMiddleware, (req, res) => {
  res.json(getBudgetPlan(req.user.family));
});

app.put('/api/budget-plan', authMiddleware, async (req, res) => {
  await saveBudgetPlan(req.body, req.user.family);
  io.to(req.user.family).emit('budget-plan:updated');
  res.json({ ok: true });
});

// ─── Cashflow Routes ──────────────────────────────────────────────────────────

app.get('/api/cashflow/:ym', authMiddleware, (req, res) => {
  res.json(getCashflow(req.params.ym, req.user.family));
});

app.put('/api/cashflow/:ym', authMiddleware, async (req, res) => {
  await saveCashflow(req.params.ym, req.body, req.user.family);
  res.json({ ok: true });
});

app.get('/api/cashflow-chart/:ym', authMiddleware, async (req, res) => {
  const { ym } = req.params;
  const [yearStr, monthStr] = ym.split('-');
  const year = parseInt(yearStr), month = parseInt(monthStr);

  const cf = getCashflow(ym, req.user.family);
  const startBalance = (cf.debit || 0) + (cf.credit || 0) + (cf.cash || 0);
  if (!startBalance && !Object.keys(cf.incomeDays || {}).length) {
    return res.status(400).json({ error: 'Нет данных баланса. Заполните поля и сохраните.' });
  }

  const dailyTotals = getMonthDailyTotals(month, year, req.user.family);
  const incomeDays = cf.incomeDays || {};

  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const lastDay = isCurrentMonth
    ? now.getDate() - 1
    : new Date(year, month, 0).getDate();

  if (lastDay < 1) {
    return res.status(400).json({ error: 'Нет завершённых дней для отображения' });
  }

  const labels = [], balances = [];
  let balance = startBalance;

  for (let d = 1; d <= lastDay; d++) {
    const dd = String(d).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    const dayKey = `${dd}.${mm}.${year}`;

    if (incomeDays[String(d)]) balance += incomeDays[String(d)];
    balance -= (dailyTotals[dayKey] || 0);

    labels.push(String(d));
    balances.push(Math.round(balance));
  }

  const minBal = Math.min(...balances);
  const maxBal = Math.max(...balances);

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: balances,
        borderColor: minBal < 0 ? '#ef4444' : '#4f46e5',
        backgroundColor: minBal < 0 ? 'rgba(239,68,68,0.08)' : 'rgba(79,70,229,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: labels.length > 20 ? 2 : 4,
        pointBackgroundColor: balances.map(v => v < 0 ? '#ef4444' : '#4f46e5'),
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: {
          ticks: { callback: 'function(v){return (v/1000).toFixed(0)+"к ₽";}' },
          suggestedMin: minBal < 0 ? minBal * 1.1 : 0,
        },
      },
    },
  };

  const url = `https://quickchart.io/chart?w=700&h=280&bkg=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  try {
    const imgRes = await fetch(url);
    if (!imgRes.ok) throw new Error('QuickChart error');
    res.set('Content-Type', 'image/png').set('Cache-Control', 'no-cache');
    res.send(Buffer.from(await imgRes.arrayBuffer()));
  } catch {
    res.status(500).json({ error: 'Ошибка генерации графика' });
  }
});

// ─── Unified Chart Data ───────────────────────────────────────────────────────

app.get('/api/unified-chart-data/:ym', authMiddleware, (req, res) => {
  const { ym } = req.params;
  const [yearStr, monthStr] = ym.split('-');
  const year = parseInt(yearStr), month = parseInt(monthStr);
  if (isNaN(month) || isNaN(year)) return res.status(400).json({ error: 'Неверный формат месяца' });

  const excludeFixed = req.query.excludeFixed === 'true';
  const family = req.user.family;

  // Expense data: per user per day, starting from day 1
  const chartData = getChartData(month, year, 1, excludeFixed, family);

  // Cashflow data
  const cf = getCashflow(ym, family);
  const startBalance = (cf.debit || 0) + (cf.credit || 0) + (cf.cash || 0);
  const incomeDays = cf.incomeDays || {};
  const hasBalance = startBalance > 0 || Object.keys(incomeDays).length > 0;

  // Days to show: 1 through yesterday (current month) or full month
  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const lastDay = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate();

  // Labels: 1..lastDay
  const labels = [];
  for (let d = 1; d <= lastDay; d++) labels.push(String(d));

  // Rebuild per-user expense arrays aligned to labels (chartData may have different range)
  const userExpenses = {};
  for (const [user, amounts] of Object.entries(chartData.userExpenses || {})) {
    // chartData was built with startDay=1, so amounts are aligned 1..lastDay already
    userExpenses[user] = labels.map((d, i) => amounts[i] || 0);
  }

  // Balance line
  let balanceLine = null;
  if (hasBalance) {
    const dailyTotals = getMonthDailyTotals(month, year, family);
    balanceLine = [];
    let balance = startBalance;
    for (let d = 1; d <= lastDay; d++) {
      const dd = String(d).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      const dayKey = `${dd}.${mm}.${year}`;
      if (incomeDays[String(d)]) balance += incomeDays[String(d)];
      balance -= (dailyTotals[dayKey] || 0);
      balanceLine.push(Math.round(balance));
    }
  }

  res.json({
    labels,
    userExpenses,
    incomeDays,
    balanceLine,
    startBalance,
    hasBalance,
    monthName: chartData.monthName,
  });
});

// ─── AI Analyze Route ────────────────────────────────────────────────────────

app.post('/api/analyze', authMiddleware, async (req, res) => {
  if (!config.openRouterKey) {
    return res.status(503).json({ error: 'AI-анализ недоступен (нет API ключа)' });
  }

  const { month, year } = req.body || {};
  const now = new Date();
  const curMonth = parseInt(month) || (now.getMonth() + 1);
  const curYear  = parseInt(year)  || now.getFullYear();
  const family   = req.user.family;

  // Current month
  const cur     = getFamilySummary(curMonth, curYear, false, family);
  const curFix  = getFamilySummary(curMonth, curYear, true,  family);

  // Previous month
  const prevDate  = new Date(curYear, curMonth - 2, 1);
  const prev      = getFamilySummary(prevDate.getMonth() + 1, prevDate.getFullYear(), false, family);

  // Budget plan & settings
  const plan     = getBudgetPlan(family);
  const settings = getFamilyBudgetSettings(family);

  // Cashflow income (поступления по дням, баланс не используем)
  const ym      = `${curYear}-${String(curMonth).padStart(2, '0')}`;
  const cf      = getCashflow(ym, family);
  const totalInc = Object.values(cf.incomeDays || {}).reduce((s, v) => s + v, 0);

  // Days context
  const daysInMonth  = new Date(curYear, curMonth, 0).getDate();
  const isCurrentMon = curMonth === (now.getMonth() + 1) && curYear === now.getFullYear();
  const daysElapsed  = isCurrentMon ? now.getDate() : daysInMonth;

  // Format category rows
  const catLimits = plan.categoryBudgets || {};
  const catLines  = Object.entries(cur.byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => {
      const limit  = catLimits[cat];
      const limTxt = limit ? ` [лимит ${limit.toLocaleString('ru')} ₽${amt > limit ? ' — ⚠️ ПЕРЕРАСХОД' : ''}]` : '';
      const prevAmt = prev.byCategory[cat] || 0;
      const delta   = prevAmt ? ` (${amt > prevAmt ? '+' : ''}${((amt - prevAmt) / prevAmt * 100).toFixed(0)}% к прошлому мес.)` : '';
      return `  ${cat}: ${amt.toLocaleString('ru')} ₽${limTxt}${delta}`;
    }).join('\n');

  // Format per-person rows
  const incomes   = plan.userIncomes || {};
  const personLines = Object.entries(cur.byUser)
    .map(([name, data]) => {
      const inc    = incomes[name] || 0;
      const pct    = inc ? ` (${Math.round(data.total / inc * 100)}% дохода)` : '';
      const topCat = Object.entries(data.byCategory || {})
        .sort(([, a], [, b]) => b - a).slice(0, 3)
        .map(([c, a]) => `${c}: ${a.toLocaleString('ru')} ₽`).join(', ');
      return `  ${name}: ${data.total.toLocaleString('ru')} ₽${pct}\n    Топ: ${topCat}`;
    }).join('\n');

  // Previous month category summary
  const prevCatLines = Object.entries(prev.byCategory)
    .sort(([, a], [, b]) => b - a).slice(0, 8)
    .map(([c, a]) => `  ${c}: ${a.toLocaleString('ru')} ₽`).join('\n');

  // Fixed expenses
  const fixedList  = (settings.fixedExpensesList || []).map(f => `  ${f.name}: ${f.amount.toLocaleString('ru')} ₽`).join('\n');
  const fixedTotal = (settings.fixedExpensesList || []).reduce((s, f) => s + f.amount, 0);

  // Planned income total
  const plannedInc = Object.values(incomes).reduce((s, v) => s + v, 0) || settings.plannedMonthly || 0;

  // Build report text for the AI
  const reportText = `Семейный бюджет — ${cur.monthName}
Дней прошло: ${daysElapsed} из ${daysInMonth}${!isCurrentMon ? ' (месяц завершён)' : ''}

=== ДОХОДЫ ===
Запланировано: ${plannedInc.toLocaleString('ru')} ₽
${Object.entries(incomes).map(([n, v]) => `  ${n}: ${v.toLocaleString('ru')} ₽`).join('\n') || '  (не указаны)'}
=== РАСХОДЫ ${cur.monthName.toUpperCase()} ===
Итого: ${cur.total.toLocaleString('ru')} ₽${plannedInc ? ` (${Math.round(cur.total / plannedInc * 100)}% от дохода)` : ''}
Переменные: ${curFix.total.toLocaleString('ru')} ₽
Постоянные/обязательные: ${(cur.total - curFix.total).toLocaleString('ru')} ₽
${cur.total > 0 ? `\nПо категориям:\n${catLines}` : ''}
${Object.keys(cur.byUser).length > 0 ? `\nПо участникам:\n${personLines}` : ''}

=== ПРОШЛЫЙ МЕСЯЦ (${prev.monthName}) ===
Итого: ${prev.total.toLocaleString('ru')} ₽${prev.total && cur.total ? ` (${cur.total > prev.total ? '+' : ''}${((cur.total - prev.total) / prev.total * 100).toFixed(0)}% к прошлому)` : ''}
${prev.total > 0 ? `По категориям:\n${prevCatLines}` : '(нет данных)'}

=== ОБЯЗАТЕЛЬНЫЕ ЕЖЕМЕСЯЧНЫЕ РАСХОДЫ ===
${fixedList || '  (не указаны)'}
Итого постоянных: ${fixedTotal.toLocaleString('ru')} ₽

=== ПЛАН/ЛИМИТЫ ===
Плановые расходы на месяц: ${(settings.plannedMonthly || 0).toLocaleString('ru')} ₽
Лимиты по категориям: ${Object.keys(catLimits).length ? Object.entries(catLimits).map(([c, v]) => `${c}: ${v.toLocaleString('ru')} ₽`).join(', ') : 'не заданы'}`;

  try {
    const result = await analyzeFinances(reportText);
    if (result.error) return res.status(502).json({ error: result.error });
    res.json({ report: result.report, model: result.model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Parse Route ───────────────────────────────────────────────────────────

app.post('/api/parse', authMiddleware, async (req, res) => {
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'Пустой текст' });

  if (!config.openRouterKey) {
    return res.status(503).json({ error: 'AI-парсинг недоступен (нет API ключа)' });
  }

  try {
    const result = await parseExpenses(text);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Парсинг изображений (банковские уведомления, чеки, скриншоты)
app.post('/api/parse-image', authMiddleware, async (req, res) => {
  const { base64, mimeType } = req.body || {};
  if (!base64) return res.status(400).json({ error: 'Нет изображения' });
  if (!config.openRouterKey) return res.status(503).json({ error: 'AI недоступен' });

  // Ограничение размера ~4MB base64
  if (base64.length > 5_500_000) {
    return res.status(413).json({ error: 'Изображение слишком большое (макс. 4 МБ)' });
  }

  try {
    const result = await parseImageExpenses(base64, mimeType || 'image/jpeg');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Socket.io Auth ───────────────────────────────────────────────────────────

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Не авторизован'));
  try {
    socket.user = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    next(new Error('Недействительный токен'));
  }
});

io.on('connection', (socket) => {
  const family = socket.user.family || 'family1';
  socket.join(family);
  console.log(`🔌 ${socket.user.name} [${family}] подключился`);
  socket.on('disconnect', () => {
    console.log(`🔌 ${socket.user.name} [${family}] отключился`);
  });
});

// ─── In-app Reminders ─────────────────────────────────────────────────────────

let lastReminderDate = null;

function getMoscowTime() {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      hour: 'numeric', minute: 'numeric',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour12: false,
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  return {
    hours: parseInt(parts.hour, 10),
    minutes: parseInt(parts.minute, 10),
    today: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function checkReminder() {
  if (!config.remindersEnabled) return;

  const { hours, minutes, today } = getMoscowTime();

  // Окно ±1 минута на случай небольших задержек сервера
  if (
    hours === config.reminderHour &&
    minutes >= config.reminderMinute &&
    minutes <= config.reminderMinute + 1 &&
    lastReminderDate !== today
  ) {
    lastReminderDate = today;
    // Отправляем напоминание каждой семье отдельно
    const families = [...new Set(config.webUsers.map(u => u.family || 'family1'))];
    for (const fid of families) {
      const familyToday = getFamilyToday(fid);
      io.to(fid).emit('reminder', {
        total: familyToday.total,
        byUser: familyToday.byUser,
      });
    }
    console.log('📨 Напоминание отправлено в приложение');
  }
}

setInterval(checkReminder, 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await loadData();

  // '0.0.0.0' обязательно для Railway — слушаем на всех интерфейсах
  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`🌐 Запущено на порту ${config.port}`);
    console.log(`⏰ Напоминания: ${config.reminderHour}:${String(config.reminderMinute).padStart(2, '0')} MSK`);
  });
}

process.on('SIGINT', async () => {
  await flushData();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await flushData();
  process.exit(0);
});

start();
