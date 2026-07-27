// Мостик «виджет → форма добавления». Deep link (App.tsx) выставляет флаг и
// уведомляет; HomeScreen открывает шторку добавления (при холодном старте —
// забирает отложенный флаг при монтировании).
let pending = false;
const listeners = new Set<() => void>();

export function requestQuickAdd() {
  pending = true;
  listeners.forEach(l => l());
}

// Забрать отложенный запрос (для холодного старта, когда HomeScreen ещё не был готов).
export function consumeQuickAdd(): boolean {
  const p = pending;
  pending = false;
  return p;
}

export function onQuickAdd(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
