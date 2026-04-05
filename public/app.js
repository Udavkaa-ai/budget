// ════════════════════════════════════════════════════════════════
//  Семейный бюджет — PWA Frontend
// ════════════════════════════════════════════════════════════════

const CATEGORY_ICONS = {
  'Продукты':     '🛒',
  'Кафе':         '🍽',
  'Транспорт':    '🚇',
  'Одежда':       '👗',
  'Медицина':     '💊',
  'Развлечения':  '🎮',
  'Дети':         '👶',
  'Дом':          '🏠',
  'Связь':        '📱',
  'Прочее':       '❓',
};

// ─── State ────────────────────────────────────────────────────────────────────
let token = localStorage.getItem('budget_token');
let currentUser = null;
let socket = null;
let appSettings = {};

// Navigation state
let familyDate = new Date();
let summaryMonth = null, summaryYear = null;
let chartMonth = null, chartYear = null;

// Add form state
let selectedCategory = null;

// ─── Utils ────────────────────────────────────────────────────────────────────

function fmt(n) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function formatDate(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}.${m}.${date.getFullYear()}`;
}

function parseDateStr(str) {
  // str = DD.MM.YYYY
  const [d, m, y] = str.split('.').map(Number);
  return new Date(y, m - 1, d);
}

function getMonthName(month, year) {
  const months = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const now = new Date();
  const m = month || (now.getMonth() + 1);
  const y = year || now.getFullYear();
  return `${months[m - 1]} ${y}`;
}

function todayStr() {
  return formatDate(new Date());
}

function dateLabel(date) {
  const now = new Date();
  const today = formatDate(now);
  const yesterday = formatDate(new Date(now - 86400000));
  const str = formatDate(date);
  if (str === today) return `Сегодня, ${str}`;
  if (str === yesterday) return `Вчера, ${str}`;
  return str;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  return res;
}

async function apiJson(method, path, body) {
  const res = await api(method, path, body);
  return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function showLogin() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-login').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
}

function logout() {
  localStorage.removeItem('budget_token');
  localStorage.removeItem('budget_user');
  token = null;
  currentUser = null;
  if (socket) { socket.disconnect(); socket = null; }
  showLogin();
  document.getElementById('screen-login').style.display = '';
}

async function loginSubmit(e) {
  e.preventDefault();
  const login = document.getElementById('login-input').value.trim();
  const password = document.getElementById('password-input').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Ошибка входа';
      errEl.classList.remove('hidden');
      return;
    }
    token = data.token;
    currentUser = { name: data.name, login: data.login };
    localStorage.setItem('budget_token', token);
    localStorage.setItem('budget_user', JSON.stringify(currentUser));
    initApp();
  } catch {
    errEl.textContent = 'Ошибка соединения';
    errEl.classList.remove('hidden');
  }
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

function initSocket() {
  socket = io({ auth: { token } });

  socket.on('expense:added', ({ by }) => {
    if (by !== currentUser.name) showToastInfo(`${by} добавил расход`);
    refreshCurrentScreen();
  });

  socket.on('expense:deleted', ({ by }) => {
    if (by !== currentUser.name) showToastInfo(`${by} удалил расход`);
    refreshCurrentScreen();
  });

  socket.on('expense:updated', () => refreshCurrentScreen());
  socket.on('expense:retagged', () => refreshCurrentScreen());
  socket.on('settings:updated', () => loadSettings());

  socket.on('reminder', ({ total, byUser }) => {
    let body = total > 0
      ? `Семья потратила ${fmt(total)}. ` + Object.entries(byUser).map(([u, d]) => `${u}: ${fmt(d.total)}`).join(', ')
      : 'Сегодня расходов не записано. Не забудьте внести!';
    showReminder(body);
  });

  socket.on('connect_error', (err) => {
    console.warn('Socket error:', err.message);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

const SCREEN_TITLES = {
  today: 'Сегодня',
  family: 'Семья',
  add: 'Добавить',
  summary: 'Статистика',
  chart: 'График',
  settings: 'Настройки',
};

let currentScreen = 'today';

function navigate(screenName) {
  // Hide all screens
  document.querySelectorAll('.main-content .screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const screen = document.getElementById(`screen-${screenName}`);
  if (screen) screen.classList.add('active');

  const navBtn = document.querySelector(`.nav-btn[data-screen="${screenName}"]`);
  if (navBtn) navBtn.classList.add('active');

  document.getElementById('topbar-title').textContent = SCREEN_TITLES[screenName] || '';
  currentScreen = screenName;

  loadScreen(screenName);
}

function refreshCurrentScreen() {
  loadScreen(currentScreen);
}

function loadScreen(name) {
  switch (name) {
    case 'today': loadToday(); break;
    case 'family': loadFamily(); break;
    case 'summary': loadSummary(); break;
    case 'chart': loadChart(); break;
    case 'settings': loadSettingsScreen(); break;
  }
}

// ─── TODAY SCREEN ─────────────────────────────────────────────────────────────

async function loadToday() {
  const [myData, familyData] = await Promise.all([
    apiJson('GET', '/api/expenses/today'),
    apiJson('GET', '/api/expenses/family'),
  ]);

  document.getElementById('today-my-total').textContent = fmt(myData.total);
  document.getElementById('today-family-total').textContent = fmt(familyData.total);

  const list = document.getElementById('today-expenses-list');
  list.innerHTML = '';

  if (myData.expenses.length === 0) {
    list.innerHTML = '<div class="empty-state">Нет ваших расходов за сегодня</div>';
    return;
  }

  for (const exp of [...myData.expenses].reverse()) {
    list.appendChild(buildExpenseItem(exp, true));
  }
}

// ─── FAMILY SCREEN ────────────────────────────────────────────────────────────

async function loadFamily() {
  const dateStr = formatDate(familyDate);
  document.getElementById('family-date-label').textContent = dateLabel(familyDate);

  // Disable "next" if today
  const today = new Date(); today.setHours(0,0,0,0);
  const fd = new Date(familyDate); fd.setHours(0,0,0,0);
  document.getElementById('family-next').disabled = fd >= today;

  const data = await apiJson('GET', `/api/expenses/family?date=${dateStr}`);

  // Total bar
  const totalBar = document.getElementById('family-total-bar');
  totalBar.innerHTML = `<span>Итого за день</span><span class="total-amount">${fmt(data.total)}</span>`;

  const list = document.getElementById('family-expenses-list');
  list.innerHTML = '';

  if (data.total === 0) {
    list.innerHTML = '<div class="empty-state">Нет расходов за этот день</div>';
    return;
  }

  for (const [user, udata] of Object.entries(data.byUser)) {
    const section = document.createElement('div');
    section.className = 'user-section';
    section.innerHTML = `
      <div class="user-section-header">
        <span class="user-section-name">${user}</span>
        <span class="user-section-total">${fmt(udata.total)}</span>
      </div>
    `;
    const expList = document.createElement('div');
    expList.className = 'expenses-list';
    for (const exp of udata.expenses) {
      expList.appendChild(buildExpenseItem(exp, user === currentUser.name));
    }
    section.appendChild(expList);
    list.appendChild(section);
  }
}

// ─── SUMMARY SCREEN ───────────────────────────────────────────────────────────

async function loadSummary() {
  const excludeFixed = document.getElementById('summary-exclude-fixed').checked;
  const params = new URLSearchParams({
    ...(summaryMonth ? { month: summaryMonth } : {}),
    ...(summaryYear ? { year: summaryYear } : {}),
    excludeFixed,
  });

  document.getElementById('summary-month-label').textContent = getMonthName(summaryMonth, summaryYear);

  // Hide detail if open
  document.getElementById('category-detail').classList.add('hidden');
  document.getElementById('summary-categories').classList.remove('hidden');
  document.getElementById('summary-by-user').classList.remove('hidden');
  document.getElementById('summary-total-bar').classList.remove('hidden');

  const data = await apiJson('GET', `/api/summary?${params}`);

  // Total bar
  const totalBar = document.getElementById('summary-total-bar');
  totalBar.innerHTML = `<span>Итого за месяц</span><span class="highlight-total">${fmt(data.total)}</span>`;

  // By user
  const byUserEl = document.getElementById('summary-by-user');
  byUserEl.innerHTML = '';
  for (const [user, udata] of Object.entries(data.byUser)) {
    byUserEl.innerHTML += `
      <div class="user-stat-chip">
        <div class="user-stat-name">${user}</div>
        <div class="user-stat-amount">${fmt(udata.total)}</div>
      </div>
    `;
  }

  // Categories
  const catList = document.getElementById('summary-categories');
  catList.innerHTML = '';

  if (Object.keys(data.byCategory).length === 0) {
    catList.innerHTML = '<div class="empty-state">Нет данных за этот месяц</div>';
    return;
  }

  const maxAmt = Math.max(...Object.values(data.byCategory));

  for (const [cat, amount] of Object.entries(data.byCategory).sort((a, b) => b[1] - a[1])) {
    const pct = maxAmt > 0 ? Math.round((amount / maxAmt) * 100) : 0;
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <span class="cat-bar-icon">${CATEGORY_ICONS[cat] || '❓'}</span>
      <div class="cat-bar-info">
        <div class="cat-bar-name">${cat}</div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <span class="cat-bar-amount">${fmt(amount)}</span>
    `;
    item.addEventListener('click', () => loadCategoryDetail(cat, summaryMonth, summaryYear));
    catList.appendChild(item);
  }
}

