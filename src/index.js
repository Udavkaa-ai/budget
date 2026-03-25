import { Telegraf, Markup } from 'telegraf';
import { config } from './config.js';
import { parseExpenses, CATEGORIES } from './parser.js';
import {
  loadData, appendExpenses,
  getTodaySummary, getFamilyDay, getFamilyToday,
  getFamilySummary, getChartData, exportCSV, flushData,
  getSettings, updateSetting, retagFixedExpenses,
  getExpensesForMonth, toggleExpenseFixed, getMonthName,
  getCategoryExpenses,
} from './storage.js';
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
    `/family — расходы семьи по дням\n` +
    `/summary — статистика за месяц\n` +
    `/chart — диаграмма расходов\n` +
    `/export — выгрузить CSV\n` +
    `/settings — настройки`,
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
    text += `${getEmoji(exp.category)} ${exp.description}: ${fmt(exp.amount)}${exp.isFixed ? ' 📌' : ''}\n`;
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
    text += `${getEmoji(exp.category)} ${exp.description}: ${fmt(exp.amount)}${exp.isFixed ? ' 📌' : ''}\n`;
  }
  text += `\n💰 *Итого: ${fmt(total)}*`;

  ctx.reply(text, { parse_mode: 'Markdown' });
});

// ============ ПРОСМОТР ПО ДНЯМ ============

// Клавиатура навигации по дням
function dayNavKeyboard(dateStr) {
  const [d, m, y] = dateStr.split('.').map(Number);
  const date = new Date(y, m - 1, d);

  const prevDate = new Date(date);
  prevDate.setDate(prevDate.getDate() - 1);

  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + 1);

  const todayStr = formatDate(new Date());
  const isToday = dateStr === todayStr;

  const prevStr = formatDate(prevDate);
  const nextStr = formatDate(nextDate);

  const buttons = [
    Markup.button.callback('◀ Пред.', `fam:${prevStr}`),
  ];
  if (!isToday) {
    buttons.push(Markup.button.callback('След. ▶', `fam:${nextStr}`));
  }

  return Markup.inlineKeyboard([buttons]);
}

// Кнопка "👨‍👩‍👧‍👦 Семья" — расходы всех за день (с навигацией)
bot.hears('👨‍👩‍👧‍👦 Семья', (ctx) => showFamilyDay(ctx));
bot.command('family', (ctx) => showFamilyDay(ctx));

// Навигация по дням
bot.action(/^fam:(\d{2}\.\d{2}\.\d{4})$/, async (ctx) => {
  const dateStr = ctx.match[1];
  await ctx.answerCbQuery();
  await showFamilyDay(ctx, dateStr, true);
});

async function showFamilyDay(ctx, dateStr = null, editMessage = false) {
  const targetDate = dateStr || formatDate(new Date());
  const family = getFamilyDay(targetDate);
  const nav = dayNavKeyboard(targetDate);

  if (family.total === 0) {
    const msg = `📭 ${targetDate} — семья ничего не тратила.`;
    if (editMessage) return ctx.editMessageText(msg, nav);
    return ctx.reply(msg, { ...mainMenu, ...nav });
  }

  let text = `👨‍👩‍👧‍👦 *Семья (${targetDate})*\n\n`;

  for (const [user, userData] of Object.entries(family.byUser)) {
    text += `*${user}:* ${fmt(userData.total)}\n`;
    for (const exp of userData.expenses) {
      text += `  ${getEmoji(exp.category)} ${exp.description}: ${fmt(exp.amount)}${exp.isFixed ? ' 📌' : ''}\n`;
    }
    text += '\n';
  }

  text += `💰 *Всего: ${fmt(family.total)}*`;

  if (editMessage) {
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...nav });
  }
  ctx.reply(text, { parse_mode: 'Markdown', ...mainMenu, ...nav });
}

// ============ НАВИГАЦИЯ ПО МЕСЯЦАМ ============

function parseMonthYear(str) {
  const [m, y] = str.split('.').map(Number);
  return { month: m, year: y };
}

