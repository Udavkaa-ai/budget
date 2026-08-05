import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import webpush from 'web-push';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
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
  getRecurring,
  saveRecurring,
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
  getUserByOAuth,
  createOAuthUser,
  linkOAuthToUser,
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
  getCustomCategories,
  addCustomCategory,
  removeCustomCategory,
  upsertSyncRecords,
  getSyncRecordsSince,
  putSyncDoc,
  getSyncDoc,
  listSyncDocs,
  getEncryptedRecordCounts,
  getFamilyE2E,
  enableFamilyE2E,
  linkGoogleToUser,
  getFamilySnapshot,
  restoreFamilySnapshot,
  addBackup,
  listBackups,
  getBackup,
  deleteBackup,
} from './storage.js';
import { parseExpenses, parseImageExpenses, analyzeFinances, chatFinances, CATEGORIES } from './parser.js';
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

// ─── Security headers ──────────────────────────────────────────────────────────
// Список внешних хостов ограничен ровно тем, что реально подключено в index.html
// (GSI-кнопка Google, Google Fonts, CDN графиков) — держим CSP настолько узкой,
// насколько возможно, чтобы её reflected/stored-XSS не смог обойти.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 'unsafe-eval' и blob: нужны Chart.js/плагину зума (иначе график падает).
      // Инлайн-скрипты по-прежнему запрещены (нет 'unsafe-inline'), поэтому
      // основная защита от XSS сохраняется.
      scriptSrc: ["'self'", "'unsafe-eval'", 'blob:', 'https://accounts.google.com', 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'https://accounts.google.com', 'https://cdn.jsdelivr.net'],
      workerSrc: ["'self'", 'blob:'],
      frameSrc: ['https://accounts.google.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  // Иначе COEP блокирует Google Fonts / GSI-виджет / jsDelivr, не давая
  // прироста безопасности для этого приложения
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Жёсткий лимит на роуты входа/привязки/инвайтов — защита от брутфорса
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток, попробуйте позже' },
});

// Мягкий общий лимит на весь /api — защита от грубого злоупотребления,
// не мешающая обычной работе (сокеты идут отдельным каналом, не через /api)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});
app.use('/api/', apiLimiter);

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

app.post('/api/auth/login', authLimiter, async (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) {
    return res.status(400).json({ error: 'Введите логин и пароль' });
  }

  const user = getUserByLogin(login);
  if (!user || !(await bcrypt.compare(password, user.password))) {
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
    yandex: !!config.yandexClientId,
    vk: !!config.vkClientId,
  });
});

