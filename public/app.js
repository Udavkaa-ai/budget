// ════════════════════════════════════════════════════════════════
//  Семейный бюджет — PWA Frontend
// ════════════════════════════════════════════════════════════════

import * as E2E from './e2e.js';
import { TARGETS as FK_TARGETS, PROPS as FK_PROPS, initState as fkInit, stepRig as fkStep, computePose as fkPose } from './finik-rig.js';

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

  // Список провайдеров. Оффлайн/ошибка — не падаем, останется вход по паролю.
  let providers = {};
  try { providers = await fetch('/api/auth/providers').then(r => r.json()); } catch { /* оффлайн */ }

  // Яндекс / VK — основной вход (RuStore). Показываем СРАЗУ и НЕЗАВИСИМО от
  // Google: раньше сбой Google-скрипта (GIS ещё не загрузился) кидал исключение
  // и пропускал рендер этих кнопок — экран оставался только с паролем.
  const hasOAuth = !!(providers.yandex || providers.vk);
  if (hasOAuth) {
    document.getElementById('oauth-buttons').classList.remove('hidden');
    document.getElementById('btn-yandex').style.display = providers.yandex ? '' : 'none';
    document.getElementById('btn-vk').style.display = providers.vk ? '' : 'none';
  }
  document.getElementById('btn-yandex').onclick = () => oauthRedirect('yandex');
  document.getElementById('btn-vk').onclick = () => oauthRedirect('vk');

  // Пароль раскрываем по умолчанию только если других способов входа нет.
  const passSection = document.getElementById('password-login-section');
  if (hasOAuth || (providers.google && providers.googleClientId)) passSection.removeAttribute('open');
  else passSection.setAttribute('open', '');

  // Google — best-effort. GIS-скрипт грузится асинхронно: ждём его до ~3с и
  // рендерим отдельно, в своём try — его ошибка не мешает остальному входу.
  if (providers.google && providers.googleClientId) {
    try {
      for (let i = 0; i < 20 && !window.google?.accounts?.id; i++) await new Promise(r => setTimeout(r, 150));
      if (window.google?.accounts?.id) {
        google.accounts.id.initialize({
          client_id: providers.googleClientId,
          callback: handleGoogleCredential,
          auto_select: false,
        });
        google.accounts.id.renderButton(
          document.getElementById('google-signin-btn'),
          { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ru', width: 280 }
        );
        document.getElementById('google-signin-section').classList.remove('hidden');
      }
    } catch { /* GIS недоступен — просто без кнопки Google */ }
  }
}

// Переход на серверный OAuth: сервер сам вернёт на эту же страницу с ?token=
function oauthRedirect(provider) {
  location.href = `/auth/${provider}/mobile?redirect=${encodeURIComponent(location.origin + location.pathname)}`;
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
  pushSelfToSW();   // стираем у воркера имя и ключ семьи
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

// ─── Push Notifications ───────────────────────────────────────────────────────

// Сообщаем service worker'у, кто мы, — чтобы он не показывал уведомления
// о наших же записях (они нужны только про партнёра)
async function pushSelfToSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    (reg.active || navigator.serviceWorker.controller)?.postMessage({
      type: 'set-self', name: currentUser?.name || '',
      // ключ семьи (E2E): воркер расшифрует им сводку в пуше от партнёра
      key: currentUser && E2E.active() ? (E2E.exportKeyHex() || '') : '',
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

// ─── Поддержка ─────────────────────────────────────────────────────────────────
async function sendSupportMessage() {
  const ta = document.getElementById('support-text');
  const btn = document.getElementById('btn-support-send');
  const text = ta.value.trim();
  if (text.length < 3) { showToastError('Напишите пару слов о проблеме или идее'); return; }
  btn.disabled = true; btn.textContent = 'Отправляю…';
  try {
    const res = await apiJson('POST', '/api/support', { text, platform: 'web' });
    if (res?.error) { showToastError(res.error); return; }
    ta.value = '';
    showToastSuccess('Сообщение отправлено разработчику — спасибо!');
    loadSupportThread();
  } catch {
    showToastError('Не удалось отправить. Проверьте интернет');
  } finally {
    btn.disabled = false; btn.textContent = 'Отправить разработчику';
  }
}

async function refreshSupportBadge() {
  try {
    const r = await apiJson('GET', '/api/admin/support/threads');
    const n = r?.unread || 0;
    const b = document.getElementById('admin-support-badge');
    if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
    setSettingsBadge('admin', n);
  } catch { /* не критично */ }
}

async function isPushSubscribed() {
  try { return !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()); } catch { return false; }
}

const supTime = iso => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// ─── МЕССЕНДЖЕР ПОДДЕРЖКИ (для администратора) ───────────────────────────────
// Отдельный экран: слева список чатов (ник, последнее сообщение, время,
// непрочитанные, поиск), справа/поверх — переписка с полем ответа. На узком
// экране список и чат сменяют друг друга, на широком стоят рядом.
const inbox = { threads: [], login: null, filter: 'all', q: '', timer: null };
const AVATAR_COLORS = ['#5947E0', '#1597A8', '#C94F97', '#17915C', '#E8A21F', '#2F7AE0', '#D8662E'];
const avatarColor = str => AVATAR_COLORS[[...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR_COLORS.length];
const initials = name => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
function chatTime(iso) {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' });
}
const dayLabel = iso => {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Сегодня';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
};
const platformLabel = t => `${t.platform === 'android' ? 'Android' : 'Веб'}${t.appVersion ? ' ' + t.appVersion : ''}`;

async function openInbox(login = null) {
  const el = document.getElementById('support-inbox');
  el.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  await loadInboxThreads();
  updateInboxBell();
  if (login) openInboxChat(login);
  else if (window.matchMedia('(min-width: 760px)').matches && inbox.threads[0]) openInboxChat(inbox.threads[0].login);
  clearInterval(inbox.timer);
  inbox.timer = setInterval(async () => { await loadInboxThreads(); if (inbox.login) loadInboxChat(inbox.login, true); }, 15000);
}
function closeInbox() {
  document.getElementById('support-inbox').classList.add('hidden');
  document.body.style.overflow = '';
  clearInterval(inbox.timer);
  inbox.login = null;
  refreshSupportBadge();
}

async function loadInboxThreads() {
  const r = await apiJson('GET', '/api/admin/support/threads').catch(() => null);
  inbox.threads = r?.threads || [];
  const total = document.querySelector('#support-inbox .inbox-total');
  total.textContent = r?.unread || 0; total.classList.toggle('hidden', !r?.unread);
  const b = document.getElementById('admin-support-badge');
  if (b) { b.textContent = r?.unread || 0; b.classList.toggle('hidden', !r?.unread); }
  setSettingsBadge('admin', r?.unread || 0);
  renderInboxList();
}

function renderInboxList() {
  const box = document.querySelector('#support-inbox .inbox-chats');
  const q = inbox.q.trim().toLowerCase();
  const list = inbox.threads.filter(t => (inbox.filter !== 'unread' || t.unread) &&
    (!q || [t.name, t.login, t.familyName].some(v => String(v || '').toLowerCase().includes(q))));
  if (!list.length) {
    box.innerHTML = `<div class="inbox-none">${inbox.threads.length ? 'Ничего не нашлось' : 'Сообщений пока нет'}</div>`;
    return;
  }
  box.innerHTML = list.map(t => `
    <button class="inbox-row${t.unread ? ' unread' : ''}${t.login === inbox.login ? ' active' : ''}" data-login="${esc(t.login)}">
      <span class="inbox-ava" style="background:${avatarColor(t.login)}">${esc(initials(t.name))}</span>
      <span class="inbox-row-main">
        <span class="inbox-row-top"><b>${esc(t.name || t.login)}</b><time>${chatTime(t.last.createdAt)}</time></span>
        <span class="inbox-row-bottom">
          <span class="inbox-preview">${t.last.from === 'admin' ? '<i>Вы:</i> ' : ''}${esc(t.last.text)}</span>
          ${t.unread ? `<span class="count-badge">${t.unread}</span>` : t.closed ? '<span class="inbox-closed">закрыт</span>' : ''}
        </span>
        <span class="inbox-row-meta">${esc(t.familyName || t.login)} · ${esc(platformLabel(t))}</span>
      </span>
    </button>`).join('');
  box.querySelectorAll('.inbox-row').forEach(r => r.addEventListener('click', () => openInboxChat(r.dataset.login)));
}

async function openInboxChat(login) {
  inbox.login = login;
  document.getElementById('support-inbox').classList.add('chat-open');
  renderInboxList();
  await loadInboxChat(login);
  const t = inbox.threads.find(x => x.login === login);
  if (t?.unread) {
    await apiJson('POST', `/api/admin/support/thread/${encodeURIComponent(login)}/read`);
    t.unread = 0; renderInboxList(); loadInboxThreads();
  }
}

async function loadInboxChat(login, silent = false) {
  const pane = document.querySelector('#support-inbox .inbox-chat');
  const t = inbox.threads.find(x => x.login === login) || { login, name: login };
  const r = await apiJson('GET', `/api/admin/support/thread/${encodeURIComponent(login)}`).catch(() => null);
  const msgs = r?.messages || [];
  if (inbox.login !== login) return;
  const draft = pane.querySelector('.inbox-compose textarea')?.value || '';
  const log = pane.querySelector('.inbox-log');
  const atBottom = !log || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  if (silent && log && log.dataset.count === String(msgs.length)) return;
  let lastDay = '';
  pane.innerHTML = `
    <header class="inbox-head inbox-chat-head">
      <button class="icon-btn inbox-back" aria-label="К списку чатов">‹</button>
      <span class="inbox-ava" style="background:${avatarColor(login)}">${esc(initials(t.name))}</span>
      <div class="inbox-chat-who"><b>${esc(t.name || login)}</b><span>${esc(login)}${t.familyName ? ' · ' + esc(t.familyName) : ''} · ${esc(platformLabel(t))}</span></div>
      <button class="icon-btn inbox-del" aria-label="Удалить переписку" title="Удалить переписку">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>
      </button>
    </header>
    <div class="inbox-log" data-count="${msgs.length}">
      ${msgs.map(m => {
        const day = dayLabel(m.createdAt);
        const sep = day !== lastDay ? `<div class="inbox-day">${day}</div>` : '';
        lastDay = day;
        const me = m.from === 'admin';
        return `${sep}<div class="inbox-msg ${me ? 'me' : 'them'}">
          <div class="inbox-msg-text">${esc(m.text)}</div>
          <div class="inbox-msg-meta">${new Date(m.createdAt).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}${me ? (m.seen ? ' · прочитано' : ' · доставлено') : ''}</div>
        </div>`;
      }).join('')}
      ${t.closed ? '<div class="inbox-day">Пользователь закрыл диалог — ответ начнёт новую переписку</div>' : ''}
    </div>
    <div class="inbox-compose">
      <textarea rows="1" maxlength="4000" placeholder="Ответить: ${esc(t.name || login)}"></textarea>
      <button class="inbox-send" aria-label="Отправить"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-3-7z"/></svg></button>
    </div>`;
  const newLog = pane.querySelector('.inbox-log');
  if (!silent || atBottom) newLog.scrollTop = newLog.scrollHeight;
  const ta = pane.querySelector('textarea');
  ta.value = draft;
  const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; };
  fit(); ta.addEventListener('input', fit);
  const send = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const btn = pane.querySelector('.inbox-send'); btn.disabled = true;
    const res = await apiJson('POST', '/api/admin/support/reply', { login, text }).catch(() => ({ error: 'Нет соединения' }));
    btn.disabled = false;
    if (res?.error) { showToastError(res.error); return; }
    ta.value = '';
    await loadInboxThreads(); await loadInboxChat(login);
  };
  pane.querySelector('.inbox-send').addEventListener('click', send);
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
  pane.querySelector('.inbox-back').addEventListener('click', () => {
    inbox.login = null;
    document.getElementById('support-inbox').classList.remove('chat-open');
    pane.innerHTML = '<div class="inbox-empty">Выберите чат слева</div>';
    renderInboxList();
  });
  pane.querySelector('.inbox-del').addEventListener('click', async () => {
    if (!(await uiConfirm('Удалить переписку?', `Все сообщения с ${t.name || login} будут удалены без возможности восстановления.`, { ok: 'Удалить', danger: true }))) return;
    await apiJson('DELETE', `/api/admin/support/thread/${encodeURIComponent(login)}`);
    pane.querySelector('.inbox-back').click();
    loadInboxThreads();
  });
  if (!silent && window.matchMedia('(min-width: 760px)').matches) ta.focus();
}

async function updateInboxBell() {
  const on = await isPushSubscribed();
  document.querySelector('#support-inbox .inbox-bell')?.classList.toggle('on', on);
}

function initInbox() {
  const el = document.getElementById('support-inbox');
  if (!el || el.dataset.ready) return;
  el.dataset.ready = '1';
  document.getElementById('btn-open-inbox')?.addEventListener('click', () => openInbox());
  el.querySelector('[data-act="close"]').addEventListener('click', closeInbox);
  el.querySelector('.inbox-search').addEventListener('input', e => { inbox.q = e.target.value; renderInboxList(); });
  el.querySelectorAll('.inbox-filters .pill').forEach(b => b.addEventListener('click', () => {
    inbox.filter = b.dataset.filter;
    el.querySelectorAll('.inbox-filters .pill').forEach(x => x.classList.toggle('active', x === b));
    renderInboxList();
  }));
  el.querySelector('[data-act="push"]').addEventListener('click', async () => {
    if (await isPushSubscribed()) { showToastSuccess('Уведомления о новых сообщениях уже приходят на это устройство'); return; }
    try {
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission !== 'granted') { showToastError('Разрешите уведомления в браузере'); return; }
      await subscribeToPush();
      showToastSuccess('Готово — новые сообщения будут приходить сюда');
      updateInboxBell();
    } catch { showToastError('Не удалось включить уведомления'); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !el.classList.contains('hidden') && !document.querySelector('.ui-dialog')) closeInbox(); });
}

// ── Поддержка у пользователя: переписка и красная точка на вкладке «Настройки»
function setSupportDot(n) {
  document.querySelector('.nav-btn[data-screen="settings"]')?.classList.toggle('has-dot', n > 0);
  setSettingsBadge('help', n, true);
}
async function refreshSupportUnread() {
  try { const r = await apiJson('GET', '/api/support/unread'); setSupportDot(r?.unread || 0); } catch { /* не критично */ }
}
// Закрыть диалог: переписка исчезает из настроек (у разработчика остаётся).
// Новое сообщение начнёт диалог заново.
async function closeSupportThread() {
  if (!(await uiConfirm('Закрыть диалог?', 'Переписка пропадёт из настроек. Если понадобится — просто напишите снова, начнётся новый диалог.', { ok: 'Закрыть' }))) return;
  try {
    await apiJson('POST', '/api/support/close');
    setSupportDot(0);
    await loadSupportThread();
    showToastSuccess('Диалог закрыт');
  } catch { showToastError('Не удалось закрыть диалог'); }
}

async function loadSupportThread() {
  const box = document.getElementById('support-thread');
  if (!box) return;
  try {
    const r = await apiJson('GET', '/api/support');
    const msgs = r?.messages || [];
    box.classList.toggle('hidden', !msgs.length);
    document.getElementById('btn-support-close')?.classList.toggle('hidden', !msgs.length);
    box.innerHTML = msgs.map(m => `
      <div class="sup-bubble sup-bubble--${m.from === 'admin' ? 'them' : 'me'}${m.from === 'admin' && !m.seen ? ' unread' : ''}">
        <div class="sup-bubble-text">${esc(m.text)}</div>
        <div class="sup-bubble-meta">${m.from === 'admin' ? 'Разработчик' : 'Вы'} · ${supTime(m.createdAt)}</div>
      </div>`).join('');
    box.scrollTop = box.scrollHeight;
    if (r?.unread) { await apiJson('POST', '/api/support/seen'); setSupportDot(0); }
  } catch { /* офлайн — покажем позже */ }
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
  recurring: 'Регулярные платежи',
};

let currentScreen = 'budget';

// ─── Дизайн-система: «золотая застёжка», досчёт сумм, тема графиков ────────
const motionOK = () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Две золотые точки над активной вкладкой пружинисто перескакивают к новой.
function placeClasp(hop) {
  const nav = document.querySelector('.bottom-nav');
  const btn = nav?.querySelector('.nav-btn.active');
  if (!nav || !btn) return;
  let clasp = nav.querySelector('.nav-clasp');
  if (!clasp) { clasp = document.createElement('span'); clasp.className = 'nav-clasp'; clasp.setAttribute('aria-hidden', 'true'); nav.appendChild(clasp); }
  clasp.style.setProperty('--clasp-x', `${btn.offsetLeft + btn.offsetWidth / 2 - 7}px`);
  if (hop && motionOK()) { clasp.classList.remove('hop'); void clasp.offsetWidth; clasp.classList.add('hop'); }
}
window.addEventListener('resize', () => placeClasp(false));

// Итоговая сумма «досчитывается» от прежнего значения к новому.
function countUp(el, to, from = 0) {
  if (!el) return;
  if (!motionOK() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 650;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Цвета графиков берём из токенов темы — корректно и в тёмной теме.
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const withAlpha = (hex, a) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
// Категориальная палитра серий (участники семьи) — из токенов --series-N
const seriesColors = () => [1, 2, 3, 4].map(i => cssVar(`--series-${i}`));
const userChartColors = () => seriesColors().map(c => ({ bg: withAlpha(c, 0.78), border: c }));
function applyChartTheme() {
  if (!window.Chart) return;
  Chart.defaults.color = cssVar('--text-muted');
  Chart.defaults.borderColor = cssVar('--border');
  Chart.defaults.font.family = "'Onest', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}
applyChartTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyChartTheme(); refreshCurrentScreen(); });

function navigate(screenName) {
  document.querySelectorAll('.main-content .screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const screen = document.getElementById(`screen-${screenName}`);
  if (screen) screen.classList.add('active');

  const navBtn = document.querySelector(`.nav-btn[data-screen="${screenName}"]`);
  if (navBtn) navBtn.classList.add('active');
  placeClasp(true);

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
    case 'settings': if (settingsPage) closeSettingsPage(); else renderSettingsRoot(); loadSupportThread(); loadSettingsScreen(); break;
    case 'goals': loadGoalsScreen(); break;
    case 'recurring': loadRecurring(); break;
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
      list.innerHTML = '<div class="empty-state finik-empty">' + finik('record', 'finik-lg') + '<span>Пока нет расходов за этот день — добавьте первый</span></div>';
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
          expList.appendChild(buildExpenseItem(exp, isMyExpense(exp), { showUser: false }));
        }
        section.appendChild(expList);
        list.appendChild(section);
      }
    } else {
      const userName = budgetFilter === 'me' ? currentUser.name : partnerName;
      const udata = byUser[userName];
      filteredTotal = udata?.total || 0;
      if (!udata || udata.expenses.length === 0) {
        list.innerHTML = '<div class="empty-state finik-empty">' + finik('record', 'finik-lg') + '<span>Пока нет расходов за этот день — добавьте первый</span></div>';
      } else {
        for (const exp of udata.expenses) {
          list.appendChild(buildExpenseItem(exp, isMyExpense(exp), { showUser: false }));
        }
      }
    }

    const dayBar = document.getElementById('budget-total-bar');
    const prevDay = Number(dayBar.dataset.total || 0);
    dayBar.innerHTML = `<span>Итого за день</span><span class="total-amount">${fmt(prevDay)}</span>`;
    dayBar.dataset.total = filteredTotal;
    countUp(dayBar.querySelector('.total-amount'), filteredTotal, prevDay);

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
  const dateEl = document.getElementById('form-date');
  if (!dateEl.value) dateEl.value = localIsoDate(new Date());
  fitAmount();
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

