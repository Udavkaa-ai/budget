import { Telegraf, Markup } from 'telegraf';
import { config } from './config.js';
import { parseExpenses, CATEGORIES } from './parser.js';
import { loadData, appendExpenses, getTodaySummary, getFamilyToday, getFamilySummary, exportCSV, flushData } from './storage.js';
import { initReminders, stopReminders } from './reminders.js';
import { generateChartImage } from './chart.js';

const bot = new Telegraf(config.telegramToken);

// Состояния пользователей для пошагового ввода
const sessions = new Map();

// Проверка доступа
const isAllowed = (ctx) => config.allowedUsers.includes(ctx.from?.id);

// Middleware авторизации
bot.use((ctx, next) => {
  if (!isAllowed(ctx)) {
    console.log(`⛔ Unauthorized: ${ctx.from?.id} (@${ctx.from?.username})`);
    return ctx.reply('⛔ Доступ запрещён.');
  }
  return next();
});

// Главное меню
const mainMenu = Markup.keyboard([
  ['➕ Добавить', '📊 Сегодня'],
  ['👨‍👩‍👧‍👦 Семья', '📈 Месяц'],
  ['📉 Диаграмма', '📎 Экспорт']
]).resize();

// /start
bot.start((ctx) => {
  ctx.reply(
    `Привет, ${ctx.from.first_name}! 👋\n\n` +
    `Я помогу вести семейный бюджет.\n\n` +
    `*Быстрый ввод:* просто напиши\n` +
    `«продукты 2300, кафе 1500»\n\n` +
    `Или используй кнопки ниже 👇`,
    { parse_mode: 'Markdown', ...mainMenu }
  );
});

// /help
bot.help((ctx) => {
  ctx.reply(
    `📖 *Как пользоваться*\n\n` +
    `*Способ 1 — текстом:*\n` +
    `Просто напиши расходы:\n` +
    `• «продукты 2300»\n` +
    `• «вчера такси 450, кафе 800»\n\n` +
    `*Способ 2 — кнопками:*\n` +
    `Нажми «➕ Добавить» и следуй инструкциям\n\n` +
    `*Команды:*\n` +
    `/add — добавить через форму\n` +
    `/today — мои расходы сегодня\n` +
    `/family — расходы семьи\n` +
    `/summary — статистика за месяц\n` +
    `/chart — диаграмма расходов\n` +
    `/export — выгрузить CSV`,
    { parse_mode: 'Markdown', ...mainMenu }
  );
});

// ============ ФОРМА ДОБАВЛЕНИЯ ============

// Кнопки категорий (по 3 в ряд)
function categoryKeyboard() {
  const buttons = CATEGORIES.map(cat => 
    Markup.button.callback(`${getEmoji(cat)} ${cat}`, `cat:${cat}`)
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 3) {
    rows.push(buttons.slice(i, i + 3));
  }
  rows.push([Markup.button.callback('❌ Отмена', 'cancel')]);
  return Markup.inlineKeyboard(rows);
}

// Кнопки быстрых сумм
function amountKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('100', 'amt:100'),
      Markup.button.callback('200', 'amt:200'),
      Markup.button.callback('500', 'amt:500'),
    ],
    [
      Markup.button.callback('1000', 'amt:1000'),
      Markup.button.callback('2000', 'amt:2000'),
      Markup.button.callback('5000', 'amt:5000'),
    ],
    [
      Markup.button.callback('⬅️ Назад', 'back_to_cat'),
      Markup.button.callback('❌ Отмена', 'cancel'),
    ]
  ]);
}

// Команда /add и кнопка "➕ Добавить"
bot.command('add', startAddForm);
bot.hears('➕ Добавить', startAddForm);

async function startAddForm(ctx) {
  sessions.set(ctx.from.id, { step: 'category' });
  await ctx.reply('📂 Выбери категорию:', categoryKeyboard());
}

