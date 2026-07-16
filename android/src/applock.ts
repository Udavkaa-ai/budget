import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';

// Замок приложения: биометрия ИЛИ цифровой PIN при открытии. Настраивается в настройках.
const LOCK_KEY = 'app_lock_enabled';
const PIN_KEY = 'app_lock_pin';       // хранится хеш, не сам PIN
const PIN_SALT = 'fb_pin_v1';

let _enabled = false;
let _hasPin = false;
const listeners = new Set<() => void>();

// Флаг «идёт системный запрос биометрии»: на Android показ промпта уводит
// приложение в background — без этого флага мы бы сбрасывали разблокировку
// и промпт «мигал»/не появлялся после автоблокировки телефона.
let _authInProgress = false;
export function isAuthInProgress() { return _authInProgress; }

export async function initAppLock() {
  _enabled = (await SecureStore.getItemAsync(LOCK_KEY)) === '1';
  _hasPin = !!(await SecureStore.getItemAsync(PIN_KEY));
  listeners.forEach(l => l());
}

export function isLockEnabled() { return _enabled; }
export function hasPin() { return _hasPin; }

export async function setLockEnabled(v: boolean) {
  _enabled = v;
  await SecureStore.setItemAsync(LOCK_KEY, v ? '1' : '0');
  listeners.forEach(l => l());
}

function notify() { listeners.forEach(l => l()); }

async function hashPin(pin: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${PIN_SALT}:${pin}`,
  );
}

export async function setPin(pin: string) {
  await SecureStore.setItemAsync(PIN_KEY, await hashPin(pin));
  _hasPin = true;
  notify();
}

export async function clearPin() {
  await SecureStore.deleteItemAsync(PIN_KEY);
  _hasPin = false;
  notify();
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = await SecureStore.getItemAsync(PIN_KEY);
  if (!stored) return false;
  return stored === await hashPin(pin);
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

// Хук для отслеживания наличия PIN (перерисовка настроек)
export function useHasPin(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return _hasPin;
}

export async function canUseBiometrics(): Promise<boolean> {
  const hw = await LocalAuthentication.hasHardwareAsync();
  const enrolled = await LocalAuthentication.isEnrolledAsync();
  return hw && enrolled;
}

// true = разблокировано биометрией (или системным PIN/паролем устройства как fallback)
export async function authenticate(): Promise<boolean> {
  _authInProgress = true;
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Разблокируйте Семейный бюджет',
      cancelLabel: 'Отмена',
      disableDeviceFallback: false,
    });
    return res.success;
  } catch {
    return false;
  } finally {
    // небольшая задержка: событие AppState 'active' приходит чуть позже промпта
    setTimeout(() => { _authInProgress = false; }, 400);
  }
}
