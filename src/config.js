import 'dotenv/config';

export const config = {
  // Telegram
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  
  // Разрешённые пользователи (Telegram user ID)
  allowedUsers: (process.env.ALLOWED_USERS || '')
    .split(',')
    .map(id => parseInt(id.trim()))
    .filter(id => !isNaN(id)),
  
  // OpenRouter
  openRouterKey: process.env.OPENROUTER_API_KEY,
  
  // Модели AI — цепочка fallback (через запятую)
  aiModels: (process.env.AI_MODELS || 'google/gemini-flash-1.5,google/gemma-3-27b-it,meta-llama/llama-3.1-8b-instruct')
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
  remindersEnabled: process.env.REMINDERS_ENABLED !== 'false'
};

// Проверка конфигурации
const required = ['telegramToken', 'openRouterKey'];
for (const key of required) {
  if (!config[key]) {
    console.error(`❌ Не задана переменная: ${key}`);
    process.exit(1);
  }
}

if (config.allowedUsers.length === 0) {
  console.warn('⚠️  ALLOWED_USERS пуст — бот будет отклонять все запросы');
}

console.log(`🤖 Модели AI: ${config.aiModels.join(' → ')}`);
