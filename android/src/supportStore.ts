import { useEffect, useState } from 'react';
import { support } from './api/client';

// Непрочитанные ответы поддержки — для точки на вкладке «Настройки».
// Паттерн общий для сторов приложения: состояние модуля + слушатели + хук.
let _unread = 0;
const listeners = new Set<(n: number) => void>();

export function setSupportUnread(n: number) {
  _unread = n;
  listeners.forEach(l => l(n));
}

export async function refreshSupportUnread() {
  try { setSupportUnread((await support.unread()).unread || 0); } catch { /* офлайн — позже */ }
}

export function useSupportUnread(): number {
  const [v, setV] = useState(_unread);
  useEffect(() => {
    const l = (n: number) => setV(n);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return v;
}
