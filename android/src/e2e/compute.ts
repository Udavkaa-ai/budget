import type {
  Expense, SummaryData, BudgetPlan, Cashflow, UnifiedChart, Goal,
} from '../api/client';
import {
  allLocalExpenses, addLocalExpense, updateLocalExpense, deleteLocalExpense,
  getLocalDoc, setLocalDoc, allCashflowDocs, tombstoneAllExpenses,
  upsertLocalExpenseById, dedupeLocalExpenses,
} from './store';
import { syncNow } from './sync';

// Локальные агрегации для E2E-семьи — точный порт серверной логики,
// но по расшифрованным данным на устройстве. Сервер сумм не видит.

function dmy(date: string) { const [d, m, y] = (date || '').split('.').map(Number); return { d, m, y }; }
function nowStr() { return new Date().toISOString(); }
function bump() { syncNow().catch(() => {}); }

// ─── Расходы ─────────────────────────────────────────────────────────────────

export async function addExpenses(items: Array<{ date: string; category: string; amount: number; description: string }>, user: string) {
  for (const e of items) {
    await addLocalExpense({ date: e.date, category: e.category, amount: e.amount, description: e.description, user, createdAt: nowStr() });
  }
  bump();
}
export async function updateExpense(id: string, patch: Partial<Expense>) { await updateLocalExpense(id, patch); bump(); }
export async function deleteExpense(id: string) { await deleteLocalExpense(id); bump(); }

export async function forDay(date: string, user?: string | null): Promise<{ expenses: Expense[] }> {
  const all = await allLocalExpenses();
  return { expenses: all.filter(e => e.date === date && (!user || e.user === user)) };
}
export async function forMonth(month: number, year: number): Promise<Expense[]> {
  const all = await allLocalExpenses();
  return all.filter(e => { const p = dmy(e.date); return p.m === month && p.y === year; });
}
export async function byCategory(cat: string, month: number, year: number): Promise<Expense[]> {
  const all = await allLocalExpenses();
  return all.filter(e => e.category === cat && (() => { const p = dmy(e.date); return p.m === month && p.y === year; })());
}

export async function summary(month: number, year: number): Promise<SummaryData> {
  const all = await allLocalExpenses();
  const byUser: SummaryData['byUser'] = {};
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const e of all) {
    const p = dmy(e.date);
    if (p.m !== month || p.y !== year) continue;
    const u = e.user || 'Неизвестно';
    if (!byUser[u]) byUser[u] = { total: 0, byCategory: {} };
    byUser[u].total += e.amount;
    byUser[u].byCategory[e.category] = (byUser[u].byCategory[e.category] || 0) + e.amount;
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    total += e.amount;
  }
  return { total, byCategory, byUser };
}

// ─── Документы: план / цели / кэшфлоу / план-сумма ───────────────────────────

export async function getBudgetPlan(): Promise<BudgetPlan> {
  const d = await getLocalDoc<BudgetPlan>('plan');
  return d?.value ?? { categoryBudgets: {}, incomes: {} };
}
export async function saveBudgetPlan(plan: BudgetPlan) { await setLocalDoc('plan', plan, { dirty: true }); bump(); }

export async function getPlannedMonthly(): Promise<number> {
  const d = await getLocalDoc<{ plannedMonthly?: number }>('meta');
  return d?.value?.plannedMonthly ?? 0;
}
export async function setPlannedMonthly(v: number) {
  const cur = (await getLocalDoc<Record<string, unknown>>('meta'))?.value ?? {};
  await setLocalDoc('meta', { ...cur, plannedMonthly: v }, { dirty: true }); bump();
}

interface LocalGoal { id: string; name: string; emoji: string; targetAmount: number; contributions: Array<{ amount: number }> }
async function rawGoals(): Promise<LocalGoal[]> { return (await getLocalDoc<LocalGoal[]>('goals'))?.value ?? []; }
async function saveGoals(g: LocalGoal[]) { await setLocalDoc('goals', g, { dirty: true }); bump(); }

