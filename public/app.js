// ════════════════════════════════════════════════════════════════
//  Семейный бюджет — PWA Frontend
// ════════════════════════════════════════════════════════════════

import * as E2E from './e2e.js';

const PLAN_CATEGORIES = [
  { key: 'Продукты',    icon: '🛒' },
  { key: 'Дом',         icon: '🏠' },
  { key: 'Дети',        icon: '👶' },
  { key: 'Медицина',    icon: '💊' },
  { key: 'Транспорт',   icon: '🚇' },
  { key: 'Авто',        icon: '🚗' },
  { key: 'Кафе',        icon: '🍽' },
  { key: 'Одежда',      icon: '👗' },
  { key: 'Красота',     icon: '💄' },
  { key: 'Развлечения', icon: '🎮' },
  { key: 'Прочее',      icon: '❓' },
  { key: 'Связь',       icon: '📱' },
];

const CATEGORY_ICONS = {
  'Продукты':     '🛒',
  'Кафе':         '🍽',
  'Транспорт':    '🚇',
  'Авто':         '🚗',
  'Одежда':       '👗',
  'Красота':      '💄',
  'Медицина':     '💊',
  'Развлечения':  '🎮',
  'Дети':         '👶',
  'Дом':          '🏠',
  'Связь':        '📱',
  'Прочее':       '❓',
};

const BASE_CATEGORY_KEYS = Object.keys(CATEGORY_ICONS);

// Пользовательские категории семьи: добавляем в иконки и планирование,
// убираем удалённые (базовые не трогаем)
function applyCustomCategories() {
  const customs = appSettings.customCategories || [];
  const customNames = new Set(customs.map(c => c.name));
  for (const key of Object.keys(CATEGORY_ICONS)) {
    if (!BASE_CATEGORY_KEYS.includes(key) && !customNames.has(key)) delete CATEGORY_ICONS[key];
  }
  for (let i = PLAN_CATEGORIES.length - 1; i >= 0; i--) {
    const k = PLAN_CATEGORIES[i].key;
    if (!BASE_CATEGORY_KEYS.includes(k) && !customNames.has(k)) PLAN_CATEGORIES.splice(i, 1);
  }
  for (const c of customs) {
    // Иконка — свободный текст с сервера, экранируем один раз здесь:
    // дальше она вставляется в innerHTML во множестве мест без повторного esc()
    const safeIcon = esc(c.emoji || '🏷️');
    CATEGORY_ICONS[c.name] = safeIcon;
    if (!PLAN_CATEGORIES.some(pc => pc.key === c.name)) {
      PLAN_CATEGORIES.push({ key: c.name, icon: safeIcon });
    }
  }
  if (typeof initCategoryGrid === 'function' && document.getElementById('category-grid')) {
    initCategoryGrid();
  }
}

// ─── State ────────────────────────────────────────────────────────────────────
let token = localStorage.getItem('budget_token');
let currentUser = null;
let pendingInviteCode = null;
let socket = null;
let appSettings = {};

// Navigation state
let budgetDate = new Date();
let budgetFilter = 'all';
let summaryMonth = null, summaryYear = null;
let chartMonth = null, chartYear = null;
let calViewYear = 0, calViewMonth = 0;

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

function formatDayMonth(dateStr) {
  const [d, m] = dateStr.split('.').map(Number);
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  return `${d} ${months[m - 1]}`;
}

function openCalendar() {
  calViewYear = budgetDate.getFullYear();
  calViewMonth = budgetDate.getMonth();
  renderCalendar();
  document.getElementById('cal-overlay').classList.remove('hidden');
  document.getElementById('cal-modal').classList.remove('hidden');
}

function closeCalendar() {
  document.getElementById('cal-overlay').classList.add('hidden');
  document.getElementById('cal-modal').classList.add('hidden');
}

function renderCalendar() {
  const now = new Date(); now.setHours(0,0,0,0);
  const sel = new Date(budgetDate); sel.setHours(0,0,0,0);
  const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  document.getElementById('cal-month-label').textContent = `${MONTHS[calViewMonth]} ${calViewYear}`;

  // Disable next if already at current month
  const isCurrentMonth = calViewYear === now.getFullYear() && calViewMonth === now.getMonth();
  document.getElementById('cal-next').disabled = isCurrentMonth;

  const firstDow = new Date(calViewYear, calViewMonth, 1).getDay(); // 0=Sun
  const offset = firstDow === 0 ? 6 : firstDow - 1; // Mon=0
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  for (let i = 0; i < offset; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day cal-day--empty';
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calViewYear, calViewMonth, d);
    date.setHours(0,0,0,0);
    const btn = document.createElement('button');
    btn.className = 'cal-day';
    btn.textContent = d;

    const isFuture = date > now;
    const isToday = date.getTime() === now.getTime();
    const isSelected = date.getTime() === sel.getTime();

    if (isFuture) { btn.classList.add('cal-day--future'); btn.disabled = true; }
    if (isToday) btn.classList.add('cal-day--today');
    if (isSelected) btn.classList.add('cal-day--selected');

    if (!isFuture) {
      btn.addEventListener('click', () => {
        budgetDate = date;
        loadBudget();
        closeCalendar();
      });
    }
    grid.appendChild(btn);
  }
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
  // E2E: финансовые запросы обслуживаются локально (сервер видит только шифроблобы)
  if (E2E.active()) {
    const handled = await E2E.handle(method, path, body);
    if (handled !== E2E.PASS) return handled;
  }
  const res = await api(method, path, body);
  try {
    return await res.json();
  } catch {
    return { error: 'Ошибка сервера', _status: res.status };
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function showLogin() {
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('app').classList.add('hidden');

  // Check for invite code in URL
  const urlParams = new URLSearchParams(window.location.search);
  const inviteCode = urlParams.get('invite');
  if (inviteCode) {
    pendingInviteCode = inviteCode.toUpperCase();
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Load auth providers
  try {
    const providers = await fetch('/api/auth/providers').then(r => r.json());
    if (providers.google && providers.googleClientId) {
      document.getElementById('google-signin-section').classList.remove('hidden');
      // Open password section only if no Google
      document.getElementById('password-login-section').removeAttribute('open');

      google.accounts.id.initialize({
        client_id: providers.googleClientId,
        callback: handleGoogleCredential,
        auto_select: false,
      });
      google.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ru', width: 280 }
      );
    } else {
      // No Google — open password login by default
      document.getElementById('password-login-section').setAttribute('open', '');
    }
  } catch {
    document.getElementById('password-login-section').setAttribute('open', '');
  }
}

async function handleGoogleCredential(response) {
  // Если уже вошли — это привязка Google к текущему аккаунту, а не вход
  if (token && currentUser) return handleGoogleLink(response);
  const errEl = document.getElementById('login-error-google');
  errEl.classList.add('hidden');
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Ошибка входа через Google';
      errEl.classList.remove('hidden');
      return;
    }
    await onLoginSuccess(data);
  } catch {
    errEl.textContent = 'Ошибка соединения';
    errEl.classList.remove('hidden');
  }
}

async function onLoginSuccess(data) {
  token = data.token;
  currentUser = { name: data.name, login: data.login, isAdmin: data.isAdmin || false };
  localStorage.setItem('budget_token', token);
  localStorage.setItem('budget_user', JSON.stringify(currentUser));

  // Handle pending invite
  if (pendingInviteCode) {
    await handlePendingInvite();
  } else {
    initApp();
  }
}

async function handlePendingInvite() {
  const code = pendingInviteCode;
  pendingInviteCode = null;
  try {
    const res = await apiJson('POST', '/api/invite/join', { code });
    if (res.token) {
      token = res.token;
      currentUser = { name: res.name, login: res.login, isAdmin: res.isAdmin || false };
      localStorage.setItem('budget_token', token);
      localStorage.setItem('budget_user', JSON.stringify(currentUser));
      showToastSuccess('Вы присоединились к семейному бюджету!');
    }
  } catch {
    // Invite failed — continue without joining
  }
  initApp();
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
    await onLoginSuccess(data);
  } catch {
    errEl.textContent = 'Ошибка соединения';
    errEl.classList.remove('hidden');
  }
}

// ─── BEAUTY RECATEGORIZATION ─────────────────────────────────────────────────

async function openBeautyCandidates() {
  const btn = document.getElementById('btn-beauty-scan');
  btn.disabled = true;
  btn.textContent = '⏳ Ищу...';

  document.getElementById('beauty-sheet').classList.add('open');
  document.getElementById('beauty-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const body = document.getElementById('beauty-body');
  body.innerHTML = '<div class="loading" style="padding:32px;text-align:center">Сканирую расходы...</div>';

  try {
    const { candidates } = await apiJson('GET', '/api/beauty-candidates');

    if (candidates.length === 0) {
      body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">Ничего не найдено — расходы уже корректно разложены по категориям.</div>';
      btn.disabled = false;
      btn.textContent = '💄 Найти расходы для «Красоты»';
      return;
    }

    const rows = candidates.map(e => `
      <label class="beauty-candidate-row">
        <input type="checkbox" class="beauty-cb" data-id="${e.id}" checked />
        <span class="beauty-candidate-info">
          <span class="beauty-candidate-desc">${e.description || '—'}</span>
          <span class="beauty-candidate-meta">${e.date} · ${fmt(e.amount)} · <span class="beauty-cat-old">${e.category}</span></span>
        </span>
      </label>`).join('');

    body.innerHTML = `
      <div style="padding:12px 16px 6px;color:var(--text-muted);font-size:13px">
        Найдено <b>${candidates.length}</b> расх. Отметьте нужные и перекатегоризируйте.
      </div>
      <div id="beauty-list">${rows}</div>
      <div style="padding:12px 16px;display:flex;gap:8px">
        <button id="beauty-select-all" class="btn btn-outline" style="flex:0 0 auto">Все</button>
        <button id="beauty-confirm" class="btn btn-primary" style="flex:1">💄 Перекатегоризировать</button>
      </div>`;

    document.getElementById('beauty-select-all').addEventListener('click', () => {
      const cbs = body.querySelectorAll('.beauty-cb');
      const allChecked = [...cbs].every(c => c.checked);
      cbs.forEach(c => c.checked = !allChecked);
    });

    document.getElementById('beauty-confirm').addEventListener('click', async () => {
      const ids = [...body.querySelectorAll('.beauty-cb:checked')].map(c => c.dataset.id);
      if (ids.length === 0) { showToastError('Ничего не выбрано'); return; }
      const confirmBtn = document.getElementById('beauty-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = '⏳ Применяю...';
      try {
        const { updated } = await apiJson('POST', '/api/beauty-recategorize', { ids });
        showToastSuccess(`Перекатегоризировано: ${updated}`);
        closeBeautySheet();
      } catch {
        showToastError('Ошибка при сохранении');
        confirmBtn.disabled = false;
        confirmBtn.textContent = '💄 Перекатегоризировать';
      }
    });
  } catch {
    body.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">Ошибка загрузки</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '💄 Найти расходы для «Красоты»';
  }
}

function closeBeautySheet() {
  document.getElementById('beauty-sheet').classList.remove('open');
  document.getElementById('beauty-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── Push Notifications ───────────────────────────────────────────────────────

// Сообщаем service worker'у, кто мы, — чтобы он не показывал уведомления
// о наших же записях (они нужны только про партнёра)
async function pushSelfToSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    (reg.active || navigator.serviceWorker.controller)?.postMessage({
      type: 'set-self', name: currentUser?.name || '',
    });
  } catch { /* ignore */ }
}

// Переотправляем имя воркеру при возврате на вкладку и смене воркера —
// чтобы фильтр «не уведомлять о своих» работал даже после перезапуска SW
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) pushSelfToSW();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (currentUser) pushSelfToSW(); });
}

async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    pushSelfToSW();
    const settings = await apiJson('GET', '/api/push/settings');
    updatePushToggleUI(settings.enabled);
    if (!settings.enabled) return;
    await subscribeToPush();
  } catch { /* push not critical */ }
}

async function subscribeToPush() {
  if (Notification.permission === 'denied') return;
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await apiJson('GET', '/api/push/vapid-key');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await apiJson('POST', '/api/push/subscribe', { subscription: sub.toJSON() });
  pushSelfToSW();
}

