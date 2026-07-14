import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// Конструктор аналитики: каждый блок можно включить/выключить в Настройках.
// Настройка локальная для устройства — у каждого члена семьи свой набор.
export const BLOCKS = [
  { id: 'gauge',    label: '💵 Баблометр',            hint: 'Факт/план на экране «Месяц»' },
  { id: 'heatmap',  label: '📅 Расходы по дням',       hint: 'Календарь-тепловая карта' },
  { id: 'byUser',   label: '👥 По участникам',         hint: 'Кто сколько потратил, % дохода' },
  { id: 'ai',       label: '🤖 Кнопка ИИ-анализа',     hint: 'На экране «Месяц» (Премиум)' },
  { id: 'chartTab', label: '📈 Вкладка «График»',      hint: 'Расходы за 6 месяцев' },
  { id: 'goalsTab', label: '🎯 Вкладка «Цели»',        hint: 'Накопления и прогресс' },
] as const;

export type BlockId = typeof BLOCKS[number]['id'];
export type BlockState = Record<BlockId, boolean>;

const KEY = 'analytics_blocks';
const DEFAULTS: BlockState = {
  gauge: true, heatmap: true, byUser: true, ai: true, chartTab: true, goalsTab: true,
};

let _state: BlockState = { ...DEFAULTS };
const listeners = new Set<() => void>();

export async function initBlocks() {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) _state = { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* keep defaults */ }
  listeners.forEach(l => l());
}

export async function setBlock(id: BlockId, value: boolean) {
  _state = { ..._state, [id]: value };
  listeners.forEach(l => l());
  await SecureStore.setItemAsync(KEY, JSON.stringify(_state));
}

export function useBlocks(): BlockState {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return _state;
}