// ─── ФИНИК — маскот (переиспользуемый SVG с эмоциями) ────────────────────────
// Финик-кошелёк. Разметка 1:1 с android/src/components/Finik.tsx. Позы и движения считает риг
// (finik-rig.js — та же математика, что в приложении); драйвер ниже каждый кадр
// задаёт частям [data-p] transform/opacity. Предметы [data-prop] — по эмоции.
const FINIK_DEFS = `<svg class="finik-defs" width="0" height="0" aria-hidden="true" style="position:absolute"><defs>
  <clipPath id="fk-pouch"><path d="M50 70 C26 96 16 150 36 178 C56 199 144 199 164 178 C184 150 174 96 150 70 Q100 57 50 70 Z"/></clipPath>
  <clipPath id="fk-eye-l"><circle cx="79" cy="97" r="19"/></clipPath>
  <clipPath id="fk-eye-r"><circle cx="121" cy="97" r="19"/></clipPath>
</defs></svg>`;

// Финик-кошелёк: плоская мультяшная палитра (фиолетовый + золото фермуара)
const FK = { body: '#7A5CF0', hi: '#9B80FF', sh: '#5947E0', arm: '#5947E0', gold: '#FFC24B', goldSh: '#E8A21F',
  goldHi: '#FFE9A8', glove: '#FFFFFF', gloveLine: '#D9CEFF', shoe: '#3A2E80', shoeHi: '#6A58D6', ink: '#2B2160' };
const FK_POUCH = 'M50 70 C26 96 16 150 36 178 C56 199 144 199 164 178 C184 150 174 96 150 70 Q100 57 50 70 Z';
const FINIK_SVG = `<svg class="finik-svg" viewBox="-6 0 220 210" data-emotion="idle" role="img" aria-label="Финик — помощник">
  <g data-p="shadow"><ellipse cx="100" cy="197" rx="54" ry="8" fill="rgba(60,40,120,0.16)"/></g>
  <g data-prop="confetti" style="display:none">
    <rect x="60" y="22" width="7" height="10" rx="2" fill="#FF7AB3"/><rect x="98" y="14" width="7" height="10" rx="2" fill="#34C7A0"/>
    <rect x="134" y="24" width="7" height="10" rx="2" fill="#FFC24B"/><rect x="80" y="18" width="7" height="10" rx="2" fill="#8A6BFF"/>
    <rect x="118" y="18" width="7" height="10" rx="2" fill="#FF7AB3"/>
  </g>
  <g data-p="bodyBack">
    <g data-p="armL"><path d="M42 112 Q14 116 14 140" stroke="${FK.arm}" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="14" cy="144" r="9" fill="${FK.glove}" stroke="${FK.gloveLine}" stroke-width="2"/><circle cx="7" cy="140" r="3.6" fill="${FK.glove}" stroke="${FK.gloveLine}" stroke-width="1.6"/></g>
    <g data-p="armR"><path d="M158 112 Q186 116 186 140" stroke="${FK.arm}" stroke-width="7" fill="none" stroke-linecap="round"/><circle cx="186" cy="144" r="9" fill="${FK.glove}" stroke="${FK.gloveLine}" stroke-width="2"/><circle cx="193" cy="140" r="3.6" fill="${FK.glove}" stroke="${FK.gloveLine}" stroke-width="1.6"/></g>
    <path d="${FK_POUCH}" fill="${FK.body}"/>
    <g clip-path="url(#fk-pouch)">
      <path d="M146 76 Q164 112 160 156 Q154 184 118 194 L210 210 L210 60 Z" fill="${FK.sh}"/>
      <path d="M52 104 Q34 128 42 156 Q50 172 68 166 Q80 158 70 142 Q62 128 66 112 Q62 98 52 104 Z" fill="${FK.hi}" opacity="0.75"/>
      <g data-p="bellyLines"><path d="M52 180 Q100 194 148 180" stroke="${FK.sh}" stroke-width="2.5" fill="none" stroke-dasharray="4 4" stroke-linecap="round"/></g>
    </g>
  </g>
  <g data-p="footL"><path d="M94 196 Q96 184 80 184 Q62 184 62 192 Q62 199 76 199 L90 199 Q94 199 94 196 Z" fill="${FK.shoe}"/><ellipse cx="70" cy="189" rx="4.5" ry="2.6" fill="${FK.shoeHi}"/></g>
  <g data-p="footR"><path d="M106 196 Q104 184 120 184 Q138 184 138 192 Q138 199 124 199 L110 199 Q106 199 106 196 Z" fill="${FK.shoe}"/><ellipse cx="130" cy="189" rx="4.5" ry="2.6" fill="${FK.shoeHi}"/></g>
  <g data-p="bodyFront">
    <g data-p="bellyPlus" style="display:none"><circle cx="100" cy="156" r="20" fill="${FK.gold}" stroke="${FK.goldSh}" stroke-width="3"/><rect x="89" y="152" width="22" height="8" rx="4" fill="#fff"/><rect x="96" y="145" width="8" height="22" rx="4" fill="#fff"/><circle cx="72" cy="160" r="9" fill="${FK.glove}" stroke="${FK.gloveLine}" stroke-width="2"/><circle cx="128" cy="160" r="9" fill="${FK.glove}" stroke="${FK.gloveLine}" stroke-width="2"/></g>
    <line x1="95" y1="58" x2="105" y2="45" stroke="${FK.goldSh}" stroke-width="4" stroke-linecap="round"/><line x1="105" y1="58" x2="95" y2="45" stroke="${FK.goldSh}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="93" cy="40" r="7.5" fill="${FK.gold}"/><circle cx="107" cy="40" r="7.5" fill="${FK.gold}"/>
    <circle cx="91" cy="37.5" r="2.4" fill="${FK.goldHi}"/><circle cx="105" cy="37.5" r="2.4" fill="${FK.goldHi}"/>
    <path d="M40 69 Q100 51 160 69" stroke="${FK.goldSh}" stroke-width="11" fill="none" stroke-linecap="round"/>
    <path d="M40 66 Q100 48 160 66" stroke="${FK.gold}" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M60 60 Q100 49 140 60" stroke="${FK.goldHi}" stroke-width="2.6" fill="none" stroke-linecap="round" opacity="0.9"/>
    <g data-p="cheeks" opacity="0"><ellipse cx="60" cy="122" rx="9" ry="5.5" fill="#FF8FB8"/><ellipse cx="140" cy="122" rx="9" ry="5.5" fill="#FF8FB8"/></g>
    <circle cx="79" cy="97" r="19" fill="#FFFFFF"/><circle cx="121" cy="97" r="19" fill="#FFFFFF"/>
    <g data-p="pupils"><circle cx="79" cy="99" r="9" fill="${FK.ink}"/><circle cx="82.5" cy="95" r="3.2" fill="#fff"/><circle cx="76" cy="102.5" r="1.5" fill="#fff"/><circle cx="121" cy="99" r="9" fill="${FK.ink}"/><circle cx="124.5" cy="95" r="3.2" fill="#fff"/><circle cx="118" cy="102.5" r="1.5" fill="#fff"/></g>
    <g clip-path="url(#fk-eye-l)"><g data-p="lidL"><rect x="58" y="36" width="42" height="41" fill="${FK.body}"/><line x1="58" y1="77" x2="100" y2="77" stroke="${FK.ink}" stroke-width="2.5"/></g></g>
    <g clip-path="url(#fk-eye-r)"><g data-p="lidR"><rect x="100" y="36" width="42" height="41" fill="${FK.body}"/><line x1="100" y1="77" x2="142" y2="77" stroke="${FK.ink}" stroke-width="2.5"/></g></g>
    <circle cx="79" cy="97" r="19" fill="none" stroke="${FK.ink}" stroke-width="2.6"/><circle cx="121" cy="97" r="19" fill="none" stroke="${FK.ink}" stroke-width="2.6"/>
    <g data-p="browL"><rect x="66" y="71" width="20" height="6" rx="3" fill="${FK.ink}"/></g>
    <g data-p="browR"><rect x="114" y="71" width="20" height="6" rx="3" fill="${FK.ink}"/></g>
    <g data-p="mSmile"><path d="M86 126 Q100 139 114 126" stroke="${FK.ink}" stroke-width="4.5" fill="none" stroke-linecap="round"/></g>
    <g data-p="mGrin" opacity="0"><path d="M84 124 Q100 146 116 124 Q100 131 84 124 Z" fill="${FK.ink}"/></g>
    <g data-p="mFrown" opacity="0"><path d="M87 133 Q100 123 113 133" stroke="${FK.ink}" stroke-width="4.5" fill="none" stroke-linecap="round"/></g>
    <g data-p="mFocus" opacity="0"><ellipse cx="100" cy="129" rx="5" ry="4" fill="${FK.ink}"/></g>
    <g data-p="mFlat" opacity="0"><line x1="89" y1="129" x2="111" y2="129" stroke="${FK.ink}" stroke-width="4.5" stroke-linecap="round"/></g>
    <g data-p="mSmirk" opacity="0"><path d="M88 129 Q100 134 114 126" stroke="${FK.ink}" stroke-width="4.5" fill="none" stroke-linecap="round"/></g>
    <g data-p="mYell" opacity="0"><g data-p="yell"><ellipse cx="100" cy="130" rx="10" ry="9" fill="${FK.ink}"/><ellipse cx="100" cy="135.5" rx="5.5" ry="2.8" fill="#FF8FB8"/></g></g>
    <g data-p="anger" opacity="0"><path d="M-7 -2 Q-7 -7 -2 -7 M2 -7 Q7 -7 7 -2 M7 2 Q7 7 2 7 M-2 7 Q-7 7 -7 2" stroke="#FF4D5E" stroke-width="3" fill="none" stroke-linecap="round"/></g>
    <g data-p="sweat" opacity="0"><path d="M150 78 q6 9 0 14 q-6 -5 0 -14 Z" fill="#4FC3F7"/></g>
    <g data-prop="think" style="display:none" fill="#5947E0"><circle cx="160" cy="54" r="4"/><circle cx="173" cy="42" r="5.5"/><circle cx="189" cy="28" r="7"/></g>
    <g data-prop="shades" style="display:none"><rect x="57" y="85" width="42" height="24" rx="11" fill="#15111f"/><rect x="101" y="85" width="42" height="24" rx="11" fill="#15111f"/><line x1="99" y1="92" x2="101" y2="92" stroke="#15111f" stroke-width="6"/><rect x="62" y="89" width="30" height="6" rx="3" fill="#4a3f6e"/><rect x="106" y="89" width="30" height="6" rx="3" fill="#4a3f6e"/></g>
    <g data-prop="wrench" style="display:none"><g transform="rotate(20 196 118)"><rect x="191" y="88" width="10" height="42" rx="4" fill="#AEB6C4"/><path d="M196 80 a11 11 0 1 0 0 22 a11 11 0 1 0 0 -22 M190 84 h12 v9 h-12 Z" fill="#8892A6"/><circle cx="196" cy="91" r="5" fill="#F1EDFF"/></g></g>
    <g data-prop="coin" style="display:none"><circle cx="186" cy="112" r="14" fill="#FFC24B" stroke="#E8A21F" stroke-width="2.5"/><text x="186" y="118" text-anchor="middle" font-size="15" font-weight="900" fill="#8a5a00">₽</text></g>
    <g data-prop="magnifier" style="display:none"><circle cx="186" cy="112" r="18" fill="rgba(180,220,255,0.30)" stroke="#8892A6" stroke-width="4"/><rect x="178" y="128" width="8" height="20" rx="4" fill="#7a6a50" transform="rotate(20 182 138)"/></g>
    <g data-prop="board" style="display:none"><g transform="translate(0 12)"><rect x="150" y="58" width="60" height="58" rx="6" fill="#F6F3FF" stroke="#B9A9F0" stroke-width="3"/><text x="163" y="80" font-size="13" font-weight="800" fill="#5947E0">₽</text><line x1="176" y1="76" x2="203" y2="76" stroke="#C9BBF5" stroke-width="3" stroke-linecap="round"/><line x1="159" y1="93" x2="203" y2="93" stroke="#C9BBF5" stroke-width="3" stroke-linecap="round"/><path d="M159 108 l12 -7 l9 4 l16 -11" stroke="#34C7A0" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></g>
    <g data-prop="sparkle" style="display:none" fill="#FFC24B"><path d="M30 52 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z"/><path d="M172 150 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#FF7AB3"/></g>
  </g>
</svg>`;

function ensureFinikDefs() {
  if (!document.querySelector('.finik-defs')) document.body.insertAdjacentHTML('beforeend', FINIK_DEFS);
}
// Показывать ли маскота (по умолчанию — да; выключается в настройках)
function finikEnabled() { return localStorage.getItem('finik_enabled') !== '0'; }
// Возвращает HTML маскота с заданной эмоцией. size: 'finik-sm' | 'finik-md' | 'finik-lg'
function finik(emotion = 'idle', size = 'finik-sm', extra = '') {
  if (!finikEnabled()) return '';
  return `<div class="finik ${size} ${extra}">${FINIK_SVG.replace('data-emotion="idle"', `data-emotion="${emotion}"`)}</div>`;
}

// Гуляющий Финик на верхней границе кнопок в контейнере [data-finik-walk]
function mountWalkers() {
  if (!finikEnabled()) return;
  document.querySelectorAll('[data-finik-walk]').forEach(host => {
    if (host.querySelector('.finik-walker')) return;
    host.classList.add('finik-walk-host');
    host.insertAdjacentHTML('afterbegin',
      `<div class="finik finik-walker">${FINIK_SVG.replace('data-emotion="idle"', 'data-emotion="walk"')}</div>`);
  });
}

// ─── Драйвер анимаций: риг (finik-rig.js) → части SVG ───────────────────────
// Один requestAnimationFrame на все видимые Финики. Эмоцию читаем из
// data-emotion каждый кадр (временная — data-fx: тап/фиджет), поэтому любой код,
// меняющий атрибут (барометр: «ругается» → «ворчит»), получает плавный переход.
const FK_MAT = { shadow: 'shadowM', bodyBack: 'bodyM', bodyFront: 'bodyM', armL: 'armLM', armR: 'armRM',
  footL: 'footLM', footR: 'footRM', browL: 'browLM', browR: 'browRM', pupils: 'pupilsM',
  lidL: 'lidM', lidR: 'lidM', yell: 'yellM', anger: 'angerM', sweat: 'sweatM' };
const FK_OP = { anger: 'angerO', sweat: 'sweatO', cheeks: 'cheeksO', mSmile: 'mSmile', mGrin: 'mGrin',
  mFrown: 'mFrown', mFocus: 'mFocus', mFlat: 'mFlat', mSmirk: 'mSmirk', mYell: 'mYell' };
const fkReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const fkRigs = new WeakMap();
const fkVisible = new Set();
let fkRaf = 0, fkLast = 0, fkIO = null;

const fkMat = m => `matrix(${m[0].toFixed(4)} ${m[1].toFixed(4)} ${m[2].toFixed(4)} ${m[3].toFixed(4)} ${m[4].toFixed(2)} ${m[5].toFixed(2)})`;
const fkEmotion = svg => svg.dataset.fx || svg.getAttribute('data-emotion') || 'idle';
function fkTarget(emo) {
  const t = FK_TARGETS[emo] || FK_TARGETS.idle;
  return fkReduced.matches ? { ...t, fA: 0, fB: 0, blink: 0 } : t; // «уменьшить движение» — замирает
}

function fkSet(r, node, attr, val) {
  const key = node.dataset.p + attr;
  if (r.last[key] !== val) { r.last[key] = val; node.setAttribute(attr, val); }
}

function fkApply(svg, r, pose, emo) {
  if (r.emo !== emo) { // дискретное: предметы и плюсик на пузе
    r.emo = emo;
    const on = FK_PROPS[emo] || [];
    r.props.forEach(n => { n.style.display = on.includes(n.dataset.prop) ? '' : 'none'; });
    const plus = emo === 'plus';
    r.p.bellyPlus.style.display = plus ? '' : 'none';
    r.p.bellyLines.style.display = plus ? 'none' : '';
    r.p.armL.style.display = r.p.armR.style.display = plus ? 'none' : '';
  }
  for (const k in FK_MAT) {
    let m = pose[FK_MAT[k]];
    if (k === 'pupils' && svg.__look && (emo === 'idle' || emo === 'walk')) {
      m = [1, 0, 0, 1, m[4] + svg.__look[0], m[5] + svg.__look[1]]; // глаза следят за курсором
    }
    fkSet(r, r.p[k], 'transform', fkMat(m));
  }
  for (const k in FK_OP) fkSet(r, r.p[k], 'opacity', pose[FK_OP[k]].toFixed(3));
}

function fkRegister(svg) {
  if (fkRigs.has(svg)) return;
  const p = {};
  svg.querySelectorAll('[data-p]').forEach(n => { p[n.dataset.p] = n; });
  if (!p.bodyFront) return; // чужая/старая разметка
  const emo = fkEmotion(svg);
  const r = { p, props: [...svg.querySelectorAll('[data-prop]')], emo: null, last: {}, st: fkInit(fkTarget(emo)) };
  fkRigs.set(svg, r);
  fkApply(svg, r, fkPose(r.st), emo); // сразу правильная поза — без мигания до первого кадра
  fkIO?.observe(svg);
}