// Клавиатура месяца + кнопка "без постоянных" + кнопки категорий
function summaryKeyboard(month, year, excludeFixed, sortedCats) {
  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };

  const now = new Date();
  const isCurrentMonth = month === (now.getMonth() + 1) && year === now.getFullYear();

  const navRow = [Markup.button.callback('◀ Пред.', `sum:${prev.m}.${prev.y}`)];
  if (!isCurrentMonth) {
    navRow.push(Markup.button.callback('След. ▶', `sum:${next.m}.${next.y}`));
  }

  const toggleRow = [Markup.button.callback(
    excludeFixed ? '✅ С постоянными' : '🚫 Без постоянных',
    `sum_fixed:${month}.${year}`
  )];

  // Кнопки категорий (по 2 в ряд)
  const catRows = [];
  for (let i = 0; i < sortedCats.length; i += 2) {
    const row = [
      Markup.button.callback(
        `${getEmoji(sortedCats[i][0])} ${sortedCats[i][0]}`,
        `cat_detail:${sortedCats[i][0]}.${month}.${year}`
      )
    ];
    if (sortedCats[i + 1]) {
      row.push(Markup.button.callback(
        `${getEmoji(sortedCats[i + 1][0])} ${sortedCats[i + 1][0]}`,
        `cat_detail:${sortedCats[i + 1][0]}.${month}.${year}`
      ));
    }
    catRows.push(row);
  }

  return Markup.inlineKeyboard([navRow, toggleRow, ...catRows]);
}

// Клавиатура навигации месяцев для диаграммы
function chartNavKeyboard(month, year) {
  const prev = month === 1 ? { m: 12, y: year - 1 } : { m: month - 1, y: year };
  const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };

  const now = new Date();
  const isCurrentMonth = month === (now.getMonth() + 1) && year === now.getFullYear();

  const buttons = [Markup.button.callback('◀ Пред.', `chart:${prev.m}.${prev.y}`)];
  if (!isCurrentMonth) {
    buttons.push(Markup.button.callback('След. ▶', `chart:${next.m}.${next.y}`));
  }

  return Markup.inlineKeyboard([buttons]);
}

// Кнопка "📈 Месяц" — статистика за месяц
bot.hears('📈 Месяц', (ctx) => sendMonthlySummary(ctx));
bot.command('summary', (ctx) => sendMonthlySummary(ctx));

bot.action(/^sum:(\d+\.\d+)$/, async (ctx) => {
  const { month, year } = parseMonthYear(ctx.match[1]);
  await ctx.answerCbQuery();
  await sendMonthlySummary(ctx, month, year, true);
});

// Переключение "без постоянных" в статистике
bot.action(/^sum_fixed:(\d+\.\d+)$/, async (ctx) => {
  const { month, year } = parseMonthYear(ctx.match[1]);
  const settings = getSettings();
  await updateSetting('excludeFixed', !settings.excludeFixed);
  await ctx.answerCbQuery();
  await sendMonthlySummary(ctx, month, year, true);
});

async function sendMonthlySummary(ctx, month = null, year = null, editMessage = false) {
  const { excludeFixed } = getSettings();
  const summary = getFamilySummary(month, year, excludeFixed || false);

  const sortedCats = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
  const nav = summaryKeyboard(summary.month, summary.year, excludeFixed || false, sortedCats);

  if (summary.total === 0) {
    const msg = `📭 ${summary.monthName} — записей нет.`;
    if (editMessage) return ctx.editMessageText(msg, nav);
    return ctx.reply(msg, { ...mainMenu, ...nav });
  }

  let text = `📊 *${summary.monthName}*`;
  if (excludeFixed) text += ` _(без постоянных)_`;
  text += `\n\n`;

  text += `*По категориям:*\n`;
  for (const [cat, amount] of sortedCats) {
    text += `${getEmoji(cat)} ${cat}: ${fmt(amount)}\n`;
  }

  text += `\n*По членам семьи:*\n`;
  for (const [user, data] of Object.entries(summary.byUser)) {
    text += `👤 ${user}: ${fmt(data.total)}\n`;
  }

  text += `\n💰 *Итого: ${fmt(summary.total)}*`;
  text += `\n_↓ нажми категорию для детализации_`;

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
  const { excludeFixed } = getSettings();

  try {
    const image = await generateChartImage(month, year, excludeFixed || false);

    if (!image) {
      return ctx.telegram.editMessageText(
        ctx.chat.id, statusMsg.message_id, null,
        '📭 Нет данных для диаграммы за выбранный период.'
      );
    }

    const now = new Date();
    const m = month || (now.getMonth() + 1);
    const y = year || now.getFullYear();
    const nav = chartNavKeyboard(m, y);

    const caption = `📉 Расходы семьи по дням${excludeFixed ? ' (без постоянных)' : ''}\nСтолбцы — факт, пунктир — план`;

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
    await ctx.replyWithPhoto(
      { source: image, filename: 'chart.png' },
      { caption, ...nav }
    );
  } catch (err) {
    console.error('Chart error:', err);
    ctx.telegram.editMessageText(
      ctx.chat.id, statusMsg.message_id, null,
      '❌ Ошибка генерации диаграммы.'
    );
  }
}

