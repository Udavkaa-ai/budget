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
} from './storage.js';
import { parseExpenses, CATEGORIES } from './parser.js';
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

app.use(express.json());

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

  const user = config.webUsers.find(
    u => u.login === login && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  const token = jwt.sign(
    { login: user.login, name: user.name },
    config.jwtSecret,
    { expiresIn: '30d' }
  );

  res.json({ token, name: user.name, login: user.login });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ name: req.user.name, login: req.user.login });
});

// ─── Expense Routes ───────────────────────────────────────────────────────────

// Добавить расходы (один или несколько)
app.post('/api/expenses', authMiddleware, async (req, res) => {
  const { expenses } = req.body || {};
  if (!Array.isArray(expenses) || expenses.length === 0) {
    return res.status(400).json({ error: 'Пустой список расходов' });
  }

  const withUser = expenses.map(e => ({ ...e, user: req.user.name }));
  await appendExpenses(withUser);

  // Уведомляем всех подключённых клиентов
  io.emit('expense:added', { expenses: withUser, by: req.user.name });

  res.json({ ok: true, count: withUser.length });
});

// Удалить расход
app.delete('/api/expenses/:id', authMiddleware, async (req, res) => {
  const deleted = await deleteExpense(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Не найдено' });

  io.emit('expense:deleted', { id: req.params.id, by: req.user.name });
  res.json({ ok: true });
});

// Переключить isFixed
app.post('/api/expenses/:id/toggle-fixed', authMiddleware, async (req, res) => {
  const result = await toggleExpenseFixed(req.params.id);
  if (result === null) return res.status(404).json({ error: 'Не найдено' });

  io.emit('expense:updated', { id: req.params.id, isFixed: result, by: req.user.name });
  res.json({ ok: true, isFixed: result });
});

// ─── View Routes ──────────────────────────────────────────────────────────────

// Мои расходы сегодня
app.get('/api/expenses/today', authMiddleware, (req, res) => {
  const data = getTodaySummary(req.user.name);
  res.json(data);
});

// Расходы семьи за день
app.get('/api/expenses/family', authMiddleware, (req, res) => {
  const { date } = req.query;
  if (date) {
    res.json(getFamilyDay(date));
  } else {
    res.json(getFamilyToday());
  }
});

// Расходы за месяц (список)
app.get('/api/expenses/month', authMiddleware, (req, res) => {
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  res.json(getExpensesForMonth(month, year));
});

// Расходы по категории
app.get('/api/expenses/category/:cat', authMiddleware, (req, res) => {
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  res.json(getCategoryExpenses(req.params.cat, month, year));
});

// Сводка за месяц (статистика)
app.get('/api/summary', authMiddleware, (req, res) => {
  const month = req.query.month ? parseInt(req.query.month) : null;
  const year = req.query.year ? parseInt(req.query.year) : null;
  const excludeFixed = req.query.excludeFixed === 'true';
  res.json(getFamilySummary(month, year, excludeFixed));
});

// Данные для диаграммы (PNG)
app.get('/api/chart', authMiddleware, async (req, res) => {
  try {
    const month = req.query.month ? parseInt(req.query.month) : null;
    const year = req.query.year ? parseInt(req.query.year) : null;
    const excludeFixed = req.query.excludeFixed === 'true';

    const img = await generateChartImage(month, year, excludeFixed);
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
  const csv = exportCSV();
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="expenses-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM для Excel
});

// Импорт CSV
app.post('/api/import', authMiddleware, async (req, res) => {
  const { csv } = req.body || {};
  if (!csv?.trim()) return res.status(400).json({ error: 'Пустой CSV' });

  try {
    const result = await importFromCSV(csv);
    io.emit('expense:added', { expenses: [], by: req.user.name });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Ошибка импорта: ' + err.message });
  }
});

// ─── Settings Routes ──────────────────────────────────────────────────────────

app.get('/api/settings', authMiddleware, (req, res) => {
  res.json({
    ...getSettings(),
    categories: CATEGORIES,
    plannedMonthly: config.plannedMonthly,
    plannedFixed: config.plannedFixed,
    fixedExpensesList: config.fixedExpensesList,
  });
});

app.put('/api/settings', authMiddleware, async (req, res) => {
  const { key, value } = req.body || {};
  if (!key) return res.status(400).json({ error: 'Не указан ключ настройки' });

  await updateSetting(key, value);
  io.emit('settings:updated', { key, value, by: req.user.name });
  res.json({ ok: true });
});

// Перепометить постоянные расходы
app.post('/api/settings/retag', authMiddleware, async (req, res) => {
  const count = await retagFixedExpenses();
  io.emit('expense:retagged', { count, by: req.user.name });
  res.json({ ok: true, count });
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
  console.log(`🔌 ${socket.user.name} подключился`);
  socket.on('disconnect', () => {
    console.log(`🔌 ${socket.user.name} отключился`);
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
    const familyToday = getFamilyToday();
    io.emit('reminder', {
      total: familyToday.total,
      byUser: familyToday.byUser,
    });
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
