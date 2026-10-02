import { useEffect, useState } from 'react';

// Какая страница Настроек открыта (null — главный экран с разделами).
// Отдельный стор — чтобы вводный тур и ссылки могли открыть нужный раздел.
export type SettingsPage = 'family' | 'screens' | 'look' | 'notify' | 'security' | 'bank' | 'premium' | 'data' | 'help';
let _page: SettingsPage | null = null;
const listeners = new Set<() => void>();

export function openSettingsPage(p: SettingsPage | null) { _page = p; listeners.forEach(l => l()); }
export function useSettingsPage(): SettingsPage | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return _page;
}