async function loadCategoryDetail(cat, month, year) {
  const params = new URLSearchParams({
    ...(month ? { month } : {}),
    ...(year ? { year } : {}),
  });

  document.getElementById('summary-categories').classList.add('hidden');
  document.getElementById('summary-by-user').classList.add('hidden');
  document.getElementById('summary-total-bar').classList.add('hidden');

  const detail = document.getElementById('category-detail');
  detail.classList.remove('hidden');
  document.getElementById('category-detail-title').textContent = `${CATEGORY_ICONS[cat] || ''} ${cat}`;

  const expenses = await apiJson('GET', `/api/expenses/category/${encodeURIComponent(cat)}?${params}`);
  const listEl = document.getElementById('category-detail-list');
  listEl.innerHTML = '';

  if (expenses.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Нет расходов</div>';
    return;
  }

  for (const exp of [...expenses].reverse()) {
    listEl.appendChild(buildExpenseItem(exp, exp.user === currentUser.name));
  }
}

// ─── CHART SCREEN ─────────────────────────────────────────────────────────────

let chartImgUrl = null;

async function loadChart() {
  const excludeFixed = document.getElementById('chart-exclude-fixed').checked;
  const params = new URLSearchParams({
    ...(chartMonth ? { month: chartMonth } : {}),
    ...(chartYear ? { year: chartYear } : {}),
    excludeFixed,
  });

  document.getElementById('chart-month-label').textContent = getMonthName(chartMonth, chartYear);

  const container = document.getElementById('chart-container');
  container.innerHTML = '<div class="loading">Загрузка графика</div>';

  try {
    const res = await api('GET', `/api/chart?${params}`);
    if (!res.ok) {
      const err = await res.json();
      container.innerHTML = `<div class="empty-state">${err.error || 'Нет данных'}</div>`;
      return;
    }
    const blob = await res.blob();
    if (chartImgUrl) URL.revokeObjectURL(chartImgUrl);
    chartImgUrl = URL.createObjectURL(blob);
    container.innerHTML = `<img src="${chartImgUrl}" alt="График расходов" />`;
  } catch {
    container.innerHTML = '<div class="empty-state">Ошибка загрузки графика</div>';
  }
}

