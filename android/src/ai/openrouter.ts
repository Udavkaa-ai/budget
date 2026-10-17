import * as SecureStore from 'expo-secure-store';

// ИИ без сервера: телефон сам ходит в OpenRouter с ключом владельца.
// Ключ хранится только на телефоне (SecureStore), в код и облако не попадает.
// Промпты — те же, что были на сервере (src/parser.js), проверены на живых чеках.
//
// Модели: Gemini 3.1 Flash Lite понимает текст, фото и звук и стоит копейки;
// Gemma 3 27B — запасная для текста и фото (звук не понимает).

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const KEY = 'openrouter_key';
const MODELS_KEY = 'openrouter_models';
export const DEFAULT_MODELS = { main: 'google/gemini-3.1-flash-lite-preview', fallback: 'google/gemma-3-27b-it' };

let _key: string | null = null;
let _models = { ...DEFAULT_MODELS };
let _loaded = false;
async function load() {
  if (_loaded) return;
  _key = await SecureStore.getItemAsync(KEY).catch(() => null);
  try { const m = await SecureStore.getItemAsync(MODELS_KEY); if (m) _models = { ...DEFAULT_MODELS, ...JSON.parse(m) }; } catch { /* по умолчанию */ }
  _loaded = true;
}
export async function hasAiKey() { await load(); return !!_key; }
export async function getAiSettings() { await load(); return { key: _key || '', ..._models }; }
export async function setAiSettings(s: { key?: string; main?: string; fallback?: string }) {
  await load();
  if (s.key !== undefined) {
    _key = s.key.trim() || null;
    if (_key) await SecureStore.setItemAsync(KEY, _key); else await SecureStore.deleteItemAsync(KEY).catch(() => {});
  }
  if (s.main !== undefined || s.fallback !== undefined) {
    _models = { main: (s.main ?? _models.main).trim() || DEFAULT_MODELS.main, fallback: (s.fallback ?? _models.fallback).trim() || DEFAULT_MODELS.fallback };
    await SecureStore.setItemAsync(MODELS_KEY, JSON.stringify(_models));
  }
}

export class AiError extends Error {}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'input_audio'; input_audio: { data: string; format: string } };
type Msg = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

