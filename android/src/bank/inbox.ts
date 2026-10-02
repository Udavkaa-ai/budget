import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import Constants from 'expo-constants';
import { openDb } from '../classifier/db';
import { predict, learn } from '../classifier';
import { getCategories } from '../categories';
import { expenses } from '../api/client';
import { queueExpense, isNetworkError } from '../offline';
import { IS_PERSONAL } from '../appScheme';
import { parseBankMessage, isSensitive, type ParsedBank } from './parse';

// «Входящие из банка»: распознанные покупки и переводы ждут подтверждения
// одним тапом. Источники: «Поделиться → ФИНИК» (все сборки) и, в личной сборке,
// перехваченные СМС/уведомления (нативный модуль FinikBank).
// Всё хранится только на телефоне (SQLite); исходные тексты — тоже только тут.

export type InboxStatus = 'pending' | 'added' | 'dismissed' | 'income';
export interface InboxItem extends ParsedBank {
  id: number;
  source: 'sms' | 'push' | 'share';
  from: string;
  ts: number;              // время сообщения, мс
  category: string;        // подсказка классификатора
  status: InboxStatus;
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
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT, sender TEXT, kind TEXT, summary TEXT);`);
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

export async function getJournal(): Promise<JournalEntry[]> {
  const d = await db();
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

// Принять одно сообщение: разобрать, отбросить лишнее, положить во «Входящие»
export async function ingest(text: string, from: string, source: InboxItem['source'], ts = Date.now()): Promise<InboxItem | null> {
  const p = parseBankMessage(text, from);
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

  // Поступление: запоминаем (во «Входящих» не показываем). Если рядом висит
  // исходящий перевод на ту же сумму из другого банка — это перевод между
  // своими счетами, а не расход: убираем его из «Входящих».
  if (p.kind === 'income') {
    await d.runAsync('INSERT INTO bank_inbox (payload, status, ts) VALUES (?, ?, ?)', [JSON.stringify({ ...p, source, from, ts }), 'income', ts]);
    const own = near.find(n => n.p.kind === 'transfer' && n.status === 'pending' && n.p.amount === p.amount && n.p.bank !== p.bank);
    if (own) {
      await d.runAsync(`UPDATE bank_inbox SET status = 'dismissed' WHERE id = ?`, [own.id]);
      await journal(source, from, p, ' · перевод между своими счетами — убран из «Входящих»', text);
      notify();
    } else {
      await journal(source, from, p, ' · доход, не расход', text);
    }
    return null;
  }
  if (p.kind === 'transfer' && near.some(n => n.p.kind === 'income' && n.p.amount === p.amount && n.p.bank !== p.bank)) {
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
export async function drainNative(): Promise<number> {
  if (!Bank || draining) return 0;
  draining = true;
  let added = 0;
  try {
    const list = JSON.parse(await Bank.drain()) as Array<{ source: 'sms' | 'push'; from: string; text: string; ts: number }>;
    for (const m of list) if (await ingest(m.text, m.from, m.source, m.ts)) added++;
  } catch { /* не критично */ } finally { draining = false; }
  return added;
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
export async function accept(item: InboxItem, category: string, description?: string) {
  const exp = {
    date: toDate(item.ts),
    category,
    amount: item.amount || 0,
    description: (description ?? item.merchant ?? '').trim() || (item.kind === 'transfer' ? 'Перевод' : item.bank),
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
