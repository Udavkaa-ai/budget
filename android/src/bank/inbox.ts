import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import Constants from 'expo-constants';
import { openDb } from '../classifier/db';
import { predict, learn } from '../classifier';
import { getCategories } from '../categories';
import { expenses, cashflow, currentUserName } from '../api/client';
import { queueExpense, isNetworkError } from '../offline';
import { IS_PERSONAL } from '../appScheme';
import { parseBankMessage, isSensitive, type ParsedBank } from './parse';

// «Входящие из банка»: распознанные покупки и переводы ждут подтверждения
// одним тапом. Источники: «Поделиться → ФИНИК» (все сборки) и, в личной сборке,
// перехваченные СМС/уведомления (нативный модуль FinikBank).
// Всё хранится только на телефоне (SQLite); исходные тексты — тоже только тут.

// income — доход до этой версии; income-wait — ждёт 10 минут, не окажется ли
// переводом между своими счетами; own — оказался; income-added — записан в кэшфлоу
export type InboxStatus = 'pending' | 'added' | 'dismissed' | 'income' | 'income-wait' | 'own' | 'income-added';
export interface InboxItem extends ParsedBank {
  id: number;
  source: 'sms' | 'push' | 'share';
  from: string;
  ts: number;              // время сообщения, мс
  category: string;        // подсказка классификатора
  status: InboxStatus;
  guess?: 'balance';       // не из сообщения, а найдено по разнице балансов
}
export interface JournalEntry { id: number; ts: number; source: string; from: string; kind: string; summary: string; raw?: string }

const Bank = NativeModules.FinikBank as undefined | {
  drain(): Promise<string>;
  status(): Promise<string>;
  setEnabled(kind: 'sms' | 'push', on: boolean): void;
  setSenders(list: string[]): void;
  setPackages(list: string[]): void;
  startDiscover(minutes: number): void;
  openNotificationAccess(): void;
  rebind?(): void;
};
const Share = NativeModules.FinikShare as undefined | { consume(): Promise<string | null> };

// Перехват СМС/уведомлений есть только в личной сборке (и только там есть натив)
export const isPersonalBuild = !!Bank && (IS_PERSONAL || Constants.expoConfig?.extra?.variant === 'personal');

const listeners = new Set<() => void>();
export function onInboxChange(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
const notify = () => listeners.forEach(l => l());

let rawColumn = false;
async function db() {
  const d = await openDb();
  await d.execAsync(`CREATE TABLE IF NOT EXISTS bank_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL, status TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS bank_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT, sender TEXT, kind TEXT, summary TEXT);
    CREATE TABLE IF NOT EXISTS bank_prefs (k TEXT PRIMARY KEY, v TEXT);`);
  // текст сообщения (кроме кодов) — чтобы по журналу можно было дописать шаблон
  if (!rawColumn) { try { await d.execAsync('ALTER TABLE bank_journal ADD COLUMN raw TEXT'); } catch { /* уже есть */ } rawColumn = true; }
  return d;
}

const fmt = (n?: number) => n == null ? '—' : new Intl.NumberFormat('ru-RU').format(n) + ' ₽';

async function journal(source: string, from: string, p: ParsedBank, extra = '', raw = '') {
  const d = await db();
  const summary = p.kind === 'ignore'
    ? `пропущено: ${p.reason}`                       // текст кода не пишем даже в журнал
    : `${fmt(p.amount)}${p.merchant ? ' · ' + p.merchant : ''}${p.reason ? ' · ' + p.reason : ''}${extra}`;
  // Текст пропущенных сообщений (коды) не сохраняем никогда
  await d.runAsync('INSERT INTO bank_journal (ts, source, sender, kind, summary, raw) VALUES (?, ?, ?, ?, ?, ?)',
    [Date.now(), source, from, p.kind, summary, p.kind === 'ignore' ? null : raw.slice(0, 500)]);
  await d.runAsync('DELETE FROM bank_journal WHERE id NOT IN (SELECT id FROM bank_journal ORDER BY id DESC LIMIT 150)');
}

// ── Настройки (только на телефоне) ─────────────────────────────────────────────
async function getPref(k: string): Promise<string | null> {
  const d = await db();
  return (await d.getFirstAsync<{ v: string }>('SELECT v FROM bank_prefs WHERE k = ?', [k]))?.v ?? null;
}
async function setPref(k: string, v: string) {
  const d = await db();
  await d.runAsync('INSERT OR REPLACE INTO bank_prefs (k, v) VALUES (?, ?)', [k, v]);
}
// Доходы из банка — сразу в кэшфлоу (по умолчанию включено)
export async function getAutoIncome() { return (await getPref('autoIncome')) !== '0'; }
export async function setAutoIncome(on: boolean) { await setPref('autoIncome', on ? '1' : '0'); if (on) settleIncomes().catch(() => {}); }
// Служебные сообщения без суммы («Вы вошли в приложение», реклама) — в журнал
// не пишем, только считаем
export async function getSkippedCount() { return parseInt((await getPref('skipped')) || '0', 10) || 0; }

export async function getJournal(): Promise<JournalEntry[]> {
  const d = await db();
  // старые записи о служебных сообщениях без суммы (до этой версии писались)
  await d.runAsync(`DELETE FROM bank_journal WHERE kind = 'unknown' AND summary LIKE '%не нашлась сумма%'`);
  const rows = await d.getAllAsync<{ id: number; ts: number; source: string; sender: string; kind: string; summary: string; raw: string | null }>(
    'SELECT * FROM bank_journal ORDER BY id DESC LIMIT 150');
  return rows.map(r => ({ id: r.id, ts: r.ts, source: r.source, from: r.sender, kind: r.kind, summary: r.summary, raw: r.raw || undefined }));
}

export async function getInbox(status: InboxStatus = 'pending'): Promise<InboxItem[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ id: number; payload: string; status: string }>(
    'SELECT id, payload, status FROM bank_inbox WHERE status = ? ORDER BY ts DESC', [status]);
  return rows.map(r => ({ ...(JSON.parse(r.payload)), id: r.id, status: r.status as InboxStatus }));
}