// Запрос с цепочкой моделей; возвращает текст ответа и какая модель ответила
async function complete(messages: Msg[], opts: { temperature: number; max_tokens: number; timeoutMs?: number; models?: string[] }) {
  await load();
  if (!_key) throw new AiError('Не задан ключ OpenRouter — Настройки › ИИ');
  const models = opts.models ?? [_models.main, _models.fallback];
  let last = '';
  for (const model of models.filter((m, i, a) => m && a.indexOf(m) === i)) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${_key}`, 'Content-Type': 'application/json', 'X-Title': 'FINIK' },
        body: JSON.stringify({ model, messages, temperature: opts.temperature, max_tokens: opts.max_tokens }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) throw new AiError('OpenRouter не принял ключ');
      if (res.status === 402) throw new AiError('На OpenRouter закончились средства');
      if (!res.ok || data?.error) { last = data?.error?.message || `HTTP ${res.status}`; continue; }
      const content = data?.choices?.[0]?.message?.content?.trim();
      if (!content) { last = 'пустой ответ'; continue; }
      return { content: String(content), model };
    } catch (e) {
      if (e instanceof AiError) throw e;
      last = (e as Error)?.name === 'AbortError' ? 'нет ответа' : String((e as Error)?.message || e);
    } finally { clearTimeout(timer); }
  }
  throw new AiError(`ИИ не ответил: ${last}`);
}

// ── Разбор расходов (текст / фото / голос) ────────────────────────────────────
const BASE = ['Продукты', 'Кафе', 'Транспорт', 'Авто', 'Одежда', 'Красота', 'Медицина', 'Развлечения', 'Дети', 'Дом', 'Связь', 'Прочее'];
function systemPrompt(extra: string[]) {
  const all = [...BASE, ...extra.filter(c => !BASE.includes(c))];
  const extraLines = extra.filter(c => !BASE.includes(c)).map(c => `- ${c}: пользовательская категория семьи`).join('\n');
  return `Ты — парсер расходов. Извлеки из сообщения пользователя список трат.

Для каждой траты определи:
- date: дата в формате DD.MM.YYYY
- category: одна из [${all.join(', ')}]
- amount: сумма в рублях (число)
- description: краткое описание

Правила дат:
- "сегодня" = текущая дата
- "вчера" = текущая дата − 1 день
- "позавчера" = −2 дня
- "в понедельник/вторник/..." = ближайший прошедший день недели
- Если дата не указана › текущая дата

Категории:
- Продукты: еда, напитки, бытовая химия, магазины
- Кафе: рестораны, кофейни, доставка еды
- Транспорт: метро, автобус, такси
- Авто: бензин, ОСАГО, ремонт, мойка, запчасти, автомойка
- Одежда: одежда, обувь, аксессуары
- Красота: косметика, парфюмерия, салон красоты, маникюр, стрижка
- Медицина: аптека, врачи, анализы, стоматолог
- Развлечения: кино, театр, игры, подписки
- Дети: кружки, игрушки, школа
- Дом: мебель, ремонт, техника
- Связь: телефон, интернет
- Прочее: всё остальное
${extraLines ? extraLines + '\n' : ''}
Ответь ТОЛЬКО валидным JSON массивом, без markdown:
[{"date": "...", "category": "...", "amount": 0, "description": "..."}]

Если расходы не распознаны — верни []`;
}
const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };

export type ParsedItem = { date: string; category: string; amount: number; description: string };
function parseJson(content: string, cats: string[]): ParsedItem[] {
  const clean = content.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
  const start = clean.indexOf('['), end = clean.lastIndexOf(']');
  const arr = JSON.parse(start >= 0 && end > start ? clean.slice(start, end + 1) : clean);
  if (!Array.isArray(arr)) throw new Error('не массив');
  const all = new Set([...BASE, ...cats]);
  return arr
    .map((e: any) => ({ date: String(e.date || today()), category: all.has(e.category) ? e.category : 'Прочее', amount: Number(e.amount), description: String(e.description || '') }))
    .filter(e => e.amount > 0 && /^\d{2}\.\d{2}\.\d{4}$/.test(e.date));
}

export async function aiParseText(text: string, cats: string[]) {
  const r = await complete([
    { role: 'system', content: systemPrompt(cats) },
    { role: 'user', content: `Сегодня: ${today()}\n\nРасходы: ${text}` },
  ], { temperature: 0.1, max_tokens: 1000 });
  return { expenses: parseJson(r.content, cats), model: r.model };
}

export async function aiParseImage(base64: string, mime: string, cats: string[]) {
  const r = await complete([{
    role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
      { type: 'text', text: `Сегодня: ${today()}\n\nЭто чек, банковское уведомление или скриншот с расходами. Извлеки список трат.\n\n${systemPrompt(cats)}\n\nОтветь ТОЛЬКО валидным JSON массивом, без markdown.` },
    ],
  }], { temperature: 0.1, max_tokens: 1500, timeoutMs: 60_000 });
  return { expenses: parseJson(r.content, cats), model: r.model };
}

// Голос: только основная модель (Gemma звук не понимает)
export async function aiParseAudio(base64: string, format: string, cats: string[]) {
  await load();
  const r = await complete([{
    role: 'user', content: [
      { type: 'input_audio', input_audio: { data: base64, format } },
      { type: 'text', text: `Сегодня: ${today()}\n\nЭто голосовое сообщение с расходами на русском. Извлеки список трат.\n\n${systemPrompt(cats)}\n\nОтветь ТОЛЬКО валидным JSON массивом, без markdown.` },
    ],
  }], { temperature: 0.1, max_tokens: 1000, timeoutMs: 60_000, models: [_models.main] });
  return { expenses: parseJson(r.content, cats), model: r.model };
}

// ── Анализ месяца и чат (промпты сервера) ─────────────────────────────────────
const sanitizeArrows = (s: string) => (s || '')
  .replace(/[→⟶➜➡⇒⟹➔➙🡒]/g, '›').replace(/[↑↗⬆🡑]/g, '▲').replace(/[↓↘⬇🡓]/g, '▼').replace(/[←⟵⬅🡐]/g, '‹');

const ANALYSIS_PROMPT = `Ты — финансовый советник семьи. Анализируй данные бюджета и составляй подробный, полезный отчёт на русском языке.

Структура (используй ровно эти заголовки с эмодзи):
## 💰 Общая картина
Итого потрачено и % от планового бюджета. Темп трат — сравни потраченное к сегодняшнему дню с нормой на этот день.
## 📊 Расходы по категориям
Перерасход лимита — сортируй по абсолютной сумме превышения (₽). Мелкие превышения (меньше 3 000 ₽ или меньше 3% расходов) не выделяй. Где удалось сэкономить.
## 👥 Кто и на что тратит
Для каждого участника: итого и топ-категории.
## ⚠️ Тревожные моменты
Только реально значимые перерасходы и аномальные траты.
## 💡 Рекомендации
5–7 конкретных действий на следующий месяц — не общие слова, а точные шаги.
Правила:
- Суммы в ₽, кратко и по делу, живой язык, без вступлений.
- Низкий % от месячного бюджета в начале месяца — это норма, а не экономия.
- Если данных для раздела нет — пропусти его.`;

export async function aiAnalyze(reportText: string) {
  const r = await complete([
    { role: 'system', content: ANALYSIS_PROMPT },
    { role: 'user', content: reportText },
  ], { temperature: 0.35, max_tokens: 2500, timeoutMs: 60_000 });
  return { report: sanitizeArrows(r.content), model: r.model };
}

const CHAT_PROMPT = `Ты — дружелюбный финансовый советник семьи. Отвечай кратко, по делу, на русском.
Тебе дают сводку бюджета семьи — суммы по категориям и по участникам.
Опирайся на эти цифры, давай конкретные практичные советы. Если для ответа данных не хватает — честно скажи и задай уточняющий вопрос.
Не выдумывай отдельные траты, которых нет в сводке. Форматируй ответ простым markdown, без гигантских простыней.`;

export async function aiChat(context: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
  const r = await complete([
    { role: 'system', content: CHAT_PROMPT },
    ...(context ? [{ role: 'system' as const, content: `Сводка бюджета семьи:\n${context}` }] : []),
    ...messages,
  ], { temperature: 0.5, max_tokens: 1200 });
  return { reply: sanitizeArrows(r.content), model: r.model };
}

// Проверка ключа и модели: короткий запрос
export async function aiPing() {
  const r = await complete([{ role: 'user', content: 'Ответь одним словом: работает' }], { temperature: 0, max_tokens: 10, timeoutMs: 20_000 });
  return r.model;
}