// Google OAuth — verifies Google ID token, creates/finds user, returns JWT
app.post('/api/auth/google', authLimiter, async (req, res) => {
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

// Привязка Google к текущему (легаси) аккаунту: войти по паролю,
// затем передать сюда Google credential — история остаётся на старом имени
app.post('/api/auth/link-google', authMiddleware, authLimiter, async (req, res) => {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: 'Нет токена Google' });
  if (!config.googleClientId) return res.status(503).json({ error: 'Google OAuth не настроен' });
  try {
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    const payload = await verifyRes.json();
    if (!verifyRes.ok || payload.error) return res.status(401).json({ error: 'Неверный токен Google' });
    if (payload.aud !== config.googleClientId) return res.status(401).json({ error: 'Неверный client_id' });

    const result = await linkGoogleToUser(req.user.login, {
      googleId: payload.sub, email: payload.email,
    });
    if (!result.ok) return res.status(404).json(result);
    io.to(req.user.family).emit('expense:updated', { by: req.user.name });
    res.json(result);
  } catch (err) {
    console.error('link-google error:', err);
    res.status(500).json({ error: 'Ошибка привязки' });
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

// ─── Яндекс ID и VK ID (для RuStore) ─────────────────────────────────────────
// Тот же паттерн, что и Google mobile: открывается в WebView (приложение) или
// как переход (веб), провайдер редиректит на /callback, там меняем code на
// профиль, создаём/находим пользователя и редиректим обратно с JWT в query.
// redirect param: familybudget://auth (приложение) или URL веб-страницы (веб).

// state кодирует и адрес возврата (r), и — при миграции — токен текущего
// пользователя (l), чтобы привязать провайдера к существующему аккаунту.
function packState(redirect, link) {
  return Buffer.from(JSON.stringify({ r: redirect || 'familybudget://auth', l: link || '' })).toString('base64url');
}
function unpackState(state) {
  try {
    const s = JSON.parse(Buffer.from(String(state || ''), 'base64url').toString());
    return { redirect: s.r || 'familybudget://auth', link: s.l || '' };
  } catch {
    return { redirect: state ? decodeURIComponent(state) : 'familybudget://auth', link: '' };
  }
}

// Единый финал: режим привязки (миграция) или обычный вход.
async function finishOAuth(res, provider, profile, state) {
  const { redirect, link } = unpackState(state);
  const { id, email, name } = profile;
  if (link) {
    // Миграция: вешаем провайдера на текущий аккаунт (данные семьи не трогаем)
    try {
      const payload = jwt.verify(link, config.jwtSecret);
      const result = await linkOAuthToUser(payload.login, provider, id, email);
      return res.redirect(`${redirect}?linked=${result.ok ? '1' : '0'}`);
    } catch {
      return res.redirect(`${redirect}?linked=0`);
    }
  }
  let user = getUserByOAuth(provider, id);
  if (!user) user = await createOAuthUser({ provider, id, email, name });
  const token = jwt.sign(
    { login: user.login, name: user.name, family: user.family, isAdmin: user.isAdmin || false },
    config.jwtSecret, { expiresIn: '90d' },
  );
  res.redirect(`${redirect}?token=${encodeURIComponent(token)}`);
}

// ── Яндекс (oauth.yandex.ru) ──
app.get('/auth/yandex/mobile', (req, res) => {
  if (!config.yandexClientId) return res.status(503).send('Яндекс OAuth не настроен');
  const state = packState(req.query.redirect, req.query.link);
  const callbackUrl = `${req.protocol}://${req.headers.host}/auth/yandex/mobile/callback`;
  const url = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${config.yandexClientId}`
    + `&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}`;
  res.redirect(url);
});

app.get('/auth/yandex/mobile/callback', async (req, res) => {
  const { code, state } = req.query;
  const { redirect } = unpackState(state);
  try {
    const callbackUrl = `${req.protocol}://${req.headers.host}/auth/yandex/mobile/callback`;
    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code,
        client_id: config.yandexClientId, client_secret: config.yandexClientSecret,
        redirect_uri: callbackUrl,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('no access_token');
    const infoRes = await fetch('https://login.yandex.ru/info?format=json', {
      headers: { Authorization: `OAuth ${tokens.access_token}` },
    });
    const info = await infoRes.json();
    await finishOAuth(res, 'yandex', {
      id: String(info.id),
      email: info.default_email || (info.emails && info.emails[0]) || '',
      name: info.real_name || info.display_name || info.login || '',
    }, state);
  } catch (err) {
    console.error('Yandex OAuth callback error:', err);
    res.redirect(`${redirect}?error=auth_failed`);
  }
});

// ── VK ID (id.vk.com, OAuth 2.1 + PKCE) ──
// code_verifier секретен и не может лежать в state — держим его на сервере,
// ключ = nonce, который и передаём как state (внутри — redirect и link).
const vkPkce = new Map(); // nonce -> { verifier, state, ts }
function vkPkceGC() {
  const now = Date.now();
  for (const [k, v] of vkPkce) if (now - v.ts > 10 * 60 * 1000) vkPkce.delete(k);
}

app.get('/auth/vk/mobile', (req, res) => {
  if (!config.vkClientId) return res.status(503).send('VK OAuth не настроен');
  vkPkceGC();
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const nonce = crypto.randomBytes(16).toString('base64url');
  vkPkce.set(nonce, { verifier, state: packState(req.query.redirect, req.query.link), ts: Date.now() });
  const callbackUrl = `${req.protocol}://${req.headers.host}/auth/vk/mobile/callback`;
  const url = `https://id.vk.com/authorize?response_type=code&client_id=${config.vkClientId}`
    + `&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(nonce)}`
    + `&code_challenge=${challenge}&code_challenge_method=S256&scope=email`;  // email: включи доступ в настройках VK-приложения
  res.redirect(url);
});

app.get('/auth/vk/mobile/callback', async (req, res) => {
  const { code, state: nonce, device_id } = req.query;
  const entry = vkPkce.get(nonce);
  if (entry) vkPkce.delete(nonce);
  const { redirect } = unpackState(entry?.state);
  try {
    if (!entry) throw new Error('pkce state expired');
    const callbackUrl = `${req.protocol}://${req.headers.host}/auth/vk/mobile/callback`;
    const tokenRes = await fetch('https://id.vk.com/oauth2/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, code_verifier: entry.verifier,
        client_id: config.vkClientId, device_id: device_id || '', redirect_uri: callbackUrl,
        state: nonce,
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('no access_token');
    const infoRes = await fetch('https://id.vk.com/oauth2/user_info', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: tokens.access_token, client_id: String(config.vkClientId) }),
    });
    const info = await infoRes.json();
    const u = info.user || {};
    const id = String(u.user_id || tokens.user_id || '');
    if (!id) throw new Error('no user_id');
    await finishOAuth(res, 'vk', {
      id, email: u.email || '',
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim(),
    }, entry.state);
  } catch (err) {
    console.error('VK ID callback error:', err);
    res.redirect(`${redirect}?error=auth_failed`);
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
app.post('/api/invite/join', authMiddleware, authLimiter, async (req, res) => {
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
  const u = getUserByLogin(req.user.login);
  res.json({
    name: req.user.name, login: req.user.login, isAdmin: req.user.isAdmin || false,
    googleLinked: !!u?.googleId,
  });
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
  const subs = getFamilyPushSubscriptions(req.user.family, [req.user.name, req.user.login])
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
      by: req.user.name,
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
    res.status(500).json({ error: 'Ошибка импорта' });
  }
});

// ─── Settings Routes ──────────────────────────────────────────────────────────

app.get('/api/settings', authMiddleware, (req, res) => {
  const budget = getFamilyBudgetSettings(req.user.family);
  const custom = getCustomCategories(req.user.family);
  res.json({
    ...getSettings(req.user.family),
    categories: [...CATEGORIES, ...custom.map(c => c.name)],
    customCategories: custom,
    plannedMonthly: budget.plannedMonthly,
  });
});

// ─── Шифрованные бэкапы (по желанию пользователя) ────────────────────────────
// Клиент скачивает снапшот, шифрует своим ключом и кладёт блоб обратно;
// сервер содержимое бэкапа прочитать не может.

app.get('/api/snapshot', authMiddleware, (req, res) => {
  res.json(getFamilySnapshot(req.user.family));
});

app.post('/api/restore', authMiddleware, async (req, res) => {
  const snap = req.body || {};
  if (!Array.isArray(snap.expenses)) return res.status(400).json({ error: 'Некорректный снапшот' });
  const result = await restoreFamilySnapshot(req.user.family, snap);
  io.to(req.user.family).emit('expense:added', { expenses: [], by: req.user.name });
  res.json({ ok: true, ...result });
});

app.post('/api/backup', authMiddleware, (req, res) => {
  const { blob } = req.body || {};
  if (typeof blob !== 'string' || blob.length < 16) {
    return res.status(400).json({ error: 'Нет данных бэкапа' });
  }
  if (blob.length > 4_000_000) return res.status(413).json({ error: 'Бэкап слишком большой' });
  res.json({ ok: true, backup: addBackup(req.user.family, blob) });
});

app.get('/api/backup', authMiddleware, (req, res) => {
  res.json(listBackups(req.user.family));
});

app.get('/api/backup/:id', authMiddleware, (req, res) => {
  const b = getBackup(req.user.family, req.params.id);
  if (!b) return res.status(404).json({ error: 'Бэкап не найден' });
  res.json({ id: b.id, createdAt: b.createdAt, blob: b.blob });
});

app.delete('/api/backup/:id', authMiddleware, (req, res) => {
  if (!deleteBackup(req.user.family, req.params.id)) {
    return res.status(404).json({ error: 'Бэкап не найден' });
  }
  res.json({ ok: true });
});

// ─── E2E-синхронизация (zero-knowledge) ──────────────────────────────────────
// Сервер хранит и раздаёт только шифроблобы; содержимое видят только клиенты
// с ключом семьи.

app.get('/api/family/e2e', authMiddleware, (req, res) => {
  res.json(getFamilyE2E(req.user.family));
});

// Включается ПОСЛЕ того как клиент залил зашифрованные данные:
// сохраняем отпечаток ключа и вычищаем плейнтекст семьи
app.post('/api/family/enable-e2e', authMiddleware, async (req, res) => {
  const { keyFingerprint } = req.body || {};
  if (!keyFingerprint) return res.status(400).json({ error: 'Нет отпечатка ключа' });
  const cur = getFamilyE2E(req.user.family);
  if (cur.enabled) return res.status(400).json({ error: 'E2E уже включён' });
  const { wiped } = await enableFamilyE2E(req.user.family, keyFingerprint);
  io.to(req.user.family).emit('e2e:enabled');
  res.json({ ok: true, wiped });
});

app.post('/api/sync/records', authMiddleware, (req, res) => {
  const { records } = req.body || {};
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'Нет записей' });
  }
  if (records.length > 500) return res.status(413).json({ error: 'Слишком много записей за раз' });
  for (const r of records) {
    if (r.blob && r.blob.length > 4096) return res.status(413).json({ error: 'Слишком большой блоб' });
  }
  const out = upsertSyncRecords(req.user.family, records);
  io.to(req.user.family).emit('sync:changed', { by: req.user.name });

  // Пуш без деталей — сервер не знает сумм
  const subs = getFamilyPushSubscriptions(req.user.family, [req.user.name, req.user.login])
    .filter(sub => getUserPushEnabled(sub.userId, req.user.family));
  if (subs.length) {
    sendPushToSubscriptions(subs, {
      title: '💸 Обновление бюджета',
      body: `${req.user.name} внёс изменения`,
      url: '/',
      by: req.user.name,
    }).catch(() => {});
  }
  res.json(out);
});

