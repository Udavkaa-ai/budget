import * as SecureStore from 'expo-secure-store';

const SERVER_URL_KEY = 'server_url';
const TOKEN_KEY = 'auth_token';

let _serverUrl = '';
let _token = '';

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
  add:    (payload: AddExpensePayload) => api.post<{ ok: boolean }>('/api/expenses', payload),
  update: (id: string, data: Partial<Expense>) => api.put<{ ok: boolean }>(`/api/expenses/${id}`, data),
  delete: (id: string) => api.delete<{ ok: boolean }>(`/api/expenses/${id}`),
  // Server expects YYYY-MM-DD and returns a plain array
  forDay: async (date: string): Promise<{ expenses: Expense[] }> => {
    const [d, m, y] = date.split('.');
    const list = await api.get<Expense[]>(`/api/expenses/day?date=${y}-${m}-${d}`);
    return { expenses: Array.isArray(list) ? list : [] };
  },
  forMonth: (month: number, year: number) =>
    api.get<Expense[]>(`/api/expenses/month?month=${month}&year=${year}`),
  byCategory: (cat: string, month: number, year: number) =>
    api.get<Expense[]>(`/api/expenses/category/${encodeURIComponent(cat)}?month=${month}&year=${year}`),
};

// ─── Family settings ─────────────────────────────────────────────────────────

export const settings = {
  get: () => api.get<{ familyName?: string; plannedMonthly?: number }>('/api/settings'),
  set: (key: string, value: unknown) => api.put<{ ok: boolean }>('/api/settings', { key, value }),
};

// ─── Summary ─────────────────────────────────────────────────────────────────

export interface SummaryData {
  total: number;
  byCategory: Record<string, number>;
  byUser: Record<string, { total: number; byCategory: Record<string, number> }>;
}

export const summary = {
  get: (month?: number, year?: number) => {
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
  get:  () => api.get<BudgetPlan>('/api/budget-plan'),
  save: (plan: BudgetPlan) => api.put<{ ok: boolean }>('/api/budget-plan', plan),
};

// ─── Goals ───────────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  emoji: string;
}

export const goals = {
  list:       () => api.get<Goal[]>('/api/goals'),
  add:        (goal: Omit<Goal, 'id' | 'saved'>) => api.post<Goal>('/api/goals', goal),
  contribute: (id: string, amount: number) => api.post<Goal>(`/api/goals/${id}/contribute`, { amount }),
  delete:     (id: string) => api.delete<{ ok: boolean }>(`/api/goals/${id}`),
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
  get:     (ym: string) => api.get<Cashflow>(`/api/cashflow/${ym}`),
  save:    (ym: string, body: Cashflow) => api.put<{ ok: boolean }>(`/api/cashflow/${ym}`, body),
  unified: (ym: string) => api.get<UnifiedChart>(`/api/unified-chart-data/${ym}`),
};

// ─── AI (paid only) ──────────────────────────────────────────────────────────

export interface ParsedExpense {
  date?: string;
  category: string;
  amount: number;
  description: string;
}

export const ai = {
  analyze: (month: number, year: number) =>
    api.post<{ report: string; model: string }>('/api/analyze', { month, year }),
  parseText: (text: string) =>
    api.post<{ expenses: ParsedExpense[] }>('/api/parse', { text }),
  parseImage: (base64: string, mimeType = 'image/jpeg') =>
    api.post<{ expenses: ParsedExpense[] }>('/api/parse-image', { base64, mimeType }),
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
