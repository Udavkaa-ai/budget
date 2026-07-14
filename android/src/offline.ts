import { openDb } from './classifier/db';
import { expenses } from './api/client';

// Офлайн-очередь: расходы, добавленные без сети, живут в локальном SQLite
// и уходят на сервер при первой возможности.
export interface QueuedExpense {
  date: string;        // DD.MM.YYYY
  category: string;
  amount: number;
  description: string;
}

export interface OutboxItem extends QueuedExpense {
  outboxId: number;
  createdAt: string;
}

const listeners = new Set<() => void>();
export function onOutboxChange(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function notify() { listeners.forEach(l => l()); }

async function ensureTable() {
  const d = await openDb();
  await d.execAsync(`CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  return d;
}

export async function queueExpense(exp: QueuedExpense) {
  const d = await ensureTable();
  await d.runAsync(
    'INSERT INTO outbox (payload, created_at) VALUES (?, ?)',
    [JSON.stringify(exp), new Date().toISOString()],
  );
  notify();
}

export async function getOutbox(): Promise<OutboxItem[]> {
  const d = await ensureTable();
  const rows = await d.getAllAsync<{ id: number; payload: string; created_at: string }>(
    'SELECT id, payload, created_at FROM outbox ORDER BY id',
  );
  return rows.map(r => ({ ...(JSON.parse(r.payload) as QueuedExpense), outboxId: r.id, createdAt: r.created_at }));
}

export async function removeFromOutbox(outboxId: number) {
  const d = await ensureTable();
  await d.runAsync('DELETE FROM outbox WHERE id = ?', [outboxId]);
  notify();
}

let flushing = false;

// Отправляет накопленное на сервер; останавливается на первой сетевой ошибке.
// Возвращает число успешно синхронизированных записей.
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    const items = await getOutbox();
    for (const it of items) {
      try {
        await expenses.add({
          expenses: [{ date: it.date, category: it.category, amount: it.amount, description: it.description }],
        });
        await removeFromOutbox(it.outboxId);
        sent++;
      } catch (e) {
        // Сети нет или сервер недоступен — попробуем в следующий раз
        break;
      }
    }
  } finally {
    flushing = false;
  }
  if (sent > 0) notify();
  return sent;
}

export function isNetworkError(e: unknown): boolean {
  return String(e).includes('Network request failed');
}
