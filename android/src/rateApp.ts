import { Linking } from 'react-native';
import { showAlert } from './dialog';
import * as SecureStore from 'expo-secure-store';

// Страница приложения в RuStore (по package name). Если каталожный слаг
// отличается — поменять только эту строку.
export const RUSTORE_URL = 'https://www.rustore.ru/catalog/app/com.familybudget.app';

const CNT    = 'rate_count';        // счётчик полезных действий
const STATUS = 'rate_status';       // '' | 'done' | 'never'
const SNOOZE = 'rate_snooze_until'; // ms-таймстамп, до которого не спрашиваем

const THRESHOLD = 6;                // действий до первого запроса
const SNOOZE_MS = 12 * 24 * 3600 * 1000; // «не сейчас» → пауза ~12 дней

async function get(k: string)            { try { return await SecureStore.getItemAsync(k); } catch { return null; } }
async function set(k: string, v: string) { try { await SecureStore.setItemAsync(k, v); } catch { /* ignore */ } }

// Открыть страницу приложения в RuStore (там пользователь ставит оценку).
export async function openRuStoreListing() {
  try { await Linking.openURL(RUSTORE_URL); } catch { /* ignore */ }
}

// Пометить, что оценку уже поставили / больше не спрашивать.
async function markDone()  { await set(STATUS, 'done'); }
async function markNever() { await set(STATUS, 'never'); }
async function snooze()    { await set(SNOOZE, String(Date.now() + SNOOZE_MS)); await set(CNT, String(THRESHOLD - 3)); }

function askNow() {
  showAlert(
    'Нравится ФИНИК?',
    'Если приложение помогает вести семейный бюджет — поставьте, пожалуйста, оценку в RuStore. Это очень поможет проекту 🟣',
    [
      { text: 'Не сейчас',      style: 'cancel',      onPress: () => { void snooze(); } },
      { text: '⭐ Оценить в RuStore', primary: true, onPress: () => { void markDone(); void openRuStoreListing(); } },
      { text: 'Больше не спрашивать', style: 'destructive', onPress: () => { void markNever(); } },
    ],
    { cancelable: true, onDismiss: () => { void snooze(); } },
  );
}

// Сразу после обновления приложения — если ещё не оценили и не отказались
export async function askRatingAfterUpdate() {
  const status = await get(STATUS);
  if (status === 'done' || status === 'never') return;
  askNow();
}

// Вызывать после заметного позитивного действия (например, добавления расхода).
// Раз в N действий и с уважением к «не сейчас/не показывать» предлагает оценить.
export async function noteUsefulAction() {
  const status = await get(STATUS);
  if (status === 'done' || status === 'never') return;

  const snoozeUntil = Number(await get(SNOOZE) || '0');
  if (snoozeUntil && Date.now() < snoozeUntil) return;

  const n = Number(await get(CNT) || '0') + 1;
  await set(CNT, String(n));
  if (n < THRESHOLD) return;

  // Пере-снузим сразу, чтобы запрос не всплыл повторно до ответа пользователя;
  // явный выбор («Оценить»/«Не показывать») перекроет это статусом.
  await snooze();
  askNow();
}
