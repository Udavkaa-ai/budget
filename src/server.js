import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import webpush from 'web-push';
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
  getCategoryExpenses,
  getExpensesForMonth,
  updateExpense,
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
  getUserStats,
  addUser,
  updateUser,
  deleteUser,
  getTodayFeed,
  getDayExpenses,
  getFamilyBudgetSettings,
  saveFamilyBudgetSettings,
  getUserByGoogleId,
  createGoogleUser,
  updateUserFamily,
  createInvite,
  getInvite,
  consumeInvite,
  getOrCreateVapidKeys,
  savePushSubscription,
  removePushSubscription,
  removeUserPushSubscriptions,
  getFamilyPushSubscriptions,
  getUserPushEnabled,
  setUserPushEnabled,
  getAllFamilyExpenses,
} from './storage.js';
import { parseExpenses, parseImageExpenses, analyzeFinances, CATEGORIES } from './parser.js';
import { generateChartImage } from './chart.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
// За Railway-прокси req.protocol иначе будет 'http', а Google OAuth требует
// точного совпадения https-адреса в redirect_uri
app.set('trust proxy', true);
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

// Mobile OAuth: open in WebView, redirect back with JWT in query string
app.get('/auth/google/mobile', async (req, res) => {
  const { redirect } = req.query;
  // Store redirect URI in session-like param (passed through Google state param)
  if (!config.googleClientId) return res.status(503).send('Google OAuth не настроен');
  const state = encodeURIComponent(redirect || 'familybudget://auth');
  const callbackUrl = encodeURIComponent(`${req.protocol}://${req.headers.host}/auth/google/mobile/callback`);
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${config.googleClientId}&redirect_uri=${callbackUrl}&response_type=code&scope=openid%20email%20profile&state=${state}`;
  res.redirect(url);
});

app.get('/auth/google/mobile/callback', async (req, res) => {
  const { code, state } = req.query;
  const redirectUri = decodeURIComponent(state || 'familybudget://auth');
  // Exchange code for id_token using server-side client secret
  // (requires GOOGLE_CLIENT_SECRET env var — same as web OAuth)
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: config.googleClientId,
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: `${req.protocol}://${req.headers.host}/auth/google/mobile/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.id_token) throw new Error('no id_token');

    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`);
    const payload = await verifyRes.json();
    const { sub: googleId, email, name, picture } = payload;

    let user = getUserByGoogleId(googleId);
    if (!user) user = await createGoogleUser({ googleId, email, name, picture });

    const appToken = jwt.sign(
      { login: user.login, name: user.name, family: user.family, isAdmin: user.isAdmin || false },
      config.jwtSecret, { expiresIn: '90d' }
    );
    res.redirect(`${redirectUri}?token=${encodeURIComponent(appToken)}`);
  } catch (err) {
    console.error('Mobile OAuth callback error:', err);
    res.redirect(`${redirectUri}?error=auth_failed`);
  }
});

// Crowd dictionary endpoints (k-anonymity: only words seen from ≥20 families)
const crowdDict = {}; // in-memory for now; persist to data file in production
const crowdContrib = {}; // word -> Set of family IDs

app.get('/api/crowd/dictionary', (_req, res) => {
  res.json(crowdDict);
});

app.post('/api/crowd/contribute', authMiddleware, (req, res) => {
  const { pairs } = req.body || {};
  if (!Array.isArray(pairs)) return res.json({ ok: false });
  for (const { w, c } of pairs) {
    if (typeof w !== 'string' || typeof c !== 'string') continue;
    if (!crowdContrib[w]) crowdContrib[w] = new Set();
    crowdContrib[w].add(req.user.family);
    if (crowdContrib[w].size >= 3) crowdDict[w] = c; // k-anonymity threshold
  }
  res.json({ ok: true });
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

  // Web Push — отправляем другим участникам семьи у которых включены уведомления
  const subs = getFamilyPushSubscriptions(req.user.family, req.user.name)
    .filter(s => getUserPushEnabled(s.userId, req.user.family));
  if (subs.length) {
    const total = withUser.reduce((s, e) => s + (e.amount || 0), 0);
    const desc = withUser.length === 1
      ? (withUser[0].description || withUser[0].category)
      : `${withUser.length} расхода(ов)`;
    sendPushToSubscriptions(subs, {
      title: `💸 ${req.user.name} добавил расход`,
      body: `${desc} — ${total.toLocaleString('ru')} ₽`,
      url: '/',
    }).catch(() => {});
  }

  res.json({ ok: true, count: withUser.length });
});

// Редактировать расход
app.put('/api/expenses/:id', authMiddleware, async (req, res) => {
  const { date, category, amount, description } = req.body || {};
  const updated = await updateExpense(req.params.id, { date, category, amount, description }, req.user.family);
  if (!updated) return res.status(404).json({ error: 'Не найдено' });
  io.to(req.user.family).emit('expense:updated', { id: req.params.id, by: req.user.name });
  res.json({ ok: true, expense: updated });
});

// Удалить расход
app.delete('/api/expenses/:id', authMiddleware, async (req, res) => {
  const deleted = await deleteExpense(req.params.id, req.user.family);
  if (!deleted) return res.status(404).json({ error: 'Не найдено' });

  io.to(req.user.family).emit('expense:deleted', { id: req.params.id, by: req.user.name });
  res.json({ ok: true });
});

// ─── Push Notifications ───────────────────────────────────────────────────────

async function sendPushToSubscriptions(subscriptions, payload) {
  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(sub, JSON.stringify(payload)).catch(err => {
        // 410 Gone — подписка протухла, удаляем
        if (err.statusCode === 410) removePushSubscription(sub.endpoint, sub.family);
        throw err;
      })
    )
  );
  return results.filter(r => r.status === 'fulfilled').length;
}

app.get('/api/push/vapid-key', authMiddleware, (req, res) => {
  res.json({ publicKey: getOrCreateVapidKeys().publicKey });
});

app.post('/api/push/subscribe', authMiddleware, (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ error: 'Нет подписки' });
  savePushSubscription(subscription, req.user.name, req.user.family);
  res.json({ ok: true });
});

app.delete('/api/push/subscribe', authMiddleware, (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) removePushSubscription(endpoint, req.user.family);
  else removeUserPushSubscriptions(req.user.name, req.user.family);
  res.json({ ok: true });
});

app.get('/api/push/settings', authMiddleware, (req, res) => {
  res.json({ enabled: getUserPushEnabled(req.user.name, req.user.family) });
});

app.post('/api/push/settings', authMiddleware, (req, res) => {
  const { enabled } = req.body || {};
  setUserPushEnabled(req.user.name, req.user.family, !!enabled);
  if (!enabled) removeUserPushSubscriptions(req.user.name, req.user.family);
  res.json({ ok: true });
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

// Расходы за конкретный день по дате траты (date=YYYY-MM-DD, опц. user=...)
app.get('/api/expenses/day', authMiddleware, (req, res) => {
  const { date, user } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });
  const [y, m, d] = date.split('-');
  const dateKey = `${d}.${m}.${y}`;
  res.json(getDayExpenses(dateKey, req.user.family, user || null));
});

// Расходы по категории
app.get('/api/expenses/category/:cat', authMiddleware, (req, res) => {
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  const user = req.query.user || null;
  res.json(getCategoryExpenses(req.params.cat, month, year, req.user.family, user));
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

// Кандидаты для перекатегоризации в "Красота"
const BEAUTY_KEYWORDS = [
  'маникюр','педикюр','стрижк','косметик','парфюм','шампун','тушь','помад',
  'пудр','тональн','эпиляц','брови','ресниц','укладк','ботокс','лосьон',
  'скраб','сыворотк','макияж','мейкап','спа','крем','ногт','салон красот',
  'окраск волос','покраск волос','хайлайтер','консилер',
];

app.get('/api/beauty-candidates', authMiddleware, (req, res) => {
  const candidates = getAllFamilyExpenses(req.user.family)
    .filter(e => {
      if (e.category === 'Красота') return false;
      const desc = (e.description || '').toLowerCase();
      return BEAUTY_KEYWORDS.some(kw => desc.includes(kw));
    })
    .map(e => ({ id: e.id, date: e.date, category: e.category, amount: e.amount, description: e.description, user: e.user }))
    .sort((a, b) => b.date.localeCompare(a.date));
  res.json({ candidates });
});

app.post('/api/beauty-recategorize', authMiddleware, async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.json({ updated: 0 });
  let updated = 0;
  for (const id of ids) {
    const result = await updateExpense(id, { category: 'Красота' }, req.user.family);
    if (result) updated++;
  }
  if (updated > 0) io.to(req.user.family).emit('expense:updated', { by: req.user.name });
  res.json({ updated });
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
    plannedMonthly: budget.plannedMonthly,
  });
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Не указан ключ настройки' });

  await updateSetting(key, value, req.user.family);
  io.to(req.user.family).emit('settings:updated', { key, value, by: req.user.name });
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

// Статистика использования (только количество, без сумм)
app.get('/api/admin/stats', authMiddleware, adminMiddleware, (req, res) => {
  const now = new Date();
  const month = req.query.month ? parseInt(req.query.month) : now.getMonth() + 1;
  const year  = req.query.year  ? parseInt(req.query.year)  : now.getFullYear();
  const ym    = `${year}-${String(month).padStart(2, '0')}`;

  const stats   = getUserStats(month, year);
  const families = [...new Set(stats.map(u => u.family))];

  const familyIncome = {};
  for (const famId of families) {
    const cf = getCashflow(ym, famId);
    familyIncome[famId] = incomeDayTotal(cf.incomeDays);
  }

  res.json({ totalFamilies: families.length, totalUsers: stats.length, users: stats, familyIncome, month, year });
});

// Бюджетные настройки конкретной группы (семьи)
app.get('/api/admin/family-settings/:familyId', authMiddleware, adminMiddleware, (req, res) => {
  res.json(getFamilyBudgetSettings(req.params.familyId));
});

app.put('/api/admin/family-settings/:familyId', authMiddleware, adminMiddleware, async (req, res) => {
  const { plannedMonthly, familyName } = req.body || {};
  await saveFamilyBudgetSettings(req.params.familyId, {
    plannedMonthly: plannedMonthly !== undefined ? Number(plannedMonthly) : undefined,
    familyName:     familyName     !== undefined ? String(familyName)     : undefined,
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

// Sum balance across all members (new format) or fall back to old flat fields
function cfStartBalance(cf) {
  if (cf.members && Object.keys(cf.members).length > 0) {
    return Object.values(cf.members).reduce((s, m) => s + (m.debit||0) + (m.credit||0) + (m.savings||0), 0);
  }
  return (cf.debit||0) + (cf.credit||0) + (cf.cash||0);
}

// Normalize incomeDays to { "day": totalAmount } dict (supports both old dict and new array format)
function incomeDayTotals(incomeDays) {
  if (Array.isArray(incomeDays)) {
    const totals = {};
    for (const e of incomeDays) {
      const d = parseInt(e.day);
      if (!d || d < 1 || d > 31) continue;
      const dk = String(d);
      totals[dk] = (totals[dk] || 0) + (e.amount || 0);
    }
    return totals;
  }
  return incomeDays || {};
}

// Total income for the month
function incomeDayTotal(incomeDays) {
  if (Array.isArray(incomeDays)) {
    return incomeDays.reduce((s, e) => s + (e.amount || 0), 0);
  }
  return Object.values(incomeDays || {}).reduce((s, v) => s + v, 0);
}

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
  const startBalance = cfStartBalance(cf);
  const incomeDays = incomeDayTotals(cf.incomeDays);
  if (!startBalance && !Object.keys(incomeDays).length) {
    return res.status(400).json({ error: 'Нет данных баланса. Заполните поля и сохраните.' });
  }

  const dailyTotals = getMonthDailyTotals(month, year, req.user.family);

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

// ─── Daily Feed ───────────────────────────────────────────────────────────────

app.get('/api/feed/today', authMiddleware, (req, res) => {
  res.json(getTodayFeed(req.user.family, req.query.date));
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
  const startBalance = cfStartBalance(cf);
  const incomeDays = incomeDayTotals(cf.incomeDays);
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

  // Two months ago
  const prev2Date = new Date(curYear, curMonth - 3, 1);
  const prev2     = getFamilySummary(prev2Date.getMonth() + 1, prev2Date.getFullYear(), false, family);

  // Budget plan & settings
  const plan     = getBudgetPlan(family);
  const settings = getFamilyBudgetSettings(family);

  // Cashflow income (поступления по дням, баланс не используем)
  const ym      = `${curYear}-${String(curMonth).padStart(2, '0')}`;
  const cf      = getCashflow(ym, family);
  const totalInc = incomeDayTotal(cf.incomeDays);

  // Days context
  const daysInMonth  = new Date(curYear, curMonth, 0).getDate();
  const isCurrentMon = curMonth === (now.getMonth() + 1) && curYear === now.getFullYear();
  const daysElapsed  = isCurrentMon ? now.getDate() : daysInMonth;

  // Format category rows
  const catLimits = plan.categoryBudgets || {};
  const catLines  = Object.entries(cur.byCategory)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, amt]) => {
      const limit     = catLimits[cat];
      const limTxt    = limit ? ` [лимит ${limit.toLocaleString('ru')} ₽${amt > limit ? ` — ⚠️ ПЕРЕРАСХОД +${(amt - limit).toLocaleString('ru')} ₽` : ''}]` : '';
      const prevAmt   = prev.byCategory[cat] || 0;
      const prev2Amt  = prev2.byCategory[cat] || 0;
      const d1 = prevAmt  ? ` ${prevAmt.toLocaleString('ru')}→${amt.toLocaleString('ru')}` : '';
      const d2 = prev2Amt ? `(${prev2Amt.toLocaleString('ru')}→` : '';
      const trend = prev2Amt && prevAmt
        ? ` [тренд: ${prev2Amt.toLocaleString('ru')}→${prevAmt.toLocaleString('ru')}→${amt.toLocaleString('ru')}]`
        : prevAmt ? ` [vs прошлый: ${prevAmt > 0 ? `${amt > prevAmt ? '+' : ''}${((amt - prevAmt) / prevAmt * 100).toFixed(0)}%` : 'новая'}]` : '';
      return `  ${cat}: ${amt.toLocaleString('ru')} ₽${limTxt}${trend}`;
    }).join('\n');

  // Format per-person rows with overspend detail
  const incomes   = plan.userIncomes || {};
  const familyTotalIncome = Object.values(incomes).reduce((s, v) => s + v, 0);
  const personLines = Object.entries(cur.byUser)
    .map(([name, data]) => {
      const inc    = incomes[name] || 0;
      const pct    = inc ? ` (${Math.round(data.total / inc * 100)}% дохода)` : '';
      const topCat = Object.entries(data.byCategory || {})
        .sort(([, a], [, b]) => b - a).slice(0, 3)
        .map(([c, a]) => `${c}: ${a.toLocaleString('ru')} ₽`).join(', ');
      // Per-user overspend: categories where their spend > their proportional share of limit
      const overspendCats = Object.entries(data.byCategory || {})
        .filter(([cat, userAmt]) => {
          const lim = catLimits[cat];
          if (!lim) return false;
          const share = familyTotalIncome > 0 && inc > 0 ? lim * (inc / familyTotalIncome) : lim;
          return userAmt > share;
        })
        .map(([cat, userAmt]) => {
          const lim = catLimits[cat];
          const share = familyTotalIncome > 0 && inc > 0 ? lim * (inc / familyTotalIncome) : lim;
          return `${cat} (+${(userAmt - share).toLocaleString('ru', { maximumFractionDigits: 0 })} ₽)`;
        }).join(', ');
      const prevPerson = prev.byUser[name];
      const prevTxt = prevPerson ? ` [прошлый мес: ${prevPerson.total.toLocaleString('ru')} ₽]` : '';
      return `  ${name}: ${data.total.toLocaleString('ru')} ₽${pct}${prevTxt}\n    Топ: ${topCat}${overspendCats ? `\n    ⚠️ Перерасход доли: ${overspendCats}` : ''}`;
    }).join('\n');

  // Previous month category summary with 2-month comparison
  const prevCatLines = Object.entries(prev.byCategory)
    .sort(([, a], [, b]) => b - a).slice(0, 10)
    .map(([c, a]) => {
      const p2 = prev2.byCategory[c];
      const trend = p2 ? ` (${a > p2 ? '+' : ''}${((a - p2) / p2 * 100).toFixed(0)}% к ${prev2.monthName})` : '';
      return `  ${c}: ${a.toLocaleString('ru')} ₽${trend}`;
    }).join('\n');

  // Two months ago summary
  const prev2CatLines = Object.entries(prev2.byCategory)
    .sort(([, a], [, b]) => b - a).slice(0, 8)
    .map(([c, a]) => `  ${c}: ${a.toLocaleString('ru')} ₽`).join('\n');

  // Planned income total
  const plannedInc = Object.values(incomes).reduce((s, v) => s + v, 0) || settings.plannedMonthly || 0;

  // Spending pace: expected spend by now vs actual
  const expectedByNow = isCurrentMon && plannedInc > 0 ? Math.round(plannedInc * daysElapsed / daysInMonth) : null;

  // Savings analysis
  const sumLimits    = Object.values(catLimits).reduce((s, v) => s + v, 0);
  const plannedSaving = plannedInc > 0 ? plannedInc - sumLimits : null;
  const actualRemain  = totalInc   > 0 ? totalInc   - cur.total : null;
  const savingsDelta  = plannedSaving !== null && actualRemain !== null ? actualRemain - plannedSaving : null;

  // Income schedule context: advance by 10th, salary by 25th
  const expectedRemainingIncome = isCurrentMon && plannedInc > 0
    ? Math.max(0, plannedInc - totalInc)
    : 0;
  const incomeScheduleNote = isCurrentMon ? (() => {
    const d = daysElapsed;
    if (d < 10) return 'Ожидаются обе выплаты: аванс (к 10-му) и зарплата (к 25-му)';
    if (d < 25) return 'Аванс уже должен быть получен. Зарплата ожидается к 25-му числу';
    return 'Обе выплаты (аванс и зарплата) уже должны быть получены';
  })() : null;

  // Build report text for the AI
  const reportText = `Семейный бюджет — ${cur.monthName}
Дней прошло: ${daysElapsed} из ${daysInMonth}${!isCurrentMon ? ' (месяц завершён)' : ''}${expectedByNow !== null ? `\nТемп трат: ${cur.total.toLocaleString('ru')} ₽ (ожидалось к этому дню ~${expectedByNow.toLocaleString('ru')} ₽ по плановому бюджету)` : ''}

=== ДОХОДЫ ===
Плановый доход за месяц: ${plannedInc.toLocaleString('ru')} ₽
${Object.entries(incomes).map(([n, v]) => `  ${n}: ${v.toLocaleString('ru')} ₽`).join('\n') || '  (не указаны)'}
График выплат: аванс — не позднее 10-го числа, зарплата — не позднее 25-го (при выходных — раньше). Выплаты надёжные.${incomeScheduleNote ? `\nСтатус: ${incomeScheduleNote}` : ''}
Фактически получено (кэшфлоу): ${totalInc > 0 ? totalInc.toLocaleString('ru') + ' ₽' : 'не зафиксировано'}${expectedRemainingIncome > 0 ? `\nОжидается до конца месяца: ~${expectedRemainingIncome.toLocaleString('ru')} ₽` : ''}

=== РАСХОДЫ ${cur.monthName.toUpperCase()} ===
Итого: ${cur.total.toLocaleString('ru')} ₽${plannedInc ? ` (${Math.round(cur.total / plannedInc * 100)}% от дохода)` : ''}
Переменные: ${curFix.total.toLocaleString('ru')} ₽
Постоянные/обязательные: ${(cur.total - curFix.total).toLocaleString('ru')} ₽
${cur.total > 0 ? `\nПо категориям (с трендом за 3 месяца):\n${catLines}` : ''}
${Object.keys(cur.byUser).length > 0 ? `\nПо участникам:\n${personLines}` : ''}

=== ИСТОРИЯ (для анализа трендов) ===
${prev.monthName}: ${prev.total.toLocaleString('ru')} ₽${prev.total && cur.total ? ` (${cur.total > prev.total ? '+' : ''}${((cur.total - prev.total) / prev.total * 100).toFixed(0)}% к текущему)` : ''}
${prev.total > 0 ? prevCatLines : '(нет данных)'}

${prev2.monthName}: ${prev2.total.toLocaleString('ru')} ₽
${prev2.total > 0 ? prev2CatLines : '(нет данных)'}

=== ПЛАН/ЛИМИТЫ ===
Плановые расходы на месяц: ${(settings.plannedMonthly || 0).toLocaleString('ru')} ₽
Сумма лимитов по категориям: ${sumLimits.toLocaleString('ru')} ₽
Лимиты по категориям (для анализа корректировки):
${(() => {
  const allCats = new Set([
    ...Object.keys(cur.byCategory),
    ...Object.keys(prev.byCategory),
    ...Object.keys(prev2.byCategory),
    ...Object.keys(catLimits),
  ]);
  return [...allCats].map(cat => {
    const c = cur.byCategory[cat] || 0;
    const p = prev.byCategory[cat] || 0;
    const p2 = prev2.byCategory[cat] || 0;
    const months = [c, p, p2].filter(v => v > 0);
    const avg = months.length ? Math.round(months.reduce((s, v) => s + v, 0) / months.length) : 0;
    const lim = catLimits[cat];
    const limTxt = lim ? `лимит ${lim.toLocaleString('ru')} ₽` : 'лимит не задан';
    const avgTxt = avg ? `среднее за ${months.length} мес: ${avg.toLocaleString('ru')} ₽` : '';
    const gap = lim && avg ? ` → ${avg > lim ? `СИСТЕМАТИЧЕСКИ ПРЕВЫШАЕТ на ${(avg - lim).toLocaleString('ru')} ₽` : avg < lim * 0.7 ? `стабильно ниже лимита на ${(lim - avg).toLocaleString('ru')} ₽` : 'в норме'}` : '';
    return `  ${cat}: ${limTxt}${avgTxt ? `, ${avgTxt}` : ''}${gap}`;
  }).join('\n');
})()}

=== СБЕРЕЖЕНИЯ ===
Плановые сбережения (доход − сумма лимитов): ${plannedSaving !== null ? plannedSaving.toLocaleString('ru') + ' ₽' : 'нет данных'}
Фактический остаток (фактический доход − расходы): ${actualRemain !== null ? actualRemain.toLocaleString('ru') + ' ₽' : 'нет данных'}${savingsDelta !== null ? `
Отклонение: ${savingsDelta >= 0 ? '+' : ''}${savingsDelta.toLocaleString('ru')} ₽ (${savingsDelta >= 0 ? 'сберегли больше плана' : 'сберегли меньше плана'})` : ''}`;

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

  // Web Push VAPID (ключи генерируются один раз и хранятся в data)
  const vapid = getOrCreateVapidKeys();
  webpush.setVapidDetails(
    'mailto:budget@app.local',
    vapid.publicKey,
    vapid.privateKey,
  );

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