// ─── SETTINGS SCREEN ──────────────────────────────────────────────────────────

async function loadSettingsScreen() {
  const data = await apiJson('GET', '/api/settings');
  appSettings = data;

  // Fixed expenses list
  const fixedList = document.getElementById('fixed-list') || document.getElementById('fixed-expenses-list');
  if (data.fixedExpensesList && fixedList) {
    fixedList.innerHTML = data.fixedExpensesList.map(item => `
      <div class="fixed-item">
        <span>${item.name}</span>
        <span class="fixed-item-amount">${fmt(item.amount)}</span>
      </div>
    `).join('');
  }

  // Info
  const infoPlanned = document.getElementById('info-planned');
  const infoFixed = document.getElementById('info-fixed');
  if (infoPlanned) infoPlanned.textContent = fmt(data.plannedMonthly || 0);
  if (infoFixed) infoFixed.textContent = fmt(data.plannedFixed || 0);
}

async function loadSettings() {
  appSettings = await apiJson('GET', '/api/settings');
}

// ─── ADD EXPENSE ──────────────────────────────────────────────────────────────

function initCategoryGrid() {
  const grid = document.getElementById('category-grid');
  const categories = Object.keys(CATEGORY_ICONS);
  grid.innerHTML = '';
  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.className = 'cat-btn';
    btn.dataset.cat = cat;
    btn.innerHTML = `<span class="cat-icon">${CATEGORY_ICONS[cat]}</span><span class="cat-name">${cat}</span>`;
    btn.addEventListener('click', () => selectCategory(cat));
    grid.appendChild(btn);
  }
}

