import 'dotenv/config';

export const config = {
  // Telegram (только для Telegram-бота)
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,

  // Разрешённые пользователи (Telegram user ID)
  allowedUsers: (process.env.ALLOWED_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id)),

  // OpenRouter
  openRouterKey: process.env.OPENROUTER_API_KEY,

  // Модели AI — цепочка fallback (через запятую)
  aiModels: (process.env.AI_MODELS || 'google/gemini-3.1-flash-lite-preview,google/gemma-3-27b-it')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean),

  // Таймаут запроса к модели (мс)
  aiTimeout: parseInt(process.env.AI_TIMEOUT) || 15000,

  // Хранилище данных (JSON)
  dataFile: process.env.DATA_FILE || './data/expenses.json',

  // Напоминания (время по Москве)
  reminderHour: parseInt(process.env.REMINDER_HOUR) || 20,
  reminderMinute: parseInt(process.env.REMINDER_MINUTE) || 0,
  remindersEnabled: process.env.REMINDERS_ENABLED !== 'false',

  // Бюджет — общие плановые расходы за месяц
  plannedMonthly: parseInt(process.env.PLANNED_MONTHLY) || 194000,
  // Фиксированные обязательные расходы (ипотека 31k, ЖКХ 12k, кружки 14k)
  plannedFixed: parseInt(process.env.PLANNED_FIXED) || 57000,
  // День списания фиксированных расходов
  fixedExpensesDay: parseInt(process.env.FIXED_EXPENSES_DAY) || 15,
  // День начала отслеживания (null = автоопределение по первой записи)
  trackingStartDay: process.env.TRACKING_START_DAY ? parseInt(process.env.TRACKING_START_DAY) : null,

  // Список постоянных расходов (для настройки "не учитывать постоянные")
  fixedExpensesList: [
    { name: 'Ипотека', amount: 31000 },
    { name: 'ЖКХ', amount: 12000 },
    { name: 'Садик и уроки', amount: 14000 },
  ],
  // Ключевые слова для авто-пометки постоянных расходов при вводе
  fixedKeywords: (process.env.FIXED_KEYWORDS || 'ипотека,жкх,коммунальн,садик,допурок,кружок')
    .split(',').map(s => s.trim().toLowerCase()),

  // === Веб-приложение ===
  port: parseInt(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production-please',
  // Пользователи веб-приложения (два человека — муж и жена)
  webUsers: [
    {
      login: process.env.USER1_LOGIN || 'user1',
      password: process.env.USER1_PASSWORD || 'pass1',
      name: process.env.USER1_NAME || 'Удав',
    },
    {
      login: process.env.USER2_LOGIN || 'user2',
      password: process.env.USER2_PASSWORD || 'pass2',
      name: process.env.USER2_NAME || 'Марина',
    },
  ],
};

// Предупреждения при старте
if (!config.openRouterKey) {
  console.warn('⚠️  OPENROUTER_API_KEY не задан — AI-парсинг недоступен');
}

console.log(`🤖 Модели AI: ${config.aiModels.join(' → ')}`);
