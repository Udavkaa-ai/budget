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

export function measureTarget(id: string): Promise<Rect | null> {
  return new Promise(resolve => {
    const node = refs.get(id)?.current;
    if (!node || typeof node.measureInWindow !== 'function') { resolve(null); return; }
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 350);
    node.measureInWindow((x: number, y: number, w: number, h: number) => {
      if (done) return;
      done = true; clearTimeout(to);
      // Отсекаем невидимое/несмонтированное и уехавшее далеко за экран
      resolve(w > 0 && h > 0 ? { x, y, w, h } : null);
    });
  });
}
