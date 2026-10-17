import { useEffect, useState } from 'react';
import { docsByPrefix, setLocalDoc, onLocalChange } from './e2e/store';
import { syncNow } from './e2e/sync';
import { currentUserName } from './api/client';

// Комментарии к расходам — свои и партнёра. Каждый комментарий — отдельный
// документ «cm:<id расхода>:<id>», поэтому синхронизируется как план или цели
// (облако, Wi-Fi) и не конфликтует с правками самого расхода и с чужими
// комментариями, оставленными в ту же минуту. Удаление — отметка deleted.

export interface ExpenseComment { id: string; expenseId: string; by: string; text: string; at: number; deleted?: boolean }

const keyOf = (expenseId: string, id: string) => `cm:${expenseId}:${id}`;
const parse = (json: string): ExpenseComment | null => { try { return JSON.parse(json); } catch { return null; } };

export async function listComments(expenseId: string): Promise<ExpenseComment[]> {
  const rows = await docsByPrefix(`cm:${expenseId}:`);
  return rows.map(r => parse(r.json)).filter((c): c is ExpenseComment => !!c && !c.deleted).sort((a, b) => a.at - b.at);
}

export async function addComment(expenseId: string, text: string) {
  const c: ExpenseComment = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, expenseId, by: currentUserName(), text: text.trim(), at: Date.now() };
  if (!c.text) return;
  await setLocalDoc(keyOf(expenseId, c.id), c, { dirty: true });
  syncNow().catch(() => {});
}

export async function deleteComment(c: ExpenseComment) {
  await setLocalDoc(keyOf(c.expenseId, c.id), { ...c, deleted: true, text: '' }, { dirty: true });
  syncNow().catch(() => {});
}

// Сколько комментариев у каждого расхода — для значка 💬 в ленте
export async function commentCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of await docsByPrefix('cm:')) {
    const c = parse(r.json);
    if (c && !c.deleted) out[c.expenseId] = (out[c.expenseId] || 0) + 1;
  }
  return out;
}

export function useCommentCounts() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const load = () => { commentCounts().then(setCounts).catch(() => {}); };
    load();
    return onLocalChange(load);
  }, []);
  return counts;
}
