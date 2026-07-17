import { api } from '../api/client';
import { loadKey, generateKey, keyFingerprint, exportKeyHex } from '../crypto';
import { setE2EEnabled, refreshHasKey } from './index';
import { addLocalExpense, setLocalDoc, dirtyRecords, wipeLocal } from './store';
import { syncNow } from './sync';

interface Snapshot {
  expenses?: Array<{ date: string; category: string; amount: number; description: string; user?: string; createdAt?: string }>;
  goals?: Array<{ id: string; name: string; emoji: string; targetAmount: number; contributions?: Array<{ amount: number }> }>;
  budgetPlan?: { categoryBudgets?: Record<string, number>; incomes?: Record<string, number> };
  cashflow?: Record<string, unknown>;
}

export type EnableResult = { ok: true; keyPhrase: string; migrated: number } | { ok: false; error: string };

// Включение E2E: генерируем/переиспользуем ключ, переносим текущие данные в
// локальную БД, шифруем и заливаем на сервер, и только ПОСЛЕ успешной заливки
// вызываем enable-e2e (сервер стирает плейнтекст). При сбое — плейнтекст цел.
export async function enableE2E(): Promise<EnableResult> {
  try {
    // 0. Уже включён?
    const state = await api.get<{ enabled: boolean }>('/api/family/e2e');
    if (state.enabled) return { ok: false, error: 'E2E уже включён для этой семьи' };

    // 1. Ключ (переиспользуем существующий — например, от бэкапов)
    let key = await loadKey();
    if (!key) key = await generateKey();
    await refreshHasKey();
    const fp = await keyFingerprint();
    const phrase = (await exportKeyHex()) || '';

    // 2. Тянем текущие данные семьи
    const snap = await api.get<Snapshot>('/api/snapshot');
    let planned = 0;
    try { planned = (await api.get<{ plannedMonthly?: number }>('/api/settings')).plannedMonthly ?? 0; } catch { /* ignore */ }

    // 3. Переносим в локальную БД (помечаем dirty — уйдёт в шифросинхрон)
    await wipeLocal(); // чистим на случай прежних экспериментов
    let migrated = 0;
    for (const e of snap.expenses ?? []) {
      await addLocalExpense({
        date: e.date, category: e.category, amount: e.amount,
        description: e.description ?? '', user: e.user ?? '', createdAt: e.createdAt ?? new Date().toISOString(),
      });
      migrated++;
    }
    if (snap.budgetPlan) await setLocalDoc('plan', { categoryBudgets: snap.budgetPlan.categoryBudgets ?? {}, incomes: snap.budgetPlan.incomes ?? {} }, { dirty: true });
    if (snap.goals) await setLocalDoc('goals', snap.goals, { dirty: true });
    for (const [ym, cf] of Object.entries(snap.cashflow ?? {})) await setLocalDoc(`cf:${ym}`, cf, { dirty: true });
    if (planned) await setLocalDoc('meta', { plannedMonthly: planned }, { dirty: true });

    // 4. Включаем локальный режим и заливаем всё шифроблобами
    setE2EEnabled(true);
    await syncNow();

    // 5. Проверяем, что всё залилось (не осталось несинхронизированных записей)
    const stillDirty = await dirtyRecords();
    if (stillDirty.length > 0) {
      setE2EEnabled(false);
      return { ok: false, error: 'Не удалось загрузить зашифрованные данные — проверьте сеть и повторите. Плейнтекст на сервере не тронут.' };
    }

    // 6. Только теперь стираем плейнтекст на сервере
    await api.post('/api/family/enable-e2e', { keyFingerprint: fp });

    return { ok: true, keyPhrase: phrase, migrated };
  } catch (e) {
    setE2EEnabled(false);
    return { ok: false, error: String(e) };
  }
}