export async function listGoals(): Promise<Goal[]> {
  return (await rawGoals()).map(g => ({
    id: g.id, name: g.name, emoji: g.emoji, target: g.targetAmount,
    saved: (g.contributions ?? []).reduce((s, c) => s + (c.amount || 0), 0),
  }));
}
export async function addGoal(name: string, targetAmount: number, emoji: string) {
  const g = await rawGoals();
  g.push({ id: `g_${Date.now().toString(36)}`, name, emoji, targetAmount, contributions: [] });
  await saveGoals(g);
}
export async function contributeGoal(id: string, amount: number) {
  const g = await rawGoals();
  const goal = g.find(x => x.id === id);
  if (goal) { goal.contributions.push({ amount }); await saveGoals(g); }
}
export async function deleteGoal(id: string) { await saveGoals((await rawGoals()).filter(x => x.id !== id)); }

export async function getCashflow(ym: string): Promise<Cashflow> {
  return (await getLocalDoc<Cashflow>(`cf:${ym}`))?.value ?? {};
}
export async function saveCashflow(ym: string, body: Cashflow) { await setLocalDoc(`cf:${ym}`, body, { dirty: true }); bump(); }

// ─── Единый график (порт /api/unified-chart-data) ────────────────────────────

function cfStartBalance(cf: Cashflow): number {
  if (cf.members && Object.keys(cf.members).length > 0) {
    return Object.values(cf.members).reduce((s, m) => s + (m.debit || 0) + (m.credit || 0) + (m.savings || 0), 0);
  }
  return 0;
}
function incomeDayTotals(incomeDays?: Cashflow['incomeDays']): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const e of incomeDays ?? []) {
    const d = parseInt(String(e.day));
    if (!d || d < 1 || d > 31) continue;
    totals[String(d)] = (totals[String(d)] || 0) + (e.amount || 0);
  }
  return totals;
}

export async function unified(ym: string): Promise<UnifiedChart> {
  const [yStr, mStr] = ym.split('-');
  const year = parseInt(yStr), month = parseInt(mStr);
  const all = await allLocalExpenses();
  const monthExp = all.filter(e => { const p = dmy(e.date); return p.m === month && p.y === year; });
  const cf = await getCashflow(ym);
  const startBalance = cfStartBalance(cf);
  const incomeDays = incomeDayTotals(cf.incomeDays);
  const hasBalance = startBalance > 0 || Object.keys(incomeDays).length > 0;

  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const lastDay = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate();

  const labels: string[] = [];
  for (let d = 1; d <= lastDay; d++) labels.push(String(d));

  // Суммы по пользователю по дням
  const userExpenses: Record<string, number[]> = {};
  const dailyTotals: Record<number, number> = {};
  for (const e of monthExp) {
    const day = dmy(e.date).d;
    if (day < 1 || day > lastDay) continue;
    const u = e.user || 'Неизвестно';
    if (!userExpenses[u]) userExpenses[u] = labels.map(() => 0);
    userExpenses[u][day - 1] += e.amount;
    dailyTotals[day] = (dailyTotals[day] || 0) + e.amount;
  }

  let balanceLine: number[] | null = null;
  if (hasBalance) {
    balanceLine = [];
    let balance = startBalance;
    for (let d = 1; d <= lastDay; d++) {
      if (incomeDays[String(d)]) balance += incomeDays[String(d)];
      balance -= (dailyTotals[d] || 0);
      balanceLine.push(Math.round(balance));
    }
  }

  return { labels, userExpenses, incomeDays, balanceLine, startBalance, hasBalance };
}

// ─── ИИ-сводка (обезличенный текст для /api/analyze-raw) ──────────────────────

