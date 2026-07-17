import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { loadKey } from '../crypto';

// Состояние E2E для текущей семьи: включён ли режим на сервере и есть ли ключ.
// Клиентский слой (api/client) смотрит на isE2E(), чтобы решить: считать локально
// или ходить на сервер.
let _enabled = false;   // семья помечена E2E на сервере
let _hasKey = false;    // ключ шифрования есть на этом устройстве
let _loaded = false;
const listeners = new Set<() => void>();
function notify() { listeners.forEach(l => l()); }

export async function initE2E(): Promise<void> {
  try {
    const st = await api.get<{ enabled: boolean; keyFingerprint: string | null }>('/api/family/e2e');
    _enabled = !!st.enabled;
  } catch { /* офлайн — оставляем как есть */ }
  _hasKey = !!(await loadKey());
  _loaded = true;
  notify();
}

// Основной переключатель для клиентского слоя. Работаем локально только когда
// семья E2E И ключ на устройстве есть (иначе расшифровать нечем).
export function isE2E(): boolean { return _enabled && _hasKey; }
export function e2eEnabledOnServer(): boolean { return _enabled; }
export function e2eHasKey(): boolean { return _hasKey; }
export function e2eLoaded(): boolean { return _loaded; }

export function setE2EEnabled(v: boolean) { _enabled = v; notify(); }
export async function refreshHasKey() { _hasKey = !!(await loadKey()); notify(); }

export function useE2E() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { enabled: _enabled, hasKey: _hasKey, active: _enabled && _hasKey, loaded: _loaded };
}
