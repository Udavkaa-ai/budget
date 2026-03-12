import { config } from './config.js';

const CATEGORIES = [
  'Продукты',
  'Кафе', 
  'Транспорт',
  'Одежда',
  'Медицина',
  'Развлечения',
  'Дети',
  'Дом',
  'Связь',
  'Прочее'
];

const SYSTEM_PROMPT = `Ты - парсер расходов. Извлеки из сообщения пользователя список трат.

Для каждой траты определи:
- date: дата в формате DD.MM.YYYY
- category: одна из [${CATEGORIES.join(', ')}]
- amount: сумма в рублях (число)
- description: краткое описание

Правила дат:
- "сегодня" = текущая дата
- "вчера" = текущая дата -1 день
- "позавчера" = −2 дня
- "в понедельник/вторник/..." = ближайший прошедший день недели
- Если дата не указана → текущая дата

Категории:
- Продукты: еда, напитки, бытовая химия, магазины
- Кафе: рестораны, кофейни, доставка еды
- Транспорт: метро, автобус, такси, бензин
- Одежда: одежда, обувь, аксессуары
- Медицина: аптека, врачи, анализы, стоматолог
- Развлечения: кино, театр, игры, подписки
- Дети: кружки, игрушки, школа
- Дом: мебель, ремонт, техника
- Связь: телефон, интернет
- Прочее: всё остальное

Ответь ТОЛЬКО валидным JSON массивом, без markdown:
[{"date": "...", "category": "...", "amount": 0, "description": "..."}]

Если расходы не распознаны - верни []`;

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
      console.warn(`⚠️  ${model}: ошибка парсинга JSON - ${parseError.message}`);
      lastError = parseError.message;
      continue; // fallback
    }
  }

  // Все модели провалились
  console.error(`❌ Все модели недоступны. Последняя ошибка: ${lastError}`);
  return { expenses: [], model: null, error: lastError };
}

function formatDate(date) {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

export { CATEGORIES };
