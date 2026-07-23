// ─── E2E (zero-knowledge) для веба ──────────────────────────────────────────
// Полный порт android/src/e2e/* на WebCrypto + localStorage.
// Источник правды — устройство; на сервер уходят только шифроблобы (см. src/server.js
// /api/sync/*). Клиент с ключом семьи считает все агрегаты локально и отдаёт
// app.js ответы той же формы, что раньше присылал сервер.
//
// Совместимость шифроблоба с приложением: base64( iv(12) + ciphertext + tag(16) ),
// AES-256-GCM, ключ семьи 32 байта. WebCrypto AES-GCM возвращает ct+tag единым
// буфером — формат идентичен @noble/ciphers gcm в приложении, ключи взаимозаменяемы.

const KEY_STORE = 'family_e2e_key';
const STORE_KEY = 'e2e_store';

// Сентинел «этот запрос не наш, пусть идёт на сервер»
export const PASS = Symbol('e2e-pass');

// ─── Состояние ───────────────────────────────────────────────────────────────

let _enabled = false;        // флаг семьи с сервера
let _hasKey = false;         // есть ли ключ на устройстве
let _userName = '';          // имя текущего пользователя (для поля user у расходов)
let _getToken = () => null;  // берём актуальный токен из app.js

export function active() { return _enabled && _hasKey; }
export function enabled() { return _enabled; }
export function hasKey() { return _hasKey; }

// ─── Криптография (WebCrypto AES-256-GCM) ────────────────────────────────────

let _cryptoKey = null;   // импортированный CryptoKey
let _keyBytes = null;    // сырые 32 байта (для отпечатка/экспорта)

function hexToBytes(hex) {
  const clean = hex.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
function b64encode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importCryptoKey(bytes) {
  return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function loadKey() {
  if (_cryptoKey) return _cryptoKey;
  const hex = localStorage.getItem(KEY_STORE);
  if (!hex) return null;
  _keyBytes = hexToBytes(hex);
  if (_keyBytes.length !== 32) { _keyBytes = null; return null; }
  _cryptoKey = await importCryptoKey(_keyBytes);
  return _cryptoKey;
}

export async function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  _keyBytes = bytes;
  _cryptoKey = await importCryptoKey(bytes);
  localStorage.setItem(KEY_STORE, bytesToHex(bytes));
  return _cryptoKey;
}

// Импорт ключа с другого устройства (hex-фраза, 64 hex-символа)
export async function importKeyHex(hex) {
  const clean = (hex || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 64) return false;
  _keyBytes = hexToBytes(clean);
  _cryptoKey = await importCryptoKey(_keyBytes);
  localStorage.setItem(KEY_STORE, clean);
  _hasKey = true;
  return true;
}

export function exportKeyHex() {
  const hex = localStorage.getItem(KEY_STORE);
  return hex || (_keyBytes ? bytesToHex(_keyBytes) : null);
}

export async function keyFingerprint() {
  if (!_keyBytes) { await loadKey(); }
  if (!_keyBytes) return null;
  const digest = await crypto.subtle.digest('SHA-256', _keyBytes);
  return bytesToHex(new Uint8Array(digest)).slice(0, 16);
}

async function encryptJson(obj) {
  const key = await loadKey();
  if (!key) throw new Error('Нет ключа шифрования');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(obj));
  const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const ct = new Uint8Array(ctBuf);
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv); packed.set(ct, iv.length);
  return b64encode(packed);
}