// Одна операция часто приходит дважды (СМС + пуш, или пуш обновился) — тот же
// банк, тот же тип и та же сумма в пределах 10 минут
const WINDOW = 600_000;
async function nearby(ts: number) {
  const d = await db();
  const rows = await d.getAllAsync<{ id: number; payload: string; status: string }>(
    'SELECT id, payload, status FROM bank_inbox WHERE ts BETWEEN ? AND ?', [ts - WINDOW, ts + WINDOW]);
  return rows.map(r => ({ id: r.id, status: r.status, p: JSON.parse(r.payload) as ParsedBank }));
}

// Сверка баланса: банк не всегда шлёт уведомление (ВТБ при переводе из самого
// приложения показывает только баннер внутри). Но баланс в следующем сообщении
// по тому же счёту его выдаёт: было B, пришла покупка A, стало не B−A, а меньше —
// значит, было списание без уведомления. Кладём его во «Входящие» на проверку.
async function reconcileBalance(p: ParsedBank, source: InboxItem['source'], from: string, ts: number) {
  if (p.balance == null || !p.card || !p.amount) return;
  const key = `bal:${p.bank}|${p.card}`;
  const raw = await getPref(key);
  const last = raw ? JSON.parse(raw) as { bal: number; ts: number } : null;
  if (last && ts <= last.ts) return;                 // старое сообщение (дочитали СМС позже) — не сверяем
  await setPref(key, JSON.stringify({ bal: p.balance, ts }));
  if (!last || ts - last.ts > 7 * 86_400_000) return;
  const expected = last.bal + (p.kind === 'income' ? p.amount : -p.amount);
  const diff = Math.round((expected - p.balance) * 100) / 100;
  if (Math.abs(diff) < 1) return;
  const d = await db();
  if (diff > 0) {
    // Уже знаем об этой операции (поделились чеком, сообщение без баланса) — не дублируем
    const known = await d.getAllAsync<{ payload: string }>(
      'SELECT payload FROM bank_inbox WHERE ts > ? AND ts <= ?', [last.ts, ts]);
    if (known.some(r => { const k = JSON.parse(r.payload) as ParsedBank; return k.balance == null && Math.abs((k.amount || 0) - diff) < 1; })) return;
    // Время неизвестно — где-то между двумя сообщениями; ставим на секунду раньше текущего
    const missed: ParsedBank = { kind: 'purchase', bank: p.bank, amount: diff, merchant: '', card: p.card, reason: 'по балансу' };
    const item = { ...missed, source, from, ts: ts - 1000, category: 'Прочее', guess: 'balance' as const };
    await d.runAsync('INSERT INTO bank_inbox (payload, status, ts) VALUES (?, ?, ?)', [JSON.stringify(item), 'pending', ts - 1000]);
    await journal(source, from, missed, ' · списание без уведомления, найдено по балансу — во «Входящих»');
    notify();
  } else {
    await journal(source, from, { kind: 'income', bank: p.bank, amount: -diff, card: p.card, reason: 'по балансу' },
      ' · поступление без уведомления, найдено по балансу (в кэшфлоу не записано)');
  }
}

