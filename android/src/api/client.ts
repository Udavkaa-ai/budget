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

export const api = {
  get:    <T>(path: string) => req<T>('GET', path),
  post:   <T>(path: string, body: unknown) => req<T>('POST', path, body),
  put:    <T>(path: string, body: unknown) => req<T>('PUT', path, body),
  delete: <T>(path: string) => req<T>('DELETE', path),
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
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as AuthUser;
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
  forDay: (date: string) => api.get<{ expenses: Expense[] }>(`/api/expenses/day?date=${date}`),
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
  heatmap: (month: number, year: number) =>
    api.get<Record<string, number>>(`/api/summary/heatmap?month=${month}&year=${year}`),
};

// ─── Budget plan ─────────────────────────────────────────────────────────────

export interface BudgetPlan {
  categoryBudgets: Record<string, number>;
  incomes: Record<string, number>;
}

export const budgetPlan = {
  get:  () => api.get<BudgetPlan>('/api/budget-plan'),
  save: (plan: BudgetPlan) => api.post<{ ok: boolean }>('/api/budget-plan', plan),
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

// ─── AI (paid only) ──────────────────────────────────────────────────────────

export const ai = {
  analyze: (month: number, year: number) =>
    api.post<{ report: string; model: string }>('/api/analyze', { month, year }),
  parseImage: (base64: string) =>
    api.post<{ expenses: Expense[] }>('/api/parse-image', { image: base64 }),
};

// ─── Crowd classifier dictionary ─────────────────────────────────────────────

export const crowd = {
  getDictionary: () => api.get<Record<string, string>>('/api/crowd/dictionary'),
  contribute: (pairs: Array<{ w: string; c: string }>) =>
    api.post<{ ok: boolean }>('/api/crowd/contribute', { pairs }),
};