// Выбор категории
bot.action(/^cat:(.+)$/, async (ctx) => {
  const category = ctx.match[1];
  const session = sessions.get(ctx.from.id) || {};
  
  session.step = 'amount';
  session.category = category;
  sessions.set(ctx.from.id, session);
  
  await ctx.editMessageText(
    `${getEmoji(category)} *${category}*\n\nВведи сумму или выбери:`,
    { parse_mode: 'Markdown', ...amountKeyboard() }
  );
  await ctx.answerCbQuery();
});

// Выбор суммы кнопкой
bot.action(/^amt:(\d+)$/, async (ctx) => {
  const amount = parseInt(ctx.match[1]);
  const session = sessions.get(ctx.from.id);
  
  if (!session || !session.category) {
    await ctx.answerCbQuery('Сессия истекла, начни заново');
    return;
  }
  
  session.amount = amount;
  session.step = 'description';
  sessions.set(ctx.from.id, session);
  
  await ctx.editMessageText(
    `${getEmoji(session.category)} *${session.category}*: ${fmt(amount)}\n\n` +
    `Напиши краткое описание (или отправь «-» чтобы пропустить):`,
    { parse_mode: 'Markdown' }
  );
  await ctx.answerCbQuery();
});

// Назад к категориям
bot.action('back_to_cat', async (ctx) => {
  const session = sessions.get(ctx.from.id) || {};
  session.step = 'category';
  sessions.set(ctx.from.id, session);
  
  await ctx.editMessageText('📂 Выбери категорию:', categoryKeyboard());
  await ctx.answerCbQuery();
});

// Отмена
bot.action('cancel', async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.editMessageText('❌ Отменено');
  await ctx.answerCbQuery();
});

// Добавить из напоминания
bot.action('add_expense', async (ctx) => {
  sessions.set(ctx.from.id, { step: 'category' });
  await ctx.reply('📂 Выбери категорию:', categoryKeyboard());
  await ctx.answerCbQuery();
});

// ============ СТАТИСТИКА ============

// Кнопка "📊 Сегодня" — мои расходы
bot.hears('📊 Сегодня', (ctx) => {
  const userName = ctx.from.first_name;
  const { expenses, total, date } = getTodaySummary(userName);
  
  if (expenses.length === 0) {
    return ctx.reply(`📭 Сегодня (${date}) у тебя записей нет.`, mainMenu);
  }

  let text = `📅 *Твои расходы (${date})*\n\n`;
  for (const exp of expenses) {
    text += `${getEmoji(exp.category)} ${exp.description}: ${fmt(exp.amount)}\n`;
  }
  text += `\n💰 *Итого: ${fmt(total)}*`;
  
  ctx.reply(text, { parse_mode: 'Markdown', ...mainMenu });
});

bot.command('today', (ctx) => {
  const userName = ctx.from.first_name;
  const { expenses, total, date } = getTodaySummary(userName);
  
  if (expenses.length === 0) {
    return ctx.reply(`📭 Сегодня (${date}) у тебя записей нет.`);
  }

  let text = `📅 *Твои расходы (${date})*\n\n`;
  for (const exp of expenses) {
    text += `${getEmoji(exp.category)} ${exp.description}: ${fmt(exp.amount)}\n`;
  }
  text += `\n💰 *Итого: ${fmt(total)}*`;
  
  ctx.reply(text, { parse_mode: 'Markdown' });
});

// Кнопка "👨‍👩‍👧‍👦 Семья" — расходы всех за сегодня
bot.hears('👨‍👩‍👧‍👦 Семья', showFamilyToday);
bot.command('family', showFamilyToday);

async function showFamilyToday(ctx) {
  const family = getFamilyToday();
  
  if (family.total === 0) {
    return ctx.reply(`📭 Сегодня (${family.date}) семья ничего не тратила.`, mainMenu);
  }

  let text = `👨‍👩‍👧‍👦 *Семья сегодня (${family.date})*\n\n`;
  
  for (const [user, data] of Object.entries(family.byUser)) {
    text += `*${user}:* ${fmt(data.total)}\n`;
    for (const exp of data.expenses) {
      text += `  ${getEmoji(exp.category)} ${exp.description}: ${fmt(exp.amount)}\n`;
    }
    text += '\n';
  }
  
  text += `💰 *Всего: ${fmt(family.total)}*`;
  
  ctx.reply(text, { parse_mode: 'Markdown', ...mainMenu });
}