async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await apiJson('DELETE', '/api/push/subscribe', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

function updatePushToggleUI(enabled) {
  const toggle = document.getElementById('push-toggle');
  if (toggle) toggle.checked = !!enabled;
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
    if (currentScreen === 'goals') loadGoalsScreen();
    else if (currentScreen === 'summary') loadSummary();
  });

  socket.on('goals:updated', () => {
    if (currentScreen === 'goals') loadGoalsList();
  });

  // E2E: другое устройство залило шифроблобы — подтягиваем и обновляем экран
  socket.on('sync:changed', ({ by } = {}) => {
    if (!E2E.active()) return;
    E2E.syncNow().then(() => {
      if (by && by !== currentUser.name) showToastInfo(`${by} обновил бюджет`);
      refreshCurrentScreen();
    }).catch(() => {});
  });

  // E2E включили с другого устройства — перезагружаемся, чтобы подтянуть режим
  socket.on('e2e:enabled', () => {
    setTimeout(() => window.location.reload(), 500);
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
  goals: 'Цели',
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

  trackTabVisit(screenName);
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
    case 'goals': loadGoalsScreen(); break;
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
    if (gen !== budgetGen) { list.style.opacity = ''; return; } // устаревший ответ — выбрасываем
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
            <span class="user-section-name">${esc(user)}</span>
            <span class="user-section-total">${fmt(udata.total)}</span>
          </div>
        `;
        const expList = document.createElement('div');
        expList.className = 'expenses-list';
        for (const exp of udata.expenses) {
          expList.appendChild(buildExpenseItem(exp, exp.user === currentUser.name, { showUser: false }));
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
          list.appendChild(buildExpenseItem(exp, exp.user === currentUser.name, { showUser: false }));
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

// ─── AI ANALYSIS ─────────────────────────────────────────────────────────────

let lastAnalysisText = null;

async function shareAnalysis() {
  if (!lastAnalysisText) return;
  const m = summaryMonth || (new Date().getMonth() + 1);
  const y = summaryYear || new Date().getFullYear();
  const title = `Финансовый анализ — ${getMonthName(m, y)}`;
  const plain = lastAnalysisText
    .replace(/^#{1,3} /gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1');
  if (navigator.share) {
    try {
      await navigator.share({ title, text: plain });
    } catch { /* dismissed */ }
    return;
  }
  await navigator.clipboard.writeText(`${title}\n\n${plain}`);
  showToastSuccess('Скопировано в буфер обмена');
}

function openAnalysis() {
  document.getElementById('analysis-sheet').classList.add('open');
  document.getElementById('analysis-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeAnalysis() {
  document.getElementById('analysis-sheet').classList.remove('open');
  document.getElementById('analysis-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function renderMarkdown(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[hul])(.+)$/gm, (_, l) => l.trim() ? l : '')
    .replace(/(<\/h[23]>|<\/ul>)\n?<\/p>/g, '$1')
    .replace(/^<\/p>|<p>$/gm, '')
    .replace(/<p>(<[hul])/g, '$1')
    .replace(/(<\/[hul][^>]*>)<\/p>/g, '$1');
}

async function getFinancialAnalysis() {
  const btn = document.getElementById('btn-get-analysis');
  btn.disabled = true;
  btn.textContent = '⏳ Анализирую...';

  const body = document.getElementById('analysis-body');
  body.innerHTML = '<div class="analysis-loading"><div class="analysis-spinner"></div><p>Собираю данные и готовлю анализ…</p></div>';
  document.getElementById('analysis-share').classList.add('hidden');
  lastAnalysisText = null;
  openAnalysis();

  try {
    const m = summaryMonth || (new Date().getMonth() + 1);
    const y = summaryYear || new Date().getFullYear();
    const data = await apiJson('POST', '/api/analyze', { month: m, year: y });

    if (data.error) {
      body.innerHTML = `<div class="analysis-error">⚠️ ${data.error}</div>`;
      return;
    }

    lastAnalysisText = data.report || '';
    const html = renderMarkdown(lastAnalysisText);
    body.innerHTML = `<div class="analysis-report">${html}</div>
      <div class="analysis-model">Модель: ${data.model || '—'}</div>`;
    document.getElementById('analysis-share').classList.remove('hidden');
  } catch {
    body.innerHTML = '<div class="analysis-error">⚠️ Ошибка соединения</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Финансовый анализ';
  }
}

// ─── PDF REPORT ───────────────────────────────────────────────────────────────

async function generatePdfReport() {
  const btn = document.getElementById('btn-pdf-report');
  btn.disabled = true;
  btn.textContent = '⏳ Формирую отчёт...';

  try {
    const m = summaryMonth || (new Date().getMonth() + 1);
    const y = summaryYear || new Date().getFullYear();

    // Fetch 3 months of data
    const makeParams = (mo, yr) => new URLSearchParams({ month: mo, year: yr }).toString();
    const prevDate = new Date(y, m - 2, 1);
    const prev2Date = new Date(y, m - 3, 1);

    const [data, planData, prev, prev2] = await Promise.all([
      apiJson('GET', `/api/summary?${makeParams(m, y)}`),
      apiJson('GET', '/api/budget-plan'),
      apiJson('GET', `/api/summary?${makeParams(prevDate.getMonth() + 1, prevDate.getFullYear())}`),
      apiJson('GET', `/api/summary?${makeParams(prev2Date.getMonth() + 1, prev2Date.getFullYear())}`),
    ]);

    const html = buildReportHTML({ data, planData, prev, prev2, m, y });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.addEventListener('load', () => {
        setTimeout(() => { win.print(); URL.revokeObjectURL(url); }, 300);
      });
    }
  } catch (e) {
    showToastError('Ошибка формирования отчёта');
  } finally {
    btn.disabled = false;
    btn.textContent = '📄 Скачать PDF отчёт';
  }
}

function buildReportHTML({ data, planData, prev, prev2, m, y }) {
  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const MONTHS_GEN = ['января','февраля','марта','апреля','мая','июня',
                      'июля','августа','сентября','октября','ноября','декабря'];
  const monthLabel = `${MONTHS_RU[m - 1]} ${y}`;
  const today = new Date();
  const dateLabel = `${today.getDate()} ${MONTHS_GEN[today.getMonth()]} ${today.getFullYear()}`;

  const prevDate = new Date(y, m - 2, 1);
  const prev2Date = new Date(y, m - 3, 1);

  const budgets = planData?.categoryBudgets || {};
  const incomes = planData?.incomes || {};
  const totalIncome = Object.values(incomes).reduce((s, v) => s + v, 0);

  function fmtNum(n) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
  }

  // Category chart: horizontal bars
  const allCats = Object.keys(CATEGORY_ICONS);
  const catData = allCats.map(cat => ({
    cat,
    icon: CATEGORY_ICONS[cat],
    spent: data.byCategory?.[cat] || 0,
    limit: budgets[cat] || 0,
    prev: prev.byCategory?.[cat] || 0,
    prev2: prev2.byCategory?.[cat] || 0,
  })).filter(c => c.spent > 0 || c.limit > 0).sort((a, b) => b.spent - a.spent);

  const maxBar = Math.max(...catData.map(c => Math.max(c.spent, c.limit)), 1);

  const barRows = catData.map(c => {
    const spentPct = Math.round(c.spent / maxBar * 100);
    const limitPct = c.limit ? Math.round(c.limit / maxBar * 100) : 0;
    const over = c.limit > 0 && c.spent > c.limit;
    const barColor = over ? '#ef4444' : '#3b82f6';
    const trend = c.prev > 0 ? Math.round((c.spent - c.prev) / c.prev * 100) : null;
    const trendHtml = trend !== null
      ? `<span style="color:${trend > 10 ? '#ef4444' : trend < -10 ? '#22c55e' : '#6b7280'};font-size:11px">${trend > 0 ? '▲' : '▼'}${Math.abs(trend)}%</span>`
      : '';
    return `
      <tr>
        <td style="width:120px;white-space:nowrap">${c.icon} ${esc(c.cat)}</td>
        <td style="width:100%;padding:0 8px">
          <div style="position:relative;height:18px;background:#f1f5f9;border-radius:4px;overflow:hidden">
            <div style="position:absolute;left:0;top:0;bottom:0;width:${spentPct}%;background:${barColor};border-radius:4px;transition:width .3s"></div>
            ${c.limit ? `<div style="position:absolute;left:${limitPct}%;top:0;bottom:0;width:2px;background:#f59e0b;z-index:1"></div>` : ''}
          </div>
        </td>
        <td style="white-space:nowrap;text-align:right;font-weight:600">${fmtNum(c.spent)}</td>
        <td style="white-space:nowrap;text-align:right;color:#6b7280;font-size:12px">${c.limit ? `/ ${fmtNum(c.limit)}` : ''}</td>
        <td style="white-space:nowrap;text-align:right;width:48px">${trendHtml}</td>
      </tr>`;
  }).join('');

  // User breakdown table
  const userRows = Object.entries(data.byUser || {}).map(([name, ud]) => {
    const inc = incomes[name] || 0;
    const pct = inc > 0 ? Math.round(ud.total / inc * 100) : '—';
    return `<tr>
      <td>${esc(name)}</td>
      <td style="text-align:right;font-weight:600">${fmtNum(ud.total)}</td>
      <td style="text-align:right;color:#6b7280">${inc ? fmtNum(inc) : '—'}</td>
      <td style="text-align:right">${inc ? pct + '%' : '—'}</td>
    </tr>`;
  }).join('');

  // 3-month trend for top categories (by current month spend)
  const top5 = catData.slice(0, 5);
  const trendRows = top5.map(c => {
    const arr = [c.prev2, c.prev, c.spent];
    const svgW = 80, svgH = 30;
    const mx = Math.max(...arr, 1);
    const pts = arr.map((v, i) => `${Math.round(i / 2 * svgW)},${Math.round((1 - v / mx) * svgH)}`).join(' ');
    const miniChart = `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" style="overflow:visible">
      <polyline points="${pts}" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round"/>
      ${arr.map((v, i) => `<circle cx="${Math.round(i / 2 * svgW)}" cy="${Math.round((1 - v / mx) * svgH)}" r="3" fill="#3b82f6"/>`).join('')}
    </svg>`;
    return `<tr>
      <td>${c.icon} ${c.cat}</td>
      <td style="text-align:right">${fmtNum(c.prev2)}</td>
      <td style="text-align:right">${fmtNum(c.prev)}</td>
      <td style="text-align:right;font-weight:600">${fmtNum(c.spent)}</td>
      <td style="text-align:center;padding:0 8px">${miniChart}</td>
    </tr>`;
  }).join('');

  const savingsRate = totalIncome > 0 ? Math.round((totalIncome - data.total) / totalIncome * 100) : null;
  const savingsHtml = savingsRate !== null
    ? `<div class="stat-box"><div class="stat-label">Норма сбережений</div><div class="stat-value" style="color:${savingsRate >= 0 ? '#22c55e' : '#ef4444'}">${savingsRate}%</div></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Отчёт за ${monthLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; background: #fff; padding: 24px; max-width: 800px; margin: 0 auto; font-size: 13px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 2px; }
  h2 { font-size: 15px; font-weight: 600; margin: 20px 0 10px; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 20px; }
  .stats-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .stat-box { background: #f8fafc; border-radius: 8px; padding: 12px 16px; flex: 1; min-width: 120px; }
  .stat-label { font-size: 11px; color: #64748b; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .04em; }
  .stat-value { font-size: 20px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 6px 4px; }
  th { font-size: 11px; color: #64748b; text-align: left; border-bottom: 1px solid #e2e8f0; }
  tr:not(:last-child) td { border-bottom: 1px solid #f1f5f9; }
  .legend { display: flex; gap: 16px; font-size: 11px; color: #64748b; margin-top: 6px; }
  .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
  @media print {
    body { padding: 0; }
    h2 { page-break-after: avoid; }
    table { page-break-inside: avoid; }
  }
</style>
</head>
<body>
<h1>Семейный бюджет — ${monthLabel}</h1>
<div class="meta">Отчёт сформирован ${dateLabel}</div>

<h2>Итоги месяца</h2>
<div class="stats-row">
  <div class="stat-box">
    <div class="stat-label">Потрачено</div>
    <div class="stat-value">${fmtNum(data.total)}</div>
  </div>
  ${totalIncome > 0 ? `<div class="stat-box"><div class="stat-label">Доходы</div><div class="stat-value" style="color:#22c55e">${fmtNum(totalIncome)}</div></div>` : ''}
  ${totalIncome > 0 && planData?.categoryBudgets ? `<div class="stat-box"><div class="stat-label">Бюджет</div><div class="stat-value">${fmtNum(Object.values(budgets).reduce((s,v) => s+v, 0))}</div></div>` : ''}
  ${savingsHtml}
</div>

${Object.keys(data.byUser || {}).length > 1 ? `
<h2>По участникам</h2>
<table>
  <thead><tr><th>Участник</th><th style="text-align:right">Расходы</th><th style="text-align:right">Доход</th><th style="text-align:right">% дохода</th></tr></thead>
  <tbody>${userRows}</tbody>
</table>` : ''}

<h2>Расходы по категориям</h2>
<table>${barRows}</table>
<div class="legend">
  <span><span class="legend-dot" style="background:#3b82f6"></span>Факт</span>
  <span><span class="legend-dot" style="background:#f59e0b"></span>Лимит</span>
  <span><span class="legend-dot" style="background:#ef4444"></span>Превышение</span>
</div>

${top5.length > 0 ? `
<h2>Тенденции — топ категорий</h2>
<table>
  <thead><tr>
    <th>Категория</th>
    <th style="text-align:right">${MONTHS_RU[prev2Date.getMonth()].slice(0,3)}</th>
    <th style="text-align:right">${MONTHS_RU[prevDate.getMonth()].slice(0,3)}</th>
    <th style="text-align:right">${MONTHS_RU[m-1].slice(0,3)}</th>
    <th style="text-align:center">Тренд</th>
  </tr></thead>
  <tbody>${trendRows}</tbody>
</table>` : ''}

</body>
</html>`;
}

// ─── SUMMARY SCREEN ───────────────────────────────────────────────────────────

let summaryUserFilter = null; // null = all users
let summaryCompareMode = false;
let lastSummaryData = null;
let lastPlanData = null;
let compareChart = null;

let heatmapSelectedDay = null;

async function loadHeatMap() {
  const grid = document.getElementById('heatmap-grid');
  const detail = document.getElementById('heatmap-day-detail');
  if (!grid) return;
  const m = summaryMonth || (new Date().getMonth() + 1);
  const y = summaryYear || new Date().getFullYear();
  const daysInMonth = new Date(y, m, 0).getDate();
  const ym = `${y}-${String(m).padStart(2, '0')}`;

  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:13px">Загрузка...</div>';
  detail.classList.add('hidden');
  heatmapSelectedDay = null;

  let dailyTotals = Array(daysInMonth).fill(0);
  let memberCount = 1;
  try {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 8000);
    const res = await fetch(`/api/unified-chart-data/${ym}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: abort.signal,
    });
    if (res.ok) {
      const data = await res.json();
      const allExpenses = data.userExpenses || {};
      memberCount = Math.max(Object.keys(allExpenses).length, 1);
      const filteredExpenses = summaryUserFilter
        ? (allExpenses[summaryUserFilter] ? { [summaryUserFilter]: allExpenses[summaryUserFilter] } : {})
        : allExpenses;
      for (const userDays of Object.values(filteredExpenses)) {
        for (let i = 0; i < userDays.length && i < daysInMonth; i++) {
          dailyTotals[i] += userDays[i] || 0;
        }
      }
    }
  } catch { /* show zeros */ }

  // Доля участника: 1/N от порогов семьи (двое — 50%, трое — 33%)
  const scale = summaryUserFilter ? 1 / memberCount : 1;
  const thresholds = [2000, 5000, 10000, 20000].map(v => v * scale);
  const tLabel = v => v >= 1000 ? `${Math.round(v / 100) / 10}к` : String(Math.round(v));
  const legend = document.querySelector('.heatmap-legend');
  if (legend) legend.innerHTML = [
    `<span class="hm-dot hm-c0"></span>0`,
    `<span class="hm-dot hm-c1"></span>${tLabel(thresholds[0])}`,
    `<span class="hm-dot hm-c2"></span>${tLabel(thresholds[1])}`,
    `<span class="hm-dot hm-c3"></span>${tLabel(thresholds[2])}`,
    `<span class="hm-dot hm-c4"></span>${tLabel(thresholds[3])}`,
    `<span class="hm-dot hm-c5"></span>${tLabel(thresholds[3])}+`,
  ].join('');
  function colorClass(v) {
    if (v === 0)                return 'hm-c0';
    if (v <= 2000  * scale)     return 'hm-c1';
    if (v <= 5000  * scale)     return 'hm-c2';
    if (v <= 10000 * scale)     return 'hm-c3';
    if (v <= 20000 * scale)     return 'hm-c4';
    return 'hm-c5';
  }
  function fmtShort(v) {
    if (v === 0) return '';
    if (v >= 1000) return Math.round(v / 1000) + 'к';
    return String(v);
  }

  // Monday-first: offset = (dayOfWeek(1st) + 6) % 7
  const firstDow = new Date(y, m - 1, 1).getDay();
  const offset = (firstDow + 6) % 7;
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  let html = DAYS.map(d => `<div class="hm-weekday">${d}</div>`).join('');
  // blank cells before 1st
  for (let i = 0; i < offset; i++) html += '<div class="hm-cell hm-empty"></div>';
  // day cells
  for (let d = 1; d <= daysInMonth; d++) {
    const amt = dailyTotals[d - 1];
    const cls = colorClass(amt);
    const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    html += `<div class="hm-cell ${cls}" data-date="${dateStr}" data-day="${d}">
      <span class="hm-day-num">${d}</span>
      ${amt > 0 ? `<span class="hm-day-amt">${fmtShort(amt)}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  // Click: show day detail
  grid.querySelectorAll('.hm-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      const dayNum = cell.dataset.day;
      if (heatmapSelectedDay === dateStr) {
        // toggle off
        cell.classList.remove('hm-active');
        detail.classList.add('hidden');
        heatmapSelectedDay = null;
        return;
      }
      grid.querySelectorAll('.hm-active').forEach(c => c.classList.remove('hm-active'));
      cell.classList.add('hm-active');
      heatmapSelectedDay = dateStr;
      showHeatmapDayDetail(dateStr, dayNum, detail);
    });
  });
}

async function showHeatmapDayDetail(dateStr, dayNum, detailEl) {
  const [y, m] = dateStr.split('-');
  detailEl.classList.remove('hidden');
  detailEl.innerHTML = `<div class="heatmap-day-detail-title">${parseInt(dayNum)} ${getMonthName(parseInt(m), parseInt(y))}</div><div class="loading" style="font-size:13px">Загрузка...</div>`;
  try {
    const userParam = summaryUserFilter ? `&user=${encodeURIComponent(summaryUserFilter)}` : '';
    const data = await apiJson('GET', `/api/expenses/day?date=${dateStr}${userParam}`);
    const entries = data.entries || [];
    if (entries.length === 0) {
      detailEl.querySelector('.loading').outerHTML = '<div class="empty-state" style="font-size:13px;padding:8px 0">Нет расходов в этот день</div>';
      return;
    }
    const rows = entries.map(e => `
      <div class="feed-entry">
        <span class="feed-cat-icon">${CATEGORY_ICONS[e.category] || '❓'}</span>
        <div class="feed-entry-info">
          <span class="feed-entry-desc">${esc(e.description || e.category)}</span>
          <span class="feed-entry-meta">${esc(e.user || '')}${e.category ? ` · ${esc(e.category)}` : ''}</span>
        </div>
        <span class="feed-entry-amt">${fmt(e.amount)}</span>
      </div>`).join('');
    const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
    detailEl.innerHTML = `
      <div class="heatmap-day-detail-title">${parseInt(dayNum)} ${getMonthName(parseInt(m), parseInt(y))} · ${fmt(total)}</div>
      ${rows}`;
  } catch {
    detailEl.innerHTML = '<div class="empty-state" style="font-size:13px">Ошибка загрузки</div>';
  }
}

async function loadSummary() {
  const gen = ++summaryGen;
  const params = new URLSearchParams({
    ...(summaryMonth ? { month: summaryMonth } : {}),
    ...(summaryYear ? { year: summaryYear } : {}),
  });

  document.getElementById('summary-month-label').textContent = getMonthName(summaryMonth, summaryYear);
  document.getElementById('category-detail').classList.add('hidden');
  document.getElementById('summary-by-user').classList.remove('hidden');
  document.getElementById('summary-total-bar').classList.remove('hidden');
  document.querySelector('.speed-chart-card')?.classList.remove('hidden');
  document.querySelector('.family-overview-card')?.classList.remove('hidden');
  loadHeatMap();
  try { loadSpeedChart(summaryMonth, summaryYear); } catch (e) { console.error('speedChart', e); }

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

    renderSummaryView();
    renderFamilyOverview(document.getElementById('family-overview-list'), data);
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
  const plannedMonthly = appSettings.plannedMonthly || 0;
  const remaining = plannedMonthly > 0 ? plannedMonthly - data.total : null;
  const remainHtml = remaining !== null
    ? `<div class="summary-остаток-row"><span>Остаток от плана</span><span class="summary-остаток-amt ${remaining >= 0 ? 'ok' : 'over'}">${fmt(remaining)}</span></div>`
    : '';
  totalBar.innerHTML = `<div class="summary-total-main"><span>Итого за месяц${filterLabel}</span><span class="highlight-total">${fmt(displayTotal)}</span></div>${remainHtml}`;

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
      document.getElementById('category-detail').classList.add('hidden');
      if (summaryCompareMode) { return; }
      renderSummaryView();
      loadHeatMap();
    });
    byUserEl.appendChild(chip);
  }

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
    plugins: [ChartDataLabels],
    data: { labels: sortedCats, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: 52 } },
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
        datalabels: {
          anchor: 'end',
          align: 'end',
          clip: false,
          formatter: (v) => v > 0 ? (v >= 1000 ? Math.round(v / 1000) + 'к' : v) : null,
          font: { size: 11, weight: '600' },
          color: (ctx) => datasets[ctx.datasetIndex]?.backgroundColor || '#555',
        },
      },
    },
  });
}

