import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import Constants from 'expo-constants';
import { api } from './api/client';
import { decryptJson } from './crypto';

// Пуши о расходах семьи через FCM (без Expo push-сервиса).
// Нужны: google-services.json в сборке (секрет GOOGLE_SERVICES_JSON в CI)
// и ключ сервисного аккаунта на сервере (FIREBASE_PROJECT_ID/_CLIENT_EMAIL/_PRIVATE_KEY).
//
// Сервер копит изменения автора и шлёт одно сообщение (src/notify.js).
// Обычная семья — системное уведомление с готовым текстом.
// E2E-семья — data-сообщение с зашифрованными сводками: их расшифровывает
// фоновая задача ниже ключом семьи и сама показывает уведомление.

const CHANNEL = 'family';
const TASK = 'finik-family-push';

// ── Сводка (повторяет summarize() из src/notify.js) ──────────────────────────
// detail — что видит получатель: 'short' (по умолчанию, без сумм),
// 'full' (с суммами и категориями), 'hidden' (без имён и цифр)
type Item = [number, string, string, number?];
type Acc = { items: Item[]; upd: number; del: number };
export type PushDetail = 'short' | 'full' | 'hidden';
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtR = (n: number) => `${new Intl.NumberFormat('ru-RU').format(Math.round(n))} ₽`;
const plural = (n: number, a: string, b: string, c: string) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? b : c; };
export function summarize(by: string, items: Item[], extra = { upd: 0, del: 0 }, detail: PushDetail = 'short') {
  if (detail === 'hidden') return { title: 'ФИНИК', body: 'Новые записи в семейном бюджете' };
  const n = items.reduce((k, it) => k + (Number(it[3]) || 1), 0);
  const days = [...new Set(items.map(it => it[1]).filter(Boolean))]
    .sort((a, b) => a.split('.').reverse().join('').localeCompare(b.split('.').reverse().join('')));
  const dd = (d: string) => { const [x, m] = d.split('.'); return `${+x} ${MON[+m - 1] || ''}`; };
  const first = days[0], last = days[days.length - 1];
  const when = !days.length ? '' : days.length === 1 ? dd(first)
    : first.slice(3) === last.slice(3) ? `${+first.split('.')[0]}–${dd(last)}` : `${dd(first)} – ${dd(last)}`;
  const tail = [extra.upd ? `изменено ${extra.upd}` : '', extra.del ? `удалено ${extra.del}` : ''].filter(Boolean).join(', ');
  if (!n) return { title: `💸 ${by}`, body: tail ? `Правки в расходах: ${tail}` : 'Правки в расходах' };
  const what = `${n} ${plural(n, 'новый расход', 'новых расхода', 'новых расходов')}`;
  if (detail !== 'full') {
    return { title: `💸 ${by} · ${what}`, body: [when ? `за ${when}` : '', tail].filter(Boolean).join(' · ') };
  }
  const sum = items.reduce((s, it) => s + (Number(it[0]) || 0), 0);
  const cats: Record<string, number> = {};
  for (const it of items) cats[it[2] || 'Прочее'] = (cats[it[2] || 'Прочее'] || 0) + (Number(it[0]) || 0);
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const catTxt = top.slice(0, 3).map(([c, v]) => `${c} ${fmtR(v)}`).join(', ') + (top.length > 3 ? '…' : '');
  return {
    title: `💸 ${by} · ${what} · ${fmtR(sum)}`,
    body: [when ? `за ${when}` : '', catTxt, tail].filter(Boolean).join(' · '),
  };
}

// Пейлоад сервера лежит строкой в data.finik; где именно — зависит от того,
// как expo-notifications передал сообщение, поэтому ищем по дереву
function findFinik(x: unknown, depth = 0): any {
  if (!x || typeof x !== 'object' || depth > 4) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.finik === 'string') { try { return JSON.parse(o.finik); } catch { return null; } }
  if (typeof o.dataString === 'string') { try { return findFinik(JSON.parse(o.dataString), depth + 1); } catch { /* дальше */ } }
  for (const v of Object.values(o)) { const r = findFinik(v, depth + 1); if (r) return r; }
  return null;
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Расходы семьи',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 100, 50, 100],
  });
}