// ============ НАСТРОЙКИ ============

bot.command('settings', (ctx) => showSettings(ctx));

bot.action('toggle_fixed', async (ctx) => {
  const settings = getSettings();
  await updateSetting('excludeFixed', !settings.excludeFixed);
  await ctx.answerCbQuery();
  await showSettings(ctx, true);
});

bot.action('mark_fixed_open', async (ctx) => {
  await ctx.answerCbQuery();
  await showMarkFixed(ctx, 0, null, null, true);
});

bot.action('retag_fixed', async (ctx) => {
  const count = await retagFixedExpenses();
  await ctx.answerCbQuery(count > 0 ? `📌 Помечено ${count} записей` : 'Новых записей не найдено');
  await showSettings(ctx, true);
});

async function showSettings(ctx, editMessage = false) {
  const settings = getSettings();
  const excludeFixed = settings.excludeFixed || false;

  const fixedTotal = config.fixedExpensesList.reduce((s, f) => s + f.amount, 0);

  let text = `⚙️ *Настройки*\n\n`;
  text += `*Постоянные расходы:*\n`;
  for (const f of config.fixedExpensesList) {
    text += `• ${f.name}: ${fmt(f.amount)}\n`;
  }
  text += `• Итого: ${fmt(fixedTotal)}\n\n`;
  text += `Режим: ${excludeFixed ? '🚫 Не учитываются в статистике' : '✅ Учитываются в статистике'}\n\n`;
  text += `_📌 Расходы помечаются автоматически по ключевым словам: ${config.fixedKeywords.join(', ')}_`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(
      excludeFixed ? '✅ Включить постоянные' : '🚫 Исключить постоянные',
      'toggle_fixed'
    )],
    [Markup.button.callback('📋 Разметить расходы вручную', 'mark_fixed_open')],
    [Markup.button.callback('🔄 Пересканировать по ключевым словам', 'retag_fixed')],
  ]);

  if (editMessage) {
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  }
  ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

// ============ РУЧНАЯ РАЗМЕТКА ПОСТОЯННЫХ РАСХОДОВ ============

const MF_PAGE_SIZE = 8;

bot.command('mark_fixed', (ctx) => showMarkFixed(ctx));

// Пагинация списка
bot.action(/^mf_page:(\d+)\.(\d+)\.(\d+)$/, async (ctx) => {
  const [page, month, year] = ctx.match.slice(1).map(Number);
  await ctx.answerCbQuery();
  await showMarkFixed(ctx, page, month, year, true);
});

// Переключение конкретной записи: mf_tog:ID.page.month.year
bot.action(/^mf_tog:([^.]+)\.(\d+)\.(\d+)\.(\d+)$/, async (ctx) => {
  const id = ctx.match[1];
  const [page, month, year] = ctx.match.slice(2).map(Number);
  await toggleExpenseFixed(id);
  await ctx.answerCbQuery();
  await showMarkFixed(ctx, page, month, year, true);
});

// Смена месяца в разметке
bot.action(/^mf_month:(\d+)\.(\d+)$/, async (ctx) => {
  const [month, year] = ctx.match.slice(1).map(Number);
  await ctx.answerCbQuery();
  await showMarkFixed(ctx, 0, month, year, true);
});

// Возврат в настройки из разметки
bot.action('settings', async (ctx) => {
  await ctx.answerCbQuery();
  await showSettings(ctx, true);
});

