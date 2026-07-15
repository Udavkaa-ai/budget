import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

// Замок приложения: отпечаток/PIN устройства при запуске, отключается в настройках
const LOCK_KEY = 'app_lock_enabled';

let _enabled = false;
const listeners = new Set<() => void>();

export async function initAppLock() {
  _enabled = (await SecureStore.getItemAsync(LOCK_KEY)) === '1';
  listeners.forEach(l => l());
}

export function isLockEnabled() { return _enabled; }

export async function setLockEnabled(v: boolean) {
  _enabled = v;
  await SecureStore.setItemAsync(LOCK_KEY, v ? '1' : '0');
  listeners.forEach(l => l());
}

export function useLockEnabled(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return _enabled;
}

export async function canUseBiometrics(): Promise<boolean> {
  const hw = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return hw && enrolled;
}

// true = разблокировано (биометрия или PIN/пароль устройства как fallback)
export async function authenticate(): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: 'Разблокируйте Семейный бюджет',
    cancelLabel: 'Отмена',
    disableDeviceFallback: false,
  });
  return res.success;
}