// Принять одно сообщение: разобрать, отбросить лишнее, положить во «Входящие»
export async function ingest(text: string, from: string, source: InboxItem['source'], ts = Date.now()): Promise<InboxItem | null> {
  const p = parseBankMessage(text, from);
  if (p.kind === 'unknown' && !p.amount) {
    await setPref('skipped', String((await getSkippedCount()) + 1));
    return null;
  }
  if (p.kind === 'ignore' || p.kind === 'unknown' || !p.amount) {
    await journal(source, from, p, '', text);
    return null;
  }
  const near = await nearby(ts);
  if (near.some(n => n.p.kind === p.kind && n.p.bank === p.bank && n.p.amount === p.amount)) {
    await journal(source, from, p, ' · дубль', text);
    return null;
  }
  const d = await db();
  await reconcileBalance(p, source, from, ts);

  // Поступление: запоминаем (во «Входящих» не показываем). Если рядом висит
  // исходящий перевод на ту же сумму из другого банка — это перевод между
  // своими счетами, а не расход: убираем его из «Входящих».
  if (p.kind === 'income') {
    const own = near.find(n => n.p.kind === 'transfer' && n.status === 'pending' && n.p.amount === p.amount && n.p.bank !== p.bank);
    // Без пары ждём 10 минут: перевод со своего счёта может прийти позже
    await d.runAsync('INSERT INTO bank_inbox (payload, status, ts) VALUES (?, ?, ?)', [JSON.stringify({ ...p, source, from, ts, category: '' }), own ? 'own' : 'income-wait', ts]);
    if (own) {
      await d.runAsync(`UPDATE bank_inbox SET status = 'dismissed' WHERE id = ?`, [own.id]);
      await journal(source, from, p, ' · перевод между своими счетами — убран из «Входящих»', text);
      notify();
    } else {
      await journal(source, from, p, (await getAutoIncome()) ? ' · доход — запишется в кэшфлоу' : ' · доход, не расход', text);
    }
    return null;
  }
  const pair = p.kind === 'transfer' && near.find(n => n.p.kind === 'income' && n.p.amount === p.amount && n.p.bank !== p.bank);
  if (pair) {
    // доход-пара — тоже не доход (если ещё не записан в кэшфлоу)
    if (pair.status === 'income-wait') await d.runAsync(`UPDATE bank_inbox SET status = 'own' WHERE id = ?`, [pair.id]);
    await d.runAsync('INSERT INTO bank_inbox (payload, status, ts) VALUES (?, ?, ?)', [JSON.stringify({ ...p, source, from, ts, category: 'Прочее' }), 'dismissed', ts]);
    await journal(source, from, p, ' · перевод между своими счетами — не расход', text);
    return null;
  }

  let category = 'Прочее';
  try {
    const r = await predict(p.merchant || '', getCategories());
    category = r.mode === 'auto' ? r.category : r.top3[0] || category;
  } catch { /* классификатор не готов — «Прочее» */ }
  const item = { ...p, source, from, ts, category };
  const res = await d.runAsync('INSERT INTO bank_inbox (payload, status, ts) VALUES (?, ?, ?)', [JSON.stringify(item), 'pending', ts]);
  await journal(source, from, p, ' · во «Входящих»', text);
  notify();
  return { ...item, id: Number(res.lastInsertRowId), status: 'pending' };
}

// Забрать то, что накопил нативный перехватчик (личная сборка)
let draining = false;
let rebound = false;
export async function drainNative(): Promise<number> {
  if (!Bank || draining) return 0;
  // Раз за запуск просим систему переподключить сервис уведомлений
  if (!rebound) { rebound = true; try { Bank.rebind?.(); } catch { /* старая сборка */ } }
  draining = true;
  let added = 0;
  try {
    const list = JSON.parse(await Bank.drain()) as Array<{ source: 'sms' | 'push'; from: string; text: string; ts: number }>;
    // Каждое сообщение — отдельно: раньше ошибка в одном теряла всю пачку
    // (из нативной очереди она уже забрана)
    for (const m of list) {
      try { if (await ingest(m.text, m.from, m.source, m.ts)) added++; }
      catch (e) {
        await journal(m.source, m.from, { kind: 'unknown', bank: 'Банк', reason: `ошибка разбора: ${String((e as Error)?.message || e).slice(0, 120)}` }, '', m.text).catch(() => {});
      }
    }
  } catch { /* не критично */ } finally { draining = false; }
  settleIncomes().catch(() => {});
  return added;
}

