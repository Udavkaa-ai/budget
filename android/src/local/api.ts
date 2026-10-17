import {
  allLocalExpenses, addLocalExpense, updateLocalExpense, getLocalDoc, setLocalDoc,
} from '../e2e/store';
import * as compute from '../e2e/compute';
import { syncNow } from '../e2e/sync';
import { BASE_CATEGORIES } from '../categories';
import { predict } from '../classifier';
import { localMe } from './mode';
import { hasAiKey, aiParseText, aiParseImage, aiParseAudio, aiAnalyze, aiChat } from '../ai/openrouter';

// Ответы «сервера» в режиме без сервера. api/client перенаправляет сюда все
// запросы, которые не покрыты локальным движком (e2e/compute): настройки семьи,
// категории, участники, разбор текста. Чего без сервера нет — понятная ошибка.

interface FamilySettings { familyName?: string; customCategories?: Array<{ name: string; emoji: string }>; members?: string[] }
const getFam = async () => (await getLocalDoc<FamilySettings>('settings'))?.value ?? {};
const setFam = async (v: FamilySettings) => { await setLocalDoc('settings', v, { dirty: true }); syncNow().catch(() => {}); };

export class LocalUnavailable extends Error {}
const unavailable = (what: string) => { throw new LocalUnavailable(`${what} — без сервера недоступно`); };

// Участники: кто встречается в расходах + я + добавленные вручную
async function members(): Promise<string[]> {
  const set = new Set<string>([localMe(), ...((await getFam()).members ?? [])]);
  for (const e of await allLocalExpenses()) { if (e.user) set.add(e.user); if (e.addedBy) set.add(e.addedBy); }
  set.delete('');
  return [...set];
}

// Категории семьи: свои (сохранённые) + те, что есть в расходах, но не в базовом списке
async function customCategories() {
  const own = (await getFam()).customCategories ?? [];
  const known = new Set([...BASE_CATEGORIES, ...own.map(c => c.name)]);
  const extra = new Set<string>();
  for (const e of await allLocalExpenses()) if (e.category && !known.has(e.category)) extra.add(e.category);
  return [...own, ...[...extra].map(name => ({ name, emoji: '🏷️' }))];
}

// ── Разбор текста без ИИ: «продукты 2300, вчера такси 450» ──────────────────
const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
export async function parseTextLocally(text: string) {
  const cats = [...BASE_CATEGORIES, ...(await customCategories()).map(c => c.name)];
  const out: Array<{ date: string; category: string; amount: number; description: string }> = [];
  for (const raw of text.split(/[,;\n]+/)) {
    let s = raw.trim();
    if (!s) continue;
    const day = new Date();
    if (/(^|\s)позавчера(\s|$)/i.test(s)) { day.setDate(day.getDate() - 2); s = s.replace(/позавчера/i, ''); }
    else if (/(^|\s)вчера(\s|$)/i.test(s)) { day.setDate(day.getDate() - 1); s = s.replace(/вчера/i, ''); }
    const dm = s.match(/(^|\s)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s|$)/);
    if (dm) {
      const y = dm[4] ? (dm[4].length === 2 ? 2000 + +dm[4] : +dm[4]) : day.getFullYear();
      day.setFullYear(y, +dm[3] - 1, +dm[2]);
      s = s.replace(dm[0], ' ');
    }
    // сумма: последнее число («2 300», «450,50», «1.5к»)
    const nums = [...s.matchAll(/(\d[\d\s ]*(?:[.,]\d{1,2})?)\s*(к|тыс\.?|т\.?р\.?|р\.?|руб\.?|₽)?(?![\d])/gi)];
    const last = nums[nums.length - 1];
    if (!last) continue;
    let amount = parseFloat(last[1].replace(/[\s ]/g, '').replace(',', '.'));
    if (last[2] && /^(к|тыс)/i.test(last[2])) amount *= 1000;
    if (!(amount > 0)) continue;
    const description = (s.slice(0, last.index) + s.slice((last.index ?? 0) + last[0].length)).replace(/\s+/g, ' ').trim() || 'Расход';
    const direct = cats.find(c => c.toLowerCase() === description.toLowerCase());
    let category = direct || 'Прочее';
    if (!direct) {
      try { const r = await predict(description, cats); category = r.mode === 'auto' ? r.category : r.top3[0] || 'Прочее'; } catch { /* классификатор не готов */ }
    }
    out.push({ date: fmtDate(day), category, amount: Math.round(amount * 100) / 100, description });
  }
  return out;
}