export async function buildAiReport(month: number, year: number): Promise<string> {
  const s = await summary(month, year);
  const plan = await getBudgetPlan();
  const planned = await getPlannedMonthly();
  const cats = Object.entries(s.byCategory).sort(([, a], [, b]) => b - a);
  const lines: string[] = [];
  lines.push(`Месяц: ${String(month).padStart(2, '0')}.${year}`);
  lines.push(`Всего потрачено: ${Math.round(s.total)} ₽ из плана ${planned || '—'} ₽`);
  lines.push('');
  lines.push('Категории:');
  for (const [c, v] of cats) {
    const lim = plan.categoryBudgets?.[c];
    lines.push(`- ${c}: ${Math.round(v)} ₽${lim ? ` (лимит ${lim} ₽)` : ''}`);
  }
  lines.push('');
  lines.push('Участники:');
  for (const [u, ud] of Object.entries(s.byUser)) lines.push(`- ${u}: ${Math.round(ud.total)} ₽`);
  return lines.join('\n');
}

// ─── Бэкап / восстановление / экспорт по ЛОКАЛЬНЫМ данным (в E2E сервер пуст) ──

// Снапшот той же формы, что GET /api/snapshot — но из локального хранилища.
export async function localSnapshot(): Promise<Record<string, unknown>> {
  return {
    version: 1,
    createdAt: nowStr(),
    expenses: await allLocalExpenses(),
    goals: (await getLocalDoc<unknown[]>('goals'))?.value ?? [],
    budgetPlan: (await getLocalDoc<BudgetPlan>('plan'))?.value ?? { categoryBudgets: {}, incomes: {} },
    cashflow: await allCashflowDocs(),
    plannedMonthly: await getPlannedMonthly(),
  };
}

// Восстановление в локальное хранилище (не на сервер). Идемпотентно: расходы
// с id заливаем ПО id (upsert), поэтому повторное восстановление не плодит
// дубли. Старые бэкапы без id — как раньше (tombstone-all + новые записи).
export async function restoreLocalSnapshot(snap: any): Promise<void> {
  const exps = (snap.expenses ?? []) as Array<any>;
  const allHaveIds = exps.length > 0 && exps.every(e => e.id);
  if (allHaveIds) {
    for (const e of exps) {
      await upsertLocalExpenseById(String(e.id), {
        date: e.date, category: e.category, amount: e.amount,
        description: e.description ?? '', user: e.user ?? '', createdAt: e.createdAt ?? nowStr(),
      });
    }
  } else {
    await tombstoneAllExpenses();
    for (const e of exps) {
      await addLocalExpense({
        date: e.date, category: e.category, amount: e.amount,
        description: e.description ?? '', user: e.user ?? '', createdAt: e.createdAt ?? nowStr(),
      });
    }
  }
  if (snap.budgetPlan) await setLocalDoc('plan', { categoryBudgets: snap.budgetPlan.categoryBudgets ?? {}, incomes: snap.budgetPlan.incomes ?? {} }, { dirty: true });
  if (snap.goals) await setLocalDoc('goals', snap.goals, { dirty: true });
  for (const [ym, cf] of Object.entries(snap.cashflow ?? {})) await setLocalDoc(`cf:${ym}`, cf, { dirty: true });
  if (snap.plannedMonthly) {
    const cur = (await getLocalDoc<Record<string, unknown>>('meta'))?.value ?? {};
    await setLocalDoc('meta', { ...cur, plannedMonthly: snap.plannedMonthly }, { dirty: true });
  }
  await syncNow();
}

// Убрать задвоенные расходы (последствие старого бага восстановления) и
// разослать удаления другим устройствам. Возвращает число удалённых.
export async function dedupeExpenses(): Promise<number> {
  const n = await dedupeLocalExpenses();
  if (n) await syncNow();
  return n;
}

// CSV из локальных расходов (тот же формат, что серверный /api/export).
export async function exportCsv(): Promise<string> {
  const csvField = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[";\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = 'Дата;Категория;Описание;Сумма;Кто;Постоянный;Создано';
  const rows = (await allLocalExpenses()).map(e =>
    [e.date, e.category, e.description, e.amount, e.user, 'нет', e.createdAt].map(csvField).join(';'));
  return header + '\n' + rows.join('\n');
}
