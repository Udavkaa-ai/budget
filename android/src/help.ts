import { useEffect, useState } from 'react';

// Простой стор видимости раздела «Помощь» — открывается по «?» из любого места.
let _open = false;
const listeners = new Set<() => void>();
function notify() { listeners.forEach(l => l()); }

export function openHelp() { _open = true; notify(); }
export function closeHelp() { _open = false; notify(); }

export function useHelpOpen(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return _open;
}
