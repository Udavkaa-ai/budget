import { config } from './config.js';
import { getTodaySummary, getFamilyToday } from './storage.js';

const REMINDER_HOUR = config.reminderHour;
const REMINDER_MINUTE = config.reminderMinute;

let bot = null;
let intervalId = null;

/**
 * Инициализация напоминаний
 */
export function initReminders(telegrafBot) {
  bot = telegrafBot;
  
  // Проверяем каждую минуту
  intervalId = setInterval(checkAndSend, 60 * 1000);
  
  console.log(`⏰ Напоминания включены: ${REMINDER_HOUR}:${String(REMINDER_MINUTE).padStart(2, '0')} MSK`);
}

let lastSentDate = null;

async function checkAndSend() {
  // Московское время (UTC+3)
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const hours = msk.getUTCHours();
  const minutes = msk.getUTCMinutes();
  const today = msk.toISOString().slice(0, 10);
  
  // Отправляем один раз в день в нужное время
  if (hours === REMINDER_HOUR && minutes === REMINDER_MINUTE && lastSentDate !== today) {
    lastSentDate = today;
    await sendReminders();
  }
}

async function sendReminders() {
  if (!bot) return;
  
  const familyToday = getFamilyToday();
  
  let message = '🔔 *Напоминание о расходах*\n\n';
  
  if (familyToday.total === 0) {
    message += 'Сегодня расходов не записано.\n';
    message += 'Не забудьте внести траты!';
  } else {
    message += `Сегодня семья потратила: *${fmt(familyToday.total)}*\n\n`;
    
    for (const [user, data] of Object.entries(familyToday.byUser)) {
      message += `👤 ${user}: ${fmt(data.total)}\n`;
    }
    
    message += '\nВсё записали?';
  }
  
  // Отправляем каждому пользователю
  for (const userId of config.allowedUsers) {
    try {
      await bot.telegram.sendMessage(userId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '➕ Добавить расход', callback_data: 'add_expense' }
          ]]
        }
      });
    } catch (err) {
      console.error(`Не удалось отправить напоминание ${userId}:`, err.message);
    }
  }
  
  console.log('📨 Напоминания отправлены');
}

function fmt(n) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', minimumFractionDigits: 0
  }).format(n);
}

export function stopReminders() {
  if (intervalId) {
    clearInterval(intervalId);
  }
}