function selectCategory(cat) {
  selectedCategory = cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
  document.querySelector(`.cat-btn[data-cat="${cat}"]`)?.classList.add('selected');
}

async function submitFormExpense() {
  if (!selectedCategory) { showToastError('Выберите категорию'); return; }
  const amount = parseInt(document.getElementById('form-amount').value);
  if (!amount || amount <= 0) { showToastError('Введите сумму'); return; }
  const description = document.getElementById('form-description').value.trim() || selectedCategory;
  const dateInput = document.getElementById('form-date').value;

  let dateStr;
  if (dateInput) {
    const d = new Date(dateInput);
    dateStr = formatDate(d);
  } else {
    dateStr = todayStr();
  }

  const btn = document.getElementById('btn-add-form');
  btn.disabled = true;
  btn.textContent = 'Сохраняю...';

  try {
    const res = await apiJson('POST', '/api/expenses', {
      expenses: [{ date: dateStr, category: selectedCategory, amount, description }],
    });
    if (res.ok) {
      showToastSuccess('Расход добавлен');
      resetAddForm();
      navigate('today');
    } else {
      showToastError(res.error || 'Ошибка');
    }
  } catch {
    showToastError('Ошибка соединения');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Добавить расход';
  }
}

function resetAddForm() {
  selectedCategory = null;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('form-amount').value = '';
  document.getElementById('form-description').value = '';
  document.getElementById('form-date').value = '';
  document.getElementById('parse-result').classList.add('hidden');
  document.getElementById('expense-text').value = '';
}

// ─── AI TEXT PARSING ──────────────────────────────────────────────────────────

let parsedExpenses = [];

async function parseText() {
  const text = document.getElementById('expense-text').value.trim();
  if (!text) { showToastError('Введите текст'); return; }

  const btn = document.getElementById('btn-parse');
  btn.disabled = true;
  btn.textContent = '⏳ Разбираю...';

  const resultEl = document.getElementById('parse-result');
  resultEl.classList.add('hidden');

  try {
    const data = await apiJson('POST', '/api/parse', { text });
    parsedExpenses = data.expenses || [];

    if (parsedExpenses.length === 0) {
      showToastError('Не удалось распознать расходы. Попробуйте переформулировать.');
      return;
    }

    renderParseResult(parsedExpenses);
    resultEl.classList.remove('hidden');
  } catch {
    showToastError('Ошибка AI-парсинга');
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Разобрать';
  }
}

function renderParseResult(expenses) {
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  const resultEl = document.getElementById('parse-result');
  resultEl.innerHTML = `
    <div class="parse-result-header">
      <strong>Распознано: ${expenses.length} записей</strong>
      <span>${fmt(total)}</span>
    </div>
    ${expenses.map((e, i) => `
      <div class="parse-expense-item">
        <span style="font-size:22px">${CATEGORY_ICONS[e.category] || '❓'}</span>
        <div class="parse-expense-info">
          <div class="parse-expense-desc">${e.description}</div>
          <div class="parse-expense-meta">${e.category} · ${e.date}</div>
        </div>
        <span class="parse-expense-amount">${fmt(e.amount)}</span>
      </div>
    `).join('')}
    <div class="parse-confirm-bar">
      <button id="btn-confirm-parse" class="btn btn-primary" style="flex:1">✓ Сохранить всё</button>
      <button id="btn-cancel-parse" class="btn btn-outline">✕</button>
    </div>
  `;

  document.getElementById('btn-confirm-parse').addEventListener('click', confirmParsedExpenses);
  document.getElementById('btn-cancel-parse').addEventListener('click', () => {
    parsedExpenses = [];
    resultEl.classList.add('hidden');
  });
}

