import * as SecureStore from 'expo-secure-store';
import { isE2E } from '../e2e';
import * as e2e from '../e2e/compute';

const SERVER_URL_KEY = 'server_url';
const TOKEN_KEY = 'auth_token';

let _serverUrl = '';
let _token = '';

// Имя текущего пользователя из JWT — нужно как автор при локальной записи (E2E)
function currentUserName(): string { return parseJwt(_token)?.name ?? ''; }

export async function initApi() {
  _serverUrl = (await SecureStore.getItemAsync(SERVER_URL_KEY)) || '';
  _token = (await SecureStore.getItemAsync(TOKEN_KEY)) || '';
}

export async function setServerUrl(url: string) {
  _serverUrl = url.replace(/\/$/, '');
  await SecureStore.setItemAsync(SERVER_URL_KEY, _serverUrl);
}

export async function setToken(token: string) {
  _token = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearAuth() {
  _token = '';
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function getServerUrl() { return _serverUrl; }
export function getToken() { return _token; }
export function isAuthenticated() { return !!_token && !!_serverUrl; }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${_serverUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...((_token) ? { Authorization: `Bearer ${_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function reqText(path: string): Promise<string> {
  const res = await fetch(`${_serverUrl}${path}`, {
    headers: { ...((_token) ? { Authorization: `Bearer ${_token}` } : {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export const api = {
  get:    <T>(path: string) => req<T>('GET', path),
  post:   <T>(path: string, body: unknown) => req<T>('POST', path, body),
  put:    <T>(path: string, body: unknown) => req<T>('PUT', path, body),
  delete: <T>(path: string) => req<T>('DELETE', path),
  getText: reqText,
};

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthUser {
  name: string;
  login: string;
  family: string;
  isAdmin: boolean;
}

// Mobile auth: send Google idToken or use a one-time mobile code from the web app
export async function mobileLogin(idToken: string): Promise<{ token: string; user: AuthUser }> {
  const res = await req<{ token: string; user: AuthUser }>('POST', '/api/auth/mobile', { idToken });
  await setToken(res.token);
  return res;
}

// Вход по логину/паролю (используется демо-сборкой: lena / Lena)
export async function passwordLogin(login: string, password: string): Promise<string> {
  const res = await req<{ token: string }>('POST', '/api/auth/login', { login, password });
  await setToken(res.token);
  return res.token;
}

// Parse JWT payload (no verification — server validates on every request)
export function parseJwt(token: string): AuthUser | null {
  try {
    const payload = token.split('.')[1];
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    // atob выдаёт latin-1: кириллица в имени превращается в кракозябры,
    // поэтому раскодируем байты как UTF-8
    const json = decodeURIComponent(
      binary.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''),
    );
    return JSON.parse(json) as AuthUser;
  } catch {
    return null;
  }
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export interface Expense {
  id: string;
  date: string;       // DD.MM.YYYY
  category: string;
  amount: number;
  description: string;
  user: string;
  createdAt: string;
}

export interface AddExpensePayload {
  expenses: Array<{ date: string; category: string; amount: number; description: string }>;
}

export const expenses = {
  add:    (payload: AddExpensePayload) => isE2E()
    ? e2e.addExpenses(payload.expenses, currentUserName()).then(() => ({ ok: true }))
    : api.post<{ ok: boolean }>('/api/expenses', payload),
  update: (id: string, data: Partial<Expense>) => isE2E()
    ? e2e.updateExpense(id, data).then(() => ({ ok: true }))
    : api.put<{ ok: boolean }>(`/api/expenses/${id}`, data),
  delete: (id: string) => isE2E()
    ? e2e.deleteExpense(id).then(() => ({ ok: true }))
    : api.delete<{ ok: boolean }>(`/api/expenses/${id}`),
  // Server expects YYYY-MM-DD and returns { entries: [...] }
  forDay: async (date: string): Promise<{ expenses: Expense[] }> => {
    if (isE2E()) return e2e.forDay(date);
    const [d, m, y] = date.split('.');
    const res = await api.get<{ entries?: Expense[] } | Expense[]>(`/api/expenses/day?date=${y}-${m}-${d}`);
    const list = Array.isArray(res) ? res : res.entries ?? [];
    return { expenses: list };
  },
  forMonth: (month: number, year: number) => isE2E()
    ? e2e.forMonth(month, year)
    : api.get<Expense[]>(`/api/expenses/month?month=${month}&year=${year}`),
  byCategory: (cat: string, month: number, year: number) => isE2E()
    ? e2e.byCategory(cat, month, year)
    : api.get<Expense[]>(`/api/expenses/category/${encodeURIComponent(cat)}?month=${month}&year=${year}`),
};

// ─── Шифрованные бэкапы ──────────────────────────────────────────────────────

export interface BackupMeta { id: string; createdAt: string; size: number }

export const backups = {
  snapshot: () => api.get<Record<string, unknown>>('/api/snapshot'),
  create:   (blob: string) => api.post<{ ok: boolean; backup: BackupMeta }>('/api/backup', { blob }),
  list:     () => api.get<BackupMeta[]>('/api/backup'),
  get:      (id: string) => api.get<{ id: string; createdAt: string; blob: string }>(`/api/backup/${id}`),
  remove:   (id: string) => api.delete<{ ok: boolean }>(`/api/backup/${id}`),
  restore:  (snap: Record<string, unknown>) => api.post<{ ok: boolean; expenses: number }>('/api/restore', snap),
};

// ─── Custom categories ───────────────────────────────────────────────────────

export const categoriesApi = {
  add: (name: string, emoji: string) =>
    api.post<{ ok: boolean }>('/api/categories', { name, emoji }),
  remove: (name: string) =>
    api.delete<{ ok: boolean; moved?: number }>(`/api/categories/${encodeURIComponent(name)}`),
};

// ─── Family settings ─────────────────────────────────────────────────────────

type SettingsShape = { familyName?: string; plannedMonthly?: number; categories?: string[]; customCategories?: Array<{ name: string; emoji: string }> };
export const settings = {
  get: async (): Promise<SettingsShape> => {
    if (isE2E()) {
      // Имя семьи и категории — нефинансовые, берём с сервера; план-сумма локальная
      let base: SettingsShape = {};
      try { base = await api.get<SettingsShape>('/api/settings'); } catch { /* офлайн */ }
      return { ...base, plannedMonthly: await e2e.getPlannedMonthly() };
    }
    return api.get<SettingsShape>('/api/settings');
  },
  set: (key: string, value: unknown) => (isE2E() && key === 'plannedMonthly')
    ? e2e.setPlannedMonthly(Number(value)).then(() => ({ ok: true }))
    : api.put<{ ok: boolean }>('/api/settings', { key, value }),
};

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface SummaryData {
  total: number;
  byCategory: Record<string, number>;
  byUser: Record<string, { total: number; byCategory: Record<string, number> }>;
}

export const summary = {
  get: (month?: number, year?: number) => {
    if (isE2E()) {
      const now = new Date();
      return e2e.summary(month ?? now.getMonth() + 1, year ?? now.getFullYear());
    }
    const params = new URLSearchParams();
    if (month) params.set('month', String(month));
    if (year)  params.set('year',  String(year));
    return api.get<SummaryData>(`/api/summary?${params}`);
  },
};

// ─── Budget plan ─────────────────────────────────────────────────────────────

export interface BudgetPlan {
  categoryBudgets: Record<string, number>;
  incomes: Record<string, number>;
}

export const budgetPlan = {
  get:  () => isE2E() ? e2e.getBudgetPlan() : api.get<BudgetPlan>('/api/budget-plan'),
  save: (plan: BudgetPlan) => isE2E()
    ? e2e.saveBudgetPlan(plan).then(() => ({ ok: true }))
    : api.put<{ ok: boolean }>('/api/budget-plan', plan),
};

// ─── Regular / recurring payments ────────────────────────────────────────────

export type RecurringFreq = 'daily' | 'weekly' | 'monthly';

export interface RecurringItem {
  id: string;
  name: string;
  amount: number;
  category: string;
  user: string;         // кто платит
  active: boolean;
  freq: RecurringFreq;  // как часто
  day: number;          // monthly: день месяца 1–31; weekly (легаси): один день недели; daily: не используется
  days?: number[];      // weekly: выбранные дни недели getDay 0(вс)–6(сб), напр. будни [1,2,3,4,5]
  times: number;        // сколько раз за период (напр. маршрутка 2 раза в день)
  lastPaid?: string;    // ключ последнего оплаченного периода (YYYY-MM-DD / понедельник недели / YYYY-MM)
  paidCount?: number;   // сколько раз внесено в периоде lastPaid
}

export const recurring = {
  get:  () => isE2E() ? e2e.getRecurring() : api.get<RecurringItem[]>('/api/recurring'),
  save: (list: RecurringItem[]) => isE2E()
    ? e2e.saveRecurring(list).then(() => ({ ok: true }))
    : api.put<{ ok: boolean }>('/api/recurring', list),
};

// ─── Goals ───────────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  emoji: string;
}

// Сервер хранит цели как { targetAmount, contributions: [{amount}] }
interface ServerGoal {
  id: string; name: string; emoji: string;
  targetAmount: number;
  contributions?: Array<{ amount: number }>;
}
const normGoal = (g: ServerGoal): Goal => ({
  id: g.id, name: g.name, emoji: g.emoji,
  target: g.targetAmount,
  saved: (g.contributions ?? []).reduce((s, c) => s + (c.amount || 0), 0),
});

export const goals = {
  list: async () => isE2E() ? e2e.listGoals() : (await api.get<ServerGoal[]>('/api/goals')).map(normGoal),
  add: (goal: Omit<Goal, 'id' | 'saved'>) => isE2E()
    ? e2e.addGoal(goal.name, goal.target, goal.emoji).then(() => ({ ok: true }))
    : api.post<{ ok: boolean }>('/api/goals', { name: goal.name, targetAmount: goal.target, emoji: goal.emoji }),
  contribute: (id: string, amount: number) => isE2E()
    ? e2e.contributeGoal(id, amount).then(() => ({ ok: true }))
    : api.post<{ ok: boolean }>(`/api/goals/${id}/contribute`, { amount }),
  delete: (id: string) => isE2E()
    ? e2e.deleteGoal(id).then(() => ({ ok: true }))
    : api.delete<{ ok: boolean }>(`/api/goals/${id}`),
};

// ─── Cashflow ────────────────────────────────────────────────────────────────

export interface CashflowMember { debit: number; credit: number; savings: number }
export interface Cashflow {
  members?: Record<string, CashflowMember>;
  incomeDays?: Array<{ day: number; user?: string; amount: number }>;
}
export interface UnifiedChart {
  labels: string[];
  userExpenses: Record<string, number[]>;
  incomeDays: Record<string, number>;
  balanceLine: number[] | null;
  startBalance: number;
  hasBalance: boolean;
}

export const cashflow = {
  get:     (ym: string) => isE2E() ? e2e.getCashflow(ym) : api.get<Cashflow>(`/api/cashflow/${ym}`),
  save:    (ym: string, body: Cashflow) => isE2E()
    ? e2e.saveCashflow(ym, body).then(() => ({ ok: true }))
    : api.put<{ ok: boolean }>(`/api/cashflow/${ym}`, body),
  unified: (ym: string) => isE2E() ? e2e.unified(ym) : api.get<UnifiedChart>(`/api/unified-chart-data/${ym}`),
};

// ─── AI (paid only) ──────────────────────────────────────────────────────────

export interface ParsedExpense {
  date?: string;
  category: string;
  amount: number;
  description: string;
}

export const ai = {
  analyze: async (month: number, year: number) => {
    if (isE2E()) {
      // Сырые данные не покидают устройство — шлём обезличенную сводку
      const reportText = await e2e.buildAiReport(month, year);
      return api.post<{ report: string; model: string }>('/api/analyze-raw', { reportText });
    }
    return api.post<{ report: string; model: string }>('/api/analyze', { month, year });
  },
  parseText: (text: string) =>
    api.post<{ expenses: ParsedExpense[] }>('/api/parse', { text }),
  parseImage: (base64: string, mimeType = 'image/jpeg') =>
    api.post<{ expenses: ParsedExpense[] }>('/api/parse-image', { base64, mimeType }),

  // Обезличенная сводка для ИИ-чата (одинаково для E2E и обычных семей — только агрегаты)
  chatContext: async (month: number, year: number): Promise<string> => {
    if (isE2E()) return e2e.buildAiReport(month, year);
    const s = await summary.get(month, year);
    const plan = await budgetPlan.get().catch(() => ({ categoryBudgets: {}, incomes: {} } as BudgetPlan));
    const lines: string[] = [`Месяц: ${String(month).padStart(2, '0')}.${year}`, `Всего потрачено: ${Math.round(s.total)} ₽`, '', 'Категории:'];
    for (const [c, v] of Object.entries(s.byCategory).sort(([, a], [, b]) => (b as number) - (a as number))) {
      const lim = plan.categoryBudgets?.[c];
      lines.push(`- ${c}: ${Math.round(v as number)} ₽${lim ? ` (лимит ${lim} ₽)` : ''}`);
    }
    lines.push('', 'Участники:');
    for (const [u, ud] of Object.entries(s.byUser)) lines.push(`- ${u}: ${Math.round(ud.total)} ₽`);
    return lines.join('\n');
  },
  chat: (context: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    api.post<{ reply: string; model: string }>('/api/chat', { context, messages }),
};

// ─── Family invites ──────────────────────────────────────────────────────────

export const invites = {
  create: () => api.post<{ code: string; link: string }>('/api/invite', {}),
  join:   (code: string) =>
    api.post<{ token: string; name: string; login: string }>('/api/invite/join', { code }),
};

// ─── CSV export / import ─────────────────────────────────────────────────────

export const csv = {
  export: () => api.getText('/api/export'),
  import: (text: string) =>
    api.post<{ ok: boolean; imported?: number }>('/api/import', { csv: text }),
};

// ─── Push settings (server side) ─────────────────────────────────────────────

export const pushSettings = {
  get: () => api.get<{ enabled: boolean }>('/api/push/settings'),
  set: (enabled: boolean) => api.post<{ ok: boolean }>('/api/push/settings', { enabled }),
};

// ─── Crowd classifier dictionary ─────────────────────────────────────────────

export const crowd = {
  getDictionary: () => api.get<Record<string, string>>('/api/crowd/dictionary'),
  contribute: (pairs: Array<{ w: string; c: string }>) =>
    api.post<{ ok: boolean }>('/api/crowd/contribute', { pairs }),
};