function fkFrame(now) {
  fkRaf = 0;
  const dt = fkLast ? Math.min(0.05, (now - fkLast) / 1000) : 1 / 60;
  fkLast = now;
  for (const svg of fkVisible) {
    if (!svg.isConnected) { fkVisible.delete(svg); fkIO?.unobserve(svg); continue; }
    const r = fkRigs.get(svg);
    if (!r) continue;
    const emo = fkEmotion(svg);
    r.st = fkStep(r.st, fkTarget(emo), dt);
    fkApply(svg, r, fkPose(r.st), emo);
  }
  fkKick();
}
function fkKick() {
  if (fkRaf || !fkVisible.size || document.hidden) { if (!fkVisible.size || document.hidden) fkLast = 0; return; }
  fkRaf = requestAnimationFrame(fkFrame);
}

function finikActivate() {
  if (window.__finikActive) return;
  window.__finikActive = true;

  // Видимость — через IntersectionObserver: анимируем только то, что на экране
  fkIO = new IntersectionObserver(entries => {
    for (const e of entries) e.isIntersecting ? fkVisible.add(e.target) : fkVisible.delete(e.target);
    fkKick();
  });
  document.querySelectorAll('.finik-svg').forEach(fkRegister);
  // Новые Финики появляются при перерисовке экранов — подхватываем до отрисовки
  new MutationObserver(muts => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.classList.contains('finik-svg')) fkRegister(n);
      else if (n.querySelector) n.querySelectorAll('.finik-svg').forEach(fkRegister);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('visibilitychange', fkKick);

  // Глаза следят за курсором (в спокойных состояниях) — смещение зрачков в единицах SVG
  let raf = 0, ev = null;
  const track = () => {
    raf = 0; if (!ev) return;
    fkVisible.forEach(svg => {
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const dx = Math.max(-3, Math.min(3, (ev.clientX - (r.left + r.width / 2)) / (r.width / 2) * 3));
      const dy = Math.max(-2.5, Math.min(2.5, (ev.clientY - (r.top + r.height * 0.46)) / (r.height / 2) * 3));
      svg.__look = [dx, dy];
    });
  };
  window.addEventListener('pointermove', e => { ev = e; if (!raf) raf = requestAnimationFrame(track); }, { passive: true });

  // Тап по Финику — короткая смена эмоции (как в приложении), риг перетекает плавно
  const TAPS = ['goal', 'income', 'inspect', 'spy'];
  document.addEventListener('click', e => {
    const wrap = e.target.closest('.finik');
    if (!wrap || wrap.classList.contains('finik-walker') || wrap.classList.contains('finik-wander') || wrap.closest('.fab')) return;
    const svg = wrap.querySelector('.finik-svg');
    if (!svg || svg.dataset.fx) return;
    svg.dataset.fx = TAPS[Math.floor(Math.random() * TAPS.length)];
    setTimeout(() => { delete svg.dataset.fx; }, 1300);
  });

  // idle-фиджеты: раз в 6–16с спокойный Финик делает случайное микродействие
  const FIDGETS = ['income', 'inspect', 'goal', 'spy'];
  const fidgetTick = () => {
    if (!fkReduced.matches) fkVisible.forEach(svg => {
      if (svg.dataset.fx || svg.getAttribute('data-emotion') !== 'idle') return;
      if (svg.closest('.fab') || Math.random() > 0.6) return; // не все и не каждый тик
      svg.dataset.fx = FIDGETS[Math.floor(Math.random() * FIDGETS.length)];
      setTimeout(() => { delete svg.dataset.fx; }, 1500);
    });
    setTimeout(fidgetTick, 6000 + Math.random() * 10000);
  };
  setTimeout(fidgetTick, 5000);
}

// Иногда Финик просто проходит по нижней панели слева направо
function finikWander() {
  if (!finikEnabled()) return;
  const app = document.getElementById('app');
  let dir = 0; // чередуем: слева-направо, затем справа-налево
  const spawn = () => {
    // не выходим гулять, если на экране уже есть Финики (чтобы их не стало трое)
    let others = 0;
    document.querySelectorAll('.finik:not(.finik-wander)').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.bottom > 0 && r.top < innerHeight) others++;
    });
    const visible = app && !app.classList.contains('hidden') && !document.hidden;
    if (visible && others < 2 && !document.querySelector('.finik-wander')) {
      const el = document.createElement('div');
      el.className = 'finik finik-wander' + (dir % 2 ? ' rtl' : '');
      dir++;
      el.innerHTML = FINIK_SVG.replace('data-emotion="idle"', 'data-emotion="walk"');
      el.addEventListener('animationend', () => el.remove());
      document.body.appendChild(el);
    }
    setTimeout(spawn, 55000 + Math.random() * 15000); // примерно раз в минуту
  };
  setTimeout(spawn, 15000 + Math.random() * 10000);
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
  body.innerHTML = `<div class="analysis-loading">${finik('thinking', 'finik-md')}<p>Финик собирает данные и готовит анализ…</p></div>`;
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

// ─── AI CHAT ──────────────────────────────────────────────────────────────────

let chatMessages = [];
let chatContext = '';
let chatLoading = false;

async function aiBuildContext(m, y) {
  const s = await apiJson('GET', `/api/summary?month=${m}&year=${y}`);
  const plan = await apiJson('GET', '/api/budget-plan').catch(() => ({ categoryBudgets: {} }));
  const lines = [`Месяц: ${String(m).padStart(2, '0')}.${y}`, `Всего потрачено: ${Math.round(s.total || 0)} ₽`, '', 'Категории:'];
  for (const [c, v] of Object.entries(s.byCategory || {}).sort((a, b) => b[1] - a[1])) {
    const lim = plan.categoryBudgets && plan.categoryBudgets[c];
    lines.push(`- ${c}: ${Math.round(v)} ₽${lim ? ` (лимит ${lim} ₽)` : ''}`);
  }
  lines.push('', 'Участники:');
  for (const [u, ud] of Object.entries(s.byUser || {})) lines.push(`- ${u}: ${Math.round((ud && ud.total) || 0)} ₽`);
  return lines.join('\n');
}

function renderChat() {
  const el = document.getElementById('chat-messages');
  el.innerHTML = chatMessages.map(m => `<div class="chat-bubble chat-${m.role}">${
    m.role === 'assistant' ? renderMarkdown(m.content) : esc(m.content)
  }</div>`).join('') + (chatLoading ? '<div class="chat-bubble chat-assistant chat-typing">●●●</div>' : '');
  el.scrollTop = el.scrollHeight;
}