async function confirmParsedExpenses() {
  if (parsedExpenses.length === 0) return;
  const btn = document.getElementById('btn-confirm-parse');
  btn.disabled = true;
  btn.textContent = 'Сохраняю...';

  try {
    const res = await apiJson('POST', '/api/expenses', { expenses: parsedExpenses });
    if (res.ok) {
      showToastSuccess(`Сохранено ${res.count} записей`);
      document.getElementById('expense-text').value = '';
      document.getElementById('parse-result').classList.add('hidden');
      parsedExpenses = [];
      navigate('today');
    } else {
      showToastError(res.error || 'Ошибка');
    }
  } catch {
    showToastError('Ошибка соединения');
  }
}

// ─── EXPENSE ITEM BUILDER ─────────────────────────────────────────────────────

function buildExpenseItem(exp, canDelete) {
  const item = document.createElement('div');
  item.className = 'expense-item' + (exp.isFixed ? ' is-fixed' : '');
  item.dataset.id = exp.id;

  item.innerHTML = `
    <span class="expense-cat-icon">${CATEGORY_ICONS[exp.category] || '❓'}</span>
    <div class="expense-info">
      <div class="expense-desc">${exp.description || exp.category}</div>
      <div class="expense-meta">
        <span class="expense-user-tag">${exp.user}</span>
        <span>${exp.category}</span>
        <span>${exp.date}</span>
        ${exp.isFixed ? '<span class="expense-fixed-tag">📌 пост.</span>' : ''}
      </div>
    </div>
    <span class="expense-amount">${fmt(exp.amount)}</span>
    <div class="expense-actions">
      ${canDelete ? `<button class="btn-delete" title="Удалить">🗑</button>` : ''}
    </div>
  `;

  if (canDelete) {
    item.querySelector('.btn-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteExpenseUI(exp.id, item);
    });
  }

  return item;
}

async function deleteExpenseUI(id, itemEl) {
  if (!confirm('Удалить этот расход?')) return;
  itemEl.style.opacity = '0.4';
  try {
    const res = await apiJson('DELETE', `/api/expenses/${id}`);
    if (res.ok) {
      itemEl.remove();
    } else {
      itemEl.style.opacity = '1';
      showToastError(res.error || 'Ошибка удаления');
    }
  } catch {
    itemEl.style.opacity = '1';
    showToastError('Ошибка соединения');
  }
}

