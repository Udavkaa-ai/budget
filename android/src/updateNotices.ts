import { Linking, Share } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { showAlert } from './dialog';
import { askRatingAfterUpdate } from './rateApp';

// Сообщения после обновления приложения: просьба оценить в RuStore и рассказ
// о веб-версии. Показываются один раз на каждую новую версию и только тем,
// кто уже пользовался приложением (новичков встречает вводный тур).
export const WEB_URL = 'https://semejnyj-budzet-udavkaa.amvera.io';
const LAST_VERSION = 'last_seen_version';

async function get(k: string)            { try { return await SecureStore.getItemAsync(k); } catch { return null; } }
async function set(k: string, v: string) { try { await SecureStore.setItemAsync(k, v); } catch { /* ignore */ } }

function showWebVersion() {
  showAlert(
    'ФИНИК есть и в браузере',
    `Откройте ${WEB_URL.replace('https://', '')} на компьютере, iPhone или любом телефоне и войдите тем же аккаунтом — там та же семья и те же расходы.\n\nНа iPhone веб-версию можно добавить на экран «Домой»: «Поделиться» → «На экран „Домой“».`,
    [
      { text: 'Понятно', style: 'cancel' },
      { text: 'Открыть сайт', primary: true, onPress: () => { Linking.openURL(WEB_URL).catch(() => {}); } },
      { text: 'Поделиться ссылкой', onPress: () => { Share.share({ message: `ФИНИК — наш семейный бюджет в браузере: ${WEB_URL}` }).catch(() => {}); } },
    ],
  );
}

// existingUser — пользователь уже проходил тур (значит, это обновление, а не
// свежая установка). Для новичков только запоминаем версию.
export async function checkUpdateNotices(existingUser: boolean) {
  const current = Constants.expoConfig?.version ?? '';
  if (!current) return;
  const last = await get(LAST_VERSION);
  if (last === current) return;
  await set(LAST_VERSION, current);
  if (!existingUser) return;
  await askRatingAfterUpdate();
  showWebVersion();
}