async function openChat() {
  const m = summaryMonth || (new Date().getMonth() + 1);
  const y = summaryYear || new Date().getFullYear();
  chatMessages = [{ role: 'assistant', content: `Привет! Я вижу вашу сводку за ${getMonthName(m, y)}. Спросите что угодно — где перерасход, как сэкономить, стоит ли поднять лимит по категории.` }];
  chatContext = '';
  chatLoading = false;
  document.getElementById('chat-input').value = '';
  renderChat();
  document.getElementById('chat-sheet').classList.add('open');
  document.getElementById('chat-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  aiBuildContext(m, y).then(c => { chatContext = c; }).catch(() => {});
}

function closeChat() {
  document.getElementById('chat-sheet').classList.remove('open');
  document.getElementById('chat-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text || chatLoading) return;
  chatMessages.push({ role: 'user', content: text });
  input.value = '';
  chatLoading = true;
  renderChat();
  try {
    const res = await apiJson('POST', '/api/chat', { context: chatContext, messages: chatMessages.slice(-16) });
    chatMessages.push({ role: 'assistant', content: res && res.reply ? res.reply : (res && res.error) || 'Не удалось получить ответ.' });
  } catch {
    chatMessages.push({ role: 'assistant', content: 'Не удалось получить ответ. Попробуйте ещё раз.' });
  } finally {
    chatLoading = false;
    renderChat();
  }
}

function initChat() {
  document.getElementById('btn-ai-chat').addEventListener('click', openChat);
  document.getElementById('chat-close').addEventListener('click', closeChat);
  document.getElementById('chat-overlay').addEventListener('click', closeChat);
  document.getElementById('chat-send').addEventListener('click', sendChat);
  const input = document.getElementById('chat-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
}

// ─── PDF REPORT ───────────────────────────────────────────────────────────────

async function generatePdfReport() {
  const btn = document.getElementById('btn-pdf-report');
  // окно открываем синхронно по клику — иначе мобильные браузеры блокируют попап
  const win = window.open('', '_blank');
  btn.disabled = true;
  btn.textContent = 'Формирую отчёт…';

  try {
    const m = summaryMonth || (new Date().getMonth() + 1);
    const y = summaryYear || new Date().getFullYear();
    const q = (mo, yr) => `/api/summary?${new URLSearchParams({ month: mo, year: yr })}`;
    const prevDate = new Date(y, m - 2, 1);
    const prev2Date = new Date(y, m - 3, 1);
    const ym = `${y}-${String(m).padStart(2, '0')}`;

    const [data, planData, prev, prev2, cashflow] = await Promise.all([
      apiJson('GET', q(m, y)),
      apiJson('GET', '/api/budget-plan'),
      apiJson('GET', q(prevDate.getMonth() + 1, prevDate.getFullYear())),
      apiJson('GET', q(prev2Date.getMonth() + 1, prev2Date.getFullYear())),
      apiJson('GET', `/api/cashflow/${ym}`).catch(() => null),
    ]);

    const html = buildReportHTML({ data, planData, prev, prev2, cashflow, m, y });
    if (win) { win.document.open(); win.document.write(html); win.document.close(); }
    else {
      // попап заблокирован — открываем в этой же вкладке через blob
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      location.href = url;
    }
  } catch (e) {
    if (win) win.close();
    showToastError('Ошибка формирования отчёта');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Отчёт за месяц (PDF)';
  }
}

// Фактический доход месяца — из кэшфлоу (дни поступлений). План доходов из
// бюджета — только запасной вариант, и тогда он явно подписан как план.
function actualIncomes(cashflow) {
  const days = cashflow?.incomeDays;
  const byUser = {};
  let total = 0;
  if (Array.isArray(days)) {
    for (const e of days) {
      const a = Number(e.amount) || 0;
      total += a;
      if (e.user) byUser[e.user] = (byUser[e.user] || 0) + a;
    }
  } else if (days && typeof days === 'object') {
    total = Object.values(days).reduce((s, v) => s + (Number(v) || 0), 0);
  }
  return { total, byUser };
}

function buildReportHTML({ data, planData, prev, prev2, cashflow, m, y }) {
  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                     'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const monthLabel = `${MONTHS_RU[m - 1]} ${y}`;
  const today = new Date();
  const dateLabel = `${today.getDate()} ${MONTHS_GEN_ALL[today.getMonth()]} ${today.getFullYear()}`;
  const prevDate = new Date(y, m - 2, 1);
  const prev2Date = new Date(y, m - 3, 1);
  const short = d => MONTHS_RU[d.getMonth()].slice(0, 3);

  const budgets = planData?.categoryBudgets || {};
  const planIncomes = planData?.incomes || {};
  const fact = actualIncomes(cashflow);
  const incomeIsFact = fact.total > 0;
  const incomeTotal = incomeIsFact ? fact.total : Object.values(planIncomes).reduce((s, v) => s + v, 0);
  const incomeOf = name => incomeIsFact ? (fact.byUser[name] || 0) : (planIncomes[name] || 0);
  const planSpend = appSettings.plannedMonthly || Object.values(budgets).reduce((s, v) => s + v, 0);
  const n = v => new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' ₽';

  const catData = Object.keys(CATEGORY_ICONS).map(cat => ({
    cat, icon: CATEGORY_ICONS[cat],
    spent: data.byCategory?.[cat] || 0,
    limit: budgets[cat] || 0,
    prev: prev.byCategory?.[cat] || 0,
    prev2: prev2.byCategory?.[cat] || 0,
  })).filter(c => c.spent > 0 || c.limit > 0).sort((a, b) => b.spent - a.spent || b.limit - a.limit);
  const maxBar = Math.max(...catData.map(c => Math.max(c.spent, c.limit)), 1);

  const catRows = catData.map(c => {
    const over = c.limit > 0 && c.spent > c.limit;
    const used = c.limit ? Math.round(c.spent / c.limit * 100) : null;
    const trend = c.prev > 0 ? Math.round((c.spent - c.prev) / c.prev * 100) : null;
    const trendHtml = trend === null ? '' :
      `<span class="trend ${trend > 10 ? 'up' : trend < -10 ? 'down' : ''}" title="к прошлому месяцу">${trend > 0 ? '▲' : trend < 0 ? '▼' : '•'}${Math.abs(trend)}%</span>`;
    return `
      <div class="cat">
        <div class="cat-top">
          <span class="cat-name">${c.icon} ${esc(c.cat)}</span>
          <span class="cat-sum"><b class="${over ? 'bad' : ''}">${n(c.spent)}</b>${c.limit ? `<span class="muted"> из ${n(c.limit)}</span>` : ''}</span>
        </div>
        <div class="bar"><i style="width:${(c.spent / maxBar * 100).toFixed(1)}%" class="${over ? 'bad' : ''}"></i>${c.limit ? `<s style="left:${(c.limit / maxBar * 100).toFixed(1)}%"></s>` : ''}</div>
        <div class="cat-foot">
          <span class="${over ? 'bad' : 'muted'}">${used === null ? 'без лимита' : over ? `превышение на ${n(c.spent - c.limit)}` : `${used}% лимита`}</span>
          ${trendHtml}
        </div>
      </div>`;
  }).join('');

  const users = Object.entries(data.byUser || {});
  const userCards = users.map(([name, ud]) => {
    const inc = incomeOf(name);
    const pct = inc > 0 ? Math.round(ud.total / inc * 100) : null;
    return `<div class="user">
      <div class="user-name">${esc(name)}</div>
      <div class="user-sum">${n(ud.total)}</div>
      <div class="muted">${inc ? `${pct}% от дохода ${n(inc)}` : 'доход не указан'}</div>
      ${inc ? `<div class="bar thin"><i style="width:${Math.min(100, pct)}%" class="${pct > 100 ? 'bad' : ''}"></i></div>` : ''}
    </div>`;
  }).join('');

  const top5 = catData.filter(c => c.spent + c.prev + c.prev2 > 0).slice(0, 5);
  const trendRows = top5.map(c => {
    const arr = [c.prev2, c.prev, c.spent];
    const W = 72, H = 26, mx = Math.max(...arr, 1);
    const pt = (v, i) => `${(4 + i / 2 * (W - 8)).toFixed(1)},${(3 + (1 - v / mx) * (H - 6)).toFixed(1)}`;
    return `<div class="tr">
      <span class="tr-name">${c.icon} ${esc(c.cat)}</span>
      <span class="tr-v muted">${n(c.prev2)}</span>
      <span class="tr-v muted">${n(c.prev)}</span>
      <span class="tr-v"><b>${n(c.spent)}</b></span>
      <svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline points="${arr.map(pt).join(' ')}" fill="none" stroke="#5947E0" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${arr.map((v, i) => `<circle cx="${pt(v, i).split(',')[0]}" cy="${pt(v, i).split(',')[1]}" r="2.6" fill="${i === 2 ? '#5947E0' : '#fff'}" stroke="#5947E0" stroke-width="1.6"/>`).join('')}</svg>
    </div>`;
  }).join('');

  const savings = incomeTotal > 0 ? incomeTotal - data.total : null;
  const savingsRate = savings !== null ? Math.round(savings / incomeTotal * 100) : null;
  const planPct = planSpend > 0 ? Math.round(data.total / planSpend * 100) : null;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ФИНИК — отчёт за ${monthLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root { --ink: #1B1830; --muted: #6E6A85; --line: #ECEAF4; --soft: #F6F5FB; --primary: #5947E0; --gold: #F2B84B; --bad: #D93A55; --good: #17915C; }
  body { font-family: 'Onest', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: var(--ink); background: #fff;
    padding: 20px 16px 40px; max-width: 760px; margin: 0 auto; font-size: 14px; line-height: 1.4; -webkit-text-size-adjust: 100%; }
  .toolbar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; justify-content: flex-end; padding: 8px 0 12px; background: #fff; }
  .toolbar button { font: inherit; font-weight: 700; font-size: 14px; border: none; border-radius: 12px; padding: 10px 16px; cursor: pointer; }
  .toolbar .pri { background: var(--primary); color: #fff; }
  .toolbar .sec { background: var(--soft); color: var(--ink); }
  .brand { font-size: 12px; font-weight: 800; letter-spacing: .12em; color: var(--primary); display: flex; align-items: center; gap: 6px; }
  .brand::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--gold); box-shadow: 8px 0 0 var(--gold); margin-right: 8px; }
  h1 { font-size: 26px; font-weight: 800; letter-spacing: -.02em; margin: 6px 0 2px; }
  .meta { color: var(--muted); font-size: 13px; margin-bottom: 18px; }
  h2 { font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 26px 0 10px; }
  .muted { color: var(--muted); }
  .bad { color: var(--bad); }
  .good { color: var(--good); }
  .kpis { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .kpi { background: var(--soft); border-radius: 14px; padding: 12px 14px; min-width: 0; }
  .kpi-l { font-size: 12px; color: var(--muted); }
  .kpi-v { font-size: 20px; font-weight: 800; letter-spacing: -.01em; margin-top: 2px; white-space: nowrap; }
  .kpi-s { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .users { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 8px; }
  .user { border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
  .user-name { font-weight: 700; }
  .user-sum { font-size: 20px; font-weight: 800; margin: 2px 0; }
  .bar { position: relative; height: 8px; background: var(--soft); border-radius: 4px; margin: 6px 0 4px; }
  .bar.thin { height: 6px; margin-top: 8px; }
  .bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--primary); }
  .bar i.bad { background: var(--bad); }
  .bar s { position: absolute; top: -3px; bottom: -3px; width: 3px; margin-left: -1.5px; border-radius: 2px; background: var(--gold); }
  .cat { padding: 10px 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
  .cat-top, .cat-foot { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .cat-name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat-sum { white-space: nowrap; }
  .cat-foot { font-size: 12px; }
  .trend { font-size: 12px; font-weight: 700; color: var(--muted); white-space: nowrap; }
  .trend.up { color: var(--bad); } .trend.down { color: var(--good); }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--muted); margin-top: 10px; }
  .legend i { display: inline-block; width: 12px; height: 8px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  .tr { display: grid; grid-template-columns: 1fr repeat(3, auto) 72px; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--line); break-inside: avoid; }
  .tr-head { font-size: 12px; color: var(--muted); font-weight: 700; padding-top: 0; }
  .tr-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .tr-v { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .foot { margin-top: 28px; font-size: 12px; color: var(--muted); text-align: center; }
  @media (min-width: 600px) { .kpis { grid-template-columns: repeat(4, 1fr); } body { padding: 28px 24px 48px; } }
  @media (max-width: 480px) {
    .tr { grid-template-columns: 1fr auto 64px; row-gap: 2px; }
    .tr .tr-v:nth-of-type(2), .tr .tr-v:nth-of-type(3) { display: none; }
    .tr-head span:nth-child(2), .tr-head span:nth-child(3) { display: none; }
  }
  @media print {
    .toolbar { display: none; }
    body { padding: 0; max-width: none; }
    .kpis { grid-template-columns: repeat(4, 1fr); }
    .tr { grid-template-columns: 1fr repeat(3, auto) 72px !important; }
    .tr .tr-v, .tr-head span { display: block !important; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    h2 { break-after: avoid; }
  }
</style>
</head>
<body>
<div class="toolbar"><button class="sec" onclick="window.close()">Закрыть</button><button class="pri" onclick="window.print()">Сохранить PDF</button></div>
<div class="brand">ФИНИК · СЕМЕЙНЫЙ БЮДЖЕТ</div>
<h1>${monthLabel}</h1>
<div class="meta">Отчёт сформирован ${dateLabel}</div>

<div class="kpis">
  <div class="kpi"><div class="kpi-l">Потрачено</div><div class="kpi-v">${n(data.total)}</div>
    ${planPct !== null ? `<div class="kpi-s ${planPct > 100 ? 'bad' : ''}">${planPct}% плана</div>` : ''}</div>
  ${planSpend > 0 ? `<div class="kpi"><div class="kpi-l">План расходов</div><div class="kpi-v">${n(planSpend)}</div>
    <div class="kpi-s ${planSpend - data.total < 0 ? 'bad' : ''}">${planSpend - data.total >= 0 ? `осталось ${n(planSpend - data.total)}` : `сверх плана ${n(data.total - planSpend)}`}</div></div>` : ''}
  ${incomeTotal > 0 ? `<div class="kpi"><div class="kpi-l">${incomeIsFact ? 'Доход' : 'Доход (план)'}</div><div class="kpi-v good">${n(incomeTotal)}</div>
    <div class="kpi-s">${incomeIsFact ? 'по данным кэшфлоу' : 'фактический доход не внесён'}</div></div>` : ''}
  ${savings !== null ? `<div class="kpi"><div class="kpi-l">Сбережения</div><div class="kpi-v ${savings < 0 ? 'bad' : ''}">${n(savings)}</div>
    <div class="kpi-s ${savings < 0 ? 'bad' : ''}">${savingsRate}% дохода</div></div>` : ''}
</div>

${users.length > 1 ? `<h2>По участникам</h2><div class="users">${userCards}</div>` : ''}

<h2>Расходы по категориям</h2>
${catRows}
<div class="legend"><span><i style="background:#5947E0"></i>Факт</span><span><i style="background:#F2B84B;width:4px"></i>Лимит</span><span><i style="background:#D93A55"></i>Превышение</span><span>▲▼ к прошлому месяцу</span></div>

${top5.length ? `<h2>Динамика — топ категорий</h2>
<div class="tr tr-head"><span>Категория</span><span class="tr-v">${short(prev2Date)}</span><span class="tr-v">${short(prevDate)}</span><span class="tr-v">${MONTHS_RU[m - 1].slice(0, 3)}</span><span></span></div>
${trendRows}` : ''}

<div class="foot">ФИНИК — семейный бюджет</div>
</body>
</html>`;
}

// ─── SUMMARY SCREEN ───────────────────────────────────────────────────────────

let summaryUserFilter = null; // null = all users
let summaryCompareMode = false;
let lastSummaryData = null;
let lastPlanData = null;
let summaryIncomes = {};
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
    // через apiJson — в E2E считается локально (иначе сервер отдаёт пусто)
    const data = await apiJson('GET', `/api/unified-chart-data/${ym}`);
    if (data && data.userExpenses) {
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
          <span class="feed-entry-meta">${esc(whoLabel(e))}${e.category ? ` · ${esc(e.category)}` : ''}</span>
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
    const sm = summaryMonth || (new Date().getMonth() + 1), sy = summaryYear || new Date().getFullYear();
    const [data, planData, cashflow] = await Promise.all([
      apiJson('GET', `/api/summary?${params}`),
      apiJson('GET', '/api/budget-plan'),
      apiJson('GET', `/api/cashflow/${sy}-${String(sm).padStart(2, '0')}`).catch(() => null),
    ]);
    if (gen !== summaryGen) return;
    lastSummaryData = data;
    lastPlanData = planData;
    // «% дохода» — от фактического дохода месяца (кэшфлоу), план — только если факта нет
    const fact = actualIncomes(cashflow);
    summaryIncomes = Object.keys(fact.byUser).length ? fact.byUser : (planData?.incomes || {});

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
  const prevMonth = Number(totalBar.dataset.total || 0);
  totalBar.innerHTML = `<div class="summary-total-main"><span>Итого за месяц${filterLabel}</span><span class="highlight-total">${fmt(prevMonth)}</span></div>${remainHtml}`;
  totalBar.dataset.total = displayTotal;
  countUp(totalBar.querySelector('.highlight-total'), displayTotal, prevMonth);

  // User chips — clickable filter toggle; show % of income in normal mode
  const incomes = summaryIncomes;
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
  const incomes = summaryIncomes;
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

  const COLORS = seriesColors();
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
          grid: { color: cssVar('--border') },
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
      listEl.appendChild(buildExpenseItem(exp, isMyExpense(exp), { showDate: true, showCategory: false }));
    }
  } catch {
    listEl.innerHTML = '<div class="empty-state">Ошибка загрузки</div>';
  }
}

// ─── CHART SCREEN ─────────────────────────────────────────────────────────────

// Colors per user index
// Цвета серий по участникам — userChartColors() (токены темы)

// Экран «График»: три простые карточки, у каждой одна шкала.
// 1) накопительные траты против линии плана (+ прогноз до конца месяца),
// 2) траты по дням с разбивкой по участникам и дневной нормой,
// 3) остаток на счетах — если заполнен кэшфлоу.
let chartScreenCharts = [];
let lastChartData = null;
const kFmt = v => Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(2)}м` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}к` : String(Math.round(v));
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_GEN_ALL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const plural = (n, one, few, many) => { const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; };

async function loadChart() {
  const gen = ++chartGen;
  const ym = cfYm();
  document.getElementById('chart-month-label').textContent = getMonthName(chartMonth, chartYear);
  const box = document.getElementById('chart-cards');
  box.innerHTML = '<div class="card"><div class="loading">Загрузка графиков</div></div>';
  try {
    const data = await apiJson('GET', `/api/unified-chart-data/${ym}`);
    if (gen !== chartGen) return;
    lastChartData = data;
    renderChartCards(box, data);
  } catch (e) {
    console.error('loadChart error:', e);
    box.innerHTML = `<div class="card"><div class="empty-state">${typeof Chart === 'undefined' ? 'Библиотека графиков не загрузилась' : 'Не удалось загрузить графики'}</div></div>`;
  }
}

function renderChartCards(box, data) {
  chartScreenCharts.forEach(c => c.destroy());
  chartScreenCharts = [];
  const users = Object.keys(data.userExpenses || {});
  const lastDay = data.labels?.length || 0;
  if (!lastDay || (!users.length && !data.hasBalance)) {
    box.innerHTML = '<div class="card"><div class="empty-state">Нет расходов за этот месяц</div></div>';
    return;
  }
  const now = new Date();
  // null в chartMonth/chartYear означает «текущий месяц»
  const cm = chartMonth || now.getMonth() + 1, cy = chartYear || now.getFullYear();
  const dim = new Date(cy, cm, 0).getDate();
  const isCur = cy === now.getFullYear() && cm === now.getMonth() + 1;
  const plan = appSettings.plannedMonthly || 0;
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const userDay = (u, d) => d <= lastDay ? (data.userExpenses[u][d - 1] || 0) : null;
  const daily = days.map(d => d <= lastDay ? users.reduce((s, u) => s + userDay(u, d), 0) : null);
  let acc = 0;
  const cum = daily.map(v => v === null ? null : (acc += v));
  const spent = acc;
  const perDay = spent / lastDay;
  const projected = Math.round(perDay * dim);
  const showProj = isCur && lastDay < dim;
  const normNow = plan ? Math.round(plan * lastDay / dim) : 0;
  const zone = plan ? gaugeZone(Math.round(spent / Math.max(1, normNow) * 100)) : null;
  const series = seriesColors();
  const userTotals = users.map(u => data.userExpenses[u].reduce((s, v) => s + (v || 0), 0));
  const bal = data.hasBalance ? (data.balanceLine || []) : null;
  const balNow = bal ? bal[Math.min(bal.length, lastDay) - 1] : 0;
  const C = { primary: cssVar('--primary'), faint: cssVar('--text-faint'), border: cssVar('--border'),
    danger: cssVar('--danger'), gold: cssVar('--gold'), surface: cssVar('--surface') };
  // Перерасход: где накопительные траты выше линии плана. Если выше сейчас —
  // находим начало текущего отрезка («выше плана с N числа»).
  const planAt = d => Math.round(plan * d / dim);
  const overDay = d => plan > 0 && cum[d - 1] != null && cum[d - 1] > planAt(d);
  let overSince = 0;
  if (overDay(lastDay)) { overSince = lastDay; while (overSince > 1 && overDay(overSince - 1)) overSince--; }
  const overDays = days.filter(overDay).length;
  const normDay = plan ? Math.round(plan / dim) : 0;
  const dailyOver = days.filter(d => normDay && daily[d - 1] > normDay).length;
  const maxDaily = Math.max(0, ...daily.filter(v => v != null));

  box.innerHTML = `
    <div class="card chart-card" data-block="chartCum">
      <div class="chart-card-head">
        <div class="settings-title">Траты за месяц</div>
        ${zone ? `<span class="gauge-chip gauge-chip--${zone.key}">${zone.verdict}</span>` : ''}
      </div>
      <div class="chart-kpis">
        <div class="chart-kpi"><span class="chart-kpi-label">Потрачено</span><span class="chart-kpi-value">${fmt(spent)}</span></div>
        ${plan ? `<div class="chart-kpi"><span class="chart-kpi-label">План на месяц</span><span class="chart-kpi-value">${fmt(plan)}</span></div>` : ''}
        ${showProj ? `<div class="chart-kpi"><span class="chart-kpi-label">Прогноз</span><span class="chart-kpi-value${plan && projected > plan ? ' is-over' : ''}">${fmt(projected)}</span></div>` : ''}
      </div>
      <div class="chart-box chart-box--hero"><canvas id="ch-cum" aria-label="Накопительные траты за месяц"></canvas></div>
      <div class="chart-legend">
        <span><i class="lg-line"></i>Потрачено</span>
        ${plan ? '<span><i class="lg-dash"></i>План</span>' : ''}
        ${showProj ? '<span><i class="lg-dot"></i>Прогноз</span>' : ''}
        ${overDays ? '<span><i class="lg-over"></i>Выше плана</span>' : ''}
      </div>
      ${overSince ? `<div class="chart-alert">Траты выше плана с ${overSince} ${MONTHS_GEN_ALL[cm - 1]} — на ${fmt(cum[lastDay - 1] - planAt(lastDay))} больше нормы</div>` : ''}
      ${plan ? '' : '<p class="settings-hint">Укажите плановые расходы: Настройки › «Семья и бюджет» — появится линия плана.</p>'}
    </div>
    <div class="card chart-card" data-block="chartDaily">
      <div class="chart-card-head"><div class="settings-title">Траты по дням</div>
        <span class="chart-card-meta">в среднем ${fmt(Math.round(perDay))} в день</span></div>
      <div class="chart-box"><canvas id="ch-daily" aria-label="Траты по дням"></canvas></div>
      <div class="chart-legend">
        ${users.map((u, i) => `<span><i class="lg-sq" style="background:${series[i % series.length]}"></i>${esc(u)} · ${fmt(userTotals[i])}</span>`).join('')}
        ${plan ? `<span><i class="lg-dash"></i>Норма ${fmt(normDay)} в день</span>` : ''}
        ${dailyOver ? `<span><i class="lg-over-dot"></i>Выше нормы · ${dailyOver} ${plural(dailyOver, 'день', 'дня', 'дней')}</span>` : ''}
      </div>
    </div>
    ${bal ? `
    <div class="card chart-card" data-block="chartBalance">
      <div class="chart-card-head"><div class="settings-title">Остаток на счетах</div>
        <span class="chart-card-meta${balNow < 0 ? ' is-over' : ''}">${fmt(balNow)}</span></div>
      <div class="chart-box chart-box--sm"><canvas id="ch-bal" aria-label="Остаток на счетах"></canvas></div>
      <div class="chart-legend"><span><i class="lg-line"></i>Остаток</span><span><i class="lg-gold"></i>Поступления</span></div>
    </div>` : ''}`;

  const base = (extra = {}) => ({
    responsive: true, maintainAspectRatio: false,
    animation: motionOK() ? { duration: 750, easing: 'easeOutQuart' } : false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        filter: it => it.parsed.y != null && !it.dataset.aux,
        callbacks: {
          title: it => `${it[0].label} ${MONTHS_SHORT[cm - 1]}`,
          label: ctx => ` ${ctx.dataset.label}: ${fmt(Math.round(ctx.parsed.y))}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false },
        ticks: { maxRotation: 0, autoSkip: false, callback: (_v, i) => (i === 0 || (i + 1) % 5 === 0) ? i + 1 : '' } },
      y: { beginAtZero: true, grid: { color: C.border }, border: { display: false }, ticks: { maxTicksLimit: 5, callback: v => kFmt(v) } },
    },
    ...extra,
  });

  // 1) Накопительно против плана
  chartScreenCharts.push(new Chart(document.getElementById('ch-cum'), {
    type: 'line',
    data: { labels: days, datasets: [
      { label: 'Потрачено', data: cum, borderColor: C.primary, backgroundColor: withAlpha(C.primary, 0.12), fill: 'origin',
        borderWidth: 3, tension: 0.25, pointRadius: days.map(d => (isCur && d === lastDay) || d === overSince ? 5 : 0),
        pointBackgroundColor: days.map(d => overDay(d) ? C.danger : C.primary), pointBorderColor: C.surface, pointBorderWidth: 2, pointHoverRadius: 5,
        // участок выше плана — красным
        segment: { borderColor: ctx => overDay(ctx.p1DataIndex + 1) && overDay(ctx.p0DataIndex + 1) ? C.danger : C.primary } },
      ...(plan ? [{ label: 'План', data: days.map(planAt), borderColor: C.faint, borderDash: [6, 5],
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, fill: false }] : []),
      ...(showProj ? [{ label: 'Прогноз', data: days.map(d => d < lastDay ? null : Math.round(spent + perDay * (d - lastDay))),
        borderColor: withAlpha(projected > plan && plan ? C.danger : C.primary, 0.65), borderDash: [2, 5], borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 0, fill: false }] : []),
      // невидимая копия траты: заливает красным зазор между тратами и планом (dataset 1 = план)
      ...(overDays ? [{ label: 'over', aux: true, data: cum, borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, tension: 0.25,
        fill: { target: 1, above: withAlpha(C.danger, 0.22), below: 'transparent' } }] : []),
    ] },
    options: base(),
    plugins: overSince ? [overSincePlugin(overSince, C.danger, C.surface)] : [],
  }));

  // 2) По дням: столбики по участникам + дневная норма
  const dailyOpts = base();
  dailyOpts.scales.x.stacked = true; dailyOpts.scales.y.stacked = true;
  chartScreenCharts.push(new Chart(document.getElementById('ch-daily'), {
    data: { labels: days, datasets: [
      ...users.map((u, i) => ({ type: 'bar', label: u, data: days.map(d => userDay(u, d)), backgroundColor: series[i % series.length],
        borderRadius: 3, borderSkipped: false, barPercentage: 0.82, categoryPercentage: 0.9, stack: 'day' })),
      ...(plan ? [{ type: 'line', label: 'Норма в день', data: days.map(() => normDay), borderColor: C.faint,
        borderDash: [6, 5], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, stack: 'norm' }] : []),
      // красная точка над столбиком, если день дороже нормы
      ...(dailyOver ? [{ type: 'line', label: 'over', aux: true, stack: 'over', showLine: false,
        data: days.map(d => daily[d - 1] > normDay ? daily[d - 1] + maxDaily * 0.06 : null),
        pointRadius: 4, pointHoverRadius: 4, pointBackgroundColor: C.danger, pointBorderColor: C.surface, pointBorderWidth: 2,
        pointStyle: 'circle', clip: false }] : []),
    ] },
    options: dailyOpts,
  }));

  // 3) Остаток на счетах
  if (bal) {
    const balOpts = base();
    balOpts.scales.y.beginAtZero = false;
    // Шкала от минимума за месяц −5% до максимума +5% (при больших накоплениях
    // иначе колебания остатка сливаются в ровную линию)
    const bNums = days.filter(d => d <= lastDay).map(d => bal[d - 1]).filter(v => v != null);
    if (bNums.length) {
      const lo = Math.min(...bNums), hi = Math.max(...bNums);
      let yMin = lo - Math.abs(lo) * 0.05, yMax = hi + Math.abs(hi) * 0.05;
      if (yMax - yMin < 1) { yMin -= 1; yMax += 1; }
      balOpts.scales.y.min = yMin; balOpts.scales.y.max = yMax;
    }
    chartScreenCharts.push(new Chart(document.getElementById('ch-bal'), {
      type: 'line',
      data: { labels: days, datasets: [{
        label: 'Остаток', data: days.map(d => d <= lastDay ? bal[d - 1] : null), borderColor: C.primary, borderWidth: 2.5,
        tension: 0.25, fill: 'start', backgroundColor: withAlpha(C.primary, 0.10),
        segment: { borderColor: ctx => ctx.p1.parsed.y < 0 ? C.danger : C.primary },
        pointRadius: days.map(d => data.incomeDays?.[String(d)] ? 4.5 : 0),
        pointBackgroundColor: C.gold, pointBorderColor: C.surface, pointBorderWidth: 2, pointHoverRadius: 5,
      }] },
      options: balOpts,
    }));
  }
}

// Флажок «с N» на дне, когда траты ушли выше плана: пунктир вниз до оси и подпись.
function overSincePlugin(day, color, surface) {
  return {
    id: 'overSince',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      const pt = meta.data[day - 1];
      if (!pt) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.strokeStyle = withAlpha(color, 0.55);
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y + 6); ctx.lineTo(pt.x, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]);
      const text = `с ${day}`;
      ctx.font = '700 11px ' + getComputedStyle(document.body).fontFamily;
      const w = ctx.measureText(text).width + 12, h = 18;
      let x = pt.x - w / 2;
      x = Math.max(chartArea.left, Math.min(chartArea.right - w, x));
      const y = Math.max(chartArea.top, pt.y - h - 10);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 9); ctx.fill();
      ctx.fillStyle = surface; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
      ctx.restore();
    },
  };
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
    renderOAuthLinkSection();
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
    refreshSupportBadge();
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
  const ok = await uiConfirm('Включить сквозное шифрование?',
    'После включения расходы будут шифроваться на устройстве, и сервер не сможет их прочитать.\n\n' +
    'Важно: ключ хранится только на ваших устройствах. Если вы его потеряете — данные будет НЕВОЗМОЖНО восстановить. Сразу после включения сохраните ключ в надёжном месте.',
    { ok: 'Включить' });
  if (!ok) return;

  const btn = document.getElementById('btn-e2e-enable');
  if (btn) { btn.disabled = true; btn.textContent = 'Включаю…'; }
  try {
    const res = await E2E.enableE2E();
    if (res.ok) {
      pushSelfToSW();
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

async function showE2EKey(phrase) {
  const box = document.getElementById('e2e-key-box');
  const text = document.getElementById('e2e-key-text');
  if (!box || !text) return;
  const key = phrase || E2E.exportKeyHex() || '';
  const fp = key ? await E2E.fingerprintOfHex(key) : null;
  // В поле — только сам ключ (его и копируем); отпечаток — отдельной строкой
  text.textContent = key || '(ключ недоступен)';
  const fpEl = document.getElementById('e2e-key-fp');
  if (fpEl) fpEl.textContent = fp ? `Отпечаток: ${fp} — должен совпадать на всех устройствах семьи` : '';
  box.classList.remove('hidden');
}

async function doImportE2EKey() {
  const hex = await uiPrompt('Ключ с другого устройства', 'Вставьте ключ семьи (64 символа), полученный с другого устройства.', { placeholder: 'ключ семьи', ok: 'Сохранить' });
  if (!hex) return;
  const clean = E2E.extractKeyHex(hex);
  if (!clean) { showToastError('Не нашёл ключ: нужны 64 символа из цифр и букв a–f'); return; }
  // Сверяем отпечаток с ключом семьи на сервере. Чужой ключ = записи не
  // расшифруются, и синхронизация молча ломается (раньше проверки не было).
  const fp = await E2E.fingerprintOfHex(clean);
  const familyFp = await E2E.familyFingerprint();
  if (familyFp && fp && familyFp !== fp) {
    if (!(await uiConfirm('Ключ не от этой семьи', `Отпечаток введённого ключа (${fp}) не совпадает с ключом семьи (${familyFp}).\n\nЕсли всё равно сохранить — ваши записи не увидят другие участники, а их записи не увидите вы. Скопируйте фразу точь-в-точь с устройства, где данные открываются правильно.`, { ok: 'Всё равно сохранить', danger: true }))) return;
  }
  const ok = await E2E.importKeyHex(clean);
  if (!ok) { showToastError('Неверный ключ (нужно 64 hex-символа)'); return; }
  showToastSuccess('Ключ сохранён. Обновляю данные…');
  pushSelfToSW();
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
    <div id="admin-support"></div>
    <div class="admin-stats-summary">
      <div class="admin-stat-card"><div class="admin-stat-num">${stats.totalFamilies}</div><div class="admin-stat-label">семей</div></div>
      <div class="admin-stat-card"><div class="admin-stat-num">${stats.totalUsers}</div><div class="admin-stat-label">пользователей</div></div>
      <div class="admin-stat-card"><div class="admin-stat-num">${stats.users.reduce((s,u)=>s+u.expenseCount,0)}</div><div class="admin-stat-label">записей всего</div></div>
    </div>
    <div id="admin-families-stat"></div>
  `;

  (async () => {
    const box = body.querySelector('#admin-support');
    const r = await apiJson('GET', '/api/admin/support/threads').catch(() => null);
    const n = r?.unread || 0, total = r?.threads?.length || 0;
    box.innerHTML = `<button class="btn btn-secondary btn-full">Сообщения поддержки · ${total} ${plural(total, 'чат', 'чата', 'чатов')}${n ? ` <span class="count-badge">${n}</span>` : ''}</button>`;
    box.querySelector('button').addEventListener('click', () => { closeAdminPanel(); openInbox(); });
  })();

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

    // E2E-семья: плейнтекст на сервере вычищен (потому «0 зап.» у всех).
    // Показываем, что данные зашифрованы и сколько шифроблобов хранится —
    // иначе выглядит как потеря данных, хотя они целы на устройствах.
    const e2e = stats.familyE2E?.[famId];
    if (e2e?.enabled) {
      const badge = document.createElement('div');
      badge.className = 'admin-family-e2e';
      badge.style.cssText = 'margin:2px 0 8px;font-size:13px;color:var(--primary);font-weight:600';
      badge.textContent = `🔒 E2E — данные зашифрованы · ${e2e.encryptedRecords} записей на сервере`;
      block.appendChild(badge);
    }
    for (const u of members) {
      const row = document.createElement('div');
      row.className = 'admin-user-row';
      row.innerHTML = `
        <div class="admin-user-info">
          <div class="admin-user-name">${esc(u.name)} ${u.isGoogle ? '<span class="admin-badge-google">G</span>' : ''} ${u.isAdmin ? '<span class="admin-badge-admin">admin</span>' : ''}</div>
          <div class="admin-user-meta">${esc(u.login)}${u.lastDate ? ` · последний ${u.lastDate}` : ''}</div>
        </div>
        <span class="admin-stat-entries">${e2e?.enabled ? '🔒' : `${u.expenseCount} зап.`}</span>
        <button class="admin-user-del" title="Удалить"
          ${u.login === currentUser.login ? 'disabled style="opacity:.3;cursor:default"' : ''}>✕</button>
      `;
      row.querySelector('.admin-user-del').addEventListener('click', async () => {
        if (!(await uiConfirm(`Удалить пользователя ${u.name}?`, '', { ok: 'Удалить', danger: true }))) return;
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
    // Если Google отключён на сервере (RuStore-конфиг) — прячем секцию целиком
    const providers = await fetch('/api/auth/providers').then(r => r.json()).catch(() => ({}));
    const section = document.getElementById('google-account-section');
    if (!providers.google) { if (section) section.classList.add('hidden'); return; }
    if (section) section.classList.remove('hidden');

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

// Привязка Яндекс/VK к текущему аккаунту (миграция): редирект-флоу с link-токеном
async function renderOAuthLinkSection() {
  const section = document.getElementById('oauth-link-section');
  if (!section) return;
  try {
    const p = await fetch('/api/auth/providers').then(r => r.json());
    if (!p.yandex && !p.vk) { section.classList.add('hidden'); return; }
    section.classList.remove('hidden');
    document.getElementById('btn-link-yandex').style.display = p.yandex ? '' : 'none';
    document.getElementById('btn-link-vk').style.display = p.vk ? '' : 'none';
    const linkOAuth = provider => {
      const redirect = location.origin + location.pathname;
      location.href = `/auth/${provider}/mobile?redirect=${encodeURIComponent(redirect)}&link=${encodeURIComponent(token)}`;
    };
    document.getElementById('btn-link-yandex').onclick = () => linkOAuth('yandex');
    document.getElementById('btn-link-vk').onclick = () => linkOAuth('vk');
  } catch { section.classList.add('hidden'); }
}

// ─── Конструктор аналитики: блоки вкл/выкл, хранится на устройстве ───────────

// Конструктор экранов: блоки сгруппированы по вкладкам. Элементы страницы
// помечены data-block="id"; выключенные прячутся одной CSS-вставкой, так что
// это работает и для карточек, которые рисуются позже (графики).
const BLOCK_GROUPS = [
  { tab: null, title: 'Вкладки внизу', hint: 'Бюджет, Месяц и Настройки показываются всегда', items: [
    { id: 'chartTab', label: 'График', hint: 'Траты против плана, по дням, остатки, кэшфлоу' },
    { id: 'goalsTab', label: 'Цели', hint: 'Барометр, лимиты, копилки, достижения' },
  ] },
  { tab: 'summary', title: 'Месяц', items: [
    { id: 'byUser', label: 'По участникам', hint: 'Кто сколько потратил и % дохода' },
    { id: 'heatmap', label: 'Календарь трат', hint: 'Тепловая карта по дням' },
    { id: 'speed', label: 'Скорость трат', hint: '% от нормы по дням месяца' },
    { id: 'categories', label: 'Категории', hint: 'Разбивка с лимитами' },
    { id: 'family', label: 'Семейные расходы', hint: 'Сводка по всей семье' },
    { id: 'ai', label: 'ИИ-анализ и отчёт PDF', hint: 'Кнопки внизу экрана' },
  ] },
  { tab: 'chart', title: 'График', items: [
    { id: 'chartCum', label: 'Траты за месяц', hint: 'Против плана, прогноз, перерасход' },
    { id: 'chartDaily', label: 'Траты по дням', hint: 'Столбики по участникам и дневная норма' },
    { id: 'chartBalance', label: 'Остаток на счетах', hint: 'Если заполнен кэшфлоу' },
    { id: 'cashflow', label: 'Кэшфлоу', hint: 'Остатки на 1-е число и дни дохода' },
  ] },
  { tab: 'goals', title: 'Цели', items: [
    { id: 'gauge', label: 'Барометр бюджета', hint: 'Темп трат относительно нормы' },
    { id: 'limits', label: 'Лимиты по категориям', hint: 'Сколько можно тратить на категорию' },
    { id: 'goalsList', label: 'Копилки', hint: 'Цели и прогресс накоплений' },
    { id: 'achievements', label: 'Достижения', hint: 'Награды Финика' },
  ] },
];
const ALL_BLOCKS = BLOCK_GROUPS.flatMap(g => g.items.map(i => i.id));

function getBlocks() {
  const def = Object.fromEntries(ALL_BLOCKS.map(id => [id, true]));
  try { return { ...def, ...JSON.parse(localStorage.getItem('analytics_blocks') || '{}') }; }
  catch { return def; }
}

function setBlockEnabled(id, v) {
  const b = getBlocks();
  b[id] = v;
  localStorage.setItem('analytics_blocks', JSON.stringify(b));
  applyBlockVisibility();
  renderBlocksConstructor();
}

function applyBlockVisibility() {
  const b = getBlocks();
  let st = document.getElementById('blocks-style');
  if (!st) { st = document.createElement('style'); st.id = 'blocks-style'; document.head.appendChild(st); }
  st.textContent = ALL_BLOCKS.filter(id => b[id] === false).map(id => `[data-block="${id}"]{display:none!important}`).join('\n');
  const chartNav = document.querySelector('.nav-btn[data-screen="chart"]');
  const goalsNav = document.querySelector('.nav-btn[data-screen="goals"]');
  if (chartNav) chartNav.style.display = b.chartTab === false ? 'none' : '';
  if (goalsNav) goalsNav.style.display = b.goalsTab === false ? 'none' : '';
  placeClasp(false);
}

function renderBlocksConstructor() {
  const box = document.getElementById('blocks-constructor');
  if (!box) return;
  const b = getBlocks();
  const tabOff = tab => (tab === 'chart' && b.chartTab === false) || (tab === 'goals' && b.goalsTab === false);
  box.innerHTML = BLOCK_GROUPS.map(g => `
    <div class="blk-group${tabOff(g.tab) ? ' off' : ''}">
      <div class="blk-group-title">${esc(g.title)}${tabOff(g.tab) ? '<span>вкладка скрыта</span>' : ''}</div>
      ${g.hint ? `<div class="settings-hint" style="margin:-2px 0 6px">${esc(g.hint)}</div>` : ''}
      ${g.items.map(it => `
        <label class="blk-row">
          <span class="blk-text"><span class="blk-label">${esc(it.label)}</span><span class="blk-hint">${esc(it.hint)}</span></span>
          <span class="toggle-wrap">
            <input type="checkbox" class="block-toggle" data-id="${it.id}" ${b[it.id] === false ? '' : 'checked'} />
            <span class="toggle-slider"></span>
          </span>
        </label>`).join('')}
    </div>`).join('');
  box.querySelectorAll('.block-toggle').forEach(inp => {
    inp.addEventListener('change', () => setBlockEnabled(inp.dataset.id, inp.checked));
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
      if (!(await uiConfirm(`Удалить «${name}»?`, 'Все её расходы будут перенесены в «Прочее».', { ok: 'Удалить', danger: true }))) return;
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
  document.getElementById('form-date').value = localIsoDate(new Date());
  fitAmount();
  document.getElementById('parse-result').classList.add('hidden');
  document.getElementById('expense-text').value = '';
  document.querySelector('.sheet-title').textContent = 'Добавить расход';
  document.getElementById('btn-add-form').textContent = 'Добавить расход';
  document.getElementById('add-sheet').classList.remove('is-editing');
  setAiHint('');
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
  fitAmount();
  document.getElementById('form-description').value = exp.description || '';
  // Convert DD.MM.YYYY → YYYY-MM-DD for date input
  if (exp.date) {
    const [d, m, y] = exp.date.split('.');
    document.getElementById('form-date').value = `${y}-${m}-${d}`;
  }

  document.querySelector('.sheet-title').textContent = 'Редактировать расход';
  document.getElementById('btn-add-form').textContent = 'Сохранить изменения';
  document.getElementById('add-sheet').classList.add('is-editing');
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
  btn.textContent = 'Разбираю…';

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
    btn.textContent = 'Разобрать';
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

// Расход, внесённый за другого члена семьи (карта мужа, тратила жена):
// считается расходом того, за кого внесли, а подпись — «Удав за Марину»
function whoLabel(e) {
  return e.addedBy ? `${e.addedBy} за ${nameAcc(e.user || '')}` : (e.user || '');
}
// Винительный падеж имени: Марина › Марину, Антон › Антона (как в приложении)
function nameAcc(n) {
  const m = /^(.*?)([а-яё])$/i.exec(n.trim());
  if (!m) return n;
  const [, stem, last] = m, up = last !== last.toLowerCase(), l = last.toLowerCase();
  const fix = x => up ? x.toUpperCase() : x;
  if (l === 'а') return stem + fix('у');
  if (l === 'я') return stem + fix('ю');
  if (l === 'й' || l === 'ь') return stem + fix('я');
  if ('бвгджзклмнпрстфхцчшщ'.includes(l)) return n.trim() + fix('а');
  return n;
}
// Править можно своё и то, что сам внёс за другого
function isMyExpense(e) {
  return !!currentUser && (e.user === currentUser.name || e.addedBy === currentUser.name);
}

function buildExpenseItem(exp, canEdit, { showDate = false, showCategory = true, showUser = true } = {}) {
  const item = document.createElement('div');
  item.className = 'expense-item';
  item.dataset.id = exp.id;

  item.innerHTML = `
    <span class="expense-cat-icon">${CATEGORY_ICONS[exp.category] || '❓'}</span>
    <div class="expense-info">
      <div class="expense-desc">${esc(exp.description || exp.category)}</div>
      <div class="expense-meta">
        ${exp.addedBy ? `<span class="expense-user-tag">${esc(whoLabel(exp))}</span>` : showUser ? `<span class="expense-user-tag">${esc(exp.user)}</span>` : ''}
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
  if (!(await uiConfirm('Удалить этот расход?', '', { ok: 'Удалить', danger: true }))) return;
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
  btn.classList.toggle('recording', recording);
  setAiHint(recording ? 'Слушаю… говорите расходы' : '');
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
  btn.classList.add('busy');
  setAiHint('Читаю чек…');

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
    btn.classList.remove('busy');
    setAiHint('');
  }
}

// ─── TOASTS ───────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(msg, type = 'info') {
  const colors = { success: 'var(--success-soft)', error: 'var(--danger-soft)', info: 'var(--primary-soft)' };
  const borders = { success: 'var(--success)', error: 'var(--danger)', info: 'var(--primary)' };

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

  // Проверяем сессию. ВАЖНО: разлогиниваем ТОЛЬКО при реально невалидном токене
  // (401/403). При временной ошибке сети/сервера (Amvera «просыпается», плохая
  // связь) НЕ трогаем токен — иначе вход слетал «через раз». Токен живёт 30–90
  // дней, поэтому открываем приложение с последним известным пользователем.
  try {
    const meRes = await api('GET', '/api/me');
    if (meRes.status === 401 || meRes.status === 403) { logout(); return; }
    if (!meRes.ok) throw new Error('server-unavailable');
    currentUser = await meRes.json();
    localStorage.setItem('budget_user', JSON.stringify(currentUser));
  } catch {
    const cached = localStorage.getItem('budget_user');
    if (!cached) { showLogin(); return; } // токен НЕ удаляем — войдёт при сети
    try { currentUser = JSON.parse(cached); } catch { showLogin(); return; }
  }

  document.getElementById('topbar-user').textContent = currentUser.name;

  // E2E: узнаём статус семьи и подтягиваем шифрованные данные до первой отрисовки
  try {
    await E2E.init({ getToken: () => token, userName: currentUser.name });
    if (E2E.active()) await E2E.syncNow();
  } catch { /* сеть — синхронизируемся позже */ }
  pushSelfToSW();   // ключ семьи известен только после E2E.init

  showApp();
  refreshSupportUnread();
  if (new URLSearchParams(location.search).get('support')) {
    window.history.replaceState({}, '', location.pathname);
    setTimeout(() => { navigate('settings'); openSettingsPage('help'); setTimeout(() => document.getElementById('support-section')?.scrollIntoView({ block: 'center' }), 400); }, 300);
  }
  // Пуш «новое сообщение в поддержку» ведёт сюда — сразу открываем мессенджер
  if (currentUser?.isAdmin && new URLSearchParams(location.search).get('admin') === 'support') {
    window.history.replaceState({}, '', location.pathname);
    setTimeout(() => openInbox(), 300);
  }
  initSocket();
  initCategoryGrid();
  setupEventListeners();
  initGoalsScreen();
  initRecurring();
  initChat();
  ensureFinikDefs();
  mountWalkers();
  finikActivate();
  finikWander();
  if (finikEnabled()) {
    const loginFinik = document.getElementById('login-finik');
    if (loginFinik) loginFinik.innerHTML = finik('wave', 'finik-hero');
    const cap = document.getElementById('login-finik-cap');
    if (cap) cap.style.display = 'block';
    const fabAdd = document.getElementById('fab-add');
    if (fabAdd) { fabAdd.classList.add('fab--finik'); fabAdd.setAttribute('aria-label', 'Добавить расход'); fabAdd.innerHTML = finik('plus'); }
  }
  const finikToggle = document.getElementById('finik-toggle');
  if (finikToggle) {
    finikToggle.checked = finikEnabled();
    finikToggle.addEventListener('change', () => {
      localStorage.setItem('finik_enabled', finikToggle.checked ? '1' : '0');
      location.reload();
    });
  }
  initPullToRefresh();
  navigate('budget');   // load content immediately, don't wait for settings
  initHelpAndTour();
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
      fitAmount();
    });
  });
  document.getElementById('form-amount').addEventListener('input', fitAmount);
  // примеры ИИ-ввода: дописываем в поле через запятую
  document.querySelectorAll('.ai-examples .chip-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const ta = document.getElementById('expense-text');
      ta.value = ta.value.trim() ? `${ta.value.trim().replace(/,$/, '')}, ${btn.dataset.example}` : btn.dataset.example;
      ta.focus();
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
    const t = E2E.extractKeyHex(document.getElementById('e2e-key-text')?.textContent || '') || '';
    if (!t) return;
    navigator.clipboard?.writeText(t).then(() => showToastSuccess('Ключ скопирован')).catch(() => {});
  });
  document.getElementById('btn-e2e-dedupe')?.addEventListener('click', async () => {
    if (!E2E.active()) { showToastError('Доступно только при включённом шифровании'); return; }
    if (!(await uiConfirm('Убрать задвоенные расходы?', 'Оставим по одному. Изменения синхронизируются на все устройства семьи.', { ok: 'Убрать' }))) return;
    try {
      const n = await E2E.dedupeExpenses();
      showToastSuccess(n ? `Удалено дубликатов: ${n}` : 'Дубликатов не найдено');
      refreshCurrentScreen();
    } catch { showToastError('Не удалось убрать дубликаты'); }
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
    let text;
    if (E2E.active()) {
      text = E2E.exportCsv();   // в E2E считаем из локальных данных, сервер пуст
    } else {
      const res = await api('GET', '/api/export');
      if (!res.ok) { showToastError('Ошибка экспорта'); return; }
      text = await res.text();
    }
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
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

  document.getElementById('btn-custom-cat-add')?.addEventListener('click', addCustomCategoryUI);

  // Reminder close
  document.getElementById('reminder-close').addEventListener('click', () => {
    document.getElementById('reminder-toast').classList.add('hidden');
  });

  // Принудительное обновление у всех пользователей
  document.getElementById('btn-open-admin').addEventListener('click', () => openAdminPanel());
  initInbox();
  initSettingsPages();
  initThemePills();
  document.getElementById('btn-support-close')?.addEventListener('click', closeSupportThread);
  document.getElementById('btn-support-send')?.addEventListener('click', sendSupportMessage);
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
    // по графику палец ведёт тултип по дням — экран не листаем
    if (e.target.closest && e.target.closest('.chart-box, canvas, [data-noswipe]')) { active = false; return; }
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

// крупная сумма растёт по ширине цифр, знак ₽ едет следом
function fitAmount() {
  const el = document.getElementById('form-amount');
  if (el) el.style.width = `${Math.max(1, String(el.value || '0').length) + 0.6}ch`;
}
function localIsoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// подсказка под полем ИИ-ввода: пустая строка возвращает текст по умолчанию
function setAiHint(text) {
  const el = document.getElementById('ai-input-hint');
  if (el) el.textContent = text || 'ИИ разберёт суммы, категории и даты';
}

function switchAddTab(tab) {
  document.getElementById('tab-text').classList.toggle('active', tab === 'text');
  document.getElementById('tab-form').classList.toggle('active', tab === 'form');
  document.querySelector('#add-sheet .seg')?.classList.toggle('seg--right', tab === 'form');
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
  const fEl = document.getElementById('ach-finik');
  if (fEl) fEl.innerHTML = finik(cnt > 0 ? 'goal' : 'idle', 'finik-sm');
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
    container.innerHTML = '<div class="empty-state">Укажите плановые расходы: Настройки › «Семья и бюджет» — тогда барометр бюджета заработает</div>';
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

// ─── Спидометр темпа трат ─────────────────────────────────────────────────────
// Полукруг 180°, шкала 0–150% от нормы трат на сегодня. Зоны совпадают с
// ИИ-анализом: ≤85% — экономим, 85–100% — в графике, 100–110% — выше плана,
// >110% — перерасход.
// Стрелка — недодемпфированная пружина (разгон, лёгкий перелёт, успокоение);
// при перерасходе мелко дрожит, за пределом шкалы бьётся об ограничитель.
const GAUGE = { CX: 120, CY: 118, R: 90, SW: 14, MAX: 150, LOW: 85, PLAN: 100, HIGH: 110 };
function gaugeZone(p) {
  if (p <= GAUGE.LOW)  return { key: 'good', color: cssVar('--success'), verdict: 'Экономим', emo: 'income' };
  if (p <= GAUGE.PLAN) return { key: 'ok',   color: cssVar('--primary'), verdict: 'В графике', emo: 'idle' };
  if (p <= GAUGE.HIGH) return { key: 'warn', color: cssVar('--warning'), verdict: 'Выше плана', emo: 'overspend' };
  return { key: 'over', color: cssVar('--danger'), verdict: 'Перерасход', emo: 'scold' };
}
// угол (градусы, математический, против часовой от +x) для значения шкалы
const gaugeAngle = v => 180 - (Math.max(0, Math.min(GAUGE.MAX, v)) / GAUGE.MAX) * 180;
function gaugePt(v, r) {
  const t = gaugeAngle(v) * Math.PI / 180;
  return [GAUGE.CX + r * Math.cos(t), GAUGE.CY - r * Math.sin(t)];
}
function gaugeArc(v1, v2, r) {
  const [x1, y1] = gaugePt(v1, r), [x2, y2] = gaugePt(v2, r);
  const large = (gaugeAngle(v1) - gaugeAngle(v2)) > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function renderSpeedometer(container, spent, expectedByNow, plannedMonthly, ratio, daysElapsed, daysInMonth) {
  const { CX, CY, R, SW, MAX, LOW, PLAN, HIGH } = GAUGE;
  const pct = Math.round(ratio * 100);
  const zone = gaugeZone(pct);
  const projected = daysElapsed > 0 ? Math.round(spent / daysElapsed * daysInMonth) : spent;
  const ink = cssVar('--text'), faint = cssVar('--text-faint'), track = cssVar('--surface-3');

  // деления: мелкие каждые 10%, крупные с подписями — 0/50/100/150
  let ticks = '';
  for (let v = 0; v <= MAX; v += 10) {
    const major = v % 50 === 0;
    const [x1, y1] = gaugePt(v, R + SW / 2 + 3), [x2, y2] = gaugePt(v, R + SW / 2 + (major ? 10 : 6));
    ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${major ? ink : faint}" stroke-width="${major ? 2 : 1.2}" stroke-linecap="round" opacity="${major ? 0.55 : 0.5}"/>`;
    if (major) {
      // крайние подписи — под концами дуги, остальные — снаружи шкалы
      const end = v === 0 || v === MAX;
      const [lx, ly] = end ? [v === 0 ? CX - R : CX + R, CY + SW / 2 + 14] : gaugePt(v, R + SW / 2 + 21);
      ticks += `<text x="${lx.toFixed(1)}" y="${(ly + (end ? 0 : 3.5)).toFixed(1)}" text-anchor="middle" class="gauge-label${v === 100 ? ' gauge-plan' : ''}">${v}%</text>`;
    }
  }
  // «застёжка» прямо на дорожке шкалы у отметки 100% = план
  const [kx, ky] = gaugePt(100, R);
  const ka = (90 - gaugeAngle(100)) * Math.PI / 180;       // касательная к дуге
  const kdx = 4.2 * Math.cos(ka), kdy = 4.2 * Math.sin(ka);
  const zoneBand = (a, b, c) => `<path d="${gaugeArc(a, b, R - SW / 2 - 3)}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" opacity="0.75"/>`;

  container.innerHTML = `
    <div class="gauge">
      <svg viewBox="0 0 240 170" class="speedometer-svg" role="img" aria-label="Темп трат: ${pct}% от нормы, ${zone.verdict.toLowerCase()}">
        <path d="${gaugeArc(0, MAX, R)}" fill="none" stroke="${track}" stroke-width="${SW}" stroke-linecap="round"/>
        ${zoneBand(1, LOW - 1.5, cssVar('--success'))}${zoneBand(LOW + 1.5, PLAN - 1.5, cssVar('--primary'))}${zoneBand(PLAN + 1.5, HIGH - 1.5, cssVar('--warning'))}${zoneBand(HIGH + 1.5, MAX - 1, cssVar('--danger'))}
        <path class="gauge-value" d="${gaugeArc(0, MAX, R)}" pathLength="100" fill="none" stroke="${zone.color}" stroke-width="${SW}" stroke-linecap="round" stroke-dasharray="0 100"/>
        ${ticks}
        <g class="gauge-clasp" stroke="${cssVar('--surface')}" stroke-width="1.6">
          <circle cx="${(kx - kdx).toFixed(1)}" cy="${(ky - kdy).toFixed(1)}" r="3.6" fill="${cssVar('--gold')}"/>
          <circle cx="${(kx + kdx).toFixed(1)}" cy="${(ky + kdy).toFixed(1)}" r="3.6" fill="${cssVar('--gold')}"/>
        </g>
        <g class="gauge-needle" transform="rotate(0 ${CX} ${CY})">
          <path d="M ${CX - 5} ${CY} L ${CX - 1} ${CY - R + 22} Q ${CX} ${CY - R + 19} ${CX + 1} ${CY - R + 22} L ${CX + 5} ${CY} Z" fill="${ink}"/>
        </g>
        <circle cx="${CX}" cy="${CY}" r="9" fill="${cssVar('--surface')}" stroke="${ink}" stroke-width="2.5"/>
        <circle cx="${CX}" cy="${CY}" r="3.2" fill="${cssVar('--gold')}"/>
        <text x="${CX}" y="${CY + 36}" text-anchor="middle" class="gauge-value-text" fill="${zone.color}">${pct}%</text>
        <text x="${CX}" y="${CY + 50}" text-anchor="middle" class="gauge-caption">от нормы трат на сегодня</text>
      </svg>
      <div class="bablometr-verdict-row">
        ${finik(zone.emo, 'finik-md', 'bar-finik')}
        <div class="speedometer-verdict gauge-chip gauge-chip--${zone.key}">${zone.verdict}</div>
      </div>
      <div class="bablometr-stats">
        <div class="bablometr-stat"><span class="bablometr-stat-label">Потрачено</span><span class="bablometr-stat-value">${fmt(spent)}</span></div>
        <div class="bablometr-stat"><span class="bablometr-stat-label">Норма на сегодня</span><span class="bablometr-stat-value">${fmt(expectedByNow)}</span></div>
        <div class="bablometr-stat"><span class="bablometr-stat-label">Прогноз на месяц</span><span class="bablometr-stat-value ${projected > plannedMonthly ? 'is-over' : ''}">${fmt(projected)}</span></div>
      </div>
      <div class="gauge-foot">День ${daysElapsed} из ${daysInMonth} · план на месяц ${fmt(plannedMonthly)}</div>
    </div>`;

  animateGauge(container, pct, zone);

  // помахал лапами — и перешёл в угрюмое стояние
  if (zone.key === 'over') {
    const svg = container.querySelector('.bar-finik .finik-svg');
    if (svg) setTimeout(() => { if (svg.isConnected) svg.setAttribute('data-emotion', 'grumpy'); }, 2300);
  }
}

// Физика стрелки: пружина с затуханием (ζ≈0.42) от прошлого значения к новому.
function animateGauge(container, pct, zone) {
  const needle = container.querySelector('.gauge-needle');
  const arcEl = container.querySelector('.gauge-value');
  const valEl = container.querySelector('.gauge-value-text');
  const { CX, CY, MAX } = GAUGE;
  const target = Math.min(pct, MAX);
  const pinned = pct > MAX;               // за пределом шкалы — упирается в ограничитель
  const from = Number(container.dataset.gauge || 0);
  container.dataset.gauge = target;
  const draw = (v, shownPct) => {
    const clamped = Math.max(0, Math.min(MAX, v));
    needle.setAttribute('transform', `rotate(${(clamped / MAX * 180 - 90).toFixed(2)} ${CX} ${CY})`);
    arcEl.setAttribute('stroke-dasharray', `${(clamped / MAX * 100).toFixed(2)} 100`);
    valEl.textContent = `${Math.round(shownPct)}%`;
  };
  if (!motionOK()) { draw(target, pct); return; }

  const w = 8.5, zeta = 0.42;            // собственная частота и затухание
  let x = from, vel = 0, last = performance.now(), t0 = last;
  const tick = now => {
    if (!needle.isConnected) return;
    const dt = Math.min(0.032, (now - last) / 1000); last = now;
    const acc = -2 * zeta * w * vel - w * w * (x - target);
    vel += acc * dt; x += vel * dt;
    // об ограничитель: отскок с потерей энергии
    if (x > MAX) { x = MAX; vel = -Math.abs(vel) * 0.35; }
    if (x < 0) { x = 0; vel = Math.abs(vel) * 0.35; }
    const settled = Math.abs(x - target) < 0.05 && Math.abs(vel) < 0.05;
    const k = Math.min(1, (now - t0) / 900);
    const shown = from + (pct - from) * (1 - Math.pow(1 - k, 3));
    // при перерасходе — мелкая дрожь, как на холостых оборотах
    const jitter = zone.key === 'over' && settled ? Math.sin(now / 55) * 0.35 + Math.sin(now / 23) * 0.2 - (pinned ? 0.6 : 0) : 0;
    draw(x + jitter, shown);
    if (!settled || zone.key === 'over') requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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
    // через apiJson — в E2E считается локально (иначе сервер отдаёт пусто)
    let chartData;
    try { chartData = await apiJson('GET', `/api/unified-chart-data/${ym}`); }
    catch { chartData = {}; }
    const userExpenses = (chartData && chartData.userExpenses) || {};
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
      if (v === null) return withAlpha(cssVar('--text-faint'), 0.5);
      if (v <= GAUGE.LOW) return cssVar('--success');
      if (v <= GAUGE.PLAN) return cssVar('--primary');
      if (v <= GAUGE.HIGH) return cssVar('--warning');
      return cssVar('--danger');
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
      <span class="feed-user">${esc(whoLabel(e))}</span>
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
  if (!(await uiConfirm('Удалить копилку?', '', { ok: 'Удалить', danger: true }))) return;
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

// ─── RECURRING / РЕГУЛЯРНЫЕ ПЛАТЕЖИ ─────────────────────────────────────────────
// Логика 1:1 с android/src/recurring.ts — меняешь тут, меняй там.
const REC_WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']; // getDay(): 0 = воскресенье
const REC_WEEKDAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];               // Пн … Вс
const REC_FREQ_LABEL = { daily: 'Каждый день', weekly: 'По дням недели', monthly: 'Каждый месяц' };
const REC_DAY_PRESETS = [
  { label: 'Будни', days: [1, 2, 3, 4, 5] },
  { label: 'Выходные', days: [0, 6] },
  { label: 'Каждый день', days: [1, 2, 3, 4, 5, 6, 0] },
];
const recPad = n => String(n).padStart(2, '0');
const recYmd = d => `${d.getFullYear()}-${recPad(d.getMonth() + 1)}-${recPad(d.getDate())}`;
const recYm = d => `${d.getFullYear()}-${recPad(d.getMonth() + 1)}`;
const recFreqOf = i => i.freq || 'monthly';
const recTimesOf = i => Math.max(1, i.times || 1);

function recWeekdaysOf(item) {
  if (item.days && item.days.length) return item.days;
  if (recFreqOf(item) === 'weekly') return [item.day];
  return [];
}
function recPeriodKey(item, now) {
  return recFreqOf(item) === 'monthly' ? recYm(now) : recYmd(now);
}
function recDueToday(item, now) {
  if (recFreqOf(item) === 'weekly') return recWeekdaysOf(item).includes(now.getDay());
  return true;
}
function recPaidInPeriod(item, now) {
  if (item.lastPaid !== recPeriodKey(item, now)) return 0;
  return item.paidCount != null ? item.paidCount : recTimesOf(item);
}
function recRemaining(item, now) {
  if (recFreqOf(item) === 'weekly' && !recDueToday(item, now)) return 0;
  return Math.max(0, recTimesOf(item) - recPaidInPeriod(item, now));
}
function recDueDate(item, now) {
  let d;
  if (recFreqOf(item) === 'monthly') {
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    d = new Date(now.getFullYear(), now.getMonth(), Math.min(Math.max(item.day, 1), dim));
  } else {
    d = now;
  }
  return `${recPad(d.getDate())}.${recPad(d.getMonth() + 1)}.${d.getFullYear()}`;
}
function recDaysUntil(item, now) {
  if (recFreqOf(item) !== 'monthly') return 0;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.min(item.day, dim) - now.getDate();
}
function recDueLabel(item, now) {
  const rem = recRemaining(item, now);
  if (recFreqOf(item) !== 'monthly') return rem > 1 ? `сегодня · осталось ${rem}` : 'сегодня';
  const diff = recDaysUntil(item, now);
  const base = diff === 0 ? 'сегодня' : diff > 0 ? `через ${diff} дн.` : `просрочено ${-diff} дн.`;
  return rem > 1 ? `${base} · осталось ${rem}` : base;
}
function recFormatDays(days) {
  const set = new Set(days);
  if (set.size >= 7) return 'каждый день';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'по будням';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'по выходным';
  const names = REC_WEEKDAYS_ORDER.filter(d => set.has(d)).map(d => REC_WEEKDAYS[d]);
  return 'по ' + (names.join(', ') || '—');
}
function recScheduleLabel(item) {
  const f = recFreqOf(item), t = recTimesOf(item);
  const times = t > 1 ? ` ×${t}` : '';
  if (f === 'daily') return `каждый день${times}`;
  if (f === 'weekly') return `${recFormatDays(recWeekdaysOf(item))}${times}`;
  return `${item.day}-го${times}`;
}

// ─── Автопоиск повторяющихся платежей (локально, приватно, работает с E2E) ──────
const recNorm = s => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const REC_DAY_MS = 86400000;
function recParseDMY(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s || '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
function recMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function recMedian(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function recModeNum(arr) {
  const c = new Map(); let best = arr[0], bestN = 0;
  for (const v of arr) { const n = (c.get(v) || 0) + 1; c.set(v, n); if (n > bestN) { bestN = n; best = v; } }
  return best;
}
function recModeStr(arr) {
  const c = new Map(); let best = arr[0] || '', bestN = 0;
  for (const v of arr) { const n = (c.get(v) || 0) + 1; c.set(v, n); if (n > bestN) { bestN = n; best = v; } }
  return best;
}
const recDkey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
function recSuggestionKey(name, category, amount) { return `${recNorm(name)}|${category}|${amount}`; }

function recClassify(dates) {
  const seen = new Set();
  const distinct = dates.filter(d => { const k = recDkey(d); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.getTime() - b.getTime());
  if (distinct.length < 3) return null;
  const range = Math.round((distinct[distinct.length - 1].getTime() - distinct[0].getTime()) / REC_DAY_MS);
  if (range < 5) return null;

  const months = new Set(distinct.map(d => `${d.getFullYear()}-${d.getMonth()}`));
  if (months.size >= 3 && distinct.length <= months.size * 1.6) {
    const dom = distinct.map(d => d.getDate());
    const day = recModeNum(dom);
    if (dom.filter(x => Math.abs(x - day) <= 3).length >= dom.length * 0.7) {
      return { freq: 'monthly', day, days: [], times: Math.max(1, Math.round(dates.length / months.size)) };
    }
  }

  const weeks = new Set(distinct.map(d => recDkey(recMonday(d))));
  if (weeks.size < 2) return null;
  const wdWeeks = new Map();
  for (const d of distinct) {
    const wd = d.getDay();
    if (!wdWeeks.has(wd)) wdWeeks.set(wd, new Set());
    wdWeeks.get(wd).add(recDkey(recMonday(d)));
  }
  const active = [];
  for (const [wd, wset] of wdWeeks) if (wset.size / weeks.size >= 0.5) active.push(wd);
  if (active.length === 0) return null;

  const perDate = new Map();
  for (const d of dates) {
    if (!active.includes(d.getDay())) continue;
    perDate.set(recDkey(d), (perDate.get(recDkey(d)) || 0) + 1);
  }
  const times = Math.max(1, Math.round(recMedian([...perDate.values()])));
  if (active.length >= 7) return { freq: 'daily', day: 0, days: [], times };
  const days = REC_WEEKDAYS_ORDER.filter(w => active.includes(w));
  return { freq: 'weekly', day: days[0], days, times };
}

function recDetect(expenses, existing, minCount = 3, dismissed = []) {
  const skip = new Set([...existing.map(i => recSuggestionKey(i.name, i.category, i.amount)), ...dismissed]);
  const groups = new Map(), meta = new Map();
  for (const e of expenses) {
    const d = recParseDMY(e.date);
    if (!d || !(e.amount > 0)) continue;
    const name = (e.description || e.category || '').trim();
    if (!name) continue;
    const key = recSuggestionKey(name, e.category, e.amount);
    if (!groups.has(key)) { groups.set(key, []); meta.set(key, { name, category: e.category, amount: e.amount }); }
    groups.get(key).push({ d, user: e.user });
  }
  const out = [];
  for (const [key, arr] of groups) {
    if (arr.length < minCount || skip.has(key)) continue;
    const detected = recClassify(arr.map(x => x.d));
    if (!detected) continue;
    const m = meta.get(key);
    out.push({ key, name: m.name, amount: m.amount, category: m.category, user: recModeStr(arr.map(x => x.user)), count: arr.length, ...detected });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 8);
}

let recItems = [];
let recEditId = null;
let recFreq = 'monthly';
let recBusy = false;
let recSuggestions = [];
let recDismissed = [];
let recScanning = false;
let recScanned = false;

async function loadRecurring() {
  try { recItems = await apiJson('GET', '/api/recurring'); } catch { recItems = []; }
  if (!Array.isArray(recItems)) recItems = [];
  renderRecurring();
}

async function recPersist() {
  try { await apiJson('PUT', '/api/recurring', recItems); }
  catch { showToastInfo('Не удалось сохранить'); }
}

function recDueClass(item, now) {
  if (recFreqOf(item) === 'daily') return '';
  const diff = recDaysUntil(item, now);
  return diff < 0 ? 'due-over' : diff <= 1 ? 'due-soon' : '';
}

function renderRecurring() {
  const now = new Date();
  const upEl = document.getElementById('rec-upcoming');
  const listEl = document.getElementById('rec-list');

  const upcoming = recItems
    .filter(i => i.active && recRemaining(i, now) > 0)
    .sort((a, b) => recDaysUntil(a, now) - recDaysUntil(b, now) || a.name.localeCompare(b.name));

  upEl.innerHTML = upcoming.length ? `<div class="rec-card">
    <div class="rec-card-title">🔁 К оплате</div>
    ${upcoming.map(i => `<div class="rec-row">
      <span class="rec-ico">${CATEGORY_ICONS[i.category] || '❓'}</span>
      <span class="rec-main">
        <div class="rec-name">${esc(i.name)}</div>
        <div class="rec-sub ${recDueClass(i, now)}">${recDueLabel(i, now)}</div>
      </span>
      <span class="rec-amt">${fmt(i.amount)}</span>
      <button class="rec-pay" data-pay="${i.id}"${recBusy ? ' disabled' : ''}>Внести</button>
    </div>`).join('')}
  </div>` : '';

  listEl.innerHTML = `<div class="rec-card">
    <div class="rec-card-title">Все платежи</div>
    ${recItems.length ? recItems.map(i => `<div class="rec-row">
      <span class="rec-ico ${i.active ? '' : 'off'}">${CATEGORY_ICONS[i.category] || '❓'}</span>
      <span class="rec-main" data-edit="${i.id}" style="cursor:pointer">
        <div class="rec-name ${i.active ? '' : 'off'}">${esc(i.name)}</div>
        <div class="rec-sub">${recScheduleLabel(i)} · ${esc(i.category)}${i.user ? ' · ' + esc(i.user) : ''}${i.active ? '' : ' · выкл'}</div>
      </span>
      <span class="rec-amt ${i.active ? '' : 'off'}">${fmt(i.amount)}</span>
      <span class="rec-actions"><button class="rec-del" data-del="${i.id}" title="Удалить" aria-label="Удалить платёж">🗑</button></span>
    </div>`).join('') : '<div class="rec-empty">Пока пусто. Добавьте подписку, аренду, проездной или что-то ежедневное.</div>'}
  </div>`;

  upEl.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => recPay(b.dataset.pay)));
  listEl.querySelectorAll('[data-edit]').forEach(e => e.addEventListener('click', () => openRecModal(e.dataset.edit)));
  listEl.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => recDelete(b.dataset.del)));
  renderRecSuggestions();
}

function renderRecSuggestions() {
  const el = document.getElementById('rec-suggestions');
  if (!el) return;
  const btn = `<button id="rec-scan" class="btn btn-primary btn-full"${recScanning ? ' disabled' : ''}>${recScanning ? 'Сканирую…' : '🔍 Найти повторяющиеся'}</button>`;
  let body = '';
  if (recSuggestions.length) {
    body = recSuggestions.map(s => `<div class="rec-row rec-suggest">
      <span class="rec-ico">${CATEGORY_ICONS[s.category] || '❓'}</span>
      <span class="rec-main">
        <div class="rec-name">${esc(s.name)} · ${fmt(s.amount)}</div>
        <div class="rec-sub">${recScheduleLabel(s)} · встречалось ${s.count}×</div>
        <div class="rec-suggest-actions">
          <button class="rec-pay" data-add="${esc(s.key)}">Добавить</button>
          <button class="rec-skip" data-skip="${esc(s.key)}">Скрыть</button>
        </div>
      </span>
    </div>`).join('');
  } else if (recScanned) {
    body = '<div class="rec-empty">Новых повторяющихся платежей не нашлось — либо истории мало, либо всё уже оформлено.</div>';
  }
  el.innerHTML = `<div class="rec-card">
    <div class="rec-card-title">🔍 Автопоиск</div>
    <div class="rec-scan-hint">Просмотрю расходы за 3 месяца и предложу оформить регулярные. Всё считается на устройстве.</div>
    ${btn}
    ${body}
  </div>`;
  const scanBtn = document.getElementById('rec-scan');
  if (scanBtn) scanBtn.addEventListener('click', recScan);
  el.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => recAddSuggestion(b.dataset.add)));
  el.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => recDismissSuggestion(b.dataset.skip)));
}