// CSV (тот же формат, что экспорт): Дата;Категория;Описание;Сумма;Кто;…
async function importCsv(text: string) {
  let n = 0;
  for (const line of text.split(/\r?\n/).slice(1)) {
    const p = line.split(';').map(x => x.replace(/^"|"$/g, '').replace(/""/g, '"'));
    const amount = parseFloat((p[3] || '').replace(',', '.'));
    if (!/^\d{2}\.\d{2}\.\d{4}$/.test(p[0] || '') || !(amount > 0)) continue;
    await addLocalExpense({ date: p[0], category: p[1] || 'Прочее', description: p[2] || '', amount, user: p[4] || localMe(), createdAt: p[6] || new Date().toISOString() });
    n++;
  }
  syncNow().catch(() => {});
  return n;
}

export async function localRequest(method: string, path: string, body?: any): Promise<any> {
  const [p] = path.split('?');
  const seg = p.split('/').filter(Boolean).map(decodeURIComponent);   // ['api', ...]

  if (p === '/health') return { ok: true };
  if (p === '/api/me') return { name: localMe(), login: 'local', isAdmin: false };
  if (p === '/api/family/e2e') return { enabled: true, keyFingerprint: null };
  if (p === '/api/users') return (await members()).map(name => ({ name, login: name, family: 'local' }));

  if (p === '/api/settings' && method === 'GET') {
    const f = await getFam();
    const custom = await customCategories();
    return {
      familyName: f.familyName || '', plannedMonthly: await compute.getPlannedMonthly(),
      customCategories: custom, categories: [...BASE_CATEGORIES, ...custom.map(c => c.name)],
    };
  }
  if (p === '/api/settings' && method === 'PUT') {
    if (body?.key === 'plannedMonthly') { await compute.setPlannedMonthly(Number(body.value) || 0); return { ok: true }; }
    await setFam({ ...(await getFam()), [body?.key]: body?.value });
    return { ok: true };
  }
  if (p === '/api/categories' && method === 'POST') {
    const f = await getFam();
    const list = (f.customCategories ?? []).filter(c => c.name !== body?.name);
    await setFam({ ...f, customCategories: [...list, { name: String(body?.name || '').trim(), emoji: body?.emoji || '🏷️' }] });
    return { ok: true };
  }
  if (seg[1] === 'categories' && method === 'DELETE') {
    const name = seg[2];
    const f = await getFam();
    await setFam({ ...f, customCategories: (f.customCategories ?? []).filter(c => c.name !== name) });
    let moved = 0;
    for (const e of await allLocalExpenses()) if (e.category === name) { await updateLocalExpense(e.id, { category: 'Прочее' }); moved++; }
    syncNow().catch(() => {});
    return { ok: true, moved };
  }

  // ИИ — напрямую в OpenRouter с ключом владельца (Настройки › ИИ)
  const cats = async () => (await customCategories()).map(c => c.name);
  if (p === '/api/parse') {
    const text = String(body?.text || '');
    if (await hasAiKey()) {
      try { return await aiParseText(text, await cats()); } catch { /* ИИ недоступен — разбираем сами */ }
    }
    return { expenses: await parseTextLocally(text) };
  }
  if (seg[1] === 'parse-image' || seg[1] === 'parse-audio' || seg[1] === 'analyze' || seg[1] === 'analyze-raw' || seg[1] === 'chat') {
    if (!(await hasAiKey())) throw new LocalUnavailable('Нужен ключ OpenRouter — Настройки › ИИ');
  }
  if (seg[1] === 'parse-image') return aiParseImage(String(body?.base64 || ''), body?.mimeType || 'image/jpeg', await cats());
  if (seg[1] === 'parse-audio') return aiParseAudio(String(body?.base64 || ''), body?.format || 'aac', await cats());
  if (seg[1] === 'analyze-raw') return aiAnalyze(String(body?.reportText || ''));
  if (seg[1] === 'analyze') return aiAnalyze(await compute.buildAiReport(Number(body?.month), Number(body?.year)));
  if (seg[1] === 'chat') return aiChat(String(body?.context || ''), body?.messages || []);
  if (p === '/api/import') return { ok: true, imported: await importCsv(String(body?.csv || '')) };

  // Пушей с сервера нет — уведомления показывает сам телефон после синхронизации
  if (seg[1] === 'push') return p === '/api/push/settings' && method === 'GET' ? { enabled: false, detail: 'short' } : { ok: true };
  if (seg[1] === 'crowd') return method === 'GET' ? {} : { ok: true };

  if (seg[1] === 'support') unavailable('Поддержка');
  if (seg[1] === 'backup' || seg[1] === 'snapshot' || seg[1] === 'restore') unavailable('Резервные копии на сервере');
  if (seg[1] === 'invite') unavailable('Приглашение по ссылке');
  return unavailable('Эта функция');
}

export async function localText(path: string): Promise<string> {
  if (path.startsWith('/api/export')) return compute.exportCsv();
  return unavailable('Эта функция');
}
