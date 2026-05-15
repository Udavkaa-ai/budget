// ════════════════════════════════════════════════════════════════
//  Семейный бюджет — PWA Frontend
// ════════════════════════════════════════════════════════════════

const PLAN_CATEGORIES = [
  { key: 'Продукты',    icon: '🛒' },
  { key: 'Дом',         icon: '🏠' },
  { key: 'Дети',        icon: '👶' },
  { key: 'Медицина',    icon: '💊' },
  { key: 'Транспорт',   icon: '🚇' },
  { key: 'Кафе',        icon: '🍽' },
  { key: 'Одежда',      icon: '👗' },
  { key: 'Развлечения', icon: '🎮' },
  { key: 'Прочее',      icon: '❓' },
  { key: 'Связь',       icon: '📱' },
];

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
let budgetDate = new Date();
let budgetFilter = 'all';
let summaryMonth = null, summaryYear = null;
let chartMonth = null, chartYear = null;

// Throttle nav button clicks (same race condition as swipe — prevents +2 jumps)
let lastNavTime = 0;
function canNav() {
  const now = Date.now();
  if (now - lastNavTime < 420) return false;
  lastNavTime = now;
  return true;
}

// Request generation counters — отбрасываем устаревшие ответы
let budgetGen = 0;
let summaryGen = 0;
let chartGen = 0;
let animateNextLoad = false;

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
  try {
    return await res.json();
  } catch {
    return { error: 'Ошибка сервера', _status: res.status };
  }
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
    currentUser = { name: data.name, login: data.login, isAdmin: data.isAdmin || false };
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
  if (socket) { socket.disconnect(); socket = null; }
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

  socket.on('app:update', () => {
    // Небольшая задержка — чтобы инициатор успел получить ответ от сервера
    setTimeout(() => window.location.reload(), 300);
  });

  socket.on('budget-plan:updated', () => {
    if (currentScreen === 'summary') loadSummary();
  });

  socket.on('connect_error', (err) => {
    console.warn('Socket error:', err.message);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────

const SCREEN_TITLES = {
  budget: 'Бюджет',
  summary: 'Месяц',
  chart: 'График',
  settings: 'Настройки',
};

let currentScreen = 'budget';

function navigate(screenName) {
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
    case 'budget': loadBudget(); break;
    case 'summary': loadSummary(); break;
    case 'chart': loadChart(); loadCashflowSection(); break;
    case 'settings': loadSettingsScreen(); break;
  }
}

// ─── BUDGET SCREEN ────────────────────────────────────────────────────────────

async function loadBudget() {
  const gen = ++budgetGen;
  const dateStr = formatDate(budgetDate);
  document.getElementById('budget-date-label').textContent = dateLabel(budgetDate);

  // Disable "next" if today
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const bd = new Date(budgetDate); bd.setHours(0, 0, 0, 0);
  document.getElementById('budget-next').disabled = bd >= today;

  const list = document.getElementById('budget-expenses-list');
  list.style.opacity = '0.4';

  try {
    const data = await apiJson('GET', `/api/expenses/family?date=${dateStr}`);
    if (gen !== budgetGen) return; // устаревший ответ — выбрасываем
    list.style.opacity = '';

    const byUser = data.byUser || {};
    const total = data.total || 0;
    const myTotal = byUser[currentUser.name]?.total || 0;
    const partnerTotal = total - myTotal;
    const partnerName = Object.keys(byUser).find(u => u !== currentUser.name) || 'Партнёр';

    // Update pills with amounts
    document.getElementById('pill-all-amt').textContent = total > 0 ? fmt(total) : '';
    document.getElementById('pill-me-amt').textContent = myTotal > 0 ? fmt(myTotal) : '';
    document.getElementById('pill-partner-label').textContent = partnerName;
    document.getElementById('pill-partner-amt').textContent = partnerTotal > 0 ? fmt(partnerTotal) : '';

    list.innerHTML = '';

    if (total === 0) {
      document.getElementById('budget-total-bar').innerHTML =
        `<span>Итого за день</span><span class="total-amount">${fmt(0)}</span>`;
      list.innerHTML = '<div class="empty-state">Нет расходов за этот день</div>';
      return;
    }

    let filteredTotal = total;

    if (budgetFilter === 'all') {
      for (const [user, udata] of Object.entries(byUser)) {
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
          expList.appendChild(buildExpenseItem(exp, exp.user === currentUser.name));
        }
        section.appendChild(expList);
        list.appendChild(section);
      }
    } else {
      const userName = budgetFilter === 'me' ? currentUser.name : partnerName;
      const udata = byUser[userName];
      filteredTotal = udata?.total || 0;
      if (!udata || udata.expenses.length === 0) {
        list.innerHTML = '<div class="empty-state">Нет расходов за этот день</div>';
      } else {
        for (const exp of udata.expenses) {
          list.appendChild(buildExpenseItem(exp, exp.user === currentUser.name));
        }
      }
    }

    document.getElementById('budget-total-bar').innerHTML =
      `<span>Итого за день</span><span class="total-amount">${fmt(filteredTotal)}</span>`;

    if (animateNextLoad) {
      animateNextLoad = false;
      list.querySelectorAll('.expense-item').forEach((el, i) => {
        el.style.animationDelay = `${i * 45}ms`;
        el.classList.add('expense-item--new');
      });
    }

  } catch {
    list.style.opacity = '';
    showToastError('Ошибка загрузки данных');
  }
}

// ─── BOTTOM SHEET ─────────────────────────────────────────────────────────────