async function decryptJson(blob) {
  const key = await loadKey();
  if (!key) throw new Error('Нет ключа шифрования');
  const packed = b64decode(blob);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

// ─── Локальное хранилище (localStorage, источник правды) ──────────────────────
// Формат: { exp: {id:{ver,deleted,dirty,date,category,amount,description,user,createdAt}},
//           doc: {key:{json,ver,dirty}}, cursor: number }

let _store = null;

function loadStore() {
  if (_store) return _store;
  try { _store = JSON.parse(localStorage.getItem(STORE_KEY) || ''); } catch { _store = null; }
  if (!_store || typeof _store !== 'object') _store = { exp: {}, doc: {}, cursor: 0 };
  if (!_store.exp) _store.exp = {};
  if (!_store.doc) _store.doc = {};
  if (!_store.cursor) _store.cursor = 0;
  return _store;
}
function saveStore() {
  localStorage.setItem(STORE_KEY, JSON.stringify(loadStore()));
}
function nowMs() { return Date.now(); }
function genId() { return `e_${nowMs().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`; }

function rowToExpense(r, id) {
  return { id, date: r.date, category: r.category, amount: r.amount, description: r.description, user: r.user, createdAt: r.createdAt };
}

function addLocalExpense(e) {
  const s = loadStore();
  const id = genId();
  s.exp[id] = {
    ver: nowMs(), deleted: false, dirty: true,
    date: e.date, category: e.category, amount: e.amount,
    description: e.description || '', user: e.user || '', createdAt: e.createdAt || new Date().toISOString(),
  };
  saveStore();
  return id;
}
function updateLocalExpense(id, patch) {
  const s = loadStore();
  const row = s.exp[id];
  if (!row) return;
  Object.assign(row, patch, { ver: nowMs(), dirty: true, deleted: false });
  saveStore();
}
function deleteLocalExpense(id) {
  const s = loadStore();
  const row = s.exp[id];
  if (!row) return;
  row.deleted = true; row.dirty = true; row.ver = nowMs();
  saveStore();
}
function allLocalExpenses() {
  const s = loadStore();
  return Object.entries(s.exp).filter(([, r]) => !r.deleted).map(([id, r]) => rowToExpense(r, id));
}

function dirtyRecords() {
  const s = loadStore();
  return Object.entries(s.exp).filter(([, r]) => r.dirty).map(([id, r]) => ({
    id, ver: r.ver, deleted: !!r.deleted, payload: r.deleted ? null : rowToExpense(r, id),
  }));
}
function clearDirty(ids) {
  const s = loadStore();
  for (const id of ids) if (s.exp[id]) s.exp[id].dirty = false;
  saveStore();
}
// LWW: применяем удалённую запись, если её ver новее локального
function applyRemoteExpense(id, ver, deleted, payload) {
  const s = loadStore();
  const row = s.exp[id];
  if (row && ver <= row.ver) return;
  if (deleted || !payload) {
    s.exp[id] = { ...(row || {}), deleted: true, dirty: false, ver };
    return;
  }
  s.exp[id] = {
    ver, deleted: false, dirty: false,
    date: payload.date, category: payload.category, amount: payload.amount,
    description: payload.description, user: payload.user, createdAt: payload.createdAt,
  };
}

function getCursor() { return loadStore().cursor || 0; }
function setCursor(seq) { loadStore().cursor = seq; saveStore(); }

function getLocalDoc(key) {
  const s = loadStore();
  const r = s.doc[key];
  if (!r) return null;
  try { return { value: JSON.parse(r.json), ver: r.ver }; } catch { return null; }
}
function setLocalDoc(key, value, opts) {
  const s = loadStore();
  const ver = opts.ver ?? nowMs();
  s.doc[key] = { json: JSON.stringify(value), ver, dirty: !!opts.dirty };
  saveStore();
  return ver;
}
function dirtyDocs() {
  const s = loadStore();
  return Object.entries(s.doc).filter(([, r]) => r.dirty).map(([key, r]) => ({ key, json: r.json, ver: r.ver }));
}
function clearDocDirty(key) {
  const s = loadStore();
  if (s.doc[key]) s.doc[key].dirty = false;
  saveStore();
}
function wipeLocal() {
  _store = { exp: {}, doc: {}, cursor: 0 };
  saveStore();
}

// ─── HTTP c авторизацией (в обход диспетчера) ────────────────────────────────

async function rawFetch(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(_getToken() ? { 'Authorization': `Bearer ${_getToken()}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    let err = 'Ошибка сервера';
    try { err = (await res.json()).error || err; } catch { /* ignore */ }
    throw new Error(err);
  }
  return res.json();
}

// ─── Движок синхронизации ────────────────────────────────────────────────────

let _syncing = false;

async function pushExpenses() {
  const dirty = dirtyRecords();
  if (!dirty.length) return;
  for (let i = 0; i < dirty.length; i += 400) {
    const chunk = dirty.slice(i, i + 400);
    const records = await Promise.all(chunk.map(async r => ({
      id: r.id, ver: r.ver, deleted: r.deleted,
      blob: r.deleted ? '' : await encryptJson(r.payload),
    })));
    await rawFetch('POST', '/api/sync/records', { records });
    clearDirty(chunk.map(r => r.id));
  }
}
async function pullExpenses() {
  const since = getCursor();
  const res = await rawFetch('GET', `/api/sync/records?since=${since}`);
  for (const rec of res.records || []) {
    let payload = null;
    if (!rec.deleted && rec.blob) {
      try { payload = await decryptJson(rec.blob); } catch { continue; } // чужой ключ — пропускаем
    }
    applyRemoteExpense(rec.id, rec.ver, rec.deleted, payload);
  }
  if (res.cursor) setCursor(res.cursor);
}
async function pushDocs() {
  for (const doc of dirtyDocs()) {
    try {
      const blob = await encryptJson(JSON.parse(doc.json));
      const out = await rawFetch('PUT', `/api/sync/doc/${encodeURIComponent(doc.key)}`, { blob, ver: doc.ver });
      if (out.ok) clearDocDirty(doc.key);
    } catch { /* конфликт версий разрулим при следующем pull */ }
  }
}
async function pullDocs() {
  const docs = await rawFetch('GET', '/api/sync/docs');
  for (const [key, d] of Object.entries(docs || {})) {
    const local = getLocalDoc(key);
    if (local && d.ver <= local.ver) continue;
    try {
      const value = await decryptJson(d.blob);
      setLocalDoc(key, value, { dirty: false, ver: d.ver });
    } catch { /* чужой ключ */ }
  }
}

export async function syncNow() {
  if (_syncing) return;
  _syncing = true;
  try {
    await pushExpenses();
    await pullExpenses();
    await pushDocs();
    await pullDocs();
  } catch { /* сеть — попробуем позже */ } finally {
    _syncing = false;
  }
}

// ─── Агрегации (точный порт серверной storage.js по расшифрованным данным) ────

function dmy(date) { const [d, m, y] = (date || '').split('.').map(Number); return { d, m, y }; }
function bump() { syncNow().catch(() => {}); }

function getPlan() {
  return getLocalDoc('plan')?.value ?? { categoryBudgets: {}, incomes: {} };
}
function getPlannedMonthly() {
  return getLocalDoc('meta')?.value?.plannedMonthly ?? 0;
}
function setPlannedMonthly(v) {
  const cur = getLocalDoc('meta')?.value ?? {};
  setLocalDoc('meta', { ...cur, plannedMonthly: v }, { dirty: true });
  bump();
}
function rawGoals() { return getLocalDoc('goals')?.value ?? []; }
function saveGoals(g) { setLocalDoc('goals', g, { dirty: true }); bump(); }
function getCf(ym) { return getLocalDoc(`cf:${ym}`)?.value ?? {}; }

function monthName(month, year) {
  const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${names[month - 1]} ${year}`;
}

// GET /api/expenses/family?date=DD.MM.YYYY -> { byUser:{name:{expenses,total}}, total, date }
function familyDay(dateStr) {
  const all = allLocalExpenses().filter(e => e.date === dateStr);
  const byUser = {};
  let total = 0;
  for (const exp of all) {
    const u = exp.user || 'Неизвестно';
    if (!byUser[u]) byUser[u] = { expenses: [], total: 0 };
    byUser[u].expenses.push(exp);
    byUser[u].total += exp.amount;
    total += exp.amount;
  }
  return { byUser, total, date: dateStr };
}

// GET /api/expenses/day?date=YYYY-MM-DD&user= -> { entries:[...] }
function dayEntries(isoDate, user) {
  const [y, m, d] = isoDate.split('-');
  const key = `${d}.${m}.${y}`;
  const entries = allLocalExpenses()
    .filter(e => e.date === key && (!user || e.user === user))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return { entries };
}

// GET /api/summary?month=&year=&excludeFixed=
function summary(month, year) {
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  const byUser = {}, byCategory = {};
  let total = 0;
  for (const e of allLocalExpenses()) {
    const p = dmy(e.date);
    if (p.m !== m || p.y !== y) continue;
    const u = e.user || 'Неизвестно';
    if (!byUser[u]) byUser[u] = { total: 0, byCategory: {} };
    byUser[u].total += e.amount;
    byUser[u].byCategory[e.category] = (byUser[u].byCategory[e.category] || 0) + e.amount;
    byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    total += e.amount;
  }
  return { byUser, byCategory, total, month: m, year: y, monthName: monthName(m, y), excludeFixed: false };
}

// GET /api/expenses/month?month=&year= -> [ ...expenses ] sorted by date
function monthList(month, year) {
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return allLocalExpenses()
    .filter(e => { const p = dmy(e.date); return p.m === m && p.y === y; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// GET /api/expenses/category/:cat?month=&year=&user= -> [ ...expenses ]
function categoryList(cat, month, year, user) {
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return allLocalExpenses()
    .filter(e => {
      const p = dmy(e.date);
      return e.category === cat && p.m === m && p.y === y && (!user || e.user === user);
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

// GET /api/feed/today?date=YYYY-MM-DD -> { entries:[...] }
function feedToday(isoDate) {
  const prefix = isoDate || new Date().toISOString().slice(0, 10);
  const entries = allLocalExpenses()
    .filter(e => e.createdAt && e.createdAt.startsWith(prefix))
    .map(({ id, date, category, description, amount, user, createdAt }) => ({ type: 'expense', id, date, category, description, amount, user, createdAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { entries };
}

function cfStartBalance(cf) {
  if (cf.members && Object.keys(cf.members).length > 0) {
    return Object.values(cf.members).reduce((s, m) => s + (m.debit || 0) + (m.credit || 0) + (m.savings || 0), 0);
  }
  return (cf.debit || 0) + (cf.credit || 0) + (cf.cash || 0);
}
function incomeDayTotals(incomeDays) {
  const totals = {};
  if (Array.isArray(incomeDays)) {
    for (const e of incomeDays) {
      const d = parseInt(e.day);
      if (!d || d < 1 || d > 31) continue;
      totals[String(d)] = (totals[String(d)] || 0) + (e.amount || 0);
    }
  } else if (incomeDays && typeof incomeDays === 'object') {
    for (const [k, v] of Object.entries(incomeDays)) {
      const d = parseInt(k);
      if (!d || d < 1 || d > 31) continue;
      totals[String(d)] = (totals[String(d)] || 0) + (Number(v) || 0);
    }
  }
  return totals;
}

// GET /api/unified-chart-data/:ym
function unifiedChart(ym) {
  const [yStr, mStr] = ym.split('-');
  const year = parseInt(yStr), month = parseInt(mStr);
  const monthExp = allLocalExpenses().filter(e => { const p = dmy(e.date); return p.m === month && p.y === year; });
  const cf = getCf(ym);
  const startBalance = cfStartBalance(cf);
  const incomeDays = incomeDayTotals(cf.incomeDays);
  const hasBalance = startBalance > 0 || Object.keys(incomeDays).length > 0;

  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const lastDay = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate();

  const labels = [];
  for (let d = 1; d <= lastDay; d++) labels.push(String(d));

  const userExpenses = {};
  const dailyTotals = {};
  for (const e of monthExp) {
    const day = dmy(e.date).d;
    if (day < 1 || day > lastDay) continue;
    const u = e.user || 'Неизвестно';
    if (!userExpenses[u]) userExpenses[u] = labels.map(() => 0);
    userExpenses[u][day - 1] += e.amount;
    dailyTotals[day] = (dailyTotals[day] || 0) + e.amount;
  }

  let balanceLine = null;
  if (hasBalance) {
    balanceLine = [];
    let balance = startBalance;
    for (let d = 1; d <= lastDay; d++) {
      if (incomeDays[String(d)]) balance += incomeDays[String(d)];
      balance -= (dailyTotals[d] || 0);
      balanceLine.push(Math.round(balance));
    }
  }
  return { labels, userExpenses, incomeDays, balanceLine, startBalance, hasBalance, monthName: monthName(month, year) };
}

// Обезличенная сводка для /api/analyze-raw
function buildAiReport(month, year) {
  const s = summary(month, year);
  const plan = getPlan();
  const planned = getPlannedMonthly();
  const cats = Object.entries(s.byCategory).sort(([, a], [, b]) => b - a);
  const lines = [];
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

// Простой парсер CSV (порт storage.js parseCsvLine) для локального импорта
function parseCsvLine(line) {
  const fields = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ';') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return fields;
}
function importCsvLocal(csvText) {
  const lines = (csvText || '').replace(/\r/g, '').split('\n').filter(Boolean);
  const dataLines = lines[0] && lines[0].startsWith('Дата') ? lines.slice(1) : lines;
  const existing = new Set(allLocalExpenses().map(e => `${e.date}|${e.category}|${e.amount}|${e.description}`));
  let imported = 0, skipped = 0;
  for (const line of dataLines) {
    const parts = parseCsvLine(line);
    if (parts.length < 4) { skipped++; continue; }
    const [date, category, description, amountStr, user = '', , createdAt = ''] = parts;
    const amount = parseFloat(amountStr);
    if (!date || !category || isNaN(amount) || amount <= 0) { skipped++; continue; }
    const key = `${date.trim()}|${category.trim()}|${amount}|${description.trim()}`;
    if (existing.has(key)) { skipped++; continue; }
    existing.add(key);
    addLocalExpense({ date: date.trim(), category: category.trim(), amount, description: description.trim(), user: user.trim() || _userName, createdAt: createdAt.trim() || new Date().toISOString() });
    imported++;
  }
  if (imported > 0) bump();
  return { imported, skipped };
}

// ─── Диспетчер: перехват apiJson ─────────────────────────────────────────────
// Возвращает PASS, если запрос должен уйти на сервер как обычно.

export async function handle(method, path, body) {
  const [pathname, query = ''] = path.split('?');
  const q = new URLSearchParams(query);
  const seg = pathname.split('/').filter(Boolean); // ['api','expenses',...]

  // ── Расходы ──
  if (pathname === '/api/expenses/family' && method === 'GET') {
    const date = q.get('date');
    return familyDay(date || todayDmy());
  }
  if (pathname === '/api/expenses/day' && method === 'GET') {
    return dayEntries(q.get('date'), q.get('user'));
  }
  if (pathname === '/api/expenses/month' && method === 'GET') {
    return monthList(parseInt(q.get('month')) || null, parseInt(q.get('year')) || null);
  }
  if (pathname === '/api/expenses/today' && method === 'GET') {
    const today = todayDmy();
    const all = allLocalExpenses().filter(e => e.date === today && (!_userName || e.user === _userName));
    return { expenses: all, total: all.reduce((s, e) => s + e.amount, 0), date: today };
  }
  if (seg[0] === 'api' && seg[1] === 'expenses' && seg[2] === 'category' && method === 'GET') {
    const cat = decodeURIComponent(seg.slice(3).join('/'));
    return categoryList(cat, parseInt(q.get('month')) || null, parseInt(q.get('year')) || null, q.get('user'));
  }
  if (pathname === '/api/expenses' && method === 'POST') {
    const items = body?.expenses || [];
    for (const e of items) {
      addLocalExpense({ date: e.date, category: e.category, amount: e.amount, description: e.description || '', user: _userName, createdAt: new Date().toISOString() });
    }
    bump();
    return { ok: true, count: items.length };
  }
  if (seg[0] === 'api' && seg[1] === 'expenses' && seg.length === 3 && method === 'PUT') {
    const id = decodeURIComponent(seg[2]);
    const { date, category, amount, description } = body || {};
    const patch = {};
    if (date !== undefined) patch.date = date;
    if (category !== undefined) patch.category = category;
    if (amount !== undefined) patch.amount = amount;
    if (description !== undefined) patch.description = description;
    if (!loadStore().exp[id]) return { error: 'Не найдено' };
    updateLocalExpense(id, patch);
    bump();
    return { ok: true, expense: rowToExpense(loadStore().exp[id], id) };
  }
  if (seg[0] === 'api' && seg[1] === 'expenses' && seg.length === 3 && method === 'DELETE') {
    const id = decodeURIComponent(seg[2]);
    if (!loadStore().exp[id]) return { error: 'Не найдено' };
    deleteLocalExpense(id);
    bump();
    return { ok: true };
  }

  // ── Сводка / график ──
  if (pathname === '/api/summary' && method === 'GET') {
    return summary(parseInt(q.get('month')) || null, parseInt(q.get('year')) || null);
  }
  if (seg[0] === 'api' && seg[1] === 'unified-chart-data' && method === 'GET') {
    return unifiedChart(seg[2]);
  }
  if (pathname === '/api/feed/today' && method === 'GET') {
    return feedToday(q.get('date'));
  }

  // ── План бюджета ──
  if (pathname === '/api/budget-plan' && method === 'GET') return getPlan();
  if (pathname === '/api/budget-plan' && method === 'PUT') {
    setLocalDoc('plan', { categoryBudgets: body?.categoryBudgets ?? {}, incomes: body?.incomes ?? {} }, { dirty: true });
    bump();
    return { ok: true };
  }

  // ── Цели ──
  if (pathname === '/api/goals' && method === 'GET') return rawGoals();
  if (pathname === '/api/goals' && method === 'POST') {
    const { name, targetAmount, emoji } = body || {};
    if (!name?.trim() || !targetAmount || targetAmount <= 0) return { error: 'Укажите название и сумму цели' };
    const goal = { id: `g_${nowMs().toString(36)}`, name: name.trim(), targetAmount, emoji: emoji || '🎯', createdBy: _userName, createdAt: new Date().toISOString(), contributions: [] };
    saveGoals([...rawGoals(), goal]);
    return { ok: true, goal };
  }
  if (seg[0] === 'api' && seg[1] === 'goals' && seg[3] === 'contribute' && method === 'POST') {
    const id = decodeURIComponent(seg[2]);
    const { amount } = body || {};
    if (!amount || amount <= 0) return { error: 'Укажите сумму' };
    const goals = rawGoals();
    const goal = goals.find(g => g.id === id);
    if (!goal) return { error: 'Цель не найдена' };
    if (!goal.contributions) goal.contributions = [];
    goal.contributions.push({ user: _userName, amount, date: new Date().toISOString() });
    saveGoals(goals);
    return { ok: true, goal };
  }
  if (seg[0] === 'api' && seg[1] === 'goals' && seg.length === 3 && method === 'DELETE') {
    const id = decodeURIComponent(seg[2]);
    const goals = rawGoals();
    if (!goals.some(g => g.id === id)) return { error: 'Цель не найдена' };
    saveGoals(goals.filter(g => g.id !== id));
    return { ok: true };
  }

  // ── Кэшфлоу ──
  if (seg[0] === 'api' && seg[1] === 'cashflow' && method === 'GET') {
    return getCf(seg[2]);
  }
  if (seg[0] === 'api' && seg[1] === 'cashflow' && method === 'PUT') {
    setLocalDoc(`cf:${seg[2]}`, body || {}, { dirty: true });
    bump();
    return { ok: true };
  }

  // ── Настройки: plannedMonthly локально, остальное — на сервер ──
  if (pathname === '/api/settings' && method === 'GET') {
    const server = await rawFetch('GET', '/api/settings').catch(() => ({}));
    return { ...server, plannedMonthly: getPlannedMonthly() };
  }
  if (pathname === '/api/settings' && method === 'PUT') {
    if (body?.key === 'plannedMonthly') {
      setPlannedMonthly(Number(body.value) || 0);
      return { ok: true };
    }
    return PASS; // familyName и прочее — на сервер
  }

  // ── Импорт CSV локально (иначе плейнтекст утечёт на сервер) ──
  if (pathname === '/api/import' && method === 'POST') {
    return importCsvLocal(body?.csv || '');
  }

  // ── ИИ-анализ: считаем агрегаты локально, шлём обезличенный текст ──
  if (pathname === '/api/analyze' && method === 'POST') {
    const now = new Date();
    const m = body?.month || (now.getMonth() + 1);
    const y = body?.year || now.getFullYear();
    try {
      const reportText = buildAiReport(m, y);
      return await rawFetch('POST', '/api/analyze-raw', { reportText });
    } catch (e) {
      return { error: String(e.message || e) };
    }
  }

  return PASS;
}

function todayDmy() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// ─── Включение E2E ───────────────────────────────────────────────────────────

export async function enableE2E() {
  try {
    const state = await rawFetch('GET', '/api/family/e2e');
    if (state.enabled) return { ok: false, error: 'E2E уже включён для этой семьи' };

    // Ключ (переиспользуем существующий — например, от бэкапов)
    if (!(await loadKey())) await generateKey();
    _hasKey = true;
    const fp = await keyFingerprint();
    const phrase = exportKeyHex() || '';

    // Тянем текущие данные семьи
    const snap = await rawFetch('GET', '/api/snapshot');
    let planned = 0;
    try { planned = (await rawFetch('GET', '/api/settings')).plannedMonthly ?? 0; } catch { /* ignore */ }

    // Переносим в локальную БД (dirty — уйдёт в шифросинхрон)
    wipeLocal();
    let migrated = 0;
    for (const e of snap.expenses ?? []) {
      addLocalExpense({ date: e.date, category: e.category, amount: e.amount, description: e.description ?? '', user: e.user ?? '', createdAt: e.createdAt ?? new Date().toISOString() });
      migrated++;
    }
    if (snap.budgetPlan) setLocalDoc('plan', { categoryBudgets: snap.budgetPlan.categoryBudgets ?? {}, incomes: snap.budgetPlan.incomes ?? {} }, { dirty: true });
    if (snap.goals) setLocalDoc('goals', snap.goals, { dirty: true });
    for (const [ym, cf] of Object.entries(snap.cashflow ?? {})) setLocalDoc(`cf:${ym}`, cf, { dirty: true });
    if (planned) setLocalDoc('meta', { plannedMonthly: planned }, { dirty: true });

    // Заливаем всё шифроблобами и проверяем, что ничего не осталось
    _enabled = true;
    await syncNow();
    if (dirtyRecords().length > 0) {
      _enabled = false;
      return { ok: false, error: 'Не удалось загрузить зашифрованные данные — проверьте сеть и повторите. Плейнтекст на сервере не тронут.' };
    }

    // Только теперь стираем плейнтекст на сервере
    await rawFetch('POST', '/api/family/enable-e2e', { keyFingerprint: fp });
    return { ok: true, keyPhrase: phrase, migrated };
  } catch (e) {
    _enabled = false;
    return { ok: false, error: String(e.message || e) };
  }
}

// ─── Инициализация ───────────────────────────────────────────────────────────

export async function init({ getToken, userName }) {
  _getToken = getToken || (() => null);
  _userName = userName || '';
  try {
    const state = await rawFetch('GET', '/api/family/e2e');
    _enabled = !!state.enabled;
  } catch { _enabled = false; }
  _hasKey = !!(await loadKey());
  return { enabled: _enabled, hasKey: _hasKey, active: active() };
}

export function setUserName(name) { _userName = name || ''; }

// CSV из локальных расходов (в E2E сервер пуст, /api/export отдаёт только заголовок)
export function exportCsv() {
  const field = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[";\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = 'Дата;Категория;Описание;Сумма;Кто;Постоянный;Создано';
  const rows = allLocalExpenses().map(e =>
    [e.date, e.category, e.description, e.amount, e.user, 'нет', e.createdAt].map(field).join(';'));
  return header + '\n' + rows.join('\n');
}
