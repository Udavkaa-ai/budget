import { config } from './config.js';

const CATEGORIES = [
  'Продукты',
  'Кафе', 
  'Транспорт',
  'Одежда',
  'Красота',
  'Медицина',
  'Развлечения',
  'Дети',
  'Дом',
  'Связь',
  'Прочее'
];

const SYSTEM_PROMPT = `Ты — парсер расходов. Извлеки из сообщения пользователя список трат.

Для каждой траты определи:
- date: дата в формате DD.MM.YYYY
- category: одна из [${CATEGORIES.join(', ')}]
- amount: сумма в рублях (число)
- description: краткое описание

Правила дат:
- "сегодня" = текущая дата
- "вчера" = текущая дата − 1 день
- "позавчера" = −2 дня
- "в понедельник/вторник/..." = ближайший прошедший день недели
- Если дата не указана → текущая дата

Категории:
- Продукты: еда, напитки, бытовая химия, магазины
- Кафе: рестораны, кофейни, доставка еды
- Транспорт: метро, автобус, такси, бензин
- Одежда: одежда, обувь, аксессуары
- Красота: косметика, парфюмерия, салон красоты, маникюр, стрижка
- Медицина: аптека, врачи, анализы, стоматолог
- Развлечения: кино, театр, игры, подписки
- Дети: кружки, игрушки, школа
- Дом: мебель, ремонт, техника
- Связь: телефон, интернет
- Прочее: всё остальное

Ответь ТОЛЬКО валидным JSON массивом, без markdown:
[{"date": "...", "category": "...", "amount": 0, "description": "..."}]

Если расходы не распознаны — верни []`;

/**
 * Запрос к одной модели с таймаутом
 */
async function callModel(model, userMessage) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeout);

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/budget-bot',
        'X-Title': 'Budget Tracker Bot'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage }
        ],
        temperature: 0.1,
        max_tokens: 1000
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const data = await response.json();
    
    // Проверяем на ошибки OpenRouter
    if (data.error) {
      throw new Error(data.error.message || 'OpenRouter error');
    }

    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty response');
    }

    return { success: true, content, model };

  } catch (error) {
    clearTimeout(timeout);
    return { success: false, error: error.message, model };
  }
}

/**
 * Парсит JSON ответ от модели
 */
function parseJson(content) {
  // Убираем markdown обёртки
  const clean = content
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();

  const expenses = JSON.parse(clean);
  
  if (!Array.isArray(expenses)) {
    throw new Error('Not an array');
  }

  // Валидация и фильтрация
  return expenses.filter(exp => 
    exp.date && 
    exp.category && 
    CATEGORIES.includes(exp.category) &&
    typeof exp.amount === 'number' && 
    exp.amount > 0
  );
}

/**
 * Основная функция — пробует модели по цепочке
 */
export async function parseExpenses(text) {
  const today = new Date();
  const todayStr = formatDate(today);
  const userMessage = `Сегодня: ${todayStr}\n\nРасходы: ${text}`;

  let lastError = null;

  for (const model of config.aiModels) {
    console.log(`🔄 Пробую модель: ${model}`);
    
    const result = await callModel(model, userMessage);
    
    if (!result.success) {
      console.warn(`⚠️  ${model}: ${result.error}`);
      lastError = result.error;
      continue; // fallback к следующей модели
    }

    try {
      const expenses = parseJson(result.content);
      console.log(`✅ ${model}: распознано ${expenses.length} записей`);
      return { expenses, model };
    } catch (parseError) {
      console.warn(`⚠️  ${model}: ошибка парсинга JSON — ${parseError.message}`);
      lastError = parseError.message;
      continue; // fallback
    }
  }

  // Все модели провалились
  console.error(`❌ Все модели недоступны. Последняя ошибка: ${lastError}`);
  return { expenses: [], model: null, error: lastError };
}

