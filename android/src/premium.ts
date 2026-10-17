import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { isLocal } from './local/mode';

// Тестовый режим премиума: активируется бесплатно из настроек на время
// тестирования. TODO: заменить на Google Play Billing перед релизом в стор.
const PREMIUM_KEY = 'premium_test';

let _premium = false;
const listeners = new Set<(v: boolean) => void>();

export async function initPremium() {
  _premium = (await SecureStore.getItemAsync(PREMIUM_KEY)) === '1';
  listeners.forEach(l => l(_premium));
}

// Без сервера всё открыто: текст разбирается на телефоне, ИИ — по ключу OpenRouter
export function isPremium() { return _premium || isLocal(); }

export async function setPremium(v: boolean) {
  _premium = v;
  await SecureStore.setItemAsync(PREMIUM_KEY, v ? '1' : '0');
  listeners.forEach(l => l(v));
}

export function usePremium(): boolean {
  const [value, setValue] = useState(_premium || isLocal());
  useEffect(() => {
    const l = (v: boolean) => setValue(v || isLocal());
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return value;
}