async function recScan() {
  recScanning = true; renderRecSuggestions();
  try {
    const base = new Date();
    const months = [0, 1, 2].map(k => {
      const d = new Date(base.getFullYear(), base.getMonth() - k, 1);
      return { m: d.getMonth() + 1, y: d.getFullYear() };
    });
    const lists = await Promise.all(months.map(({ m, y }) =>
      apiJson('GET', `/api/expenses/month?month=${m}&year=${y}`)
        .then(r => Array.isArray(r) ? r : (r.expenses || [])).catch(() => [])));
    recSuggestions = recDetect(lists.flat(), recItems, 3, recDismissed);
    recScanned = true;
  } catch { showToastInfo('Не удалось просканировать'); }
  finally { recScanning = false; renderRecSuggestions(); }
}

function recAddSuggestion(key) {
  const s = recSuggestions.find(x => x.key === key);
  if (!s) return;
  recItems.push({
    id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    name: s.name, amount: s.amount, category: s.category, user: s.user || (currentUser && currentUser.name) || '',
    active: true, freq: s.freq, day: s.day, days: s.days, times: s.times,
  });
  recSuggestions = recSuggestions.filter(x => x.key !== key);
  recPersist();
  renderRecurring();
}

function recDismissSuggestion(key) {
  recDismissed.push(key);
  recSuggestions = recSuggestions.filter(x => x.key !== key);
  renderRecSuggestions();
}

