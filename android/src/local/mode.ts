import * as SecureStore from 'expo-secure-store';

// Режим «без сервера»: все данные живут на телефоне (SQLite из e2e/store),
// между телефонами семьи — через общую папку в облаке (local/sync.ts) или
// напрямую по Wi-Fi. Пользователь — просто имя, выбранное при входе.
const KEY = 'local_mode';
let _me: string | null = null;

export async function initLocal() {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    _me = v ? (JSON.parse(v).me as string) || null : null;
  } catch { _me = null; }
}

export const isLocal = () => !!_me;
export const localMe = () => _me || '';

export async function enterLocal(me: string) {
  _me = me.trim();
  await SecureStore.setItemAsync(KEY, JSON.stringify({ me: _me }));
}

export async function leaveLocal() {
  _me = null;
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
