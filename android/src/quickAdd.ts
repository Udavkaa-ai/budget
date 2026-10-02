// Мостик «виджет → форма добавления». Deep link (App.tsx) выставляет флаг и
// уведомляет; HomeScreen открывает шторку добавления (при холодном старте —
// забирает отложенный флаг при монтировании).
let pending = false;
let pendingText: string | null = null;
const listeners = new Set<() => void>();

// text — готовый текст для ИИ-разбора (например, присланный через «Поделиться»)
export function requestQuickAdd(text?: string) {
  pending = true;
  if (text) pendingText = text;
  listeners.forEach(l => l());
}

// Забрать текст для поля «Текстом» (один раз)
export function consumeQuickAddText(): string | null {
  const t = pendingText;
  pendingText = null;
  return t;
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