async function loadCategoryDetail(cat, month, year) {
  const params = new URLSearchParams({
    ...(month ? { month } : {}),
    ...(year ? { year } : {}),
    ...(summaryUserFilter ? { user: summaryUserFilter } : {}),
  });

  // Update total bar: show this category's amount (filtered by user if active)
  if (lastSummaryData) {
    const catAmount = summaryUserFilter
      ? (lastSummaryData.byUser[summaryUserFilter]?.byCategory[cat] || 0)
      : (lastSummaryData.byCategory[cat] || 0);
    const uLabel = summaryUserFilter ? ` · ${summaryUserFilter}` : '';
    document.getElementById('summary-total-bar').innerHTML =
      `<div class="summary-total-main"><span>${CATEGORY_ICONS[cat] || ''} ${esc(cat)}${uLabel}</span><span class="highlight-total">${fmt(catAmount)}</span></div>`;
  }

  document.getElementById('summary-categories').classList.add('hidden');
  document.getElementById('summary-compare-panel').classList.add('hidden');
  document.getElementById('summary-heatmap').classList.add('hidden');
  document.getElementById('summary-by-user').classList.add('hidden');
  // Блоки аналитики за весь месяц не относятся к выбранной категории и лишь
  // отделяют её сумму от списка расходов — прячем на время просмотра категории
  document.querySelector('.speed-chart-card')?.classList.add('hidden');
  document.querySelector('.family-overview-card')?.classList.add('hidden');

  const detail = document.getElementById('category-detail');
  detail.classList.remove('hidden');
  document.getElementById('category-detail-title').textContent = `${CATEGORY_ICONS[cat] || ''} ${cat}`;

  const MONTH_NAMES = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const mLabel = `${MONTH_NAMES[(month || new Date().getMonth() + 1) - 1]} ${year || new Date().getFullYear()}`;
  const uLabel = summaryUserFilter ? ` · ${summaryUserFilter}` : '';
  document.getElementById('category-detail-ctx').textContent = mLabel + uLabel;

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
      listEl.appendChild(buildExpenseItem(exp, exp.user === currentUser.name, { showDate: true, showCategory: false }));
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
    const data = await apiJson('GET', `/api/unified-chart-data/${ym}`);
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
    console.error('loadChart error:', e);
    loadingEl.remove();
    const emp = document.createElement('div');
    emp.className = 'empty-state';
    emp.textContent = typeof Chart === 'undefined'
      ? 'Библиотека графиков не загрузилась'
      : 'Ошибка загрузки графика: ' + (e?.message || e);
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
  const totalIncome = Object.values(lastPlanData?.incomes || {}).reduce((s, v) => s + v, 0);
  let totalLimits = 0;
  document.querySelectorAll('.plan-budget-input').forEach(inp => {
    totalLimits += parseInt(inp.value) || 0;
  });
  const savings = totalIncome - totalLimits;
  const el = document.getElementById('plan-savings-calc');
  if (!el) return;
  if (totalIncome === 0) {
    el.textContent = '—';
    el.className = 'plan-savings-calc';
  } else {
    el.textContent = fmt(savings);
    el.className = 'plan-savings-calc ' + (savings >= 0 ? 'savings-ok' : 'savings-over');
  }
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
      <span class="plan-cat-name">${esc(cat.key)}</span>
      <input class="plan-budget-input" type="number" data-cat="${esc(cat.key)}"
             value="${budgeted || ''}" placeholder="—" inputmode="numeric" />
    `;
    row.querySelector('input').addEventListener('input', updatePlanTotals);
    table.appendChild(row);
  }

  // Savings row — auto-calculated, read-only
  const savingsRow = document.createElement('div');
  savingsRow.className = 'plan-row plan-row--savings';
  savingsRow.innerHTML = `
    <span class="plan-cat-icon">🏦</span>
    <span class="plan-cat-name">Сбережения</span>
    <span id="plan-savings-calc" class="plan-savings-calc">—</span>
  `;
  table.appendChild(savingsRow);

  updatePlanTotals();
}

async function savePlan() {
  const categoryBudgets = {};
  document.querySelectorAll('.plan-budget-input').forEach(inp => {
    const val = parseInt(inp.value) || 0;
    if (val > 0) categoryBudgets[inp.dataset.cat] = val;
  });

  // Preserve existing income values (no longer editable here)
  const incomes = lastPlanData?.incomes || {};

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
    applyCustomCategories();
    renderCustomCategoriesList();
    renderGoogleLinkSection();
    renderBlocksConstructor();
    applyBlockVisibility();

    const plannedInput = document.getElementById('setting-planned-monthly');
    if (plannedInput) plannedInput.value = data.plannedMonthly || '';

    const familyNameInput = document.getElementById('setting-family-name');
    if (familyNameInput) familyNameInput.value = data.familyName || '';
    updateFamilyChip(data.familyName || '');
  } catch {
    showToastError('Ошибка загрузки настроек');
  }

  if (currentUser?.isAdmin) {
    document.getElementById('admin-panel-btn-section').classList.remove('hidden');
    document.getElementById('admin-update-section').classList.remove('hidden');
  }

  renderE2ESection();
}

// ─── E2E (Приватность) ────────────────────────────────────────────────────────

function renderE2ESection() {
  const statusEl = document.getElementById('e2e-status');
  const offEl = document.getElementById('e2e-off');
  const onEl = document.getElementById('e2e-on');
  if (!statusEl || !offEl || !onEl) return;

  const on = E2E.active();
  const enabledNoKey = E2E.enabled() && !E2E.hasKey();

  if (on) {
    statusEl.textContent = '✅ Шифрование включено. Сервер не видит ваши расходы.';
    onEl.classList.remove('hidden');
    offEl.classList.add('hidden');
  } else if (enabledNoKey) {
    statusEl.textContent = '🔑 В этой семье включено шифрование, но на этом устройстве нет ключа. Введите ключ с другого устройства, чтобы видеть данные.';
    onEl.classList.remove('hidden');
    offEl.classList.add('hidden');
  } else {
    statusEl.textContent = 'Шифрование выключено — сервер видит расходы в открытом виде.';
    offEl.classList.remove('hidden');
    onEl.classList.add('hidden');
  }
  document.getElementById('e2e-key-box')?.classList.add('hidden');
}

async function doEnableE2E() {
  const ok = confirm(
    'Включить сквозное шифрование?\n\n' +
    'После включения расходы будут шифроваться на устройстве, и сервер не сможет их прочитать.\n\n' +
    '⚠️ ВАЖНО: ключ хранится только на ваших устройствах. Если вы его потеряете — данные будет НЕВОЗМОЖНО восстановить. Сразу после включения сохраните ключ в надёжном месте.'
  );
  if (!ok) return;

  const btn = document.getElementById('btn-e2e-enable');
  if (btn) { btn.disabled = true; btn.textContent = 'Включаю…'; }
  try {
    const res = await E2E.enableE2E();
    if (res.ok) {
      renderE2ESection();
      showE2EKey(res.keyPhrase);
      showToastSuccess(`Шифрование включено. Перенесено расходов: ${res.migrated}`);
    } else {
      showToastError(res.error || 'Не удалось включить шифрование');
    }
  } catch {
    showToastError('Ошибка при включении шифрования');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Включить шифрование'; }
  }
}

function showE2EKey(phrase) {
  const box = document.getElementById('e2e-key-box');
  const text = document.getElementById('e2e-key-text');
  if (!box || !text) return;
  text.textContent = phrase || E2E.exportKeyHex() || '(ключ недоступен)';
  box.classList.remove('hidden');
}

async function doImportE2EKey() {
  const hex = prompt('Вставьте ключ семьи (64 символа), полученный с другого устройства:');
  if (!hex) return;
  const ok = await E2E.importKeyHex(hex);
  if (!ok) { showToastError('Неверный ключ (нужно 64 hex-символа)'); return; }
  showToastSuccess('Ключ сохранён. Обновляю данные…');
  try { await E2E.syncNow(); } catch { /* ignore */ }
  renderE2ESection();
  refreshCurrentScreen();
}

function updateFamilyChip(name) {
  const chip = document.getElementById('topbar-family');
  if (!chip) return;
  if (name) {
    chip.textContent = name;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }
}

// ─── ADMIN PANEL ──────────────────────────────────────────────────────────────

function renderFamilyNameView(container, famId, name) {
  container.innerHTML = `
    <div class="admin-family-name-view">
      <span class="admin-family-id">${esc(famId)}</span>
      ${name ? `<span class="admin-family-display-name">${esc(name)}</span>` : ''}
      <button class="admin-family-name-edit-btn icon-btn" title="Переименовать">✏️</button>
    </div>`;
  container.querySelector('.admin-family-name-edit-btn').addEventListener('click', () => {
    renderFamilyNameEdit(container, famId, name);
  });
}

function renderFamilyNameEdit(container, famId, currentName) {
  container.innerHTML = `
    <div class="admin-family-name-row">
      <input class="admin-family-name-input" type="text" placeholder="Название семьи" value="${esc(currentName)}" maxlength="40" />
      <button class="admin-family-name-save btn btn-sm btn-primary">✓</button>
      <button class="admin-family-name-cancel btn btn-sm btn-outline">✕</button>
    </div>`;
  const input = container.querySelector('.admin-family-name-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  container.querySelector('.admin-family-name-cancel').addEventListener('click', () => {
    renderFamilyNameView(container, famId, currentName);
  });
  container.querySelector('.admin-family-name-save').addEventListener('click', async () => {
    const nameVal = input.value.trim();
    const res = await apiJson('PUT', `/api/admin/family-settings/${encodeURIComponent(famId)}`, { familyName: nameVal });
    if (res.ok) {
      showToastSuccess(nameVal ? `Название «${nameVal}» сохранено` : 'Название удалено');
      renderFamilyNameView(container, famId, nameVal);
    } else {
      showToastError(res.error || 'Ошибка');
    }
  });
}

async function openAdminPanel(month, year) {
  document.getElementById('admin-overlay').classList.remove('hidden');
  document.getElementById('admin-panel').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const now = new Date();
  const m = month || now.getMonth() + 1;
  const y = year  || now.getFullYear();

  const body = document.getElementById('admin-panel-body');
  body.innerHTML = '<div class="loading">Загрузка…</div>';

  const [stats, allUsers] = await Promise.all([
    apiJson('GET', `/api/admin/stats?month=${m}&year=${y}`),
    apiJson('GET', '/api/admin/users'),
  ]);

  if (!stats || !Array.isArray(allUsers)) {
    body.innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
    return;
  }

  // Group users by family
  const byFamily = {};
  for (const u of stats.users) {
    if (!byFamily[u.family]) byFamily[u.family] = [];
    byFamily[u.family].push(u);
  }

  const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

  // Month nav goes into the non-scrollable nav bar (outside body) — fixes iOS touch issue
  const nav = document.getElementById('admin-panel-nav');
  nav.innerHTML = `
    <button id="admin-prev-month" class="icon-btn">◀</button>
    <span class="nav-date-label">${MONTH_NAMES[m-1]} ${y}</span>
    <button id="admin-next-month" class="icon-btn">▶</button>
  `;
  nav.querySelector('#admin-prev-month').addEventListener('click', () => {
    const prev = new Date(y, m - 2, 1);
    openAdminPanel(prev.getMonth() + 1, prev.getFullYear());
  });
  nav.querySelector('#admin-next-month').addEventListener('click', () => {
    const next = new Date(y, m, 1);
    openAdminPanel(next.getMonth() + 1, next.getFullYear());
  });

  body.innerHTML = `
    <div class="admin-stats-summary">
      <div class="admin-stat-card"><div class="admin-stat-num">${stats.totalFamilies}</div><div class="admin-stat-label">семей</div></div>
      <div class="admin-stat-card"><div class="admin-stat-num">${stats.totalUsers}</div><div class="admin-stat-label">пользователей</div></div>
      <div class="admin-stat-card"><div class="admin-stat-num">${stats.users.reduce((s,u)=>s+u.expenseCount,0)}</div><div class="admin-stat-label">записей всего</div></div>
    </div>
    <div id="admin-families-stat"></div>
  `;

  // Load family names in parallel
  const familyIds = Object.keys(byFamily);
  const famSettingsArr = await Promise.all(
    familyIds.map(fid => apiJson('GET', `/api/admin/family-settings/${encodeURIComponent(fid)}`).catch(() => ({})))
  );
  const famSettings = Object.fromEntries(familyIds.map((fid, i) => [fid, famSettingsArr[i]]));

  const familyStat = body.querySelector('#admin-families-stat');
  for (const [famId, members] of Object.entries(byFamily)) {
    const block = document.createElement('div');
    block.className = 'admin-family-block';
    const currentName = famSettings[famId]?.familyName || '';

    // Family name: view mode by default, switch to edit on pencil click
    const nameHeader = document.createElement('div');
    nameHeader.className = 'admin-family-header';
    renderFamilyNameView(nameHeader, famId, currentName);
    block.appendChild(nameHeader);
    for (const u of members) {
      const row = document.createElement('div');
      row.className = 'admin-user-row';
      row.innerHTML = `
        <div class="admin-user-info">
          <div class="admin-user-name">${esc(u.name)} ${u.isGoogle ? '<span class="admin-badge-google">G</span>' : ''} ${u.isAdmin ? '<span class="admin-badge-admin">admin</span>' : ''}</div>
          <div class="admin-user-meta">${esc(u.login)}${u.lastDate ? ` · последний ${u.lastDate}` : ''}</div>
        </div>
        <span class="admin-stat-entries">${u.expenseCount} зап.</span>
        <button class="admin-user-del" title="Удалить"
          ${u.login === currentUser.login ? 'disabled style="opacity:.3;cursor:default"' : ''}>✕</button>
      `;
      row.querySelector('.admin-user-del').addEventListener('click', async () => {
        if (!confirm(`Удалить пользователя ${u.name}?`)) return;
        const res = await apiJson('DELETE', `/api/admin/users/${encodeURIComponent(u.login)}`);
        if (res.ok) { showToastSuccess('Удалён'); openAdminPanel(); }
        else showToastError(res.error || 'Ошибка');
      });
      block.appendChild(row);
    }
    familyStat.appendChild(block);
  }

  // Create user form
  const families = Object.keys(byFamily);
  const familyOpts = families.map(f => `<option value="${esc(f)}">${esc(f)}</option>`).join('');
  const createForm = document.createElement('div');
  createForm.className = 'admin-create-section';
  createForm.innerHTML = `
    <button id="btn-admin-add2" class="btn btn-outline btn-full" style="margin-top:16px">+ Создать пользователя</button>
    <div id="admin-create-form2" class="admin-create-form hidden">
      <div class="form-group"><label>Имя</label><input id="anew-name" type="text" placeholder="Имя" autocomplete="off"/></div>
      <div class="form-group"><label>Логин</label><input id="anew-login" type="text" placeholder="login" autocomplete="off" autocapitalize="none"/></div>
      <div class="form-group"><label>Пароль</label><input id="anew-password" type="text" placeholder="пароль" autocomplete="off"/></div>
      <div class="form-group"><label>Семья</label><select id="anew-family">${familyOpts}<option value="__new__">+ Новая…</option></select></div>
      <div id="anew-error" class="error-msg hidden"></div>
      <div class="admin-form-btns">
        <button id="anew-create" class="btn btn-primary">Создать</button>
        <button id="anew-cancel" class="btn btn-outline">Отмена</button>
      </div>
    </div>
  `;
  body.appendChild(createForm);

  body.querySelector('#btn-admin-add2').addEventListener('click', () => {
    body.querySelector('#admin-create-form2').classList.remove('hidden');
    body.querySelector('#btn-admin-add2').classList.add('hidden');
  });
  body.querySelector('#anew-cancel').addEventListener('click', () => {
    body.querySelector('#admin-create-form2').classList.add('hidden');
    body.querySelector('#btn-admin-add2').classList.remove('hidden');
  });
  body.querySelector('#anew-create').addEventListener('click', async () => {
    const name = body.querySelector('#anew-name').value.trim();
    const login = body.querySelector('#anew-login').value.trim();
    const password = body.querySelector('#anew-password').value.trim();
    let family = body.querySelector('#anew-family').value;
    if (family === '__new__') family = 'fam_' + Date.now().toString(36);
    const errEl = body.querySelector('#anew-error');
    if (!name || !login || !password) { errEl.textContent = 'Заполните все поля'; errEl.classList.remove('hidden'); return; }
    errEl.classList.add('hidden');
    const res = await apiJson('POST', '/api/admin/users', { name, login, password, family });
    if (res.login) { showToastSuccess('Пользователь создан'); openAdminPanel(); }
    else { errEl.textContent = res.error || 'Ошибка'; errEl.classList.remove('hidden'); }
  });
}

function closeAdminPanel() {
  document.getElementById('admin-overlay').classList.add('hidden');
  document.getElementById('admin-panel').classList.add('hidden');
  document.body.style.overflow = '';
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadSettings() {
  appSettings = await apiJson('GET', '/api/settings');
  applyCustomCategories();
  applyBlockVisibility();
}



// Привязка Google к легаси-аккаунту (вход по паролю → кнопка в настройках)
async function handleGoogleLink(response) {
  try {
    const res = await apiJson('POST', '/api/auth/link-google', { credential: response.credential });
    let msg = 'Google-аккаунт привязан!';
    if (res.mergedDuplicate) msg += ` Дубликат объединён, перенесено расходов: ${res.moved}`;
    showToastSuccess(msg);
    await loadSettingsScreen();
  } catch (e) {
    showToastError('Не удалось привязать Google');
  }
}

async function renderGoogleLinkSection() {
  const status = document.getElementById('account-link-status');
  const btnBox = document.getElementById('google-link-btn');
  if (!status || !btnBox) return;
  try {
    const me = await apiJson('GET', '/api/me');
    if (me.googleLinked) {
      status.textContent = '✅ Вход через Google привязан к этому аккаунту.';
      btnBox.innerHTML = '';
      return;
    }
    status.textContent = 'Привяжите Google, чтобы входить без пароля в вебе и приложении — вся история останется на этом аккаунте.';
    if (typeof google !== 'undefined' && google.accounts?.id) {
      btnBox.innerHTML = '';
      google.accounts.id.renderButton(btnBox, {
        theme: 'outline', size: 'large', text: 'continue_with', locale: 'ru', width: 280,
      });
    }
  } catch { /* не критично */ }
}

// ─── Конструктор аналитики: блоки вкл/выкл, хранится на устройстве ───────────

const ANALYTICS_BLOCKS = [
  { id: 'gauge',   label: '💸 Барометр бюджета',        sel: '.bablometr-card' },
  { id: 'heatmap', label: '🗓 Расходы по дням',         sel: '#summary-heatmap' },
  { id: 'speed',   label: '📈 Скорость трат',           sel: '.speed-chart-card' },
  { id: 'byUser',  label: '👥 По участникам',           sel: '#summary-by-user' },
  { id: 'family',  label: '👨‍👩‍👧 Семейные расходы',       sel: '.family-overview-card' },
  { id: 'ai',      label: '🤖 Кнопки ИИ-анализа и PDF', sel: null },
  { id: 'chartTab', label: '📉 Вкладка «График»',       sel: null },
  { id: 'goalsTab', label: '🎯 Вкладка «Цели»',         sel: null },
];

function getBlocks() {
  try {
    return { gauge: true, heatmap: true, speed: true, byUser: true, family: true, ai: true, chartTab: true, goalsTab: true,
      ...JSON.parse(localStorage.getItem('analytics_blocks') || '{}') };
  } catch { return {}; }
}

function setBlockEnabled(id, v) {
  const b = getBlocks();
  b[id] = v;
  localStorage.setItem('analytics_blocks', JSON.stringify(b));
  applyBlockVisibility();
}

function applyBlockVisibility() {
  const b = getBlocks();
  for (const blk of ANALYTICS_BLOCKS) {
    if (!blk.sel) continue;
    document.querySelectorAll(blk.sel).forEach(el => el.style.display = b[blk.id] === false ? 'none' : '');
  }
  const ai1 = document.getElementById('btn-get-analysis');
  const ai2 = document.getElementById('btn-pdf-report');
  if (ai1) ai1.style.display = b.ai === false ? 'none' : '';
  if (ai2) ai2.style.display = b.ai === false ? 'none' : '';
  const chartNav = document.querySelector('.nav-btn[data-screen="chart"]');
  const goalsNav = document.querySelector('.nav-btn[data-screen="goals"]');
  if (chartNav) chartNav.style.display = b.chartTab === false ? 'none' : '';
  if (goalsNav) goalsNav.style.display = b.goalsTab === false ? 'none' : '';
}

function renderBlocksConstructor() {
  const box = document.getElementById('blocks-constructor');
  if (!box) return;
  const b = getBlocks();
  box.innerHTML = ANALYTICS_BLOCKS.map(blk => `
    <label class="push-toggle-row" style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;cursor:pointer">
      <span class="toggle-label">${blk.label}</span>
      <span class="toggle-wrap">
        <input type="checkbox" class="block-toggle" data-block="${blk.id}" ${b[blk.id] === false ? '' : 'checked'} />
        <span class="toggle-slider"></span>
      </span>
    </label>`).join('');
  box.querySelectorAll('.block-toggle').forEach(inp => {
    inp.addEventListener('change', () => setBlockEnabled(inp.dataset.block, inp.checked));
  });
}

// ─── Пользовательские категории (Настройки) ──────────────────────────────────

function renderCustomCategoriesList() {
  const box = document.getElementById('custom-cats-list');
  if (!box) return;
  const customs = appSettings.customCategories || [];
  box.innerHTML = customs.length === 0
    ? '<div style="color:var(--text-muted);font-size:13px">Пока нет своих категорий</div>'
    : customs.map(c => `
      <div class="custom-cat-row">
        <span>${esc(c.emoji || '🏷️')} ${esc(c.name)}</span>
        <button class="btn btn-outline btn-cat-del" data-name="${esc(c.name)}">Удалить</button>
      </div>`).join('');
  box.querySelectorAll('.btn-cat-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`Удалить «${name}»? Все её расходы будут перенесены в «Прочее».`)) return;
      try {
        const r = await apiJson('DELETE', `/api/categories/${encodeURIComponent(name)}`);
        showToastSuccess(r.moved ? `Категория удалена, перенесено расходов: ${r.moved}` : 'Категория удалена');
        await loadSettingsScreen();
      } catch (e) {
        showToastError('Ошибка удаления категории');
      }
    });
  });
}

async function addCustomCategoryUI() {
  const nameInp = document.getElementById('custom-cat-name');
  const emojiInp = document.getElementById('custom-cat-emoji');
  const name = (nameInp?.value || '').trim();
  if (!name) { showToastError('Введите название категории'); return; }
  try {
    await apiJson('POST', '/api/categories', { name, emoji: (emojiInp?.value || '').trim() || '🏷️' });
    nameInp.value = ''; if (emojiInp) emojiInp.value = '';
    showToastSuccess('Категория добавлена');
    await loadSettingsScreen();
  } catch (e) {
    showToastError('Не удалось добавить категорию');
  }
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
    btn.innerHTML = `<span class="cat-icon">${CATEGORY_ICONS[cat]}</span><span class="cat-name">${esc(cat)}</span>`;
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
    if (editingExpenseId) {
      const res = await apiJson('PUT', `/api/expenses/${editingExpenseId}`, {
        date: dateStr, category: selectedCategory, amount, description,
      });
      if (res.ok) {
        showToastSuccess('Изменения сохранены');
        closeSheet();
        refreshCurrentScreen();
      } else {
        showToastError(res.error || 'Ошибка');
      }
    } else {
      const res = await apiJson('POST', '/api/expenses', {
        expenses: [{ date: dateStr, category: selectedCategory, amount, description }],
      });
      if (res.ok) {
        showToastSuccess('Расход добавлен');
        achOnAddExpense();
        const fab = document.getElementById('fab-add');
        fab.classList.add('fab--success');
        setTimeout(() => fab.classList.remove('fab--success'), 700);
        animateNextLoad = true;
        closeSheet();
        loadBudget();
      } else {
        showToastError(res.error || 'Ошибка');
      }
    }
  } catch {
    showToastError('Ошибка соединения');
  } finally {
    btn.disabled = false;
    btn.textContent = editingExpenseId ? 'Сохранить изменения' : 'Добавить расход';
  }
}

let editingExpenseId = null;

function resetAddForm() {
  editingExpenseId = null;
  selectedCategory = null;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('form-amount').value = '';
  document.getElementById('form-description').value = '';
  document.getElementById('form-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('parse-result').classList.add('hidden');
  document.getElementById('expense-text').value = '';
  document.querySelector('.sheet-title').textContent = 'Добавить расход';
  document.getElementById('btn-add-form').textContent = 'Добавить расход';
  switchAddTab('text');
}

function openEditExpense(exp) {
  resetAddForm();
  editingExpenseId = exp.id;

  // Pre-select category
  selectedCategory = exp.category;
  document.querySelectorAll('.cat-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.cat === exp.category);
  });

  // Pre-fill fields
  document.getElementById('form-amount').value = exp.amount;
  document.getElementById('form-description').value = exp.description || '';
  // Convert DD.MM.YYYY → YYYY-MM-DD for date input
  if (exp.date) {
    const [d, m, y] = exp.date.split('.');
    document.getElementById('form-date').value = `${y}-${m}-${d}`;
  }

  document.querySelector('.sheet-title').textContent = 'Редактировать расход';
  document.getElementById('btn-add-form').textContent = 'Сохранить изменения';
  switchAddTab('form');
  openSheet();
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
    lastParseWasPhoto = false;

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
  const todayStr = new Date().toISOString().slice(0, 10); // max for date inputs
  const resultEl = document.getElementById('parse-result');
  resultEl.innerHTML = '';

  function calcTotal() { return expenses.reduce((s, e) => s + (e.amount || 0), 0); }

  // Header
  const header = document.createElement('div');
  header.className = 'parse-result-header';
  header.innerHTML = `
    <strong>Распознано: ${expenses.length}</strong>
    <span id="parse-total">${fmt(calcTotal())}</span>
  `;
  resultEl.appendChild(header);

  function refreshTotal() {
    const el = resultEl.querySelector('#parse-total');
    if (el) el.textContent = fmt(calcTotal());
  }

  // Cards
  expenses.forEach((exp, idx) => {
    const [dd, mm, yyyy] = exp.date.split('.');
    const dateVal = `${yyyy}-${mm}-${dd}`;
    const catOptHtml = PLAN_CATEGORIES.map(c =>
      `<button class="parse-cat-opt${c.key === exp.category ? ' active' : ''}" data-key="${esc(c.key)}" title="${esc(c.key)}">${c.icon}</button>`
    ).join('');

    const card = document.createElement('div');
    card.className = 'parse-expense-item parse-expense-item--edit';
    card.innerHTML = `
      <button class="parse-cat-icon-btn" title="Изменить категорию">${CATEGORY_ICONS[exp.category] || '❓'}</button>
      <div class="parse-expense-info">
        <div class="parse-desc-row">
          <span class="parse-expense-desc">${esc(exp.description)}</span>
          <button class="parse-del-btn" title="Удалить">🗑</button>
        </div>
        <div class="parse-edit-row">
          <span class="parse-cat-name">${esc(exp.category)}</span>
          <input class="parse-edit-date" type="date" value="${dateVal}" max="${todayStr}">
          <input class="parse-edit-amount" type="number" value="${exp.amount}" min="1">
          <span class="parse-edit-ruble">₽</span>
        </div>
        <div class="parse-cat-picker hidden">${catOptHtml}</div>
      </div>
    `;

    const iconBtn = card.querySelector('.parse-cat-icon-btn');
    const catName = card.querySelector('.parse-cat-name');
    const catPicker = card.querySelector('.parse-cat-picker');

    iconBtn.addEventListener('click', () => catPicker.classList.toggle('hidden'));

    catPicker.querySelectorAll('.parse-cat-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        exp.category = btn.dataset.key;
        iconBtn.textContent = CATEGORY_ICONS[btn.dataset.key] || '❓';
        catName.textContent = btn.dataset.key;
        catPicker.querySelectorAll('.parse-cat-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        catPicker.classList.add('hidden');
      });
    });

    card.querySelector('.parse-edit-date').addEventListener('change', function () {
      const [y, m, d] = this.value.split('-');
      exp.date = `${d}.${m}.${y}`;
    });

    card.querySelector('.parse-edit-amount').addEventListener('input', function () {
      exp.amount = parseInt(this.value) || 0;
      refreshTotal();
    });

    card.querySelector('.parse-del-btn').addEventListener('click', () => {
      parsedExpenses.splice(idx, 1);
      if (parsedExpenses.length === 0) {
        resultEl.classList.add('hidden');
      } else {
        renderParseResult(parsedExpenses);
      }
    });

    resultEl.appendChild(card);
  });

  // Action bar
  const bar = document.createElement('div');
  bar.className = 'parse-confirm-bar';
  bar.innerHTML = `
    <button id="btn-confirm-parse" class="btn btn-primary" style="flex:1">✓ Сохранить всё</button>
    <button id="btn-cancel-parse" class="btn btn-outline">✕</button>
  `;
  resultEl.appendChild(bar);

  bar.querySelector('#btn-confirm-parse').addEventListener('click', confirmParsedExpenses);
  bar.querySelector('#btn-cancel-parse').addEventListener('click', () => {
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
      achOnAddExpense({ receipt: lastParseWasPhoto });
      lastParseWasPhoto = false;
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

function buildExpenseItem(exp, canEdit, { showDate = false, showCategory = true, showUser = true } = {}) {
  const item = document.createElement('div');
  item.className = 'expense-item';
  item.dataset.id = exp.id;

  item.innerHTML = `
    <span class="expense-cat-icon">${CATEGORY_ICONS[exp.category] || '❓'}</span>
    <div class="expense-info">
      <div class="expense-desc">${esc(exp.description || exp.category)}</div>
      <div class="expense-meta">
        ${showUser ? `<span class="expense-user-tag">${esc(exp.user)}</span>` : ''}
        ${showCategory ? `<span>${esc(exp.category)}</span>` : ''}
        ${showDate && exp.date ? `<span class="expense-date-tag">${formatDayMonth(exp.date)}</span>` : ''}
      </div>
    </div>
    <div class="expense-right">
      <span class="expense-amount">${fmt(exp.amount)}</span>
      <div class="expense-actions">
        ${canEdit ? `<button class="btn-edit" title="Редактировать">✏️</button><button class="btn-delete" title="Удалить">🗑</button>` : ''}
      </div>
    </div>
  `;

  if (canEdit) {
    item.querySelector('.btn-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openEditExpense(exp);
    });
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
    lastParseWasPhoto = true;
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

  // E2E: узнаём статус семьи и подтягиваем шифрованные данные до первой отрисовки
  try {
    await E2E.init({ getToken: () => token, userName: currentUser.name });
    if (E2E.active()) await E2E.syncNow();
  } catch { /* сеть — синхронизируемся позже */ }

  showApp();
  initSocket();
  initCategoryGrid();
  setupEventListeners();
  initGoalsScreen();
  initPullToRefresh();
  navigate('budget');   // load content immediately, don't wait for settings
  loadSettings();       // run in background
  // Hide push section if browser doesn't support it
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    document.getElementById('push-settings-section')?.classList.add('hidden');
  } else {
    initPushNotifications();
  }
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

  // Calendar date picker
  document.getElementById('budget-date-label').addEventListener('click', openCalendar);
  document.getElementById('cal-overlay').addEventListener('click', closeCalendar);
  document.getElementById('cal-prev').addEventListener('click', () => {
    if (calViewMonth === 0) { calViewMonth = 11; calViewYear--; }
    else calViewMonth--;
    renderCalendar();
  });
  document.getElementById('cal-next').addEventListener('click', () => {
    const now = new Date();
    if (calViewYear === now.getFullYear() && calViewMonth === now.getMonth()) return;
    if (calViewMonth === 11) { calViewMonth = 0; calViewYear++; }
    else calViewMonth++;
    renderCalendar();
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
  document.getElementById('btn-save-plan').addEventListener('click', savePlan);

  // Invite
  document.getElementById('btn-create-invite')?.addEventListener('click', async () => {
    const res = await apiJson('POST', '/api/invite');
    document.getElementById('invite-code-text').textContent = res.code;
    document.getElementById('invite-result').classList.remove('hidden');
    document.getElementById('btn-copy-invite').onclick = () => {
      navigator.clipboard.writeText(res.link).then(() => showToastSuccess('Ссылка скопирована'));
    };
  });

  document.getElementById('btn-get-analysis').addEventListener('click', getFinancialAnalysis);
  document.getElementById('btn-pdf-report').addEventListener('click', generatePdfReport);
  document.getElementById('analysis-close').addEventListener('click', closeAnalysis);
  document.getElementById('analysis-share').addEventListener('click', shareAnalysis);
  document.getElementById('analysis-overlay').addEventListener('click', closeAnalysis);

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
    document.getElementById('summary-heatmap').classList.remove('hidden');
    document.querySelector('.speed-chart-card')?.classList.remove('hidden');
    document.querySelector('.family-overview-card')?.classList.remove('hidden');
    renderSummaryView();
    applyBlockVisibility(); // вернуть блокам видимость согласно «Конструктору аналитики»
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
  document.getElementById('btn-cf-add-day').addEventListener('click', () => {
    document.getElementById('cf-income-days').appendChild(makeCfDayRow('', 0, currentUser?.name || ''));
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

  // Family name save
  document.getElementById('btn-save-family-name').addEventListener('click', async () => {
    const val = document.getElementById('setting-family-name').value.trim();
    const res = await apiJson('PUT', '/api/settings', { key: 'familyName', value: val });
    if (res.ok) {
      appSettings.familyName = val;
      updateFamilyChip(val);
      showToastSuccess('Название семьи сохранено');
    } else {
      showToastError(res.error || 'Ошибка сохранения');
    }
  });

  // Planned budget save
  document.getElementById('btn-save-planned').addEventListener('click', async () => {
    const val = parseInt(document.getElementById('setting-planned-monthly').value) || 0;
    const res = await apiJson('PUT', '/api/settings', { key: 'plannedMonthly', value: val });
    if (res.ok) {
      appSettings.plannedMonthly = val;
      const infoPlanned = document.getElementById('info-planned');
      if (infoPlanned) infoPlanned.textContent = fmt(val);
      showToastSuccess('Плановый бюджет сохранён');
    } else {
      showToastError(res.error || 'Ошибка сохранения');
    }
  });

  // E2E (Приватность)
  document.getElementById('btn-e2e-enable')?.addEventListener('click', doEnableE2E);
  document.getElementById('btn-e2e-showkey')?.addEventListener('click', () => showE2EKey(E2E.exportKeyHex()));
  document.getElementById('btn-e2e-importkey')?.addEventListener('click', doImportE2EKey);
  document.getElementById('btn-e2e-copykey')?.addEventListener('click', () => {
    const t = document.getElementById('e2e-key-text')?.textContent || '';
    navigator.clipboard?.writeText(t).then(() => showToastSuccess('Ключ скопирован')).catch(() => {});
  });

  // Push notifications toggle
  const pushToggle = document.getElementById('push-toggle');
  if (pushToggle) {
    pushToggle.addEventListener('change', async () => {
      const enabled = pushToggle.checked;
      try {
        if (enabled) {
          if (Notification.permission === 'denied') {
            showToastError('Уведомления заблокированы в браузере. Разрешите их в настройках.');
            pushToggle.checked = false;
            return;
          }
          await apiJson('POST', '/api/push/settings', { enabled: true });
          await subscribeToPush();
          showToastSuccess('Уведомления включены');
        } else {
          await apiJson('POST', '/api/push/settings', { enabled: false });
          await unsubscribeFromPush();
          showToastSuccess('Уведомления отключены');
        }
      } catch {
        showToastError('Не удалось изменить настройку');
        pushToggle.checked = !enabled;
      }
    });
  }

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

  document.getElementById('btn-beauty-scan').addEventListener('click', openBeautyCandidates);
  document.getElementById('btn-custom-cat-add')?.addEventListener('click', addCustomCategoryUI);
  document.getElementById('beauty-close').addEventListener('click', closeBeautySheet);
  document.getElementById('beauty-overlay').addEventListener('click', closeBeautySheet);

  // Reminder close
  document.getElementById('reminder-close').addEventListener('click', () => {
    document.getElementById('reminder-toast').classList.add('hidden');
  });

  // Принудительное обновление у всех пользователей
  document.getElementById('btn-open-admin').addEventListener('click', () => openAdminPanel());
  document.getElementById('btn-close-admin').addEventListener('click', () => closeAdminPanel());
  document.getElementById('admin-overlay').addEventListener('click', () => closeAdminPanel());

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

}

// Свайп-навигация в стиле Apple: 1:1-трекинг пальца, скорость → инерция
// (лёгкий флик = переход), прогрессивная резинка на закрытой границе,
// симметричные вход/выход. Уважает prefers-reduced-motion.
function setupSwipe(el, { onLeft, onRight, canLeft, canRight }) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPRING = 'transform 0.34s cubic-bezier(0.32,0.72,0,1)';
  let startX = 0, startY = 0, active = false, decided = false, horizontal = false, transitioning = false;
  let lastX = 0, lastT = 0, vx = 0; // vx: px/ms
  const width = () => el.clientWidth || window.innerWidth || 360;
  // Резинка: чем дальше за границу, тем меньше следует за пальцем (раздел 9 скилла)
  const rubber = (x, dim, c = 0.55) => (x * dim * c) / (dim + c * Math.abs(x));

  function snapBack() {
    el.style.transition = SPRING;
    el.style.transform = '';
  }

  function commit(goLeft) {
    transitioning = true;
    if (navigator.vibrate) navigator.vibrate(8); // тактильный «прищёлк» (Android; iOS игнорирует)
    el.style.transition = 'transform 0.19s cubic-bezier(0.4,0,1,1)'; // ускорение на выход
    el.style.transform = `translateX(${goLeft ? '-105%' : '105%'})`;
    setTimeout(() => {
      // мгновенно на противоположную сторону, грузим новые данные
      el.style.transition = 'none';
      el.style.transform = `translateX(${goLeft ? '60%' : '-60%'})`;
      if (goLeft) onLeft(); else onRight();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = SPRING;               // въезд с той стороны, откуда пришло
        el.style.transform = '';
        setTimeout(() => { transitioning = false; }, 360);
      }));
    }, 190);
  }

  el.addEventListener('touchstart', e => {
    if (transitioning || e.touches.length > 1) return;
    startX = lastX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    lastT = e.timeStamp; vx = 0;
    active = true; decided = false; horizontal = false;
    el.style.transition = 'none';
  }, { passive: true });

  el.addEventListener('touchmove', e => {
    if (!active) return;
    const x = e.touches[0].clientX, y = e.touches[0].clientY;
    const dx = x - startX, dy = y - startY;
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // ждём явного намерения
      decided = true;
      horizontal = Math.abs(dx) > Math.abs(dy);
      if (!horizontal) { active = false; return; }     // вертикаль — отдаём скроллу
    }
    if (!horizontal || reduce) return;
    const dt = e.timeStamp - lastT;
    if (dt > 0) vx = (x - lastX) / dt;
    lastX = x; lastT = e.timeStamp;
    // 1:1 в разрешённую сторону, резинка — в закрытую
    const goLeft = dx < 0;
    const blocked = goLeft ? (canLeft && !canLeft()) : (canRight && !canRight());
    const eff = blocked ? rubber(dx, width()) : dx;
    el.style.transform = `translateX(${eff}px)`;
  }, { passive: true });

  function finish(dx, dy) {
    if (!active) return;
    active = false;
    if (!horizontal) { snapBack(); return; }
    const w = width();
    // проекция точки покоя по скорости (раздел 6): v(px/s) * 0.998/(1-0.998)/1000
    const projected = dx + vx * 499;
    const goLeft = projected < 0;
    const passed = Math.abs(projected) > w * 0.26 || Math.abs(vx) > 0.45;
    const canProceed = goLeft ? (!canLeft || canLeft()) : (!canRight || canRight());
    if (reduce) { if (passed && canProceed) { goLeft ? onLeft() : onRight(); } return; }
    if (passed && canProceed) commit(goLeft);
    else snapBack();
  }

  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    if (active && horizontal && Math.abs(dx) > 24) e.preventDefault(); // гасим фантомный click
    finish(dx, dy);
  });

  el.addEventListener('touchcancel', () => { active = false; snapBack(); }, { passive: true });
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
  let total = 0;
  document.querySelectorAll('.cf-member-input').forEach(inp => {
    total += parseInt(inp.value) || 0;
  });
  document.getElementById('cf-total').textContent = fmt(total);
}

function renderCfMemberBlocks(cf, users) {
  const container = document.getElementById('cf-balance-members');
  container.innerHTML = '';
  const members = cf.members || {};

  // Backward compat: if old flat format and only 1 user, pre-fill their block
  const oldFlat = !cf.members && (cf.debit || cf.credit || cf.cash);

  users.forEach((user, idx) => {
    const m = members[user.name] || (oldFlat && idx === 0 ? { debit: cf.debit, credit: cf.credit, savings: cf.cash } : {});
    const block = document.createElement('div');
    block.className = 'cf-member-block';
    block.innerHTML = `
      <div class="cf-member-name">${esc(user.name)}</div>
      <div class="cf-balance-grid">
        <div class="form-group">
          <label>Дебетовая</label>
          <input type="number" class="cf-member-input" data-user="${esc(user.name)}" data-field="debit"
            inputmode="numeric" placeholder="0" value="${m.debit || ''}" />
        </div>
        <div class="form-group">
          <label>Кредитная</label>
          <input type="number" class="cf-member-input" data-user="${esc(user.name)}" data-field="credit"
            inputmode="numeric" placeholder="0" value="${m.credit || ''}" />
        </div>
        <div class="form-group">
          <label>Сбережения</label>
          <input type="number" class="cf-member-input" data-user="${esc(user.name)}" data-field="savings"
            inputmode="numeric" placeholder="0" value="${m.savings || ''}" />
        </div>
      </div>`;
    block.querySelectorAll('.cf-member-input').forEach(inp => inp.addEventListener('input', updateCfTotal));
    container.appendChild(block);
  });
  updateCfTotal();
}

let cfUserNames = [];

function renderCfIncomeDays(incomeDays, users) {
  cfUserNames = (users || []).map(u => u.name || u);
  const container = document.getElementById('cf-income-days');
  container.innerHTML = '';
  if (Array.isArray(incomeDays)) {
    for (const e of incomeDays) {
      container.appendChild(makeCfDayRow(e.day || '', e.amount || 0, e.user || ''));
    }
  } else {
    // backward compat: old dict format, assign to current user
    for (const [day, amt] of Object.entries(incomeDays)) {
      container.appendChild(makeCfDayRow(day, amt, currentUser?.name || ''));
    }
  }
}

function makeCfDayRow(day, amt, user) {
  const row = document.createElement('div');
  row.className = 'cf-day-row';
  const opts = cfUserNames.map(n =>
    `<option value="${esc(n)}"${n === user ? ' selected' : ''}>${esc(n)}</option>`
  ).join('');
  row.innerHTML = `
    <select class="cf-day-user">${opts}</select>
    <span class="cf-day-label">д.</span>
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
    const [cf, users] = await Promise.all([
      apiJson('GET', `/api/cashflow/${ym}`),
      apiJson('GET', '/api/users'),
    ]);
    const cfUsers = users.length ? users : [{ name: currentUser?.name || 'Я' }];
    renderCfMemberBlocks(cf, cfUsers);
    renderCfIncomeDays(cf.incomeDays || [], cfUsers);
    const totalInc = Array.isArray(cf.incomeDays)
      ? cf.incomeDays.reduce((s, e) => s + (e.amount || 0), 0)
      : Object.values(cf.incomeDays || {}).reduce((s, v) => s + (Number(v) || 0), 0);
    const incRow = document.getElementById('cf-income-total-row');
    if (totalInc > 0) {
      document.getElementById('cf-income-total-amt').textContent = fmt(totalInc);
      incRow.classList.remove('hidden');
    } else {
      incRow.classList.add('hidden');
    }
  } catch {
    showToastError('Ошибка загрузки кэшфлоу');
    const fallbackUsers = currentUser ? [{ name: currentUser.name }] : [];
    renderCfMemberBlocks({}, fallbackUsers);
    renderCfIncomeDays([], fallbackUsers);
    document.getElementById('cf-income-total-row').classList.add('hidden');
  }
}