const ANALYSIS_SYSTEM_PROMPT = `Ты — финансовый советник семьи. Анализируй данные бюджета и составляй подробный, полезный отчёт на русском языке.

Структура (используй ровно эти заголовки с эмодзи):

## 💰 Общая картина
Итого потрачено, % от планового бюджета, темп трат (факт/ожидаемый по дням), сравнение с планом расходов.

## 📊 Расходы по категориям
Перерасход лимита — сортируй строго по АБСОЛЮТНОЙ сумме превышения (₽), а не по проценту. Категории с превышением меньше 3 000 ₽ или меньше 3% от общих расходов — не упоминай как проблему. Топ роста к прошлому месяцу по абсолютным суммам. Где удалось сэкономить.

## 📈 Тренды (3 месяца)
По каждой значимой категории: направление (↑↓→), масштаб изменений за 2–3 месяца. Выдели категории с устойчивым ростом расходов.

## 👥 Кто и на что тратит
Для каждого участника: итого, % от планового бюджета, топ-категории. Отдельно — у кого и в каких категориях перерасход значительный (>3 000 ₽).

## 🏦 Сбережения
Плановые vs фактические с учётом всего запланированного дохода за месяц (включая ещё не поступившие выплаты). Отклонение и его причины.

## ⚠️ Тревожные моменты
Только реально значимые перерасходы — категории, где превышение лимита >3 000 ₽ и >3% от общих расходов. Аномальные траты. Если месяц ещё не закончен — оцени риски с учётом ожидаемых доходов.

## 🎯 Корректировка лимитов
На основе данных за 3 месяца предложи конкретные изменения лимитов. Для каждой рекомендации укажи:
- Текущий лимит → рекомендуемый лимит (в ₽)
- Среднее фактических трат за 3 месяца
- Обоснование (устойчивый рост / систематическая экономия / лимит не задан но расходы есть)

Правила раздела:
- Предлагай ПОВЫСИТЬ лимит, если фактические траты устойчиво превышают его 2–3 месяца подряд (иначе лимит фиктивный).
- Предлагай СНИЗИТЬ лимит, если траты стабильно ниже лимита на >30% — свободный бюджет лучше перераспределить.
- Предлагай УСТАНОВИТЬ лимит для категорий без него, если траты регулярные и значительные (>2 000 ₽/мес в среднем).
- Если лимит адекватен трендам — напиши что менять не нужно (без перечисления каждой категории, только итоговый вывод).
- Округляй предложения до 500 ₽.
- Укажи итоговую сумму всех рекомендуемых лимитов и как она соотносится с плановым доходом.

## 💡 Рекомендации
5–7 конкретных действий на следующий месяц — адресованных конкретным людям или категориям где выявлены реальные проблемы. Не общие слова, а точные шаги.

Правила:
- Суммы в ₽, кратко и по делу, живой язык, без вступлений — сразу по делу.
- График доходов семьи: аванс поступает не позднее 10-го числа, зарплата — не позднее 25-го (если приходится на выходные — раньше). Это надёжные выплаты, сомнений нет.
- НЕ поднимай тревогу о том, что расходы превышают ПОЛУЧЕННЫЙ доход в текущем месяце — запланированный, но ещё не поступивший доход учитывается в разделе ДОХОДЫ как "Ожидается".
- При сравнении расходов с доходом используй ПЛАНОВЫЙ доход за месяц, а не только фактически полученное.
- Перерасход лимита по категории оценивай в ₽, а не в процентах — мелкие суммы не акцентируй.
- Если данных для раздела нет — пропусти его.`;

/**
 * Финансовый анализ бюджета семьи через AI
 */
export async function analyzeFinances(reportText) {
  if (!config.openRouterKey) {
    return { report: null, error: 'Нет API ключа' };
  }

  const analysisModels = [
    'google/gemini-2.5-flash-preview',
    'google/gemini-2.0-flash-001',
    ...config.aiModels,
  ].filter((m, i, arr) => arr.indexOf(m) === i); // deduplicate

  for (const model of analysisModels) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.openRouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/budget-bot',
          'X-Title': 'Budget Tracker Bot',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
            { role: 'user', content: reportText },
          ],
          temperature: 0.35,
          max_tokens: 2500,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!response.ok) {
        const txt = await response.text();
        console.warn(`Analysis ${model}: HTTP ${response.status}: ${txt.slice(0, 200)}`);
        continue;
      }

      const data = await response.json();
      if (data.error) { console.warn(`Analysis ${model}: ${data.error.message}`); continue; }

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) continue;

      console.log(`✅ Analysis via ${model}`);
      return { report: content, model };
    } catch (e) {
      clearTimeout(timeout);
      console.warn(`Analysis ${model}: ${e.message}`);
    }
  }

  return { report: null, error: 'Не удалось получить анализ' };
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

export { CATEGORIES };

/**
 * Парсинг расходов из изображения (банковские уведомления, скриншоты)
 * Использует vision-модель через OpenRouter
 */
export async function parseImageExpenses(base64, mimeType = 'image/jpeg') {
  if (!config.openRouterKey) {
    return { expenses: [], error: 'Нет API ключа' };
  }

  const todayStr = formatDate(new Date());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeout * 2);

  const visionModels = [
    'google/gemma-4-31b-it',
    'google/gemma-3-27b-it',
  ];

  for (const model of visionModels) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.openRouterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
              { type: 'text', text: `Сегодня: ${todayStr}\n\nЭто банковское уведомление, чек или скриншот с расходами. Извлеки список трат.\n\n${SYSTEM_PROMPT}\n\nОтветь ТОЛЬКО валидным JSON массивом, без markdown.` },
            ],
          }],
          temperature: 0.1,
          max_tokens: 1000,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!response.ok) continue;

      const data = await response.json();
      if (data.error) continue;

      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) continue;

      const expenses = parseJson(content);
      console.log(`✅ Vision ${model}: ${expenses.length} записей`);
      return { expenses, model };
    } catch {
      continue;
    }
  }

  clearTimeout(timeout);
  return { expenses: [], error: 'Не удалось распознать изображение' };
}
