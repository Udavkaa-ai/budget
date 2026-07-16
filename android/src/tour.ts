import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// Вводный тур: показывается новым пользователям один раз, повторяется по кнопке.
// (пересборка после временного сбоя сети в CI)
const KEY = 'tour_done_v1';

let _seen = false;
let _loaded = false;
let _active = false;
const listeners = new Set<() => void>();
function notify() { listeners.forEach(l => l()); }

export async function initTour() {
  try { _seen = (await SecureStore.getItemAsync(KEY)) === '1'; } catch { _seen = false; }
  _loaded = true;
  notify();
}

export function tourLoaded() { return _loaded; }
export function tourSeen() { return _seen; }
export function isTourActive() { return _active; }

export function startTour() { _active = true; notify(); }

export async function endTour() {
  _active = false;
  _seen = true;
  notify();
  try { await SecureStore.setItemAsync(KEY, '1'); } catch { /* ignore */ }
}

export function useTourActive(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return _active;
}

// Флаг завершения загрузки: меняется false→true, когда прочитали SecureStore.
// Нужен, чтобы автозапуск тура сработал, даже если init завершился после входа.
export function useTourLoaded(): boolean {
  const [loaded, setLoaded] = useState(_loaded);
  useEffect(() => {
    if (_loaded) { setLoaded(true); return; }
    const l = () => setLoaded(_loaded);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return loaded;
}