async function saveCashflow() {
  const incomeDays = [];
  document.querySelectorAll('.cf-day-row').forEach(row => {
    const user = row.querySelector('.cf-day-user')?.value || '';
    const day  = parseInt(row.querySelector('.cf-day-num').value) || 0;
    const amt  = parseInt(row.querySelector('.cf-day-amt').value) || 0;
    if (day >= 1 && day <= 31 && amt > 0) incomeDays.push({ day, user, amount: amt });
  });

  const members = {};
  document.querySelectorAll('.cf-member-input').forEach(inp => {
    const user = inp.dataset.user;
    const field = inp.dataset.field;
    if (!members[user]) members[user] = { debit: 0, credit: 0, savings: 0 };
    members[user][field] = parseInt(inp.value) || 0;
  });

  const body = { members, incomeDays };

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

// ─── GOALS / ЦЕЛИ SCREEN ─────────────────────────────────────────────────────

// ─── Достижения (геймификация) ───────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id: 'tour',      emoji: '🎓', title: 'Экскурсовод',               desc: 'Заглянуть во все разделы приложения.' },
  { id: 'first',     emoji: '👶', title: 'Первый шаг',                desc: 'Внести самый первый расход.' },
  { id: 'week',      emoji: '📅', title: 'Неделя дисциплины',         desc: 'Вносить расходы каждый день 7 дней подряд.' },
  { id: 'month30',   emoji: '🔥', title: 'Марафонец',                 desc: 'Вести учёт 30 дней подряд.' },
  { id: 'redline',   emoji: '🏎️', title: 'Стрелку до отсечки',        desc: 'Барометр выше 160% три дня подряд.' },
  { id: 'fast10',    emoji: '✍️', title: 'Помедленней, я записываю!', desc: 'Внести больше 10 расходов за один день.' },
  { id: 'shelves',   emoji: '🗂️', title: 'У меня всё по полочкам',    desc: 'Создать 5 своих категорий.' },
  { id: 'variety',   emoji: '🎨', title: 'Всего понемногу',           desc: 'Расходы из 5 разных категорий за один день.' },
  { id: 'century',   emoji: '💯', title: 'Сотка',                     desc: 'Внести 100 расходов за всё время.' },
  { id: 'onplan',    emoji: '🎯', title: 'Точно по плану',            desc: 'Закрыть месяц, уложившись в план (барометр ≤ 100%).' },
  { id: 'goal',      emoji: '🏆', title: 'Мечты сбываются',           desc: 'Накопить на цель на 100%.' },
  { id: 'family',    emoji: '🤝', title: 'Вместе веселее',            desc: 'Вести бюджет вдвоём или большей семьёй.' },
  { id: 'midnight',  emoji: '🌙', title: 'Успеть до полуночи!',       desc: 'Внести расход в интервале 23:50–00:00.', secret: true },
  { id: 'earlybird', emoji: '🌅', title: 'Ранняя пташка',            desc: 'Внести расход до 7 утра.', secret: true },
  { id: 'receipt',   emoji: '🧾', title: 'Чекист',                    desc: 'Распознать чек с помощью ИИ.', secret: true },
];