// ============ НАВИГАЦИЯ ПО МЕСЯЦАМ ============

function monthNavKeyboard(month, year, prefix) {
  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };

  const now = new Date();
  const isCurrentMonth = month === (now.getMonth() + 1) && year === now.getFullYear();

  const buttons = [
    Markup.button.callback('◀ Пред.', `${prefix}:${prev.m}.${prev.y}`),
  ];
  if (!isCurrentMonth) {
    buttons.push(Markup.button.callback('След. ▶', `${prefix}:${next.m}.${next.y}`));
  }

  return Markup.inlineKeyboard([buttons]);
}

function parseMonthYear(str) {
  const [m, y] = str.split('.').map(Number);
  return { month: m, year: y };
}

// Кнопка "📈 Месяц" — статистика за месяц
bot.hears('📈 Месяц', (ctx) => sendMonthlySummary(ctx));
bot.command('summary', (ctx) => sendMonthlySummary(ctx));

bot.action(/^sum:(\d+\.\d+)$/, async (ctx) => {
  const { month, year } = parseMonthYear(ctx.match[1]);
  await ctx.answerCbQuery();
  await sendMonthlySummary(ctx, month, year, true);
});

async function sendMonthlySummary(ctx, month = null, year = null, editMessage = false) {
  const summary = getFamilySummary(month, year);

  if (summary.total === 0) {
    const msg = `📭 ${summary.monthName} — записей нет.`;
    const nav = monthNavKeyboard(summary.month, summary.year, 'sum');
    if (editMessage) {
      return ctx.editMessageText(msg, nav);
    }
    return ctx.reply(msg, { ...mainMenu, ...nav });
  }

  let text = `📊 *${summary.monthName}*\n\n`;

  text += `*По категориям:*\n`;
  const sortedCats = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
  for (const [cat, amount] of sortedCats) {
    text += `${getEmoji(cat)} ${cat}: ${fmt(amount)}\n`;
  }

  text += `\n*По членам семьи:*\n`;
  for (const [user, data] of Object.entries(summary.byUser)) {
    text += `👤 ${user}: ${fmt(data.total)}\n`;
  }

  text += `\n💰 *Итого: ${fmt(summary.total)}*`;

  const nav = monthNavKeyboard(summary.month, summary.year, 'sum');
  if (editMessage) {
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...nav });
  }
  ctx.reply(text, { parse_mode: 'Markdown', ...mainMenu, ...nav });
}

// Кнопка "📉 Диаграмма"
bot.hears('📉 Диаграмма', (ctx) => sendChart(ctx));
bot.command('chart', (ctx) => sendChart(ctx));

bot.action(/^chart:(\d+\.\d+)$/, async (ctx) => {
  const { month, year } = parseMonthYear(ctx.match[1]);
  await ctx.answerCbQuery();
  await sendChart(ctx, month, year);
});

async function sendChart(ctx, month = null, year = null) {
  const statusMsg = await ctx.reply('🔄 Генерирую диаграмму...');

  try {
    const image = await generateChartImage(month, year);

    if (!image) {
      return ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, null,
        '📭 Нет данных для диаграммы за выбранный период.'
      );
    }

    // Определяем month/year для навигации
    const now = new Date();
    const m = month || (now.getMonth() + 1);
    const y = year || now.getFullYear();
    const nav = monthNavKeyboard(m, y, 'chart');

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    await ctx.replyWithPhoto(
      { source: image, filename: 'chart.png' },
      { caption: '📉 Расходы семьи по дням\nСтолбцы — факт, пунктир — план', ...nav }
    );
  } catch (err) {
    console.error('Chart error:', err);
    ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, null,
      '❌ Ошибка генерации диаграммы.'
    );
  }
}

// Кнопка "📎 Экспорт"
bot.hears('📎 Экспорт', exportData);
bot.command('export', exportData);