async function showMarkFixed(ctx, page = 0, month = null, year = null, editMessage = false) {
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();

  const expenses = getExpensesForMonth(m, y);
  const totalPages = Math.max(1, Math.ceil(expenses.length / MF_PAGE_SIZE));
  const curPage = Math.min(page, totalPages - 1);
  const pageItems = expenses.slice(curPage * MF_PAGE_SIZE, (curPage + 1) * MF_PAGE_SIZE);

  const fixedCount = expenses.filter(e => e.isFixed).length;
  const monthLabel = getMonthName(m, y);

  let text = `📋 *Разметка постоянных — ${monthLabel}*\n`;
  text += `_📌 помечено: ${fixedCount} из ${expenses.length}_\n\n`;
  text += `Нажми на запись, чтобы пометить/снять как постоянную:`;

  const rows = [];

  if (expenses.length === 0) {
    text = `📭 В ${monthLabel} записей нет.`;
  } else {
    for (const exp of pageItems) {
      const icon = exp.isFixed ? '📌' : '⬜';
      const desc = exp.description.length > 13 ? exp.description.slice(0, 13) + '…' : exp.description;
      const amt = exp.amount.toLocaleString('ru-RU');
      rows.push([Markup.button.callback(
        `${icon} ${exp.date.slice(0, 5)} ${getEmoji(exp.category)} ${desc}: ${amt}₽`,
        `mf_tog:${exp.id}.${curPage}.${m}.${y}`
      )]);
    }
  }

  // Навигация по страницам
  const pageNav = [];
  if (curPage > 0) pageNav.push(Markup.button.callback('◀', `mf_page:${curPage - 1}.${m}.${y}`));
  if (totalPages > 1) pageNav.push(Markup.button.callback(`${curPage + 1}/${totalPages}`, 'noop'));
  if (curPage < totalPages - 1) pageNav.push(Markup.button.callback('▶', `mf_page:${curPage + 1}.${m}.${y}`));
  if (pageNav.length > 0) rows.push(pageNav);

  // Навигация по месяцам
  const prevM = m === 1 ? { m: 12, y: y - 1 } : { m: m - 1, y: y };
  const nextM = m === 12 ? { m: 1, y: y + 1 } : { m: m + 1, y: y };
  const isCurrentMonth = m === (now.getMonth() + 1) && y === now.getFullYear();
  const monthNav = [Markup.button.callback('◀ Пред. мес.', `mf_month:${prevM.m}.${prevM.y}`)];
  if (!isCurrentMonth) monthNav.push(Markup.button.callback('След. мес. ▶', `mf_month:${nextM.m}.${nextM.y}`));
  rows.push(monthNav);

  rows.push([Markup.button.callback('⬅️ Назад к настройкам', 'settings')]);

  const keyboard = Markup.inlineKeyboard(rows);
  if (editMessage) {
    return ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  }
  ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
}

bot.action('noop', (ctx) => ctx.answerCbQuery());

// ============ ДЕТАЛИЗАЦИЯ ПО КАТЕГОРИИ ============

// cat_detail:Категория.месяц.год  или  cat_detail:Категория.месяц.год.фильтр
bot.action(/^cat_detail:(.+)\.(\d+)\.(\d+)(?:\.(.+))?$/, async (ctx) => {
  const category = ctx.match[1];
  const month = parseInt(ctx.match[2]);
  const year = parseInt(ctx.match[3]);
  const filter = ctx.match[4] || null;
  await ctx.answerCbQuery();
  await showCategoryDetail(ctx, category, month, year, filter, true);
});

async function showCategoryDetail(ctx, category, month, year, filter = null, editMessage = false) {
  const allExpenses = getCategoryExpenses(category, month, year);
  const monthLabel = getMonthName(month, year);

  // Уникальные пользователи в этой категории
  const users = [...new Set(allExpenses.map(e => e.user).filter(Boolean))];

  // Применяем фильтр по первой букве имени
  const activeFilter = filter === 'all' ? null : filter;
  const expenses = activeFilter
    ? allExpenses.filter(e => (e.user || '?')[0].toUpperCase() === activeFilter)
    : allExpenses;

  // Строка фильтров
  const filterRow = [
    Markup.button.callback(
      !activeFilter ? '✅ Все' : 'Все',
      `cat_detail:${category}.${month}.${year}.all`
    ),
    ...users.map(u => Markup.button.callback(
      activeFilter === u[0].toUpperCase() ? `✅ ${u}` : u,
      `cat_detail:${category}.${month}.${year}.${u[0].toUpperCase()}`
    ))
  ];

  const keyboard = Markup.inlineKeyboard([
    filterRow,
    [Markup.button.callback('⬅️ Назад к месяцу', `sum:${month}.${year}`)]
  ]);

  if (allExpenses.length === 0) {
    const msg = `📭 ${getEmoji(category)} ${category} — ${monthLabel}: записей нет.`;
    if (editMessage) return ctx.editMessageText(msg, keyboard);
    return ctx.reply(msg, keyboard);
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const filterLabel = activeFilter
    ? ` · ${users.find(u => u[0].toUpperCase() === activeFilter) || activeFilter}`
    : '';

  let text = `${getEmoji(category)} *${category} — ${monthLabel}${filterLabel}*\n\n`;

  for (const exp of expenses) {
    const who = (exp.user || '?')[0].toUpperCase();
    const fixed = exp.isFixed ? ' 📌' : '';
    text += `${exp.date.slice(0, 5)} *${who}*  ${exp.description}: ${fmt(exp.amount)}${fixed}\n`;
  }

  text += `\n💰 *Итого: ${fmt(total)}*`;

  if (editMessage) return ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
  ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
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