function openSheet() {
  document.getElementById('add-sheet').classList.add('open');
  document.getElementById('sheet-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  if (recognition && isRecording) recognition.stop();
  document.getElementById('add-sheet').classList.remove('open');
  document.getElementById('sheet-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  resetAddForm();
}

// ─── SUMMARY SCREEN ───────────────────────────────────────────────────────────

let summaryUserFilter = null; // null = all users
let summaryCompareMode = false;
let lastSummaryData = null;
let lastPlanData = null;
let compareChart = null;

async function loadSummary() {
  const gen = ++summaryGen;
  const excludeFixed = document.getElementById('summary-exclude-fixed').checked;
  const params = new URLSearchParams({
    ...(summaryMonth ? { month: summaryMonth } : {}),
    ...(summaryYear ? { year: summaryYear } : {}),
    excludeFixed,
  });

  document.getElementById('summary-month-label').textContent = getMonthName(summaryMonth, summaryYear);
  document.getElementById('plan-month-label').textContent = getMonthName(summaryMonth, summaryYear);
  document.getElementById('category-detail').classList.add('hidden');
  document.getElementById('summary-by-user').classList.remove('hidden');
  document.getElementById('summary-total-bar').classList.remove('hidden');
  document.getElementById('summary-plan-section').classList.remove('hidden');

  try {
    const [data, planData] = await Promise.all([
      apiJson('GET', `/api/summary?${params}`),
      apiJson('GET', '/api/budget-plan'),
    ]);
    if (gen !== summaryGen) return;
    lastSummaryData = data;
    lastPlanData = planData;

    // Derive partner name from summary users
    const users = Object.keys(data.byUser || {});
    planPartnerName = users.find(u => u !== currentUser.name) || 'Партнёр';

    // Populate income fields
    const incomes = planData.incomes || {};
    document.getElementById('plan-label-me').textContent = currentUser.name;
    document.getElementById('plan-label-partner').textContent = planPartnerName;
    document.getElementById('plan-income-me').value = incomes[currentUser.name] || '';
    document.getElementById('plan-income-partner').value = incomes[planPartnerName] || '';

    // Populate category budgets table (compact: icon + name + input only)
    renderPlanBreakdown(planData.categoryBudgets || {});
    updatePlanTotals();

    renderSummaryView();
  } catch {
    showToastError('Ошибка загрузки статистики');
  }
}

function renderSummaryView() {
  if (!lastSummaryData) return;
  const data = lastSummaryData;

  // Total bar — shows filtered user total when filter is active
  const totalBar = document.getElementById('summary-total-bar');
  const displayTotal = summaryUserFilter
    ? (data.byUser[summaryUserFilter]?.total || 0)
    : data.total;
  const filterLabel = summaryUserFilter ? ` · ${summaryUserFilter}` : '';
  totalBar.innerHTML = `<span>Итого за месяц${filterLabel}</span><span class="highlight-total">${fmt(displayTotal)}</span>`;

  // User chips — clickable filter toggle; show % of income in normal mode
  const incomes = lastPlanData?.incomes || {};
  const byUserEl = document.getElementById('summary-by-user');
  byUserEl.innerHTML = '';
  for (const [user, udata] of Object.entries(data.byUser)) {
    const isActive = summaryUserFilter === user;
    const income = incomes[user] || 0;
    const pctText = (!summaryCompareMode && income > 0)
      ? `${Math.round(udata.total / income * 100)}% дохода`
      : '';
    const chip = document.createElement('div');
    chip.className = 'user-stat-chip' + (isActive ? ' active' : '');
    chip.innerHTML = `
      <div class="user-stat-name">${esc(user)}</div>
      <div class="user-stat-amount">${fmt(udata.total)}</div>
      ${pctText ? `<div class="user-stat-pct">${pctText}</div>` : ''}
    `;
    chip.addEventListener('click', () => {
      summaryUserFilter = isActive ? null : user;
      if (summaryCompareMode) { return; }
      renderSummaryView();
    });
    byUserEl.appendChild(chip);
  }

  document.getElementById('summary-plan-section').classList.remove('hidden');

  if (summaryCompareMode) {
    document.getElementById('summary-categories').classList.add('hidden');
    document.getElementById('summary-compare-panel').classList.remove('hidden');
    renderCompareChart(data);
  } else {
    document.getElementById('summary-compare-panel').classList.add('hidden');
    document.getElementById('summary-categories').classList.remove('hidden');
    renderCategoryList(data);
  }
}

function renderCategoryList(data) {
  const catList = document.getElementById('summary-categories');
  catList.innerHTML = '';

  const byCategory = summaryUserFilter
    ? (data.byUser[summaryUserFilter]?.byCategory || {})
    : data.byCategory;

  if (Object.keys(byCategory).length === 0) {
    catList.innerHTML = '<div class="empty-state">Нет данных за этот месяц</div>';
    return;
  }

  const categoryBudgets = lastPlanData?.categoryBudgets || {};
  const maxAmt = Math.max(...Object.values(byCategory));

  for (const [cat, amount] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    const budget = categoryBudgets[cat] || 0;
    let pct, budgetHtml = '';

    if (budget > 0) {
      pct = Math.min(Math.round((amount / budget) * 100), 100);
      const remaining = budget - amount;
      const isOver = remaining < 0;
      const cls = isOver ? 'cat-budget-over' : 'cat-budget-ok';
      const text = isOver
        ? `перерасход ${fmt(-remaining)}`
        : `осталось ${fmt(remaining)}`;
      budgetHtml = `<div class="cat-bar-budget"><span class="${cls}">${text}</span><span class="cat-budget-limit">лимит ${fmt(budget)}</span></div>`;
    } else {
      pct = maxAmt > 0 ? Math.round((amount / maxAmt) * 100) : 0;
    }

    const fillCls = budget > 0 && amount > budget ? 'cat-bar-fill cat-bar-fill--over' : 'cat-bar-fill';

    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <span class="cat-bar-icon">${CATEGORY_ICONS[cat] || '❓'}</span>
      <div class="cat-bar-info">
        <div class="cat-bar-name">${esc(cat)}</div>
        <div class="cat-bar-track"><div class="${fillCls}" style="width:${pct}%"></div></div>
        ${budgetHtml}
      </div>
      <span class="cat-bar-amount">${fmt(amount)}</span>
    `;
    item.addEventListener('click', () => loadCategoryDetail(cat, summaryMonth, summaryYear));
    catList.appendChild(item);
  }
}

function renderCompareChart(data) {
  const users = Object.keys(data.byUser);
  const incomes = lastPlanData?.incomes || {};
  const categoryBudgets = lastPlanData?.categoryBudgets || {};

  // Show % of income per user in chips
  const byUserEl = document.getElementById('summary-by-user');
  byUserEl.innerHTML = '';
  for (const [user, udata] of Object.entries(data.byUser)) {
    const income = incomes[user] || 0;
    const pctText = income > 0 ? `${Math.round(udata.total / income * 100)}% дохода` : '';
    const chip = document.createElement('div');
    chip.className = 'user-stat-chip';
    chip.innerHTML = `
      <div class="user-stat-name">${esc(user)}</div>
      <div class="user-stat-amount">${fmt(udata.total)}</div>
      ${pctText ? `<div class="user-stat-pct">${pctText}</div>` : ''}
    `;
    byUserEl.appendChild(chip);
  }

  const allCats = new Set();
  for (const u of users) Object.keys(data.byUser[u].byCategory || {}).forEach(c => allCats.add(c));

  const sortedCats = [...allCats].sort((a, b) => {
    const ta = users.reduce((s, u) => s + (data.byUser[u].byCategory[a] || 0), 0);
    const tb = users.reduce((s, u) => s + (data.byUser[u].byCategory[b] || 0), 0);
    return tb - ta;
  });

  const COLORS = ['#5947E0', '#FF7AB3', '#FFB47A', '#7AE0C3'];
  const datasets = users.map((user, i) => ({
    label: user,
    data: sortedCats.map(cat => data.byUser[user].byCategory[cat] || 0),
    backgroundColor: COLORS[i % COLORS.length],
    borderRadius: 4,
  }));

  const canvas = document.getElementById('compare-chart');
  const rowH = Math.max(38, Math.min(52, Math.round(300 / sortedCats.length)));
  canvas.parentElement.style.height = (sortedCats.length * rowH * users.length + 60) + 'px';

  if (compareChart) { compareChart.destroy(); compareChart = null; }
  compareChart = new Chart(canvas, {
    type: 'bar',
    data: { labels: sortedCats, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { callback: v => v >= 1000 ? (v/1000).toFixed(0) + 'к' : String(v) },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        y: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
      plugins: {
        legend: { labels: { boxWidth: 12, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const user = ctx.dataset.label;
              const cat = ctx.label;
              const amount = ctx.parsed.x;
              const income = incomes[user] || 0;
              const budget = categoryBudgets[cat] || 0;
              const pctIncome = income > 0 ? ` · ${Math.round(amount / income * 100)}% дохода` : '';
              const pctBudget = budget > 0 ? ` · ${Math.round(amount / budget * 100)}% лимита` : '';
              return ` ${user}: ${amount.toLocaleString('ru')} ₽${pctBudget || pctIncome}`;
            },
          },
        },
      },
    },
  });
}

async function loadCategoryDetail(cat, month, year) {
  const params = new URLSearchParams({
    ...(month ? { month } : {}),
    ...(year ? { year } : {}),
  });

  document.getElementById('summary-categories').classList.add('hidden');
  document.getElementById('summary-compare-panel').classList.add('hidden');
  document.getElementById('summary-plan-section').classList.add('hidden');

  const detail = document.getElementById('category-detail');
  detail.classList.remove('hidden');
  document.getElementById('category-detail-title').textContent = `${CATEGORY_ICONS[cat] || ''} ${cat}`;

  const listEl = document.getElementById('category-detail-list');
  listEl.innerHTML = '<div class="loading">Загрузка</div>';

  try {
    const expenses = await apiJson('GET', `/api/expenses/category/${encodeURIComponent(cat)}?${params}`);
    listEl.innerHTML = '';

    if (!Array.isArray(expenses) || expenses.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Нет расходов</div>';
      return;
    }

    for (const exp of [...expenses].reverse()) {
      listEl.appendChild(buildExpenseItem(exp, exp.user === currentUser.name));
    }
  } catch {
    listEl.innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
  }
}

// ─── CHART SCREEN ─────────────────────────────────────────────────────────────

// Colors per user index
const USER_CHART_COLORS = [
  { bg: 'rgba(79,70,229,0.75)',  border: '#4f46e5' },
  { bg: 'rgba(239,68,68,0.75)', border: '#ef4444' },
  { bg: 'rgba(245,158,11,0.75)',border: '#f59e0b' },
  { bg: 'rgba(16,185,129,0.75)',border: '#10b981' },
];

let mainChart = null;     // Chart.js instance for inline chart
let mainChartFs = null;   // Chart.js instance for fullscreen chart

function buildChartConfig(chartData) {
  const { labels, userExpenses, incomeDays, balanceLine, hasBalance } = chartData;
  const datasets = [];

  // Expense bars (UP, positive) — one dataset per user, rendered first (behind income)
  Object.entries(userExpenses).forEach(([user, amounts], i) => {
    const col = USER_CHART_COLORS[i % USER_CHART_COLORS.length];
    datasets.push({
      type: 'bar',
      label: user,
      data: amounts,
      backgroundColor: col.bg,
      borderColor: col.border,
      borderWidth: 1,
      stack: 'expenses',
      order: 3,
      yAxisID: 'y',
    });
  });

  // Income bars (UP, positive) — separate stack, rendered on top
  const incomeArr = labels.map(d => incomeDays[d] || 0);
  if (incomeArr.some(v => v > 0)) {
    datasets.push({
      type: 'bar',
      label: 'Доход',
      data: incomeArr,
      backgroundColor: 'rgba(122,224,195,0.85)',
      borderColor: '#2BA889',
      borderWidth: 1,
      stack: 'income',
      order: 2,
      yAxisID: 'y',
    });
  }

  // Balance line
  if (hasBalance && balanceLine) {
    datasets.push({
      type: 'line',
      label: 'Баланс',
      data: balanceLine,
      borderWidth: 2,
      pointRadius: labels.length > 20 ? 2 : 4,
      pointHoverRadius: 6,
      tension: 0.3,
      order: 1,
      yAxisID: 'yBalance',
      fill: false,
      segment: {
        borderColor: ctx => ctx.p1.parsed.y < 0 ? '#ef4444' : '#4f46e5',
        backgroundColor: ctx => ctx.p1.parsed.y < 0
          ? 'rgba(239,68,68,0.08)' : 'rgba(79,70,229,0.08)',
      },
      pointBackgroundColor: balanceLine.map(v => v < 0 ? '#ef4444' : '#4f46e5'),
    });
  }

  const scales = {
    x: {
      grid: { display: false },
      stacked: true,
      ticks: { maxTicksLimit: 15 },
    },
    y: {
      stacked: true,
      title: { display: true, text: 'Расходы / Доход, ₽', font: { size: 10 }, color: '#6b7280' },
      ticks: {
        callback: v => v >= 1000 ? (v/1000).toFixed(0) + 'к' : String(v),
      },
      grid: { color: 'rgba(0,0,0,0.05)' },
    },
  };

  if (hasBalance && balanceLine) {
    scales.yBalance = {
      position: 'right',
      grid: { display: false },
      title: { display: true, text: 'Баланс, ₽', font: { size: 10 }, color: '#4f46e5' },
      ticks: {
        callback: v => {
          const abs = Math.abs(v);
          return abs >= 1000 ? (v < 0 ? '-' : '') + (abs/1000).toFixed(0) + 'к' : String(v);
        },
        color: '#4f46e5',
      },
    };
  }

  return {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales,
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { boxWidth: 12, padding: 10, font: { size: 11 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = Math.abs(ctx.parsed.y);
              return `${ctx.dataset.label}: ${val.toLocaleString('ru')} ₽`;
            },
          },
        },
        zoom: {
          limits: {
            x: { minRange: 7 }, // can't zoom in more than 7 days at once
          },
          zoom: {
            wheel: { enabled: true, speed: 0.04 },
            pinch: { enabled: true },
            mode: 'x',
          },
          pan: {
            enabled: true,
            mode: 'x',
          },
        },
      },
    },
  };
}

let lastChartData = null; // store for fullscreen reuse

async function loadChart() {
  const gen = ++chartGen;
  const excludeFixed = document.getElementById('chart-exclude-fixed').checked;
  const ym = cfYm();

  document.getElementById('chart-month-label').textContent = getMonthName(chartMonth, chartYear);

  const container = document.getElementById('chart-container');
  // Show loading, keep expand button
  container.querySelector('.chart-canvas-wrapper')?.remove();
  container.querySelector('.chart-zoom-hint')?.remove();
  container.querySelector('.empty-state')?.remove();
  container.querySelector('.loading')?.remove();
  const loadingEl = document.createElement('div');
  loadingEl.className = 'loading';
  loadingEl.textContent = 'Загрузка графика';
  container.insertBefore(loadingEl, document.getElementById('chart-expand-btn'));

  try {
    const data = await apiJson('GET', `/api/unified-chart-data/${ym}?excludeFixed=${excludeFixed}`);
    if (gen !== chartGen) return;

    lastChartData = data;

    // Clear loading
    loadingEl.remove();

    if (!data.labels?.length) {
      const emp = document.createElement('div');
      emp.className = 'empty-state';
      emp.textContent = 'Нет данных за этот месяц';
      container.insertBefore(emp, document.getElementById('chart-expand-btn'));
      return;
    }

    // Create canvas wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-canvas-wrapper';
    const canvas = document.createElement('canvas');
    canvas.id = 'main-chart';
    wrapper.appendChild(canvas);
    container.insertBefore(wrapper, document.getElementById('chart-expand-btn'));

    // Zoom hint
    const hint = document.createElement('div');
    hint.className = 'chart-zoom-hint';
    hint.textContent = 'Свайп/колесо мыши — масштаб • Двойной тап — сброс';
    container.appendChild(hint);

    // Destroy previous chart
    if (mainChart) { mainChart.destroy(); mainChart = null; }

    const cfg = buildChartConfig(data);
    mainChart = new Chart(canvas, cfg);

    // Double-tap resets zoom
    let lastTap = 0;
    canvas.addEventListener('touchend', () => {
      const now = Date.now();
      if (now - lastTap < 300) mainChart?.resetZoom();
      lastTap = now;
    }, { passive: true });
    canvas.addEventListener('dblclick', () => mainChart?.resetZoom());

  } catch (e) {
    loadingEl.remove();
    const emp = document.createElement('div');
    emp.className = 'empty-state';
    emp.textContent = 'Ошибка загрузки графика';
    container.insertBefore(emp, document.getElementById('chart-expand-btn'));
  }
}

function openChartFullscreen() {
  if (!lastChartData) return;
  const overlay = document.getElementById('chart-fullscreen');
  overlay.classList.remove('hidden');

  // Destroy previous fullscreen chart
  if (mainChartFs) { mainChartFs.destroy(); mainChartFs = null; }

  const canvas = document.getElementById('main-chart-fs');
  const cfg = buildChartConfig(lastChartData);
  mainChartFs = new Chart(canvas, cfg);

  let lastTapFs = 0;
  canvas.addEventListener('touchend', () => {
    const now = Date.now();
    if (now - lastTapFs < 300) mainChartFs?.resetZoom();
    lastTapFs = now;
  }, { passive: true });
  canvas.addEventListener('dblclick', () => mainChartFs?.resetZoom());
}

function closeChartFullscreen() {
  document.getElementById('chart-fullscreen').classList.add('hidden');
  if (mainChartFs) { mainChartFs.destroy(); mainChartFs = null; }
}

// ─── PLANNING (merged into summary screen) ────────────────────────────────────

let planPartnerName = 'Партнёр';

function updatePlanTotals() {
  const myIncome = parseInt(document.getElementById('plan-income-me').value) || 0;
  const partnerIncome = parseInt(document.getElementById('plan-income-partner').value) || 0;
  const totalIncome = myIncome + partnerIncome;
  document.getElementById('plan-income-total').textContent = fmt(totalIncome);

  let totalPlanned = 0;
  document.querySelectorAll('.plan-budget-input').forEach(inp => {
    totalPlanned += parseInt(inp.value) || 0;
  });

  const byCategory = lastSummaryData?.byCategory || {};
  const totalActual = Object.values(byCategory).reduce((s, v) => s + v, 0);
  const remaining = totalIncome - totalActual;

  document.getElementById('plan-total-planned').textContent = totalPlanned > 0 ? fmt(totalPlanned) : '—';
  document.getElementById('plan-total-actual').textContent = fmt(totalActual);

  const savingsEl = document.getElementById('plan-savings');
  savingsEl.textContent = totalIncome > 0 ? fmt(remaining) : '—';
  savingsEl.className = 'plan-savings-amount ' + (remaining >= 0 ? 'plan-diff-ok' : 'plan-diff-over');
}

function renderPlanBreakdown(categoryBudgets) {
  const table = document.getElementById('plan-table');
  table.innerHTML = '';

  for (const cat of PLAN_CATEGORIES) {
    const budgeted = categoryBudgets[cat.key] || 0;
    const row = document.createElement('div');
    row.className = 'plan-row plan-row--compact';
    row.innerHTML = `
      <span class="plan-cat-icon">${cat.icon}</span>
      <span class="plan-cat-name">${cat.key}</span>
      <input class="plan-budget-input" type="number" data-cat="${cat.key}"
             value="${budgeted || ''}" placeholder="—" inputmode="numeric" />
    `;
    row.querySelector('input').addEventListener('input', updatePlanTotals);
    table.appendChild(row);
  }
}

async function savePlan() {
  const categoryBudgets = {};
  document.querySelectorAll('.plan-budget-input').forEach(inp => {
    const val = parseInt(inp.value) || 0;
    if (val > 0) categoryBudgets[inp.dataset.cat] = val;
  });

  const incomes = {
    [currentUser.name]: parseInt(document.getElementById('plan-income-me').value) || 0,
    [planPartnerName]: parseInt(document.getElementById('plan-income-partner').value) || 0,
  };

  const btn = document.getElementById('btn-save-plan');
  btn.disabled = true;
  btn.textContent = 'Сохраняю...';

  try {
    await apiJson('PUT', '/api/budget-plan', { incomes, categoryBudgets });
    showToastSuccess('Бюджет сохранён');
  } catch {
    showToastError('Ошибка сохранения');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Сохранить';
  }
}

// ─── SETTINGS SCREEN ──────────────────────────────────────────────────────────

async function loadSettingsScreen() {
  try {
    const data = await apiJson('GET', '/api/settings');
    appSettings = data;

    // Fixed expenses list — editable by all family members
    renderFixedExpensesEditable(data.fixedExpensesList || []);

    // Info
    const infoPlanned = document.getElementById('info-planned');
    const infoFixed = document.getElementById('info-fixed');
    if (infoPlanned) infoPlanned.textContent = fmt(data.plannedMonthly || 0);
    if (infoFixed) infoFixed.textContent = fmt(data.plannedFixed || 0);
  } catch {
    showToastError('Ошибка загрузки настроек');
  }

  // Admin panel — загружаем только если текущий пользователь администратор
  if (currentUser?.isAdmin) {
    document.getElementById('admin-section').classList.remove('hidden');
    document.getElementById('admin-update-section').classList.remove('hidden');
    document.getElementById('admin-budget-section').classList.remove('hidden');
    loadAdminUsers();
  }
}

// ─── FIXED EXPENSES (editable by family) ──────────────────────────────────────

function renderFixedExpensesEditable(list) {
  const container = document.getElementById('fixed-expenses-list');
  container.innerHTML = '';
  for (const item of list) {
    container.appendChild(buildFixedItemRow(item.name, item.amount));
  }
}

function buildFixedItemRow(name = '', amount = '') {
  const row = document.createElement('div');
  row.className = 'fixed-item-edit';
  row.innerHTML = `
    <input class="fixed-item-name-input" type="text" value="${esc(name)}" placeholder="Название" />
    <input class="fixed-item-amount-input" type="number" value="${amount || ''}" placeholder="0" inputmode="numeric" />
    <button class="fixed-item-del-btn" title="Удалить">✕</button>
  `;
  row.querySelector('.fixed-item-del-btn').addEventListener('click', () => row.remove());
  return row;
}

async function saveFixedExpenses() {
  const items = [...document.querySelectorAll('.fixed-item-edit')].map(row => ({
    name:   row.querySelector('.fixed-item-name-input').value.trim(),
    amount: parseInt(row.querySelector('.fixed-item-amount-input').value) || 0,
  })).filter(i => i.name);

  const btn = document.getElementById('btn-fixed-save');
  btn.disabled = true;
  try {
    const res = await apiJson('PUT', '/api/family-budget/fixed-expenses', { fixedExpensesList: items });
    if (res.ok) showToastSuccess('Постоянные расходы сохранены');
    else showToastError(res.error || 'Ошибка сохранения');
  } catch {
    showToastError('Ошибка соединения');
  } finally {
    btn.disabled = false;
  }
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────

async function loadAdminUsers() {
  const users = await apiJson('GET', '/api/admin/users');
  if (!Array.isArray(users)) return;

  const list = document.getElementById('admin-users-list');

  // Собираем уникальные семьи для select'а и для раздела бюджетных настроек
  const families = [...new Set(users.map(u => u.family || 'family1'))];
  renderAdminFamilySelect(families);
  loadAdminFamilies(families);

  list.innerHTML = '';
  for (const u of users) {
    const row = document.createElement('div');
    row.className = 'admin-user-row';
    row.innerHTML = `
      <div class="admin-user-info">
        <div class="admin-user-name">${esc(u.name)}</div>
        <div class="admin-user-meta">${esc(u.login)}</div>
      </div>
      <span class="admin-family-badge">${esc(u.family || 'family1')}</span>
      ${u.isAdmin ? '<span class="admin-badge-admin">admin</span>' : ''}
      <button class="admin-user-del" data-login="${esc(u.login)}" title="Удалить"
        ${u.login === currentUser.login ? 'disabled style="opacity:.3;cursor:default"' : ''}>✕</button>
    `;
    row.querySelector('.admin-user-del').addEventListener('click', async () => {
      if (!confirm(`Удалить пользователя ${u.name} (${u.login})?`)) return;
      const res = await apiJson('DELETE', `/api/admin/users/${encodeURIComponent(u.login)}`);
      if (res.ok) { showToastSuccess('Пользователь удалён'); loadAdminUsers(); }
      else showToastError(res.error || 'Ошибка');
    });
    list.appendChild(row);
  }
}

function renderAdminFamilySelect(families) {
  const sel = document.getElementById('admin-new-family');
  if (!sel) return;
  sel.innerHTML = families.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  sel.insertAdjacentHTML('beforeend', '<option value="__new__">+ Новая группа…</option>');
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── ADMIN: BUDGET SETTINGS PER FAMILY ───────────────────────────────────────

async function loadAdminFamilies(families) {
  const container = document.getElementById('admin-families-list');
  container.innerHTML = '';
  const tmplCard = document.getElementById('tmpl-family-budget');
  const tmplItem = document.getElementById('tmpl-fixed-item');

  for (const familyId of families) {
    const settings = await apiJson('GET', `/api/admin/family-settings/${encodeURIComponent(familyId)}`);

    const card = tmplCard.content.cloneNode(true).firstElementChild;
    card.querySelector('.family-budget-id').textContent = familyId;
    card.querySelector('.fb-planned-monthly').value = settings.plannedMonthly || '';
    card.querySelector('.fb-planned-fixed').value   = settings.plannedFixed   || '';
    card.querySelector('.fb-fixed-day').value        = settings.fixedExpensesDay || '';

    const fixedList = card.querySelector('.fb-fixed-list');

    function addFixedItem(name = '', amount = '') {
      const row = tmplItem.content.cloneNode(true).firstElementChild;
      row.querySelector('.fb-item-name').value   = name;
      row.querySelector('.fb-item-amount').value = amount || '';
      row.querySelector('.fb-item-del').addEventListener('click', () => row.remove());
      fixedList.appendChild(row);
    }

    for (const item of (settings.fixedExpensesList || [])) {
      addFixedItem(item.name, item.amount);
    }

    card.querySelector('.fb-add-item').addEventListener('click', () => addFixedItem());

    card.querySelector('.fb-save').addEventListener('click', async () => {
      const items = [...fixedList.querySelectorAll('.fb-item-row')].map(row => ({
        name:   row.querySelector('.fb-item-name').value.trim(),
        amount: parseInt(row.querySelector('.fb-item-amount').value) || 0,
      })).filter(i => i.name);

      const body = {
        plannedMonthly:    parseInt(card.querySelector('.fb-planned-monthly').value) || 0,
        plannedFixed:      parseInt(card.querySelector('.fb-planned-fixed').value)   || 0,
        fixedExpensesDay:  parseInt(card.querySelector('.fb-fixed-day').value)        || 15,
        fixedExpensesList: items,
      };

      const res = await apiJson('PUT', `/api/admin/family-settings/${encodeURIComponent(familyId)}`, body);
      if (res.ok) showToastSuccess(`Настройки группы «${familyId}» сохранены`);
      else showToastError(res.error || 'Ошибка сохранения');
    });

    container.appendChild(card);
  }
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
  const amount = parseInt(document.getElementById('form-amount').value, 10);
  if (isNaN(amount) || amount <= 0) { showToastError('Введите сумму'); return; }
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
      const fab = document.getElementById('fab-add');
      fab.classList.add('fab--success');
      setTimeout(() => fab.classList.remove('fab--success'), 700);
      animateNextLoad = true;
      closeSheet();
      loadBudget();
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
  document.getElementById('form-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('parse-result').classList.add('hidden');
  document.getElementById('expense-text').value = '';
  switchAddTab('text');
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
        <span class="parse-expense-icon">${CATEGORY_ICONS[e.category] || '❓'}</span>
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
      parsedExpenses = [];
      const fab2 = document.getElementById('fab-add');
      fab2.classList.add('fab--success');
      setTimeout(() => fab2.classList.remove('fab--success'), 700);
      animateNextLoad = true;
      closeSheet();
      loadBudget();
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

// ─── VOICE INPUT ──────────────────────────────────────────────────────────────

let recognition = null;
let isRecording = false;

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  recognition = new SR();
  recognition.lang = 'ru-RU';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    const transcript = Array.from(event.results).map(r => r[0].transcript).join('');
    document.getElementById('expense-text').value = transcript;
  };

  recognition.onend = () => {
    isRecording = false;
    setVoiceBtn(false);
    const text = document.getElementById('expense-text').value.trim();
    if (text) parseText(); // auto-parse after voice
  };

  recognition.onerror = (event) => {
    isRecording = false;
    setVoiceBtn(false);
    if (event.error !== 'no-speech') showToastError('Ошибка микрофона: ' + event.error);
  };

  return true;
}

function setVoiceBtn(recording) {
  const btn = document.getElementById('btn-voice');
  if (!btn) return;
  btn.textContent = recording ? '🔴 Слушаю...' : '🎤 Голос';
  btn.classList.toggle('recording', recording);
}

function toggleVoice() {
  if (!recognition && !initVoice()) {
    showToastError('Голосовой ввод не поддерживается в этом браузере');
    return;
  }
  if (isRecording) {
    recognition.stop();
  } else {
    isRecording = true;
    setVoiceBtn(true);
    document.getElementById('expense-text').value = '';
    document.getElementById('parse-result').classList.add('hidden');
    recognition.start();
  }
}

// ─── PHOTO PARSING ────────────────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handlePhotoInput(file) {
  if (!file) return;
  const btn = document.getElementById('btn-photo');
  const resultEl = document.getElementById('parse-result');
  resultEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = '⏳ Читаю...';

  try {
    const base64 = await fileToBase64(file);
    const data = await apiJson('POST', '/api/parse-image', {
      base64,
      mimeType: file.type || 'image/jpeg',
    });
    if (data.error) { showToastError(data.error); return; }
    parsedExpenses = data.expenses || [];
    if (parsedExpenses.length === 0) {
      showToastError('Не удалось распознать расходы на фото');
      return;
    }
    renderParseResult(parsedExpenses);
    resultEl.classList.remove('hidden');
  } catch {
    showToastError('Ошибка обработки изображения');
  } finally {
    btn.disabled = false;
    btn.textContent = '📷 Фото / чек';
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

  await loadSettings();
  initPullToRefresh();
  navigate('budget');
}

function setupEventListeners() {
  // Login
  document.getElementById('login-form').addEventListener('submit', loginSubmit);
  document.getElementById('btn-logout').addEventListener('click', logout);

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.screen));
  });

  // FAB — open add sheet
  document.getElementById('fab-add').addEventListener('click', openSheet);

  // Sheet close
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.getElementById('sheet-overlay').addEventListener('click', closeSheet);

  // Voice
  document.getElementById('btn-voice').addEventListener('click', toggleVoice);

  // Photo
  document.getElementById('btn-photo').addEventListener('click', () => {
    document.getElementById('photo-input').click();
  });
  document.getElementById('photo-input').addEventListener('change', (e) => {
    handlePhotoInput(e.target.files[0]);
    e.target.value = '';
  });

  // Filter pills
  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      budgetFilter = pill.dataset.filter;
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      loadBudget();
    });
  });

  // Budget date navigation
  document.getElementById('budget-prev').addEventListener('click', () => {
    if (!canNav()) return;
    budgetDate = new Date(budgetDate - 86400000);
    loadBudget();
  });
  document.getElementById('budget-next').addEventListener('click', () => {
    if (!canNav()) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const bd = new Date(budgetDate); bd.setHours(0,0,0,0);
    if (bd >= today) return;
    budgetDate = new Date(+budgetDate + 86400000);
    loadBudget();
  });

  // Swipe navigation
  setupSwipe(document.getElementById('screen-budget'), {
    canLeft: () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const bd = new Date(budgetDate); bd.setHours(0,0,0,0);
      return bd < today;
    },
    onLeft: () => {
      budgetDate = new Date(+budgetDate + 86400000); loadBudget();
    },
    onRight: () => {
      budgetDate = new Date(budgetDate - 86400000); loadBudget();
    },
  });
  setupSwipe(document.getElementById('screen-summary'), {
    canLeft: () => {
      const now = new Date();
      const m = summaryMonth || (now.getMonth() + 1);
      const y = summaryYear || now.getFullYear();
      return y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1);
    },
    onLeft: () => {
      const now = new Date();
      const m = summaryMonth || (now.getMonth() + 1);
      const y = summaryYear || now.getFullYear();
      const next = new Date(y, m, 1);
      summaryMonth = next.getMonth() + 1; summaryYear = next.getFullYear();
      loadSummary();
    },
    onRight: () => {
      const now = new Date();
      const m = summaryMonth || (now.getMonth() + 1);
      const y = summaryYear || now.getFullYear();
      const prev = new Date(y, m - 2, 1);
      summaryMonth = prev.getMonth() + 1; summaryYear = prev.getFullYear();
      loadSummary();
    },
  });
  setupSwipe(document.getElementById('screen-chart'), {
    canLeft: () => {
      const now = new Date();
      const m = chartMonth || (now.getMonth() + 1);
      const y = chartYear || now.getFullYear();
      return y < now.getFullYear() || (y === now.getFullYear() && m < now.getMonth() + 1);
    },
    onLeft: () => {
      const now = new Date();
      const m = chartMonth || (now.getMonth() + 1);
      const y = chartYear || now.getFullYear();
      const next = new Date(y, m, 1);
      chartMonth = next.getMonth() + 1; chartYear = next.getFullYear();
      loadChart(); loadCashflowSection();
    },
    onRight: () => {
      const now = new Date();
      const m = chartMonth || (now.getMonth() + 1);
      const y = chartYear || now.getFullYear();
      const prev = new Date(y, m - 2, 1);
      chartMonth = prev.getMonth() + 1; chartYear = prev.getFullYear();
      loadChart(); loadCashflowSection();
    },
  });

  // Planning
  document.getElementById('plan-income-me').addEventListener('input', updatePlanTotals);
  document.getElementById('plan-income-partner').addEventListener('input', updatePlanTotals);
  document.getElementById('btn-save-plan').addEventListener('click', savePlan);

  // Summary navigation
  document.getElementById('summary-prev').addEventListener('click', () => {
    if (!canNav()) return;
    const now = new Date();
    const m = summaryMonth || (now.getMonth() + 1);
    const y = summaryYear || now.getFullYear();
    const prev = new Date(y, m - 2, 1);
    summaryMonth = prev.getMonth() + 1;
    summaryYear = prev.getFullYear();
    loadSummary();
  });
  document.getElementById('summary-next').addEventListener('click', () => {
    if (!canNav()) return;
    const now = new Date();
    const m = summaryMonth || (now.getMonth() + 1);
    const y = summaryYear || now.getFullYear();
    if (y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1)) return;
    const next = new Date(y, m, 1);
    summaryMonth = next.getMonth() + 1;
    summaryYear = next.getFullYear();
    loadSummary();
  });
  document.getElementById('summary-exclude-fixed').addEventListener('change', loadSummary);

  // Compare toggle
  document.getElementById('btn-summary-compare').addEventListener('click', () => {
    summaryCompareMode = !summaryCompareMode;
    document.getElementById('btn-summary-compare').classList.toggle('active', summaryCompareMode);
    if (!summaryCompareMode && compareChart) { compareChart.destroy(); compareChart = null; }
    renderSummaryView();
  });

  // Category detail back
  document.getElementById('category-detail-back').addEventListener('click', () => {
    document.getElementById('category-detail').classList.add('hidden');
    document.getElementById('summary-by-user').classList.remove('hidden');
    document.getElementById('summary-total-bar').classList.remove('hidden');
    renderSummaryView();
  });

  // Chart navigation
  document.getElementById('chart-prev').addEventListener('click', () => {
    if (!canNav()) return;
    const now = new Date();
    const m = chartMonth || (now.getMonth() + 1);
    const y = chartYear || now.getFullYear();
    const prev = new Date(y, m - 2, 1);
    chartMonth = prev.getMonth() + 1;
    chartYear = prev.getFullYear();
    loadChart(); loadCashflowSection();
  });
  document.getElementById('chart-next').addEventListener('click', () => {
    if (!canNav()) return;
    const now = new Date();
    const m = chartMonth || (now.getMonth() + 1);
    const y = chartYear || now.getFullYear();
    if (y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth() + 1)) return;
    const next = new Date(y, m, 1);
    chartMonth = next.getMonth() + 1;
    chartYear = next.getFullYear();
    loadChart(); loadCashflowSection();
  });
  document.getElementById('chart-exclude-fixed').addEventListener('change', loadChart);

  // Chart expand / fullscreen
  document.getElementById('chart-expand-btn').addEventListener('click', openChartFullscreen);
  document.getElementById('chart-fs-close').addEventListener('click', closeChartFullscreen);
  document.getElementById('chart-fullscreen').addEventListener('dblclick', e => {
    if (e.target === document.getElementById('chart-fullscreen')) closeChartFullscreen();
  });
  // Prevent fullscreen touch events from bubbling to the screen-chart swipe handler
  ['touchstart', 'touchmove', 'touchend'].forEach(type => {
    document.getElementById('chart-fullscreen').addEventListener(type, e => e.stopPropagation(), { passive: true });
  });

  // Cashflow
  ['cf-debit','cf-credit','cf-cash'].forEach(id =>
    document.getElementById(id).addEventListener('input', updateCfTotal)
  );
  document.getElementById('btn-cf-add-day').addEventListener('click', () => {
    document.getElementById('cf-income-days').appendChild(makeCfDayRow('', 0));
  });
  document.getElementById('btn-cf-save').addEventListener('click', saveCashflow);

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
  document.getElementById('btn-fixed-add').addEventListener('click', () => {
    document.getElementById('fixed-expenses-list').appendChild(buildFixedItemRow());
  });
  document.getElementById('btn-fixed-save').addEventListener('click', saveFixedExpenses);

  document.getElementById('btn-retag').addEventListener('click', async () => {
    const res = await apiJson('POST', '/api/settings/retag');
    showToastSuccess(`Перепомечено записей: ${res.count}`);
    refreshCurrentScreen();
  });

  // Export button — download with auth
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

  // Import CSV
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const resultEl = document.getElementById('import-result');
    resultEl.className = '';
    resultEl.textContent = '⏳ Импортирую...';

    try {
      const csv = await file.text();
      const res = await apiJson('POST', '/api/import', { csv });
      if (res.ok) {
        resultEl.className = 'success-msg';
        resultEl.textContent = `✅ Импортировано: ${res.imported}, пропущено дублей: ${res.skipped}`;
        loadBudget();
      } else {
        resultEl.className = 'error-msg';
        resultEl.textContent = '❌ ' + (res.error || 'Ошибка импорта');
      }
    } catch {
      resultEl.className = 'error-msg';
      resultEl.textContent = '❌ Ошибка чтения файла';
    }

    e.target.value = '';
  });

  // Reminder close
  document.getElementById('reminder-close').addEventListener('click', () => {
    document.getElementById('reminder-toast').classList.add('hidden');
  });

  // Принудительное обновление у всех пользователей
  document.getElementById('btn-force-update').addEventListener('click', async () => {
    const btn = document.getElementById('btn-force-update');
    btn.disabled = true;
    btn.textContent = 'Отправляю...';
    const res = await apiJson('POST', '/api/admin/force-update');
    if (res.ok) {
      showToastSuccess('Обновление отправлено — все пользователи перезагрузят страницу');
    } else {
      showToastError('Ошибка');
    }
    // Через 1с перезагружаем и сами
    setTimeout(() => window.location.reload(), 1000);
  });

  // Admin panel — кнопка показа формы создания
  document.getElementById('btn-admin-add').addEventListener('click', () => {
    document.getElementById('admin-create-form').classList.remove('hidden');
    document.getElementById('btn-admin-add').classList.add('hidden');
    document.getElementById('admin-new-name').focus();
  });

  document.getElementById('btn-admin-cancel').addEventListener('click', () => {
    document.getElementById('admin-create-form').classList.add('hidden');
    document.getElementById('btn-admin-add').classList.remove('hidden');
    clearAdminForm();
  });

  // Если выбрана "Новая группа" — заменяем select на текстовый input
  document.getElementById('admin-new-family').addEventListener('change', (e) => {
    if (e.target.value !== '__new__') return;
    const name = prompt('Название новой группы (например: family2):');
    if (!name?.trim()) { e.target.value = e.target.options[0]?.value || 'family1'; return; }
    const opt = document.createElement('option');
    opt.value = name.trim(); opt.textContent = name.trim(); opt.selected = true;
    e.target.insertBefore(opt, e.target.lastElementChild);
    e.target.value = name.trim();
  });

  document.getElementById('btn-admin-create').addEventListener('click', async () => {
    const name   = document.getElementById('admin-new-name').value.trim();
    const login  = document.getElementById('admin-new-login').value.trim();
    const pass   = document.getElementById('admin-new-password').value.trim();
    const family = document.getElementById('admin-new-family').value;
    const errEl  = document.getElementById('admin-create-error');
    errEl.classList.add('hidden');

    if (!name || !login || !pass) {
      errEl.textContent = 'Заполните имя, логин и пароль';
      errEl.classList.remove('hidden');
      return;
    }

    const btn = document.getElementById('btn-admin-create');
    btn.disabled = true;
    const res = await apiJson('POST', '/api/admin/users', { name, login, password: pass, family });
    btn.disabled = false;

    if (res.ok) {
      showToastSuccess(`Пользователь ${name} создан`);
      document.getElementById('admin-create-form').classList.add('hidden');
      document.getElementById('btn-admin-add').classList.remove('hidden');
      clearAdminForm();
      loadAdminUsers();
    } else {
      errEl.textContent = res.error || 'Ошибка';
      errEl.classList.remove('hidden');
    }
  });
}

function clearAdminForm() {
  ['admin-new-name','admin-new-login','admin-new-password'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('admin-create-error').classList.add('hidden');
}

function setupSwipe(el, { onLeft, onRight, canLeft, canRight }) {
  let startX = 0, startY = 0, active = false, transitioning = false;

  el.addEventListener('touchstart', e => {
    if (transitioning) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    active = true;
    el.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!active) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // Cancel tracking if clearly a vertical scroll
    if (Math.abs(dy) > 20 && Math.abs(dy) > Math.abs(dx)) {
      active = false;
      el.style.transition = 'transform 0.2s ease';
      el.style.transform = '';
      return;
    }
    // Follow finger with dampening (rubber-band feel)
    el.style.transform = `translateX(${dx * 0.35}px)`;
  }, { passive: true });

  function finish(dx, dy) {
    if (!active) return;
    active = false;
    const isHorizontal = Math.abs(dx) >= 55 && Math.abs(dx) >= Math.abs(dy) * 1.3;
    if (isHorizontal) {
      const goLeft = dx < 0;
      const canProceed = goLeft ? (!canLeft || canLeft()) : (!canRight || canRight());

      if (!canProceed) {
        // Boundary reached — rubber-band bounce
        const bump = goLeft ? '-28px' : '28px';
        el.style.transition = 'transform 0.12s ease-out';
        el.style.transform = `translateX(${bump})`;
        setTimeout(() => {
          el.style.transition = 'transform 0.35s cubic-bezier(0.34,1.56,0.64,1)';
          el.style.transform = '';
        }, 120);
        return;
      }

      // Lock against new swipes for the full animation cycle
      transitioning = true;

      // Slide screen out
      el.style.transition = 'transform 0.2s ease-in';
      el.style.transform = `translateX(${goLeft ? '-105%' : '105%'})`;
      setTimeout(() => {
        // Instantly jump to opposite side, fire data load
        el.style.transition = 'none';
        el.style.transform = `translateX(${goLeft ? '60%' : '-60%'})`;
        if (goLeft) onLeft(); else onRight();
        // Slide back to center
        requestAnimationFrame(() => requestAnimationFrame(() => {
          el.style.transition = 'transform 0.22s ease-out';
          el.style.transform = '';
          // Unlock only after slide-in animation completes
          setTimeout(() => { transitioning = false; }, 260);
        }));
      }, 200);
    } else {
      // Not a valid swipe — snap back
      el.style.transition = 'transform 0.25s ease';
      el.style.transform = '';
    }
  }

  el.addEventListener('touchend', e => {
    finish(
      e.changedTouches[0].clientX - startX,
      e.changedTouches[0].clientY - startY,
    );
  }, { passive: true });

  el.addEventListener('touchcancel', () => {
    active = false;
    el.style.transition = 'transform 0.25s ease';
    el.style.transform = '';
  }, { passive: true });
}

function switchAddTab(tab) {
  document.getElementById('tab-text').classList.toggle('active', tab === 'text');
  document.getElementById('tab-form').classList.toggle('active', tab === 'form');
  document.getElementById('add-text-panel').classList.toggle('hidden', tab !== 'text');
  document.getElementById('add-form-panel').classList.toggle('hidden', tab !== 'form');
}

// ─── CASHFLOW ─────────────────────────────────────────────────────────────────

function cfYm() {
  const m = chartMonth || (new Date().getMonth() + 1);
  const y = chartYear || new Date().getFullYear();
  return `${y}-${String(m).padStart(2, '0')}`;
}

function updateCfTotal() {
  const debit  = parseInt(document.getElementById('cf-debit').value)  || 0;
  const credit = parseInt(document.getElementById('cf-credit').value) || 0;
  const cash   = parseInt(document.getElementById('cf-cash').value)   || 0;
  document.getElementById('cf-total').textContent = fmt(debit + credit + cash);
}

function renderCfIncomeDays(incomeDays) {
  const container = document.getElementById('cf-income-days');
  container.innerHTML = '';
  for (const [day, amt] of Object.entries(incomeDays)) {
    container.appendChild(makeCfDayRow(day, amt));
  }
}

function makeCfDayRow(day, amt) {
  const row = document.createElement('div');
  row.className = 'cf-day-row';
  row.innerHTML = `
    <span class="cf-day-label">День</span>
    <input class="cf-day-num" type="number" value="${day}" min="1" max="31" inputmode="numeric" />
    <input class="cf-day-amt" type="number" value="${amt || ''}" placeholder="0" inputmode="numeric" />
    <span class="cf-day-currency">₽</span>
    <button class="cf-day-remove icon-btn">✕</button>
  `;
  row.querySelector('.cf-day-remove').addEventListener('click', () => row.remove());
  return row;
}

async function loadCashflowSection() {
  const ym = cfYm();
  try {
    const cf = await apiJson('GET', `/api/cashflow/${ym}`);
    document.getElementById('cf-debit').value  = cf.debit  || '';
    document.getElementById('cf-credit').value = cf.credit || '';
    document.getElementById('cf-cash').value   = cf.cash   || '';
    updateCfTotal();
    renderCfIncomeDays(cf.incomeDays || { '10': 0, '25': 0 });
  } catch {
    renderCfIncomeDays({ '10': 0, '25': 0 });
  }
}

async function saveCashflow() {
  const incomeDays = {};
  document.querySelectorAll('.cf-day-row').forEach(row => {
    const day = row.querySelector('.cf-day-num').value.trim();
    const amt = parseInt(row.querySelector('.cf-day-amt').value) || 0;
    if (day && amt > 0) incomeDays[day] = (incomeDays[day] || 0) + amt;
  });

  const body = {
    debit:  parseInt(document.getElementById('cf-debit').value)  || 0,
    credit: parseInt(document.getElementById('cf-credit').value) || 0,
    cash:   parseInt(document.getElementById('cf-cash').value)   || 0,
    incomeDays,
  };

  const btn = document.getElementById('btn-cf-save');
  btn.disabled = true; btn.textContent = 'Сохраняю...';
  try {
    await apiJson('PUT', `/api/cashflow/${cfYm()}`, body);
    showToastSuccess('Кэшфлоу сохранён');
    await loadChart(); // refresh unified chart with updated cashflow
  } catch {
    showToastError('Ошибка сохранения');
  } finally {
    btn.disabled = false; btn.textContent = 'Сохранить';
  }
}

// ─── PULL TO REFRESH ──────────────────────────────────────────────────────────

function initPullToRefresh() {
  const content = document.querySelector('.main-content');
  const indicator = document.getElementById('ptr-indicator');
  const THRESHOLD = 64;
  let startY = 0;
  let pulling = false;

  content.addEventListener('touchstart', (e) => {
    if (content.scrollTop === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const delta = e.touches[0].clientY - startY;
    if (delta <= 0) { pulling = false; return; }
    e.preventDefault();
    const pull = Math.min(delta * 0.5, THRESHOLD);
    indicator.style.height = pull + 'px';
    indicator.style.opacity = delta / THRESHOLD;
    indicator.querySelector('.ptr-icon').style.transform =
      `rotate(${Math.min(delta / THRESHOLD, 1) * 180}deg)`;
  }, { passive: false });

  content.addEventListener('touchend', (e) => {
    if (!pulling) return;
    pulling = false;
    const delta = e.changedTouches[0].clientY - startY;
    if (delta >= THRESHOLD) {
      indicator.classList.add('ptr-spinning');
      refreshCurrentScreen();
      setTimeout(() => {
        indicator.style.height = '0';
        indicator.style.opacity = '0';
        indicator.classList.remove('ptr-spinning');
        indicator.querySelector('.ptr-icon').style.transform = '';
      }, 700);
    } else {
      indicator.style.height = '0';
      indicator.style.opacity = '0';
      indicator.querySelector('.ptr-icon').style.transform = '';
    }
  }, { passive: true });
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────

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

// ─── Service Worker ───────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err =>
    console.warn('Service Worker registration failed:', err)
  );

  // Когда новый SW активируется (после деплоя) — перезагружаем страницу автоматически
  let swRefreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swRefreshing) return;
    swRefreshing = true;
    window.location.reload();
  });
}