async function recPay(id) {
  const item = recItems.find(i => i.id === id);
  if (!item || recBusy) return;
  recBusy = true; renderRecurring();
  try {
    const date = recDueDate(item, new Date());
    await apiJson('POST', '/api/expenses', { expenses: [{ date, category: item.category, amount: item.amount, description: item.name }] });
    const now = new Date();
    item.lastPaid = recPeriodKey(item, now);
    item.paidCount = recPaidInPeriod(item, now) + 1;
    await recPersist();
  } catch { showToastInfo('Не удалось внести'); }
  finally { recBusy = false; renderRecurring(); }
}

async function recDelete(id) {
  const item = recItems.find(i => i.id === id);
  if (!item) return;
  if (!(await uiConfirm(`Удалить «${item.name}»?`, '', { ok: 'Удалить', danger: true }))) return;
  recItems = recItems.filter(i => i.id !== id);
  recPersist();
  renderRecurring();
}

let recDays = [1, 2, 3, 4, 5];

function recRenderDays() {
  const presetsEl = document.getElementById('rec-weekday-presets');
  presetsEl.innerHTML = REC_DAY_PRESETS.map((p, idx) => `<button type="button" class="rec-preset" data-preset="${idx}">${p.label}</button>`).join('');
  presetsEl.querySelectorAll('[data-preset]').forEach(b =>
    b.addEventListener('click', () => { recDays = REC_DAY_PRESETS[+b.dataset.preset].days.slice(); recRenderDays(); }));

  const daysEl = document.getElementById('rec-weekday');
  daysEl.innerHTML = REC_WEEKDAYS_ORDER.map(w =>
    `<button type="button" class="rec-day${recDays.includes(w) ? ' active' : ''}" data-day="${w}">${REC_WEEKDAYS[w]}</button>`).join('');
  daysEl.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => {
    const w = +b.dataset.day;
    recDays = recDays.includes(w) ? recDays.filter(x => x !== w) : [...recDays, w];
    recRenderDays();
  }));
}