// ─── TOASTS ───────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg, type = 'info') {
  const colors = { success: '#d1fae5', error: '#fee2e2', info: '#e0e7ff' };
  const borders = { success: '#10b981', error: '#ef4444', info: '#4f46e5' };

  let toast = document.getElementById('simple-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'simple-toast';
    toast.style.cssText = `
      position:fixed;top:70px;left:50%;transform:translateX(-50%);
      max-width:320px;width:90%;
      padding:12px 16px;border-radius:10px;font-size:14px;font-weight:500;
      z-index:200;text-align:center;transition:opacity 0.3s;
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = msg;
  toast.style.background = colors[type] || colors.info;
  toast.style.borderLeft = `4px solid ${borders[type] || borders.info}`;
  toast.style.opacity = '1';

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

const showToastSuccess = (msg) => showToast(msg, 'success');
const showToastError = (msg) => showToast(msg, 'error');
const showToastInfo = (msg) => showToast(msg, 'info');

// ─── REMINDER TOAST ───────────────────────────────────────────────────────────

function showReminder(body) {
  const toast = document.getElementById('reminder-toast');
  document.getElementById('reminder-body').textContent = body;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 30000);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function initApp() {
  if (!token) { showLogin(); return; }

  // Get current user
  try {
    const meRes = await api('GET', '/api/me');
    if (!meRes.ok) { logout(); return; }
    currentUser = await meRes.json();
  } catch { logout(); return; }

  document.getElementById('topbar-user').textContent = currentUser.name;
  showApp();
  initSocket();
  initCategoryGrid();
  setupEventListeners();

  // Set today's date in form
  document.getElementById('form-date').value = new Date().toISOString().slice(0, 10);

  await loadSettings();
  navigate('today');
}

function setupEventListeners() {
  // Login
  document.getElementById('login-form').addEventListener('submit', loginSubmit);
  document.getElementById('btn-logout').addEventListener('click', logout);

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.screen));
  });

  // Family navigation
  document.getElementById('family-prev').addEventListener('click', () => {
    familyDate = new Date(familyDate - 86400000);
    loadFamily();
  });
  document.getElementById('family-next').addEventListener('click', () => {
    familyDate = new Date(+familyDate + 86400000);
    loadFamily();
  });

  // Summary navigation
  document.getElementById('summary-prev').addEventListener('click', () => {
    const now = new Date();
    const m = summaryMonth || (now.getMonth() + 1);
    const y = summaryYear || now.getFullYear();
    const prev = new Date(y, m - 2, 1);
    summaryMonth = prev.getMonth() + 1;
    summaryYear = prev.getFullYear();
    loadSummary();
  });
  document.getElementById('summary-next').addEventListener('click', () => {
    const now = new Date();
    const m = summaryMonth || (now.getMonth() + 1);
    const y = summaryYear || now.getFullYear();
    const next = new Date(y, m, 1);
    summaryMonth = next.getMonth() + 1;
    summaryYear = next.getFullYear();
    loadSummary();
  });
  document.getElementById('summary-exclude-fixed').addEventListener('change', loadSummary);

  // Category detail back
  document.getElementById('category-detail-back').addEventListener('click', () => {
    document.getElementById('category-detail').classList.add('hidden');
    document.getElementById('summary-categories').classList.remove('hidden');
    document.getElementById('summary-by-user').classList.remove('hidden');
    document.getElementById('summary-total-bar').classList.remove('hidden');
  });

  // Chart navigation
  document.getElementById('chart-prev').addEventListener('click', () => {
    const now = new Date();
    const m = chartMonth || (now.getMonth() + 1);
    const y = chartYear || now.getFullYear();
    const prev = new Date(y, m - 2, 1);
    chartMonth = prev.getMonth() + 1;
    chartYear = prev.getFullYear();
    loadChart();
  });
  document.getElementById('chart-next').addEventListener('click', () => {
    const now = new Date();
    const m = chartMonth || (now.getMonth() + 1);
    const y = chartYear || now.getFullYear();
    const next = new Date(y, m, 1);
    chartMonth = next.getMonth() + 1;
    chartYear = next.getFullYear();
    loadChart();
  });
  document.getElementById('chart-exclude-fixed').addEventListener('change', loadChart);

  // Add tabs
  document.getElementById('tab-text').addEventListener('click', () => switchAddTab('text'));
  document.getElementById('tab-form').addEventListener('click', () => switchAddTab('form'));

  // Parse button
  document.getElementById('btn-parse').addEventListener('click', parseText);

  // Add form submit
  document.getElementById('btn-add-form').addEventListener('click', submitFormExpense);

  // Quick amount buttons
  document.querySelectorAll('.quick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('form-amount').value = btn.dataset.amount;
    });
  });

  // Retag button
  document.getElementById('btn-retag').addEventListener('click', async () => {
    const res = await apiJson('POST', '/api/settings/retag');
    showToastSuccess(`Перепомечено записей: ${res.count}`);
    refreshCurrentScreen();
  });

  // Export button — update href with auth
  document.getElementById('btn-export').addEventListener('click', async (e) => {
    e.preventDefault();
    const res = await api('GET', '/api/export');
    if (!res.ok) { showToastError('Ошибка экспорта'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Reminder close
  document.getElementById('reminder-close').addEventListener('click', () => {
    document.getElementById('reminder-toast').classList.add('hidden');
  });
}

function switchAddTab(tab) {
  document.getElementById('tab-text').classList.toggle('active', tab === 'text');
  document.getElementById('tab-form').classList.toggle('active', tab === 'form');
  document.getElementById('add-text-panel').classList.toggle('hidden', tab !== 'text');
  document.getElementById('add-form-panel').classList.toggle('hidden', tab !== 'form');
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────

// Try to restore session from localStorage
const savedUser = localStorage.getItem('budget_user');
if (savedUser) {
  try { currentUser = JSON.parse(savedUser); } catch {}
}

if (token && currentUser) {
  initApp();
} else {
  showLogin();
  document.getElementById('login-form').addEventListener('submit', loginSubmit);
}
