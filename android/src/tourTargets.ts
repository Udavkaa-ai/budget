import React, { useEffect, useRef } from 'react';

// Реестр «целей» для подсветки в туре: экраны регистрируют ref на элемент,
// тур замеряет его реальные координаты (measureInWindow) — точная подсветка.
const refs = new Map<string, React.RefObject<any>>();

export function useTourTarget(id: string) {
  const ref = useRef<any>(null);
  useEffect(() => {
    refs.set(id, ref);
    return () => { if (refs.get(id) === ref) refs.delete(id); };
  }, [id]);
  return ref;
}

export type Rect = { x: number; y: number; w: number; h: number };

// Замер любого узла в оконных координатах
export function measureNode(node: any): Promise<Rect | null> {
  return new Promise(resolve => {
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 350);
    node.measureInWindow((x: number, y: number, w: number, h: number) => {
      if (done) return;
      done = true; clearTimeout(to);
      resolve(w > 0 && h > 0 ? { x, y, w, h } : null);
    });
  });
}

export function measureTarget(id: string): Promise<Rect | null> {
  return measureNode(refs.get(id)?.current);
}

// ── Автопрокрутка целей в длинных экранах (Настройки) ──────────────────────
// Экран регистрирует функцию прокрутки по префиксу ('settings'), а каждая цель
// сообщает свой offset внутри контента через onLayout. Тур прокручивает цель
// в зону видимости перед замером.
const scrollers = new Map<string, (y: number) => void>();
const offsets = new Map<string, number>();

export function registerScroller(prefix: string, fn: (y: number) => void) {
  scrollers.set(prefix, fn);
}
export function unregisterScroller(prefix: string) {
  scrollers.delete(prefix);
}
export function setTargetOffset(id: string, y: number) {
  offsets.set(id, y);
}
export function scrollTargetIntoView(id: string) {
  const fn = scrollers.get(id.split('.')[0]);
  const y = offsets.get(id);
  if (fn && y != null) fn(Math.max(0, y - 90));
}
