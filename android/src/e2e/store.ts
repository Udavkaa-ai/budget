import * as SQLite from 'expo-sqlite';
import type { Expense } from '../api/client';

// Локальное хранилище E2E-семьи: источник правды на устройстве.
// На сервер уходят только шифроблобы (см. sync.ts).
let _db: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('e2e.db');
  await _db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS exp (
      id          TEXT PRIMARY KEY,
      ver         INTEGER NOT NULL,
      deleted     INTEGER NOT NULL DEFAULT 0,
      dirty       INTEGER NOT NULL DEFAULT 0,
      date        TEXT, category TEXT, amount REAL,
      description TEXT, "user" TEXT, createdAt TEXT
    );
    CREATE TABLE IF NOT EXISTS doc (
      key   TEXT PRIMARY KEY,
      json  TEXT NOT NULL,
      ver   INTEGER NOT NULL,
      dirty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meta ( k TEXT PRIMARY KEY, v TEXT );
  `);
  return _db;
}

const listeners = new Set<() => void>();
export function onLocalChange(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function notify() { listeners.forEach(l => l()); }

function now() { return Date.now(); }
function genId() { return `e_${now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`; }

// ─── Расходы ─────────────────────────────────────────────────────────────────

export type LocalExpense = Expense; // {id,date,category,amount,description,user,createdAt}

export async function addLocalExpense(e: Omit<Expense, 'id'>): Promise<string> {
  const d = await db();
  const id = genId();
  await d.runAsync(
    `INSERT INTO exp (id, ver, deleted, dirty, date, category, amount, description, "user", createdAt)
     VALUES (?, ?, 0, 1, ?, ?, ?, ?, ?, ?)`,
    [id, now(), e.date, e.category, e.amount, e.description, e.user, e.createdAt],
  );
  notify();
  return id;
}

export async function updateLocalExpense(id: string, patch: Partial<Expense>): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<any>('SELECT * FROM exp WHERE id = ?', [id]);
  if (!row) return;
  const next = { ...row, ...patch };
  await d.runAsync(
    `UPDATE exp SET ver=?, dirty=1, date=?, category=?, amount=?, description=?, "user"=? WHERE id=?`,
    [now(), next.date, next.category, next.amount, next.description, next.user, id],
  );
  notify();
}

export async function deleteLocalExpense(id: string): Promise<void> {
  const d = await db();
  await d.runAsync('UPDATE exp SET deleted=1, dirty=1, ver=? WHERE id=?', [now(), id]);
  notify();
}

function rowToExpense(r: any): Expense {
  return { id: r.id, date: r.date, category: r.category, amount: r.amount, description: r.description, user: r.user, createdAt: r.createdAt };
}

export async function allLocalExpenses(): Promise<Expense[]> {
  const d = await db();
  const rows = await d.getAllAsync<any>('SELECT * FROM exp WHERE deleted=0');
  return rows.map(rowToExpense);
}

// ─── Синхронизация (применение удалённых записей, LWW по ver) ────────────────

export type SyncRecord = { id: string; blob: string; ver: number; seq: number; deleted: boolean };

export async function dirtyRecords(): Promise<Array<{ id: string; ver: number; deleted: boolean; payload: Expense | null }>> {
  const d = await db();
  const rows = await d.getAllAsync<any>('SELECT * FROM exp WHERE dirty=1');
  return rows.map(r => ({
    id: r.id, ver: r.ver, deleted: !!r.deleted,
    payload: r.deleted ? null : rowToExpense(r),
  }));
}

export async function clearDirty(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const d = await db();
  await d.runAsync(`UPDATE exp SET dirty=0 WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
}

// Применяем расшифрованную удалённую запись (LWW: берём, если ver новее локального)
export async function applyRemoteExpense(id: string, ver: number, deleted: boolean, payload: Expense | null): Promise<void> {
  const d = await db();
  const row = await d.getFirstAsync<any>('SELECT ver, dirty FROM exp WHERE id=?', [id]);
  if (row && ver <= row.ver) return;               // наша версия свежее или равна
  if (deleted || !payload) {
    if (row) await d.runAsync('UPDATE exp SET deleted=1, dirty=0, ver=? WHERE id=?', [ver, id]);
    else await d.runAsync('INSERT INTO exp (id, ver, deleted, dirty) VALUES (?, ?, 1, 0)', [id, ver]);
    return;
  }
  if (row) {
    await d.runAsync(
      `UPDATE exp SET ver=?, deleted=0, dirty=0, date=?, category=?, amount=?, description=?, "user"=?, createdAt=? WHERE id=?`,
      [ver, payload.date, payload.category, payload.amount, payload.description, payload.user, payload.createdAt, id],
    );
  } else {
    await d.runAsync(
      `INSERT INTO exp (id, ver, deleted, dirty, date, category, amount, description, "user", createdAt)
       VALUES (?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
      [id, ver, payload.date, payload.category, payload.amount, payload.description, payload.user, payload.createdAt],
    );
  }
}

export async function afterPull(): Promise<void> { notify(); }

// ─── Курсор синхронизации + документы (план/кэшфлоу/цели) ─────────────────────

export async function getCursor(): Promise<number> {
  const d = await db();
  const r = await d.getFirstAsync<{ v: string }>('SELECT v FROM meta WHERE k=?', ['cursor']);
  return r ? parseInt(r.v) || 0 : 0;
}
export async function setCursor(seq: number): Promise<void> {
  const d = await db();
  await d.runAsync('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)', ['cursor', String(seq)]);
}

export async function getLocalDoc<T>(key: string): Promise<{ value: T; ver: number } | null> {
  const d = await db();
  const r = await d.getFirstAsync<{ json: string; ver: number }>('SELECT json, ver FROM doc WHERE key=?', [key]);
  if (!r) return null;
  try { return { value: JSON.parse(r.json) as T, ver: r.ver }; } catch { return null; }
}
export async function setLocalDoc(key: string, value: unknown, opts: { dirty: boolean; ver?: number }): Promise<number> {
  const d = await db();
  const ver = opts.ver ?? now();
  await d.runAsync('INSERT OR REPLACE INTO doc (key, json, ver, dirty) VALUES (?, ?, ?, ?)',
    [key, JSON.stringify(value), ver, opts.dirty ? 1 : 0]);
  notify();
  return ver;
}
export async function dirtyDocs(): Promise<Array<{ key: string; json: string; ver: number }>> {
  const d = await db();
  return d.getAllAsync<any>('SELECT key, json, ver FROM doc WHERE dirty=1');
}
export async function clearDocDirty(key: string): Promise<void> {
  const d = await db();
  await d.runAsync('UPDATE doc SET dirty=0 WHERE key=?', [key]);
}

// Полная очистка (при отключении E2E / смене семьи)
export async function wipeLocal(): Promise<void> {
  const d = await db();
  await d.execAsync('DELETE FROM exp; DELETE FROM doc; DELETE FROM meta;');
  notify();
}