app.get('/api/sync/records', authMiddleware, (req, res) => {
  const since = parseInt(req.query.since) || 0;
  res.json(getSyncRecordsSince(req.user.family, since));
});

app.put('/api/sync/doc/:key', authMiddleware, (req, res) => {
  const { blob, ver } = req.body || {};
  if (typeof blob !== 'string' || blob.length > 65536) {
    return res.status(400).json({ error: 'Некорректный блоб' });
  }
  const out = putSyncDoc(req.user.family, req.params.key, blob, ver);
  if (!out.ok) return res.status(409).json(out);
  io.to(req.user.family).emit('sync:changed', { by: req.user.name, doc: req.params.key });
  res.json(out);
});

app.get('/api/sync/doc/:key', authMiddleware, (req, res) => {
  const doc = getSyncDoc(req.user.family, req.params.key);
  if (!doc) return res.status(404).json({ error: 'Нет документа' });
  res.json(doc);
});

app.get('/api/sync/docs', authMiddleware, (req, res) => {
  res.json(listSyncDocs(req.user.family));
});

// ИИ-анализ для E2E-семей: клиент сам считает агрегаты и присылает
// только обезличенный текст сводки — сырые данные не покидают устройство
app.post('/api/analyze-raw', authMiddleware, async (req, res) => {
  if (!config.openRouterKey) {
    return res.status(503).json({ error: 'AI-анализ недоступен (нет API ключа)' });
  }
  const { reportText } = req.body || {};
  if (!reportText?.trim() || reportText.length > 20000) {
    return res.status(400).json({ error: 'Некорректная сводка' });
  }
  try {
    const result = await analyzeFinances(reportText);
    if (result.error) return res.status(502).json({ error: result.error });
    res.json({ report: result.report, model: result.model });
  } catch (err) {
    console.error('analyze-raw error:', err);
    res.status(500).json({ error: 'Ошибка ИИ-анализа' });
  }
});

