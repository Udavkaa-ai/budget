import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// Показывать ли маскота Финика. По умолчанию — включён.
const FINIK_KEY = 'finik_enabled';

let _enabled = true;
const listeners = new Set<(v: boolean) => void>();

export async function initFinik() {
  const raw = await SecureStore.getItemAsync(FINIK_KEY);
  _enabled = raw !== '0'; // всё, кроме явного '0' (в т.ч. отсутствие) — включён
  listeners.forEach(l => l(_enabled));
}

export function isFinikEnabled() { return _enabled; }

export async function setFinikEnabled(v: boolean) {
  _enabled = v;
  await SecureStore.setItemAsync(FINIK_KEY, v ? '1' : '0');
  listeners.forEach(l => l(v));
}

export function useFinikEnabled(): boolean {
  const [value, setValue] = useState(_enabled);
  useEffect(() => {
    const l = (v: boolean) => setValue(v);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return value;
}