async function exportData(ctx) {
  try {
    const csv = exportCSV();
    const filename = `expenses_${formatDateFile(new Date())}.csv`;
    
    await ctx.replyWithDocument({
      source: Buffer.from(csv, 'utf-8'),
      filename
    }, { caption: '📎 Выгрузка расходов' });
  } catch (err) {
    console.error('Export error:', err);
    ctx.reply('❌ Ошибка экспорта.');
  }
}

// ============ ОБРАБОТКА ТЕКСТА ============

bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  
  const userId = ctx.from.id;
  const session = sessions.get(userId);
  
  // Если есть активная сессия формы
  if (session) {
    // Ввод суммы вручную
    if (session.step === 'amount') {
      const amount = parseInt(text.replace(/\s/g, ''));
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('❌ Введи корректную сумму (число больше 0)');
      }
      
      session.amount = amount;
      session.step = 'description';
      sessions.set(userId, session);
      
      return ctx.reply(
        `${getEmoji(session.category)} *${session.category}*: ${fmt(amount)}\n\n` +
        `Напиши описание (или «-» чтобы пропустить):`,
        { parse_mode: 'Markdown' }
      );
    }
    
    // Ввод описания
    if (session.step === 'description') {
      const description = text === '-' ? session.category.toLowerCase() : text;
      const userName = ctx.from.first_name || 'User';
      const today = formatDate(new Date());
      
      await appendExpenses([{
        date: today,
        category: session.category,
        description,
        amount: session.amount,
        user: userName
      }]);
      
      sessions.delete(userId);
      
      return ctx.reply(
        `✅ *Записано:*\n\n` +
        `${getEmoji(session.category)} ${description}: ${fmt(session.amount)}`,
        { parse_mode: 'Markdown', ...mainMenu }
      );
    }
  }
  
  // Свободный ввод через AI
  const statusMsg = await ctx.reply('🔄 Обрабатываю...');
  
  try {
    const userName = ctx.from.first_name || 'User';
    const { expenses, model } = await parseExpenses(text);
    
    if (!expenses || expenses.length === 0) {
      return ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, null,
        '🤔 Не удалось распознать.\n\nПример: «продукты 2300, кафе 1500»\nИли нажми «➕ Добавить»'
      );
    }
    
    const withUser = expenses.map(e => ({ ...e, user: userName }));
    await appendExpenses(withUser);
    
    let response = '✅ *Записано:*\n\n';
    let total = 0;
    
    for (const exp of expenses) {
      response += `${getEmoji(exp.category)} ${exp.description}: ${fmt(exp.amount)} _(${exp.date})_\n`;
      total += exp.amount;
    }
    
    response += `\n💰 Итого: *${fmt(total)}*`;
    
    if (model) {
      const shortModel = model.split('/').pop();
      response += `\n\n_via ${shortModel}_`;
    }
    
    ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, null,
      response, { parse_mode: 'Markdown' }
    );
    
  } catch (err) {
    console.error('Processing error:', err);
    ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, null,
      '❌ Ошибка. Попробуй «➕ Добавить» для ручного ввода.'
    );
  }
});

// ============ HELPERS ============

function getEmoji(category) {
  const map = {
    'Продукты': '🛒', 'Кафе': '🍽', 'Транспорт': '🚇',
    'Одежда': '👗', 'Медицина': '💊', 'Развлечения': '🎮',
    'Дети': '👶', 'Дом': '🏠', 'Связь': '📱', 'Прочее': '❓'
  };
  return map[category] || '❓';
}

function fmt(n) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency', currency: 'RUB', minimumFractionDigits: 0
  }).format(n);
}

function formatDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function formatDateFile(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============ ЗАПУСК ============

async function start() {
  await loadData();
  
  if (config.remindersEnabled) {
    initReminders(bot);
  }
  
  await bot.launch();
  console.log('🤖 Бот запущен');
}

start();

process.once('SIGINT', async () => {
  stopReminders();
  await flushData();
  bot.stop('SIGINT');
});
process.once('SIGTERM', async () => {
  stopReminders();
  await flushData();
  bot.stop('SIGTERM');
});