// ИИ-чат по бюджету: клиент присылает обезличенную сводку (context) + историю
// сообщений. Для E2E-семей сырые данные не покидают устройство — только агрегаты.
app.post('/api/chat', authMiddleware, async (req, res) => {
  if (!config.openRouterKey) {
    return res.status(503).json({ error: 'ИИ-чат недоступен (нет API ключа)' });
  }
  const { context, messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 20) {
    return res.status(400).json({ error: 'Некорректный запрос' });
  }
  const ctx = typeof context === 'string' ? context.slice(0, 20000) : '';
  let total = ctx.length;
  const clean = [];
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) {
      return res.status(400).json({ error: 'Некорректное сообщение' });
    }
    total += m.content.length;
    clean.push({ role: m.role, content: m.content.slice(0, 4000) });
  }
  if (total > 24000) {
    return res.status(400).json({ error: 'Слишком длинный диалог' });
  }
  try {
    const result = await chatFinances(ctx, clean);
    if (result.error) return res.status(502).json({ error: result.error });
    res.json({ reply: result.reply, model: result.model });
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: 'Ошибка ИИ-чата' });
  }
});

// ─── Пользовательские категории ──────────────────────────────────────────────

app.post('/api/categories', authMiddleware, async (req, res) => {
  const { name, emoji } = req.body || {};
  const n = (name || '').trim();
  const em = (emoji || '').trim();
  if (!n) return res.status(400).json({ error: 'Укажите название' });
  if (n.length > 24) return res.status(400).json({ error: 'Слишком длинное название' });
  if (em.length > 8) return res.status(400).json({ error: 'Иконка слишком длинная' });
  if (CATEGORIES.includes(n)) return res.status(400).json({ error: 'Такая категория уже есть' });
  const cat = await addCustomCategory(req.user.family, { name: n, emoji: em || '🏷️' });
  if (!cat) return res.status(400).json({ error: 'Такая категория уже есть' });
  io.to(req.user.family).emit('settings:updated', { key: 'categories' });
  res.json({ ok: true, category: cat });
});