function recSetFreq(f) {
  recFreq = f;
  if (f === 'weekly' && recDays.length === 0) recDays = [1, 2, 3, 4, 5];
  document.querySelectorAll('#rec-freq button').forEach(b => b.classList.toggle('active', b.dataset.freq === f));
  document.getElementById('rec-weekday-group').classList.toggle('hidden', f !== 'weekly');
  document.getElementById('rec-monthday-group').classList.toggle('hidden', f !== 'monthly');
}

function openRecModal(id) {
  recEditId = id || null;
  const item = id ? recItems.find(i => i.id === id) : null;

  // Категории
  const catSel = document.getElementById('rec-category');
  catSel.innerHTML = Object.keys(CATEGORY_ICONS).map(c => `<option value="${esc(c)}">${CATEGORY_ICONS[c]} ${esc(c)}</option>`).join('');
  // Плательщики
  const members = Array.from(new Set([currentUser && currentUser.name, ...recItems.map(i => i.user)].filter(Boolean)));
  const paySel = document.getElementById('rec-payer');
  paySel.innerHTML = members.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  document.getElementById('rec-payer-group').classList.toggle('hidden', members.length <= 1);

  recDays = item && recFreqOf(item) === 'weekly' ? recWeekdaysOf(item).slice() : [1, 2, 3, 4, 5];
  document.getElementById('rec-modal-title').textContent = item ? 'Изменить платёж' : 'Новый платёж';
  document.getElementById('rec-name').value = item ? item.name : '';
  document.getElementById('rec-amount').value = item ? item.amount : '';
  document.getElementById('rec-times').value = item ? recTimesOf(item) : 1;
  document.getElementById('rec-monthday').value = item && recFreqOf(item) === 'monthly' ? item.day : 1;
  document.getElementById('rec-active').checked = item ? item.active : true;
  catSel.value = item ? item.category : Object.keys(CATEGORY_ICONS)[0];
  if (members.length) paySel.value = item && item.user ? item.user : (currentUser && currentUser.name) || members[0];
  recSetFreq(item ? recFreqOf(item) : 'monthly');
  recRenderDays();

  document.getElementById('rec-modal-overlay').classList.remove('hidden');
  document.getElementById('rec-modal').classList.add('open');
}

function closeRecModal() {
  document.getElementById('rec-modal-overlay').classList.add('hidden');
  document.getElementById('rec-modal').classList.remove('open');
}

function recSaveModal() {
  const name = document.getElementById('rec-name').value.trim();
  const amount = parseInt(String(document.getElementById('rec-amount').value).replace(/[^\d]/g, '')) || 0;
  const times = Math.max(1, parseInt(document.getElementById('rec-times').value) || 1);
  if (!name) { showToastInfo('Введите название'); return; }
  if (amount <= 0) { showToastInfo('Введите сумму'); return; }

  if (recFreq === 'weekly' && recDays.length === 0) { showToastInfo('Выберите хотя бы один день недели'); return; }
  const days = recFreq === 'weekly' ? REC_WEEKDAYS_ORDER.filter(w => recDays.includes(w)) : [];
  let day;
  if (recFreq === 'weekly') day = days[0];
  else if (recFreq === 'monthly') day = Math.min(Math.max(parseInt(document.getElementById('rec-monthday').value) || 1, 1), 31);
  else day = 0;

  const base = {
    name, amount, times, freq: recFreq, day, days,
    category: document.getElementById('rec-category').value,
    user: document.getElementById('rec-payer').value || (currentUser && currentUser.name) || '',
    active: document.getElementById('rec-active').checked,
  };

  if (recEditId) {
    recItems = recItems.map(i => i.id === recEditId ? { ...i, ...base } : i);
  } else {
    recItems.push({ id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8), ...base });
  }
  recPersist();
  closeRecModal();
  renderRecurring();
}

function initRecurring() {
  document.getElementById('btn-open-recurring').addEventListener('click', () => navigate('recurring'));
  document.getElementById('rec-back').addEventListener('click', () => navigate('settings'));
  document.getElementById('rec-add').addEventListener('click', () => openRecModal(null));
  document.getElementById('rec-modal-close').addEventListener('click', closeRecModal);
  document.getElementById('rec-modal-overlay').addEventListener('click', closeRecModal);
  document.getElementById('rec-save').addEventListener('click', recSaveModal);
  document.querySelectorAll('#rec-freq button').forEach(b => b.addEventListener('click', () => recSetFreq(b.dataset.freq)));
}

// ─── ПОМОЩЬ: ВОПРОСЫ И ОТВЕТЫ ─────────────────────────────────────────────────
// Тексты держим в паре с android/src/components/HelpScreen.tsx (там — про приложение).
const HELP_SECTIONS = [
  { title: 'Начало работы', items: [
    { q: 'Как внести расход?', a: 'Нажмите Финика с «+» внизу экрана. Во вкладке «Текстом» пишите как в мессенджере: «кофе 180, вчера такси 450» — ИИ сам разберёт суммы, категории и даты. Рядом с полем — микрофон (надиктовать) и камера (сфотографировать чек). Во вкладке «Вручную» — крупная сумма, быстрые суммы, категория и дата.' },
    { q: 'Как посмотреть другой день или месяц?', a: 'Листайте экран пальцем влево-вправо или жмите стрелки ◀ ▶ у даты. На графиках палец не листает экран, а ведёт подсказку по дням — так удобно смотреть траты за конкретное число.' },
    { q: 'Как исправить или удалить расход?', a: 'У своих расходов в ленте есть кнопки ✏️ и 🗑. Правка открывает то же окно ввода, уже заполненное.' },
    { q: 'Как установить на телефон?', a: 'iPhone: откройте сайт в Safari → «Поделиться» → «На экран „Домой“». Android: меню браузера → «Установить приложение» — или скачайте ФИНИК из RuStore. Компьютер: значок установки в адресной строке Chrome/Edge.' },
  ] },
  { title: 'Семья', items: [
    { q: 'Как добавить близких?', a: 'Настройки › «Семья и бюджет» › «Пригласить в семью» › отправьте ссылку. Открыть её можно с любого устройства: iPhone, Android или компьютера. После входа все видят общий бюджет в реальном времени.' },
    { q: 'Что за фильтр «Все / Я / Партнёр»?', a: 'На экране «Бюджет» можно смотреть траты всей семьи вместе или каждого отдельно. Цвета участников одинаковые во всех графиках.' },
  ] },
  { title: 'Барометр и графики', items: [
    { q: 'Что показывает барометр бюджета?', a: 'Сколько потрачено относительно нормы на сегодняшний день: если план 90 000 ₽ и прошла треть месяца, норма — 30 000 ₽. Зоны шкалы: до 85% — «Экономим» (зелёная), 85–100% — «В графике», 100–110% — «Выше плана» (жёлтая, Финик волнуется), больше 110% — «Перерасход» (красная, Финик ворчит). Золотая застёжка на шкале — отметка плана, 100%.' },
    { q: 'Как читать график трат?', a: 'Верхний график — сколько потрачено с начала месяца (сплошная линия) против плана (пунктир), точками — прогноз до конца месяца. Где траты выше плана, линия и заливка становятся красными, а флажок «с N» отмечает день, когда начался перерасход. Ниже — траты по дням с дневной нормой: красная точка над столбиком — день дороже нормы.' },
    { q: 'Где задать план?', a: 'Настройки › «Семья и бюджет» › «Плановый бюджет». Лимиты по отдельным категориям — на экране «Цели».' },
    { q: 'Как убрать лишние графики и блоки?', a: 'Настройки › «Внешний вид и экраны». Блоки сгруппированы по вкладкам — Месяц, График, Цели; там же можно скрыть сами вкладки. Настройка своя на каждом устройстве.' },
  ] },
  { title: 'Приватность и поддержка', items: [
    { q: 'Что даёт шифрование?', a: 'Настройки › «Безопасность и данные». Расходы шифруются прямо на устройстве, сервер хранит только непрозрачные данные. Ключ есть только у вас — сохраните его: без ключа данные не восстановить.' },
    { q: 'Светлая и тёмная тема', a: 'Настройки › «Внешний вид и экраны»: как в системе, светлая или тёмная.' },
    { q: 'Как написать разработчику?', a: 'Настройки › «Помощь и поддержка». Сообщение придёт напрямую разработчику, а ответ появится там же — на вкладке «Настройки» загорится точка.' },
  ] },
];