function achSet() {
  try { return new Set(JSON.parse(localStorage.getItem('budget_achievements') || '[]')); } catch { return new Set(); }
}
function unlockAchievement(id) {
  if (!ACHIEVEMENTS.some(a => a.id === id)) return;
  const s = achSet();
  if (s.has(id)) return;
  s.add(id);
  localStorage.setItem('budget_achievements', JSON.stringify([...s]));
  showAchievementToast(ACHIEVEMENTS.find(a => a.id === id));
  if (currentScreen === 'goals') renderAchievements();
}
function showAchievementToast(a) {
  if (!a) return;
  const el = document.getElementById('achievement-toast');
  if (!el) return;
  el.innerHTML = `<span class="ach-toast-emoji">${a.emoji}</span><div><div class="ach-toast-label">ДОСТИЖЕНИЕ ПОЛУЧЕНО</div><div class="ach-toast-title">${esc(a.title)}</div></div>`;
  el.classList.add('show');
  clearTimeout(showAchievementToast._t);
  showAchievementToast._t = setTimeout(() => el.classList.remove('show'), 3400);
}
function renderAchievements() {
  const box = document.getElementById('achievements-list');
  if (!box) return;
  const s = achSet();
  const cnt = ACHIEVEMENTS.filter(a => s.has(a.id)).length;
  const cntEl = document.getElementById('achievements-count');
  if (cntEl) cntEl.textContent = `${cnt} / ${ACHIEVEMENTS.length}`;
  box.innerHTML = ACHIEVEMENTS.map(a => {
    const got = s.has(a.id);
    const hidden = a.secret && !got;
    return `<div class="ach-row ${got ? 'ach-got' : ''}">
      <span class="ach-emoji">${hidden ? '❓' : a.emoji}</span>
      <div class="ach-info">
        <div class="ach-title">${hidden ? 'Секретное достижение' : esc(a.title)}</div>
        <div class="ach-desc">${hidden ? 'Условие откроется, когда вы его выполните' : esc(a.desc)}</div>
      </div>
      <span class="ach-status">${got ? '✓' : '🔒'}</span>
    </div>`;
  }).join('');
}