// Доходы, которые 10 минут не нашли пары-перевода со своего счёта, — в кэшфлоу
// месяца («Поступления» на графике остатка). Офлайн — попробуем в следующий раз.
let settling = false;
export async function settleIncomes(): Promise<number> {
  if (settling || !(await getAutoIncome())) return 0;
  const user = currentUserName();
  if (!user) return 0;
  settling = true;
  let n = 0;
  try {
    const d = await db();
    const rows = await d.getAllAsync<{ id: number; payload: string; ts: number }>(
      `SELECT id, payload, ts FROM bank_inbox WHERE status = 'income-wait' AND ts < ? ORDER BY ts`, [Date.now() - WINDOW]);
    const byMonth = new Map<string, Array<{ id: number; p: ParsedBank & { from?: string; source?: string }; ts: number }>>();
    for (const r of rows) {
      const dt = new Date(r.ts);
      const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym)!.push({ id: r.id, p: JSON.parse(r.payload), ts: r.ts });
    }
    for (const [ym, list] of byMonth) {
      const cf = await cashflow.get(ym);
      const incomeDays = [...(Array.isArray(cf.incomeDays) ? cf.incomeDays : [])];
      for (const it of list) incomeDays.push({ day: new Date(it.ts).getDate(), user, amount: Math.round(it.p.amount || 0) });
      await cashflow.save(ym, { ...cf, incomeDays });
      for (const it of list) {
        await d.runAsync(`UPDATE bank_inbox SET status = 'income-added' WHERE id = ?`, [it.id]);
        await journal(it.p.source || 'sms', it.p.from || '', it.p, ' · записан в кэшфлоу');
        n++;
      }
    }
  } finally { settling = false; }
  if (n) notify();
  return n;
}

// «Поделиться → ФИНИК»: возвращает текст, если он пришёл (и уже разобран во «Входящие»)
// Текст с кодом подтверждения не берём вовсе — ни во «Входящие», ни в ИИ-разбор.
export async function consumeShared(): Promise<{ text: string; item: InboxItem | null; sensitive: boolean } | null> {
  if (!Share) return null;
  const text = await Share.consume().catch(() => null);
  if (!text) return null;
  if (isSensitive(text)) { await journal('share', '', { kind: 'ignore', bank: 'Банк', reason: 'код подтверждения' }); return { text: '', item: null, sensitive: true }; }
  const item = await ingest(text, '', 'share');
  return { text, item, sensitive: false };
}

function toDate(ts: number) {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

async function setStatus(id: number, status: InboxStatus) {
  const d = await db();
  await d.runAsync('UPDATE bank_inbox SET status = ? WHERE id = ?', [status, id]);
  await d.runAsync(`DELETE FROM bank_inbox WHERE status != 'pending' AND ts < ?`, [Date.now() - 30 * 86_400_000]);
  notify();
}

// Подтвердить: становится обычным расходом (офлайн — в очередь), классификатор учится
// forUser — расход другого члена семьи (тратила жена с моей карты):
// запишется на неё с пометкой «Удав за Марину»
export async function accept(item: InboxItem, category: string, description?: string, forUser?: string) {
  const exp = {
    ...(forUser ? { forUser } : {}),
    date: toDate(item.ts),
    category,
    amount: item.amount || 0,
    description: (description ?? item.merchant ?? '').trim() || (item.guess ? 'Списание без уведомления' : item.kind === 'transfer' ? 'Перевод' : item.bank),
  };
  try {
    await expenses.add({ expenses: [exp] });
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await queueExpense(exp);
  }
  if (item.merchant) learn(item.merchant, category).catch(() => {});
  await setStatus(item.id, 'added');
}

export async function dismiss(item: InboxItem) { await setStatus(item.id, 'dismissed'); }

// ── Настройки личной сборки ────────────────────────────────────────────────────
export interface BankStatus {
  notificationAccess: boolean; sms: boolean; push: boolean; smsPermission: boolean;
  dropped: number; senders: string[]; packages: string[]; discovered: string[]; discoverUntil: number;
  smsSeen: number; smsFrom: string[]; smsRead: boolean;
  pushSeen?: number; pushLast?: number; listenerOn?: number; listenerOff?: number;
}
export async function getBankStatus(): Promise<BankStatus | null> {
  if (!Bank) return null;
  const s = JSON.parse(await Bank.status());
  const smsPermission = Platform.OS === 'android'
    ? await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS) : false;
  const smsRead = Platform.OS === 'android'
    ? await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS) : false;
  return { ...s, smsPermission, smsRead };
}
export async function requestSmsPermission() {
  // RECEIVE_SMS — ловить СМС сразу; READ_SMS — дочитать пропущенные из входящих,
  // если прошивка не пустила СМС в фоне
  const r = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
    PermissionsAndroid.PERMISSIONS.READ_SMS,
  ]);
  return r[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED;
}
export const bankNative = {
  setEnabled: (k: 'sms' | 'push', on: boolean) => Bank?.setEnabled(k, on),
  setSenders: (l: string[]) => Bank?.setSenders(l),
  setPackages: (l: string[]) => Bank?.setPackages(l),
  startDiscover: (min: number) => Bank?.startDiscover(min),
  openNotificationAccess: () => Bank?.openNotificationAccess(),
};