function renderHelp() {
  const body = document.getElementById('help-body');
  body.innerHTML = `
    <p class="settings-hint">Коротко о том, как всё устроено. Нажмите на вопрос, чтобы раскрыть ответ.</p>
    ${HELP_SECTIONS.map(sec => `
      <div class="help-sec">
        <div class="settings-title">${esc(sec.title)}</div>
        ${sec.items.map(it => `
          <details class="help-item"><summary>${esc(it.q)}</summary><p>${esc(it.a)}</p></details>`).join('')}
      </div>`).join('')}
    <button class="btn btn-outline btn-full" id="help-tour">Пройти вводный тур заново</button>`;
  body.querySelector('#help-tour').addEventListener('click', () => { closeHelp(); startTour(); });
}
function openHelp() {
  renderHelp();
  document.getElementById('help-sheet').classList.add('open');
  document.getElementById('help-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeHelp() {
  document.getElementById('help-sheet').classList.remove('open');
  document.getElementById('help-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── ВВОДНЫЙ ТУР ──────────────────────────────────────────────────────────────
// Финик ведёт по реальным экранам и подсвечивает нужное. Шаг пропускается,
// если его вкладка или блок скрыты конструктором аналитики.
const TOUR_KEY = 'finik_tour_v1';
const TOUR_STEPS = [
  { emo: 'wave', title: 'Привет! Я Финик', body: 'Ваш семейный бухгалтер. Порадуюсь доходам, поворчу за перерасход и покажу за минуту, как тут всё устроено.' },
  { screen: 'budget', target: '#fab-add', emo: 'plus', title: 'Внесите расход', body: 'Нажмите на меня. Пишите как в мессенджере — «кофе 180, вчера такси 450», диктуйте голосом или сфотографируйте чек. Есть и ручной ввод.' },
  { screen: 'budget', target: '.nav-date-row', emo: 'walk', title: 'Листайте дни', body: 'Свайп по экрану влево-вправо или стрелки — предыдущий и следующий день. Под датой — траты всей семьи и каждого отдельно.' },
  { screen: 'summary', target: '#summary-total-bar', emo: 'inspect', title: 'Итоги месяца', body: 'Сколько потрачено за месяц, разбивка по категориям, тепловая карта дней и ИИ-разбор с советами.' },
  { screen: 'goals', target: '#bablometr-content .speedometer-svg', emo: 'overspend', title: 'Барометр бюджета', body: 'Стрелка — траты относительно нормы на сегодня. Зелёная зона — экономим, фиолетовая — в графике, жёлтая — выше плана, красная — перерасход. Я тоже подскажу настроением.' },
  { screen: 'chart', target: '#chart-cards .chart-box--hero', emo: 'thinking', title: 'Графики', body: 'Траты против плана и прогноз до конца месяца. Где начался перерасход — видно красным. Ведите пальцем по графику, чтобы смотреть дни.' },
  { screen: 'settings', page: 'family', target: '#invite-section', emo: 'wave', title: 'Позовите семью', body: 'Отправьте ссылку-приглашение — открыть можно на iPhone, Android или компьютере. Все вносят траты и видят общий бюджет сразу.' },
  { screen: 'settings', page: 'help', target: '#support-section', emo: 'record', title: 'Поддержка', body: 'Нашли ошибку или есть идея — напишите прямо отсюда. Ответ разработчика придёт сюда же.' },
  { emo: 'goal', title: 'Готово!', body: 'Вопросы и ответы и повтор тура — в Настройках, раздел «Помощь и поддержка». Удачного планирования!' },
];
let tourIdx = 0, tourSteps = [];

function tourVisible(step) {
  if (step.screen && !document.querySelector(`.nav-btn[data-screen="${step.screen}"]`)?.offsetParent) return false;
  return true;
}

function startTour() {
  tourSteps = TOUR_STEPS.filter(tourVisible);
  tourIdx = 0;
  const el = document.getElementById('tour');
  el.classList.remove('hidden');
  el.querySelector('.tour-dots').innerHTML = tourSteps.map(() => '<i></i>').join('');
  showTourStep();
}

function endTour() {
  localStorage.setItem(TOUR_KEY, '1');
  const el = document.getElementById('tour');
  el.classList.add('hidden');
  el.querySelector('.tour-finik').innerHTML = '';
  navigate('budget');
}

async function showTourStep() {
  const step = tourSteps[tourIdx];
  const el = document.getElementById('tour');
  const spot = el.querySelector('.tour-spot'), card = el.querySelector('.tour-card');
  if (step.screen && currentScreen !== step.screen) { navigate(step.screen); await new Promise(r => setTimeout(r, 700)); }
  if (step.page) { openSettingsPage(step.page, { history: false }); await new Promise(r => setTimeout(r, 200)); }
  else if (step.screen === 'settings' && settingsPage) closeSettingsPage();
  let target = step.target ? document.querySelector(step.target) : null;
  if (target && !target.offsetParent && target !== document.getElementById('fab-add')) target = null;
  if (target) { target.scrollIntoView({ block: 'center', behavior: motionOK() ? 'smooth' : 'auto' }); await new Promise(r => setTimeout(r, motionOK() ? 380 : 30)); }

  el.querySelector('.tour-finik').innerHTML = finikEnabled() ? finik(step.emo, 'finik-md') : '';
  el.querySelector('.tour-step').textContent = `${tourIdx + 1} из ${tourSteps.length}`;
  el.querySelector('.tour-title').textContent = step.title;
  el.querySelector('.tour-body').textContent = step.body;
  el.querySelector('.tour-next').textContent = tourIdx === tourSteps.length - 1 ? 'Начать' : 'Далее';
  el.querySelector('.tour-skip').classList.toggle('hidden', tourIdx === tourSteps.length - 1);
  el.querySelectorAll('.tour-dots i').forEach((d, i) => d.classList.toggle('on', i === tourIdx));

  if (target) {
    const r = target.getBoundingClientRect(), pad = 8;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    spot.classList.remove('tour-spot--none');
    // карточка — с той стороны, где больше места
    card.classList.toggle('tour-card--top', r.top + r.height / 2 > window.innerHeight / 2);
  } else {
    spot.classList.add('tour-spot--none');
    card.classList.remove('tour-card--top');
  }
  card.classList.remove('tour-card--in'); void card.offsetWidth; card.classList.add('tour-card--in');
}

function initHelpAndTour() {
  document.getElementById('btn-open-help').addEventListener('click', openHelp);
  document.getElementById('btn-start-tour').addEventListener('click', startTour);
  document.getElementById('help-close').addEventListener('click', closeHelp);
  document.getElementById('help-overlay').addEventListener('click', closeHelp);
  const el = document.getElementById('tour');
  el.querySelector('.tour-skip').addEventListener('click', endTour);
  el.querySelector('.tour-next').addEventListener('click', () => {
    if (tourIdx >= tourSteps.length - 1) { endTour(); return; }
    tourIdx++; showTourStep();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!el.classList.contains('hidden')) endTour();
    else if (document.getElementById('help-sheet').classList.contains('open')) closeHelp();
  });
  // первый запуск — показываем тур один раз
  let seen = false;
  try { seen = localStorage.getItem(TOUR_KEY) === '1'; } catch { seen = true; }
  if (!seen) setTimeout(startTour, 1200);
}

// ─── НАСТРОЙКИ: разделы со страницами ─────────────────────────────────────────
// Главный экран — карточка профиля и список разделов; каждый раздел открывается
// отдельной страницей с «‹ Настройки». Сами блоки остаются в index.html и при
// запуске переносятся в свои страницы (логика у них прежняя).
const SET_ICONS = {
  family: '<path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19c0-3 2.2-5 5-5s5 2 5 5M11 19c0-3 2.2-5 5-5s5 2 5 5"/>',
  screens: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><path d="M13 16.5h7M16.5 13v7"/>',
  look: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none"/>',
  notify: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  security: '<path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  data: '<path d="M12 4v10M8 10l4 4 4-4M5 18h14"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6M12 17h.01"/>',
  admin: '<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="18" cy="17" r="2"/>',
};
const SETTINGS_PAGES = [
  { id: 'family', title: 'Семья и бюджет', sub: 'Название, приглашения, план, категории, регулярные платежи',
    sections: ['#family-name-section', '#invite-section', '#planned-section', '#custom-cats-section', '#btn-open-recurring'] },
  { id: 'look', title: 'Внешний вид и экраны', sub: 'Тема, Финик и что показывать на вкладках',
    sections: ['#theme-section', '#finik-section', '#blocks-section'] },
  { id: 'notify', title: 'Уведомления', sub: 'О расходах партнёра', sections: ['#push-settings-section'] },
  { id: 'security', title: 'Безопасность и данные', sub: 'Аккаунт и вход, шифрование, экспорт и импорт',
    sections: ['#google-account-section', '#oauth-link-section', '#e2e-section', '#data-section'] },
  { id: 'help', title: 'Помощь и поддержка', sub: 'Вопросы и ответы, тур, написать разработчику',
    sections: ['#help-section', '#support-section', '#about-section'] },
  { id: 'admin', title: 'Администрирование', sub: 'Сообщения поддержки, панель, обновление', admin: true,
    sections: ['#admin-panel-btn-section', '#admin-update-section'] },
];
let settingsPage = null;

function initSettingsPages() {
  const list = document.querySelector('#screen-settings .settings-list');
  if (!list || list.dataset.paged) return;
  list.dataset.paged = '1';
  const root = document.createElement('div');
  root.className = 'set-root';
  root.innerHTML = `
    <div class="card set-profile">
      <div class="set-ava" id="set-ava"></div>
      <div class="set-who"><b id="set-name"></b><span id="set-family"></span></div>
    </div>
    <div class="card set-menu">
      ${SETTINGS_PAGES.map(pg => `
        <button class="set-row${pg.admin ? ' hidden' : ''}" data-page="${pg.id}">
          <span class="set-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${SET_ICONS[pg.id]}</svg></span>
          <span class="set-text"><span class="set-title">${pg.title}</span><span class="set-sub">${pg.sub}</span></span>
          <span class="set-badge hidden"></span>
          <span class="set-chev">›</span>
        </button>`).join('')}
    </div>
    <button class="btn btn-secondary btn-full set-logout" id="set-logout">Выйти из аккаунта</button>`;
  for (const pg of SETTINGS_PAGES) {
    const page = document.createElement('div');
    page.className = 'set-page hidden';
    page.dataset.page = pg.id;
    page.innerHTML = `<div class="set-page-head"><button class="set-back" type="button">‹ Настройки</button><h2>${pg.title}</h2></div>`;
    for (const sel of pg.sections) { const el = list.querySelector(sel) || document.querySelector(sel); if (el) page.appendChild(el); }
    list.appendChild(page);
  }
  list.prepend(root);
  root.querySelectorAll('.set-row').forEach(r => r.addEventListener('click', () => openSettingsPage(r.dataset.page)));
  list.querySelectorAll('.set-back').forEach(b => b.addEventListener('click', () => (history.state?.setPage ? history.back() : closeSettingsPage())));
  root.querySelector('#set-logout').addEventListener('click', async () => {
    if (await uiConfirm('Выйти из аккаунта?', 'Данные останутся на сервере — войти можно снова в любой момент.', { ok: 'Выйти', danger: true })) logout();
  });
  window.addEventListener('popstate', () => { if (settingsPage) closeSettingsPage(); });
}

function renderSettingsRoot() {
  const name = currentUser?.name || '';
  const ava = document.getElementById('set-ava');
  if (ava) { ava.textContent = name.trim().slice(0, 1).toUpperCase() || '?'; ava.style.background = avatarColor(currentUser?.login || name); }
  const n = document.getElementById('set-name'); if (n) n.textContent = name;
  const f = document.getElementById('set-family');
  if (f) f.textContent = appSettings?.familyName ? `Семья «${appSettings.familyName}»` : 'Семья без названия';
  document.querySelector('.set-row[data-page="admin"]')?.classList.toggle('hidden', !currentUser?.isAdmin);
  // раздел пустой (например, уведомления не поддерживаются браузером) — прячем строку
  for (const pg of SETTINGS_PAGES) {
    if (pg.admin) continue;
    const page = document.querySelector(`.set-page[data-page="${pg.id}"]`);
    const visible = page && [...page.children].some(c => !c.classList.contains('set-page-head') && !c.classList.contains('hidden'));
    document.querySelector(`.set-row[data-page="${pg.id}"]`)?.classList.toggle('hidden', !visible);
  }
}

function openSettingsPage(id, { history: push = true } = {}) {
  const list = document.querySelector('#screen-settings .settings-list');
  if (!list) return;
  settingsPage = id;
  list.querySelector('.set-root')?.classList.add('hidden');
  list.querySelectorAll('.set-page').forEach(p => p.classList.toggle('hidden', p.dataset.page !== id));
  document.querySelector('.main-content')?.scrollTo?.(0, 0);
  if (push) history.pushState({ setPage: id }, '');
  if (id === 'look') renderBlocksConstructor();
}

function closeSettingsPage() {
  const list = document.querySelector('#screen-settings .settings-list');
  if (!list) return;
  settingsPage = null;
  list.querySelectorAll('.set-page').forEach(p => p.classList.add('hidden'));
  list.querySelector('.set-root')?.classList.remove('hidden');
  renderSettingsRoot();
  document.querySelector('.main-content')?.scrollTo?.(0, 0);
}

// Значки на строках разделов: непрочитанный ответ поддержки, сообщения админу
function setSettingsBadge(page, n, dotOnly = false) {
  const b = document.querySelector(`.set-row[data-page="${page}"] .set-badge`);
  if (!b) return;
  b.classList.toggle('hidden', !n);
  b.classList.toggle('dot', dotOnly);
  b.textContent = dotOnly ? '' : String(n || '');
}

// ─── Тема: как в системе / светлая / тёмная (личная настройка устройства) ──────
function applyThemePref(pref) {
  let p = pref;
  if (!p) { try { p = localStorage.getItem('theme_pref') || 'auto'; } catch { p = 'auto'; } }
  if (p === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = p;
  document.querySelectorAll('[data-theme-pref]').forEach(b => b.classList.toggle('active', b.dataset.themePref === p));
}
function initThemePills() {
  document.querySelectorAll('[data-theme-pref]').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem('theme_pref', b.dataset.themePref); } catch { /* приватный режим */ }
    applyThemePref(b.dataset.themePref);
  }));
  applyThemePref();
}
applyThemePref();

// ─── ДИАЛОГИ ──────────────────────────────────────────────────────────────────
// Фирменные окна вместо системных confirm()/prompt() (1:1 с приложением,
// android/src/components/DialogHost.tsx). Возвращают Promise.
function uiDialog({ title, text = '', buttons, input = null }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'ui-dialog';
    wrap.innerHTML = `
      <div class="ui-dialog-card" role="dialog" aria-modal="true" aria-labelledby="ui-dialog-title">
        <div class="ui-dialog-clasp"><i></i><i></i></div>
        <div class="ui-dialog-title" id="ui-dialog-title">${esc(title)}</div>
        ${text ? `<div class="ui-dialog-text">${esc(text)}</div>` : ''}
        ${input ? `<input class="ui-dialog-input" type="text" placeholder="${esc(input.placeholder || '')}" autocomplete="off" spellcheck="false">` : ''}
        <div class="ui-dialog-btns">${buttons.map((b, i) => `<button class="btn ${b.kind === 'danger' ? 'btn-danger' : b.kind === 'primary' ? 'btn-primary' : 'btn-secondary'}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
    document.body.appendChild(wrap);
    const field = wrap.querySelector('.ui-dialog-input');
    const close = v => { document.removeEventListener('keydown', onKey); wrap.classList.add('closing'); setTimeout(() => wrap.remove(), 160); resolve(v); };
    const cancelVal = buttons.find(b => b.cancel)?.value ?? null;
    const onKey = e => {
      if (e.key === 'Escape') close(cancelVal);
      if (e.key === 'Enter' && field && document.activeElement === field) close(field.value);
    };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(cancelVal); });
    wrap.querySelectorAll('.ui-dialog-btns button').forEach(btn => btn.addEventListener('click', () => {
      const b = buttons[+btn.dataset.i];
      close(b.value === '__input' ? (field?.value ?? '') : b.value);
    }));
    setTimeout(() => (field || wrap.querySelector('.btn-primary, .btn-danger'))?.focus(), 50);
  });
}
function uiConfirm(title, text = '', { ok = 'Да', cancel = 'Отмена', danger = false } = {}) {
  return uiDialog({ title, text, buttons: [
    { label: cancel, value: false, cancel: true },
    { label: ok, value: true, kind: danger ? 'danger' : 'primary' },
  ] });
}
function uiPrompt(title, text = '', { placeholder = '', ok = 'Готово' } = {}) {
  return uiDialog({ title, text, input: { placeholder }, buttons: [
    { label: 'Отмена', value: null, cancel: true },
    { label: ok, value: '__input', kind: 'primary' },
  ] });
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

// OAuth-редирект (Google/Яндекс/VK) вернул токен или результат привязки в URL
const _params = new URLSearchParams(location.search);
const _oauthToken = _params.get('token');
const _linked = _params.get('linked');
if (_oauthToken) {
  token = _oauthToken;
  localStorage.setItem('budget_token', _oauthToken);
}
if (_oauthToken || _linked) window.history.replaceState({}, '', location.pathname);

if (_oauthToken || (token && currentUser)) {
  initApp().then(() => {   // initApp сам подтянет /api/me, если пользователя ещё нет
    if (_linked === '1') showToastSuccess('Способ входа привязан ✓');
    else if (_linked === '0') showToastError('Не удалось привязать вход');
  }).catch(() => {});
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