// Заглянул во все разделы → «Экскурсовод»
const MAIN_TABS = ['budget', 'summary', 'chart', 'goals', 'settings'];
function trackTabVisit(name) {
  if (!MAIN_TABS.includes(name)) return;
  let v; try { v = new Set(JSON.parse(localStorage.getItem('budget_tabs_seen') || '[]')); } catch { v = new Set(); }
  if (v.has(name)) return;
  v.add(name);
  localStorage.setItem('budget_tabs_seen', JSON.stringify([...v]));
  if (MAIN_TABS.every(x => v.has(x))) unlockAchievement('tour');
}

// Событийные ачивки при добавлении расхода
let lastParseWasPhoto = false;
function achOnAddExpense(opts = {}) {
  const now = new Date(), h = now.getHours(), m = now.getMinutes();
  if (h === 23 && m >= 50) unlockAchievement('midnight');
  if (h < 7) unlockAchievement('earlybird');
  if (opts.receipt) unlockAchievement('receipt');
}

function achDmyOrdinal(s) {
  const p = (s || '').split('.').map(Number);
  if (p.length < 3 || !p[0] || !p[1] || !p[2]) return null;
  return Math.floor(Date.UTC(p[2], p[1] - 1, p[0]) / 86400000);
}
function achLongestRun(ords) {
  const uniq = [...new Set(ords)].sort((a, b) => a - b);
  let best = 0, cur = 0, prev = null;
  for (const o of uniq) { cur = prev !== null && o === prev + 1 ? cur + 1 : 1; best = Math.max(best, cur); prev = o; }
  return best;
}

