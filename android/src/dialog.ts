import { useEffect, useState } from 'react';

// Тематический диалог вместо системного Alert.alert (белое окно Android не
// вписывается в дизайн и не знает тёмную тему). Та же сигнатура, что у
// Alert.alert, поэтому вызывается откуда угодно, в том числе вне компонентов.
export type DialogButton = { text?: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };
export type DialogState = { id: number; title: string; message?: string; buttons: DialogButton[]; cancelable: boolean; onDismiss?: () => void } | null;

let current: DialogState = null;
let seq = 0;
const queue: NonNullable<DialogState>[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

export function showAlert(title: string, message?: string, buttons?: DialogButton[], options?: { cancelable?: boolean; onDismiss?: () => void }) {
  const d = {
    id: ++seq, title, message,
    buttons: buttons?.length ? buttons : [{ text: 'OK' }],
    cancelable: options?.cancelable ?? true,
    onDismiss: options?.onDismiss,
  };
  if (current) queue.push(d); else current = d;
  notify();
}

// Закрыть текущий диалог и выполнить действие кнопки (после закрытия — чтобы
// следующий showAlert из обработчика встал в очередь, а не потерялся)
export function closeDialog(btn?: DialogButton) {
  current = queue.shift() ?? null;
  notify();
  btn?.onPress?.();
}

export function useDialog(): DialogState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return current;
}
