import { useEffect, useState } from 'react';
import { settings } from './api/client';

// Базовые категории с иконками + пользовательские категории семьи с сервера
export const BASE_ICONS: Record<string, string> = {
  Продукты: '🛒', Кафе: '🍽', Транспорт: '🚇', Авто: '🚗', Одежда: '👗', Красота: '💄',
  Медицина: '💊', Развлечения: '🎮', Дети: '👶', Дом: '🏠', Связь: '📱', Прочее: '❓',
};
export const BASE_CATEGORIES = Object.keys(BASE_ICONS);

export interface CustomCategory { name: string; emoji: string }

let _cats: string[] = [...BASE_CATEGORIES];
let _icons: Record<string, string> = { ...BASE_ICONS };
let _custom: CustomCategory[] = [];
const listeners = new Set<() => void>();

export async function refreshCategories() {
  try {
    const s = await settings.get();
    _custom = s.customCategories ?? [];
    _cats = [
      ...BASE_CATEGORIES,
      ..._custom.map(c => c.name).filter(n => !BASE_CATEGORIES.includes(n)),
    ];
    _icons = { ...BASE_ICONS };
    for (const c of _custom) _icons[c.name] = c.emoji || '🏷️';
    listeners.forEach(l => l());
  } catch { /* офлайн — остаёмся на текущем списке */ }
}

export function getCategories() { return _cats; }
export function getCustomCategories() { return _custom; }
export function catIcon(c: string) { return _icons[c] ?? '🏷️'; }

export function useCategories() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return { cats: _cats, custom: _custom, icon: catIcon };
}