async function evaluateAchievements() {
  try {
    const now = new Date();
    const months = [0, 1, 2].map(off => { const d = new Date(now.getFullYear(), now.getMonth() - off, 1); return { m: d.getMonth() + 1, y: d.getFullYear() }; });
    const chunks = await Promise.all(months.map(({ m, y }) =>
      apiJson('GET', `/api/expenses/month?month=${m}&year=${y}`).then(r => Array.isArray(r) ? r : (r.expenses || [])).catch(() => [])));
    const exp = chunks.flat().filter(Boolean);
    const plannedMonthly = appSettings.plannedMonthly || 0;
    const customCatCount = (appSettings.customCategories || []).length;
    let goals = [];
    try { goals = await apiJson('GET', '/api/goals'); } catch { /* ignore */ }

    if (exp.length >= 1) unlockAchievement('first');
    if (exp.length >= 100) unlockAchievement('century');
    if (customCatCount >= 5) unlockAchievement('shelves');
    if ([...new Set(exp.map(e => e.user).filter(Boolean))].length >= 2) unlockAchievement('family');
    if ((goals || []).some(g => g.targetAmount > 0 && (g.contributions || []).reduce((s, c) => s + (c.amount || 0), 0) >= g.targetAmount)) unlockAchievement('goal');

    const byDay = new Map();
    for (const e of exp) { if (!e.date) continue; (byDay.get(e.date) || byDay.set(e.date, []).get(e.date)).push(e); }
    for (const [, items] of byDay) {
      if (items.length >= 10) unlockAchievement('fast10');
      if (new Set(items.map(i => i.category)).size >= 5) unlockAchievement('variety');
    }
    const streak = achLongestRun([...byDay.keys()].map(achDmyOrdinal).filter(v => v !== null));
    if (streak >= 7) unlockAchievement('week');
    if (streak >= 30) unlockAchievement('month30');

    if (plannedMonthly > 0) {
      const byMonth = new Map();
      for (const e of exp) { const p = (e.date || '').split('.'); if (p.length < 3) continue; const k = `${p[2]}-${p[1]}`; (byMonth.get(k) || byMonth.set(k, []).get(k)).push(e); }
      const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      for (const [k, items] of byMonth) {
        const [y, mo] = k.split('-').map(Number);
        const dim = new Date(y, mo, 0).getDate();
        const perDay = Array(dim + 1).fill(0);
        for (const e of items) { const d = parseInt((e.date || '').split('.')[0]); if (d >= 1 && d <= dim) perDay[d] += e.amount; }
        let cum = 0, run = 0;
        for (let d = 1; d <= dim; d++) { cum += perDay[d]; const ptd = plannedMonthly * d / dim; const pct = ptd > 0 ? cum / ptd * 100 : 0; run = pct > 160 ? run + 1 : 0; if (run >= 3) { unlockAchievement('redline'); break; } }
        if (k !== curKey) { const tot = items.reduce((s, e) => s + e.amount, 0); if (tot > 0 && tot <= plannedMonthly) unlockAchievement('onplan'); }
      }
    }
  } catch { /* оценка достижений не должна ломать экран */ }
}

async function loadGoalsScreen() {
  loadSpeedometer();
  loadGoalsList();
  renderAchievements();
  evaluateAchievements();
  try {
    const planData = await apiJson('GET', '/api/budget-plan');
    lastPlanData = planData;
    renderPlanBreakdown(planData.categoryBudgets || {});
  } catch (e) { console.error('goals plan', e); }
}

async function loadSpeedometer() {
  const container = document.getElementById('bablometr-content');
  const now = new Date();
  const m = now.getMonth() + 1, y = now.getFullYear();
  const daysInMonth = new Date(y, m, 0).getDate();
  const daysElapsed = now.getDate();
  const plannedMonthly = appSettings.plannedMonthly || 0;
  if (!plannedMonthly) {
    container.innerHTML = '<div class="empty-state">Укажите плановые расходы в настройках — тогда барометр бюджета заработает</div>';
    return;
  }
  try {
    const summary = await apiJson('GET', `/api/summary?month=${m}&year=${y}`);
    const spent = summary.total || 0;
    const expectedByNow = Math.round(plannedMonthly * daysElapsed / daysInMonth);
    const ratio = expectedByNow > 0 ? spent / expectedByNow : 0;
    renderSpeedometer(container, spent, expectedByNow, plannedMonthly, ratio, daysElapsed, daysInMonth);
  } catch {
    container.innerHTML = '<div class="empty-state">Нет данных для барометра бюджета</div>';
  }
}