// Показать (или дописать в уже висящее) уведомление по автору
const _seen = new Set<string>();
async function present(p: any) {
  if (p.id) { if (_seen.has(p.id)) return; _seen.add(p.id); }
  let acc: Acc | null = null;
  if (p.e2e) {
    acc = { items: [], upd: 0, del: 0 };
    for (const h of (p.hints || []) as string[]) {
      try {
        const j = await decryptJson<{ items?: Item[]; upd?: number; del?: number }>(h);
        acc.items.push(...(j.items || [])); acc.upd += j.upd || 0; acc.del += j.del || 0;
      } catch { /* нет ключа или чужой ключ */ }
    }
    if (!acc.items.length && !acc.upd && !acc.del) acc = null;
  } else if (Array.isArray(p.items) && p.items.length) {
    acc = { items: p.items, upd: 0, del: 0 };
  }
  if (p.detail === 'hidden') acc = null;   // скрытый режим: текст сервера как есть
  const id = String(p.tag || `upd:${p.by || ''}`);
  if (acc) {
    const prev = (await Notifications.getPresentedNotificationsAsync().catch(() => []))
      .find(n => n.request.identifier === id)?.request.content.data?.acc as Acc | undefined;
    if (prev) acc = { items: [...prev.items, ...acc.items].slice(-200), upd: prev.upd + acc.upd, del: prev.del + acc.del };
  }
  const text = acc ? summarize(p.by || 'Семья', acc.items, acc, p.detail || 'short') : { title: p.title || 'ФИНИК', body: p.body || '' };
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title: text.title, body: text.body, data: { acc, url: p.url || '/' } },
    trigger: Platform.OS === 'android' ? { channelId: CHANNEL } : null,
  });
}

// Фоновая задача: data-сообщения E2E (приложение может быть выгружено)
TaskManager.defineTask(TASK, async ({ data, error }) => {
  if (error) return;
  const p = findFinik(data);
  if (p?.e2e) await present(p).catch(() => {});
});

// Своё системное уведомление (обычная семья) при открытом приложении и
// data-сообщение E2E на переднем плане: показываем сами, свои — не показываем
let _selfName = '';
Notifications.setNotificationHandler({
  handleNotification: async n => {
    const p = findFinik(n.request.content.data) || findFinik((n.request.trigger as any)?.remoteMessage);
    const fromServer = n.request.trigger && (n.request.trigger as any).type === 'push';
    if (fromServer && p) {
      if (p.by && p.by === _selfName) return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
      // Пуш с сервера на переднем плане: рисуем свою сводку (для E2E — расшифровав)
      present(p).catch(() => {});
      return { shouldShowAlert: false, shouldPlaySound: false, shouldSetBadge: false };
    }
    return { shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false };
  },
});

let _registered = false;
export type PushState = 'ok' | 'denied' | 'unavailable' | 'server-off';

// Разрешение › FCM-токен устройства › сервер. Возвращает, что получилось.
export async function registerPush(selfName: string): Promise<PushState> {
  _selfName = selfName;
  try {
    const { status: cur } = await Notifications.getPermissionsAsync();
    const status = cur === 'granted' ? cur : (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    await ensureChannel();
    if (!_registered) { await Notifications.registerTaskAsync(TASK).catch(() => {}); _registered = true; }
    const { data: token } = await Notifications.getDevicePushTokenAsync();
    if (!token || typeof token !== 'string') return 'unavailable';
    const r = await api.post<{ ok: boolean; server: boolean }>('/api/push/fcm', {
      token, app: Constants.expoConfig?.android?.package || '',
    });
    return r.server ? 'ok' : 'server-off';
  } catch {
    // Нет google-services.json для этого пакета (сборка без Firebase)
    return 'unavailable';
  }
}

export const PUSH_STATE_TEXT: Record<PushState, string> = {
  ok: '',
  denied: 'Уведомления запрещены в настройках Android — разрешите их для ФИНИК',
  unavailable: 'В этой сборке пуши недоступны (не подключён Firebase)',
  'server-off': 'Сервер пока не настроен на отправку пушей в приложение',
};
