import { api } from '../api/client';
import { encryptJson, decryptJson } from '../crypto';
import type { Expense } from '../api/client';
import {
  dirtyRecords, clearDirty, applyRemoteExpense, afterPull,
  getCursor, setCursor, dirtyDocs, clearDocDirty, setLocalDoc, getLocalDoc,
  type SyncRecord,
} from './store';

// Движок E2E-синхронизации: расходы — записи с LWW-версией и seq-курсором,
// документы (план/кэшфлоу/цели) — один блоб на ключ. Сервер видит только блобы.

let _running = false;

// Отправляем локальные изменения (расходы) на сервер шифроблобами
async function pushExpenses(): Promise<void> {
  const dirty = await dirtyRecords();
  if (!dirty.length) return;
  // не более 500 за раз (лимит сервера)
  for (let i = 0; i < dirty.length; i += 400) {
    const chunk = dirty.slice(i, i + 400);
    const records = await Promise.all(chunk.map(async r => ({
      id: r.id, ver: r.ver, deleted: r.deleted,
      blob: r.deleted ? '' : await encryptJson(r.payload),
    })));
    await api.post('/api/sync/records', { records });
    await clearDirty(chunk.map(r => r.id));
  }
}

// Забираем удалённые изменения и применяем локально
async function pullExpenses(): Promise<void> {
  const since = await getCursor();
  const res = await api.get<{ records: SyncRecord[]; cursor: number }>(`/api/sync/records?since=${since}`);
  for (const rec of res.records) {
    let payload: Expense | null = null;
    if (!rec.deleted && rec.blob) {
      try { payload = await decryptJson<Expense>(rec.blob); } catch { continue; } // чужой ключ — пропускаем
    }
    await applyRemoteExpense(rec.id, rec.ver, rec.deleted, payload);
  }
  if (res.cursor) await setCursor(res.cursor);
}

// Документы: пушим свои изменения и тянем чужие
async function pushDocs(): Promise<void> {
  const dirty = await dirtyDocs();
  for (const doc of dirty) {
    try {
      const blob = await encryptJson(JSON.parse(doc.json));
      const out = await api.put<{ ok: boolean; ver: number }>(`/api/sync/doc/${encodeURIComponent(doc.key)}`, { blob, ver: doc.ver });
      if (out.ok) await clearDocDirty(doc.key);
    } catch { /* конфликт версий разрулим при следующем pull */ }
  }
}

async function pullDocs(): Promise<void> {
  const docs = await api.get<Record<string, { blob: string; ver: number }>>('/api/sync/docs');
  for (const [key, d] of Object.entries(docs || {})) {
    const local = await getLocalDoc(key);
    if (local && d.ver <= local.ver) continue;
    try {
      const value = await decryptJson(d.blob);
      await setLocalDoc(key, value, { dirty: false, ver: d.ver });
    } catch { /* чужой ключ */ }
  }
}

export async function syncNow(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    await pushExpenses();
    await pullExpenses();
    await pushDocs();
    await pullDocs();
    await afterPull();
  } catch { /* сеть/ошибка — попробуем в следующий раз */ } finally {
    _running = false;
  }
}