function renderSpeedometer(container, spent, expectedByNow, plannedMonthly, ratio, daysElapsed, daysInMonth) {
  const pctFmt = Math.round(ratio * 100);

  // SVG angles are measured CLOCKWISE from the right (3 o'clock).
  // x = cx + r*cos(θ),  y = cy + r*sin(θ)  (y positive = DOWN in SVG)
  //
  // Arc layout: starts at 150° (lower-left, ~7 o'clock),
  //             ends   at  30° (lower-right, ~5 o'clock),
  //             sweeps 240° clockwise through the top (12 o'clock = 270°).
  //
  // 0%→150°  70%→255°  90%→285°  160%→30°
  const CX = 100, CY = 112, R = 75, SW = 18;
  const START_A = 150, END_A = 30;
  const TOTAL_SWEEP = 240; // degrees, clockwise in SVG
  const SCALE_MAX = 160;

  // SVG point at angle θ (CW from right)
  function pt(deg, r) {
    const rad = deg * Math.PI / 180;
    return [(CX + r * Math.cos(rad)).toFixed(1), (CY + r * Math.sin(rad)).toFixed(1)];
  }

  // Clockwise arc from startDeg to endDeg (sweep-flag = 1)
  function arc(s, e, r) {
    const [x1, y1] = pt(s, r);
    const [x2, y2] = pt(e, r);
    const sweep = ((e - s) + 360) % 360;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x2} ${y2}`;
  }

  // Zone boundary angles and needle angle
  const gEnd = START_A + (70 / SCALE_MAX) * TOTAL_SWEEP;  // 255°
  const yEnd = START_A + (90 / SCALE_MAX) * TOTAL_SWEEP;  // 285°
  const needleA = START_A + (Math.min(pctFmt, SCALE_MAX) / SCALE_MAX) * TOTAL_SWEEP;

  // Needle tip sits on the middle of the track
  const [nx, ny] = pt(needleA, R - SW / 2 - 2);

  // Tick mark helper (inner→outer of track)
  function tick(deg) {
    const [xi, yi] = pt(deg, R - SW / 2 + 2);
    const [xo, yo] = pt(deg, R + SW / 2 + 1);
    return `<line x1="${xi}" y1="${yi}" x2="${xo}" y2="${yo}" stroke="rgba(255,255,255,0.75)" stroke-width="2.5"/>`;
  }

  // Label position: outside arc track
  function labelPt(deg) { return pt(deg, R + SW / 2 + 14); }

  const color   = pctFmt <= 70 ? '#22c55e' : pctFmt <= 90 ? '#f59e0b' : '#ef4444';
  const verdict = pctFmt <= 70 ? 'Экономим 🟢' : pctFmt <= 90 ? 'В норме 🟡' : 'Перерасход 🔴';
  const labelFill = 'rgba(26,21,48,0.65)';

  const [l0x, l0y]   = labelPt(START_A);   // 0%   at 150° (lower-left)
  const [l70x, l70y] = labelPt(gEnd);      // 70%  at 255° (upper-left)
  const [l90x, l90y] = labelPt(yEnd);      // 90%  at 285° (upper-right)
  const [l160x, l160y] = labelPt(END_A);   // 160% at 30°  (lower-right)

  container.innerHTML = `
    <svg viewBox="0 0 200 178" class="speedometer-svg">
      <!-- Background track -->
      <path d="${arc(START_A, END_A, R)}" fill="none" stroke="rgba(89,71,224,0.14)" stroke-width="${SW}"/>
      <!-- Green zone 0-70% -->
      <path d="${arc(START_A, gEnd, R)}" fill="none" stroke="#16a34a" stroke-width="${SW}" opacity="0.55"/>
      <!-- Yellow zone 70-90% -->
      <path d="${arc(gEnd, yEnd, R)}" fill="none" stroke="#d97706" stroke-width="${SW}" opacity="0.55"/>
      <!-- Red zone 90-160% -->
      <path d="${arc(yEnd, END_A, R)}" fill="none" stroke="#dc2626" stroke-width="${SW}" opacity="0.55"/>
      <!-- Zone boundary ticks -->
      ${tick(gEnd)}${tick(yEnd)}
      <!-- Progress arc (bright, up to needle) -->
      ${pctFmt > 0 ? `<path d="${arc(START_A, needleA, R)}" fill="none" stroke="${color}" stroke-width="${SW - 8}"/>` : ''}
      <!-- Needle -->
      <line x1="${CX}" y1="${CY}" x2="${nx}" y2="${ny}" stroke="${color}" stroke-width="3.5" stroke-linecap="round"/>
      <!-- Hub -->
      <circle cx="${CX}" cy="${CY}" r="7" fill="rgba(89,71,224,0.1)"/>
      <circle cx="${CX}" cy="${CY}" r="4"  fill="${color}"/>
      <!-- Value -->
      <text x="${CX}" y="${CY - 16}" text-anchor="middle" fill="${color}" font-size="26" font-weight="800" font-family="Onest,sans-serif">${pctFmt}%</text>
      <text x="${CX}" y="${CY - 2}"  text-anchor="middle" fill="rgba(26,21,48,0.5)" font-size="8" font-family="Onest,sans-serif" letter-spacing="0.6">ФАКТ / ПЛАН</text>
      <!-- Scale labels outside arc track -->
      <text x="${l0x}"   y="${l0y}"   text-anchor="middle" fill="${labelFill}" font-size="10" font-weight="600" font-family="Onest,sans-serif">0%</text>
      <text x="${l70x}"  y="${l70y}"  text-anchor="middle" fill="${labelFill}" font-size="10" font-weight="600" font-family="Onest,sans-serif">70%</text>
      <text x="${l90x}"  y="${l90y}"  text-anchor="middle" fill="${labelFill}" font-size="10" font-weight="600" font-family="Onest,sans-serif">90%</text>
      <text x="${l160x}" y="${l160y}" text-anchor="middle" fill="${labelFill}" font-size="10" font-weight="600" font-family="Onest,sans-serif">160%</text>
    </svg>
    <div class="speedometer-verdict" style="color:${color}">${verdict}</div>
    <div class="bablometr-stats">
      <div class="bablometr-stat">
        <span class="bablometr-stat-label">Потрачено</span>
        <span class="bablometr-stat-value">${fmt(spent)}</span>
      </div>
      <div class="bablometr-stat">
        <span class="bablometr-stat-label">По плану</span>
        <span class="bablometr-stat-value">${fmt(expectedByNow)}</span>
      </div>
      <div class="bablometr-stat">
        <span class="bablometr-stat-label">Дней</span>
        <span class="bablometr-stat-value">${daysElapsed} из ${daysInMonth}</span>
      </div>
    </div>`;
}

let speedChartMonth = null; // { m, y } — currently viewed month

function loadSpeedChart(m, y) {
  const MNAMES = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  const now = new Date();
  const curM = now.getMonth() + 1, curY = now.getFullYear();
  if (!m) { m = curM; y = curY; }
  speedChartMonth = { m, y };

  const isCurrent = y === curY && m === curM;

  // Update nav UI
  const label = document.getElementById('speed-chart-month-label');
  const btnNext = document.getElementById('speed-chart-next');
  const btnPrev = document.getElementById('speed-chart-prev');
  if (label) label.textContent = `${MNAMES[m - 1]} ${y}`;
  if (btnNext) btnNext.disabled = isCurrent;

  // Wire nav buttons (replace listeners by cloning)
  if (btnPrev) {
    const prev = btnPrev.cloneNode(true);
    btnPrev.parentNode.replaceChild(prev, btnPrev);
    prev.addEventListener('click', () => {
      const d = new Date(y, m - 2, 1);
      loadSpeedChart(d.getMonth() + 1, d.getFullYear());
    });
  }
  if (btnNext && !isCurrent) {
    const next = btnNext.cloneNode(true);
    btnNext.parentNode.replaceChild(next, btnNext);
    next.addEventListener('click', () => {
      const d = new Date(y, m, 1);
      loadSpeedChart(d.getMonth() + 1, d.getFullYear());
    });
  }

  _renderSpeedChart(m, y, isCurrent, now.getDate());
}

async function _renderSpeedChart(m, y, isCurrent, todayDay) {
  const container = document.getElementById('speed-chart-container');
  if (!container) return;
  const plannedMonthly = appSettings?.plannedMonthly || 0;
  if (!plannedMonthly) {
    container.innerHTML = '<div class="empty-state">Нет планового бюджета</div>';
    return;
  }
  container.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 10000);
    let chartData;
    try {
      const res = await fetch(`/api/unified-chart-data/${ym}`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: abort.signal,
      });
      clearTimeout(timer);
      chartData = res.ok ? await res.json() : {};
    } catch {
      clearTimeout(timer);
      chartData = {};
    }
    const userExpenses = chartData.userExpenses || {};
    const daysInMonth = new Date(y, m, 0).getDate();
    const lastDay = isCurrent ? todayDay : daysInMonth;

    // Sum all users into daily totals array (index 0 = day 1)
    const dailyTotals = Array(daysInMonth).fill(0);
    for (const userDays of Object.values(userExpenses)) {
      for (let i = 0; i < userDays.length && i < daysInMonth; i++) {
        dailyTotals[i] += userDays[i] || 0;
      }
    }

    // Point for day d: cumulative_spent_through_day_d / (plan * d / daysInMonth) * 100
    const labels = [];
    const ratios = [];
    let cumulative = 0;
    for (let d = 1; d <= lastDay; d++) {
      cumulative += dailyTotals[d - 1] || 0;
      labels.push(d);
      const expected = plannedMonthly * d / daysInMonth;
      ratios.push(Math.round(cumulative / expected * 100));
    }

    container.innerHTML = '<canvas id="speed-chart-canvas"></canvas>';
    const canvas = document.getElementById('speed-chart-canvas');

    function ratioColor(v) {
      if (v === null) return 'rgba(150,150,150,0.5)';
      if (v < 70) return '#22c55e';
      if (v < 90) return '#f59e0b';
      return '#ef4444';
    }

    const pointColors = ratios.map(ratioColor);

    const segmentPlugin = {
      id: 'speedSegmentColors',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea, scales } = chart;
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.clip();
        const y100 = scales.y.getPixelForValue(100);
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.moveTo(chartArea.left, y100);
        ctx.lineTo(chartArea.right, y100);
        ctx.strokeStyle = 'rgba(239,68,68,0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        const pts = chart.data.datasets[0].data;
        const meta = chart.getDatasetMeta(0);
        for (let i = 0; i < pts.length - 1; i++) {
          if (pts[i] === null || pts[i + 1] === null) continue;
          const p1 = meta.data[i], p2 = meta.data[i + 1];
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = ratioColor((pts[i] + pts[i + 1]) / 2);
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        ctx.restore();
      }
    };

    new Chart(canvas, {
      type: 'line',
      plugins: [segmentPlugin],
      data: {
        labels,
        datasets: [{
          data: ratios,
          borderColor: 'transparent',
          borderWidth: 2.5,
          tension: 0.3,
          pointBackgroundColor: pointColors,
          pointRadius: 4,
          pointHoverRadius: 6,
          spanGaps: false,
          fill: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => `День ${items[0].label}`,
              label: (item) => item.raw !== null ? `${item.raw}%` : '—',
            }
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 11 }, maxRotation: 0 },
          },
          y: {
            min: 0,
            suggestedMax: 150,
            ticks: { callback: v => `${v}%`, font: { size: 11 }, stepSize: 50 },
            grid: { color: 'rgba(0,0,0,0.06)' },
          }
        }
      }
    });
  } catch {
    container.innerHTML = '<div class="empty-state">Нет данных</div>';
  }
}

async function loadDailyFeed() {
  const list = document.getElementById('daily-feed-list');
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  try {
    const data = await apiJson('GET', `/api/feed/today?date=${localDate}`);
    renderDailyFeed(list, data.entries || []);
  } catch {
    list.innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
  }
}

function renderDailyFeed(container, entries) {
  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state">Ничего не внесено сегодня</div>';
    return;
  }
  const todayStr = formatDate(new Date());
  container.innerHTML = entries.map(e => {
    const icon = CATEGORY_ICONS[e.category] || '❓';
    const desc = esc(e.description || e.category);
    const pastTag = e.date !== todayStr ? ` <span class="feed-past-date">${formatDayMonth(e.date)}</span>` : '';
    return `<div class="feed-entry">
      <span class="feed-icon">${icon}</span>
      <span class="feed-desc">${desc}${pastTag}</span>
      <span class="feed-user">${esc(e.user)}</span>
      <span class="feed-amount">${fmt(e.amount)}</span>
    </div>`;
  }).join('');
}

async function loadGoalsList() {
  const container = document.getElementById('goals-list');
  try {
    const goals = await apiJson('GET', '/api/goals');
    renderGoals(container, goals);
  } catch {
    container.innerHTML = '<div class="empty-state" style="background:var(--card);padding:14px 16px;border-radius:var(--radius-sm)">Ошибка загрузки целей</div>';
  }
}

function renderGoals(container, goals) {
  if (goals.length === 0) {
    container.innerHTML = '<div class="empty-state" style="background:var(--card);padding:14px 16px;border-radius:var(--radius-sm)">Нет копилок. Нажмите «+ Новая» чтобы создать!</div>';
    return;
  }
  container.innerHTML = '';
  for (const goal of goals) {
    const current = (goal.contributions || []).reduce((s, c) => s + (c.amount || 0), 0);
    const pct = goal.targetAmount > 0 ? Math.min(current / goal.targetAmount * 100, 100) : 0;
    const done = pct >= 100;
    const card = document.createElement('div');
    card.className = 'goal-card card';
    card.innerHTML = `
      <div class="goal-header">
        <span class="goal-emoji">${goal.emoji || '🎯'}</span>
        <div class="goal-info">
          <div class="goal-name">${esc(goal.name)}</div>
          <div class="goal-amounts">${fmt(current)} из ${fmt(goal.targetAmount)}</div>
        </div>
        <span class="goal-pct">${Math.round(pct)}%</span>
      </div>
      <div class="goal-progress">
        <div class="goal-progress-fill${done ? ' done' : ''}" style="width:${pct}%"></div>
      </div>
      <div class="goal-actions">
        <button class="btn btn-primary btn-sm" data-action="contribute">+ Пополнить</button>
        <button class="btn btn-ghost btn-sm" data-action="delete">Удалить</button>
      </div>`;
    card.querySelector('[data-action="contribute"]').addEventListener('click', () => openGoalContribute(goal));
    card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteGoalById(goal.id));
    container.appendChild(card);
  }
}

let goalContributeId = null;

function openGoalModal(mode, goal = null) {
  document.getElementById('goal-add-form').classList.toggle('hidden', mode !== 'add');
  document.getElementById('goal-contribute-form').classList.toggle('hidden', mode !== 'contribute');
  document.getElementById('goal-modal-title').textContent = mode === 'add' ? 'Новая копилка' : `Пополнить: ${goal?.name || ''}`;
  document.getElementById('goal-modal-overlay').classList.remove('hidden');
  document.getElementById('goal-modal').classList.add('open');
  if (mode === 'add') {
    document.getElementById('goal-name-input').value = '';
    document.getElementById('goal-target-input').value = '';
    document.getElementById('goal-emoji-input').value = '🎯';
  } else {
    document.getElementById('goal-contribute-amount').value = '';
    goalContributeId = goal?.id || null;
  }
}

function closeGoalModal() {
  document.getElementById('goal-modal-overlay').classList.add('hidden');
  document.getElementById('goal-modal').classList.remove('open');
  goalContributeId = null;
}

function openGoalContribute(goal) {
  openGoalModal('contribute', goal);
}

async function createGoal() {
  const name = document.getElementById('goal-name-input').value.trim();
  const target = parseInt(document.getElementById('goal-target-input').value) || 0;
  const emoji = document.getElementById('goal-emoji-input').value.trim() || '🎯';
  if (!name || target <= 0) { showToastError('Укажите название и сумму'); return; }
  const btn = document.getElementById('btn-goal-create');
  btn.disabled = true;
  try {
    await apiJson('POST', '/api/goals', { name, targetAmount: target, emoji });
    closeGoalModal();
    loadGoalsList();
    showToastSuccess('Копилка создана!');
  } catch {
    showToastError('Ошибка создания');
  } finally {
    btn.disabled = false;
  }
}

async function contributeToGoal() {
  if (!goalContributeId) return;
  const amount = parseInt(document.getElementById('goal-contribute-amount').value) || 0;
  if (amount <= 0) { showToastError('Укажите сумму'); return; }
  const btn = document.getElementById('btn-goal-contribute');
  btn.disabled = true;
  try {
    await apiJson('POST', `/api/goals/${goalContributeId}/contribute`, { amount });
    closeGoalModal();
    loadGoalsList();
    showToastSuccess('Пополнено!');
  } catch {
    showToastError('Ошибка пополнения');
  } finally {
    btn.disabled = false;
  }
}

async function deleteGoalById(id) {
  if (!confirm('Удалить копилку?')) return;
  try {
    await apiJson('DELETE', `/api/goals/${id}`);
    loadGoalsList();
    showToastSuccess('Копилка удалена');
  } catch {
    showToastError('Ошибка удаления');
  }
}

async function loadFamilyOverview() {
  const container = document.getElementById('family-overview-list');
  const now = new Date();
  const m = now.getMonth() + 1, y = now.getFullYear();
  try {
    const summary = await apiJson('GET', `/api/summary?month=${m}&year=${y}`);
    renderFamilyOverview(container, summary);
  } catch {
    container.innerHTML = '<div class="empty-state">Нет данных</div>';
  }
}

function renderFamilyOverview(container, summary) {
  const byUser = summary.byUser || {};
  const users = Object.entries(byUser).sort(([, a], [, b]) => (b.total || 0) - (a.total || 0));
  if (users.length === 0) {
    container.innerHTML = '<div class="empty-state">Нет расходов за этот месяц</div>';
    return;
  }
  container.innerHTML = '';
  for (const [userName, udata] of users) {
    const topCats = Object.entries(udata.byCategory || {})
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([cat, amt]) => `${CATEGORY_ICONS[cat] || '❓'} ${fmt(amt)}`)
      .join(' · ');
    const row = document.createElement('div');
    row.className = 'family-overview-row';
    row.innerHTML = `
      <div class="family-ov-top">
        <span class="family-ov-name">${esc(userName)}</span>
        <span class="family-ov-total">${fmt(udata.total || 0)}</span>
      </div>
      ${topCats ? `<div class="family-ov-cats">${topCats}</div>` : ''}`;
    container.appendChild(row);
  }
}

function initGoalsScreen() {
  document.getElementById('btn-add-goal').addEventListener('click', () => openGoalModal('add'));
  document.getElementById('goal-modal-close').addEventListener('click', closeGoalModal);
  document.getElementById('goal-modal-overlay').addEventListener('click', closeGoalModal);
  document.getElementById('btn-goal-create').addEventListener('click', createGoal);
  document.getElementById('btn-goal-contribute').addEventListener('click', contributeToGoal);
}

// ─── PULL TO REFRESH ──────────────────────────────────────────────────────────

function initPullToRefresh() {
  const content = document.querySelector('.main-content');
  const indicator = document.getElementById('ptr-indicator');
  const THRESHOLD = 64;
  let startY = 0, startX = 0;
  let pulling = false, decided = false;

  content.addEventListener('touchstart', (e) => {
    if (content.scrollTop === 0) {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      pulling = true;
      decided = false;
    }
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const delta = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    // Определяем ось: pull-to-refresh только для вертикально-доминантного жеста,
    // иначе горизонтальный свайп смены дня и потяг срабатывали одновременно
    // (экран уезжал по диагонали). Горизонталь — отдаём свайпу.
    if (!decided) {
      if (Math.abs(dx) < 8 && Math.abs(delta) < 8) return;
      if (Math.abs(dx) > Math.abs(delta)) { pulling = false; return; }
      decided = true;
    }
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
