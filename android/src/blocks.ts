import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

// Конструктор экранов: блоки сгруппированы по вкладкам (как в вебе).
// Настройка локальная для устройства — у каждого члена семьи свой набор.
export type BlockId =
  | 'chartTab' | 'goalsTab'
  | 'gauge' | 'speed' | 'heatmap' | 'ai' | 'byUser' | 'categories'
  | 'chartCum' | 'chartDaily' | 'chartBalance' | 'cashflow' | 'months6'
  | 'limits' | 'goalsList' | 'achievements';
export interface BlockItem { id: BlockId; label: string; hint: string }
export interface BlockGroup { tab: 'summary' | 'chart' | 'goals' | null; title: string; hint?: string; items: BlockItem[] }

export const BLOCK_GROUPS: BlockGroup[] = [
  { tab: null, title: 'Вкладки внизу', hint: 'Бюджет, Месяц и Настройки показываются всегда', items: [
    { id: 'chartTab', label: 'График', hint: 'Траты против плана, по дням, остатки, кэшфлоу' },
    { id: 'goalsTab', label: 'Цели', hint: 'Лимиты, копилки, достижения' },
  ] },
  { tab: 'summary', title: 'Месяц', items: [
    { id: 'gauge', label: 'Барометр бюджета', hint: 'Темп трат относительно нормы' },
    { id: 'speed', label: 'Скорость трат', hint: '% от нормы по дням месяца' },
    { id: 'heatmap', label: 'Календарь трат', hint: 'Тепловая карта по дням' },
    { id: 'ai', label: 'ИИ-анализ и чат', hint: 'Кнопки на экране (Премиум)' },
    { id: 'byUser', label: 'По участникам', hint: 'Кто сколько потратил и % дохода' },
    { id: 'categories', label: 'Категории', hint: 'Разбивка с лимитами' },
  ] },
  { tab: 'chart', title: 'График', items: [
    { id: 'chartCum', label: 'Траты за месяц', hint: 'Против плана, прогноз, перерасход' },
    { id: 'chartDaily', label: 'Траты по дням', hint: 'Столбики по участникам и дневная норма' },
    { id: 'chartBalance', label: 'Остаток на счетах', hint: 'Если заполнен кэшфлоу' },
    { id: 'cashflow', label: 'Кэшфлоу', hint: 'Остатки на 1-е число и дни дохода' },
    { id: 'months6', label: 'Расходы за 6 месяцев', hint: 'Топ категорий по месяцам' },
  ] },
  { tab: 'goals', title: 'Цели', items: [
    { id: 'limits', label: 'Лимиты по категориям', hint: 'Сколько можно тратить на категорию' },
    { id: 'goalsList', label: 'Копилки', hint: 'Цели и прогресс накоплений' },
    { id: 'achievements', label: 'Достижения', hint: 'Награды Финика' },
  ] },
];
export const BLOCKS: BlockItem[] = BLOCK_GROUPS.flatMap(g => g.items);

export type BlockState = Record<BlockId, boolean>;

const KEY = 'analytics_blocks';
const DEFAULTS = Object.fromEntries(BLOCKS.map(b => [b.id, true])) as BlockState;

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