app.delete('/api/categories/:name', authMiddleware, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (CATEGORIES.includes(name)) return res.status(400).json({ error: 'Базовую категорию нельзя удалить' });
  const result = await removeCustomCategory(req.user.family, name);
  if (!result.removed) return res.status(404).json({ error: 'Категория не найдена' });
  io.to(req.user.family).emit('settings:updated', { key: 'categories' });
  if (result.moved > 0) io.to(req.user.family).emit('expense:updated', { by: req.user.name });
  res.json({ ok: true, moved: result.moved });
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
  const familyE2E = {};
  const encCounts = getEncryptedRecordCounts();
  for (const famId of families) {
    const cf = getCashflow(ym, famId);
    familyIncome[famId] = incomeDayTotal(cf.incomeDays);
    // E2E-семьи: плейнтекст на сервере вычищен, показываем что данные
    // зашифрованы, и сколько живых шифроблобов хранится (не «0 зап.»).
    familyE2E[famId] = { enabled: getFamilyE2E(famId).enabled, encryptedRecords: encCounts[famId] || 0 };
  }

  res.json({ totalFamilies: families.length, totalUsers: stats.length, users: stats, familyIncome, familyE2E, month, year });
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

// Регулярные платежи (подписки/аренда/ЖКХ)
app.get('/api/recurring', authMiddleware, (req, res) => {
  res.json(getRecurring(req.user.family));
});

app.put('/api/recurring', authMiddleware, async (req, res) => {
  await saveRecurring(req.body, req.user.family);
  io.to(req.user.family).emit('sync:changed', { by: req.user.name });
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

  // Spending pace — вердикт считаем в коде, чтобы ИИ не пересчитывал (модель регулярно
  // делит на 31 вместо дней прошло и объявляет «месяц почти закончился, темп низкий»).
  const paceBase = settings.plannedMonthly || Object.values(catLimits).reduce((s, v) => s + v, 0) || plannedInc || 0;
  const paceBlock = (() => {
    if (!isCurrentMon) return `Месяц завершён — прошло все ${daysInMonth} дн.`;
    const dayLine = `СЕГОДНЯ ${daysElapsed}-й календарный день месяца (из ${daysInMonth}). Прошло ровно ${daysElapsed} дн. — это ЕДИНСТВЕННОЕ верное число прошедших дней, бери только его.`;
    if (paceBase <= 0) return `${dayLine} Плановый бюджет не задан — темп оценить нельзя.`;
    const daysLeft    = daysInMonth - daysElapsed;
    const expectedNow = Math.round(paceBase * daysElapsed / daysInMonth);
    const paceRatio   = expectedNow > 0 ? Math.round(cur.total / expectedNow * 100) : 100;
    const dailyActual = Math.round(cur.total / daysElapsed);
    const dailyPlan   = Math.round(paceBase / daysInMonth);
    const projected   = Math.round(cur.total / daysElapsed * daysInMonth);
    const projVsPlan  = Math.round(projected / paceBase * 100);
    const verdict = paceRatio >= 115
      ? `ОПЕРЕЖЕНИЕ ГРАФИКА — потрачено ${paceRatio}% от нормы на этот день (на ${(cur.total - expectedNow).toLocaleString('ru')} ₽ больше ожидаемого), есть риск перерасхода`
      : paceRatio <= 85
        ? `отставание от графика — ${paceRatio}% от нормы на этот день (пока укладываемся в план)`
        : `в графике — ${paceRatio}% от нормы на этот день`;
    // Все цифры уже посчитаны в коде. ИИ должен пересказать их своими словами,
    // НЕ пересчитывая (модель регулярно берёт «10» из графика выплат «аванс к 10-му»
    // и делит на него, вместо реального числа прошедших дней).
    return `${dayLine}
Впереди ещё ${daysLeft} дн.
Потрачено на сегодня: ${cur.total.toLocaleString('ru')} ₽; норма к ${daysElapsed}-му дню при равномерном темпе ~${expectedNow.toLocaleString('ru')} ₽.
Темп (готово, не пересчитывай): ${paceRatio}% от нормы на этот день — ${verdict}.
Средний расход в день (готово, = потрачено ÷ ${daysElapsed} дн., не пересчитывай): ${dailyActual.toLocaleString('ru')} ₽/день при плановом ${dailyPlan.toLocaleString('ru')} ₽/день.
Прогноз расходов до конца месяца при этом темпе (готово, не пересчитывай): ~${projected.toLocaleString('ru')} ₽ = ${projVsPlan}% планового бюджета (${paceBase.toLocaleString('ru')} ₽)${daysElapsed < 7 ? '. NB: в начале месяца прогноз грубый — опирайся прежде всего на «потрачено vs норма к этому дню»' : ''}.`;
  })();

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

ТЕМП ТРАТ (готовые цифры — перескажи их своими словами в «Общей картине», НЕ вставляй эти строки дословно и НЕ пересчитывай числа):
${paceBlock}

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
    console.error('analyze error:', err);
    res.status(500).json({ error: 'Ошибка ИИ-анализа' });
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
    const result = await parseExpenses(text, getCustomCategories(req.user.family).map(c => c.name));
    res.json(result);
  } catch (err) {
    console.error('parse error:', err);
    res.status(500).json({ error: 'Ошибка ИИ-разбора текста' });
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
    const result = await parseImageExpenses(base64, mimeType || 'image/jpeg', getCustomCategories(req.user.family).map(c => c.name));
    res.json(result);
  } catch (err) {
    console.error('parse-image error:', err);
    res.status(500).json({ error: 'Ошибка ИИ-разбора изображения' });
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
