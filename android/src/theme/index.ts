import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Дизайн-система ФИНИК 1:1 с вебом (:root в public/style.css): чистые цвета
// без градиентов, одна палитра на весь интерфейс. Фишка — «золотая застёжка»
// кошелька Финика: две золотые точки у активной вкладки и заголовков секций.
export const palette = {
  primary:     '#5947E0',
  primaryHi:   '#8B7BFF',
  primaryDark: '#4A39C4',
  gold:        '#FFC24B',
  goldDeep:    '#E8A21F',
  red:         '#D93B55',
  green:       '#17915C',
  yellow:      '#C77A12',
  pink:        '#C94F97',
  mint:        '#1597A8',
};

// Раньше — цветной «дымок» вверху вкладки; в плоском дизайне фон ровный.
export type TabTint = 'home' | 'summary' | 'chart' | 'settings' | 'goals';
const noTints = { home: 'transparent', summary: 'transparent', chart: 'transparent', settings: 'transparent', goals: 'transparent' } as Record<TabTint, string>;

const light = {
  scheme:      'light' as 'light' | 'dark',
  bg:          '#F4F2FA',
  surface:     '#FFFFFF',
  surface2:    '#F1EEFA',
  surface3:    '#E8E3F7',
  border:      '#E6E1F4',
  borderStrong:'#D3CBEE',
  seam:        '#CFC6EC',
  text:        '#1C1830',
  textMuted:   '#645E82',
  textFaint:   '#8F89AC',
  primary:     '#5947E0',
  primaryStrong:'#5947E0',
  primarySoft: '#EDEAFD',
  primaryText: '#FFFFFF',
  gold:        '#FFC24B',
  goldDeep:    '#E8A21F',
  goldSoft:    '#FFF4D9',
  accent:      '#17915C',
  tabBar:      '#FFFFFF',
  danger:      '#D93B55',
  dangerSoft:  '#FCE7EA',
  success:     '#17915C',
  successSoft: '#E2F4EA',
  warning:     '#C77A12',
  warningSoft: '#FDF0DD',
  series:      ['#5947E0', '#1597A8', '#C94F97', '#17915C'],
  heat:        ['#CDEFD9', '#7FD3A3', '#FFD37A', '#F59A3C', '#E5566B'],
  overlay:     'rgba(17,16,24,0.42)',
  // совместимость: где ещё остался LinearGradient — он рисуется ровным цветом
  gradient:    ['#5947E0', '#5947E0'] as [string, string],
  titleColor:  '#5947E0',
  tints:       noTints,
};

const dark: typeof light = {
  scheme:      'dark',
  bg:          '#111018',
  surface:     '#1B1926',
  surface2:    '#232031',
  surface3:    '#2C283D',
  border:      '#2C2840',
  borderStrong:'#3B3656',
  seam:        '#464063',
  text:        '#EEEBF8',
  textMuted:   '#A39DC6',
  textFaint:   '#7B7599',
  primary:     '#8B7BFF',
  primaryStrong:'#6E5CF0',
  primarySoft: '#26214A',
  primaryText: '#FFFFFF',
  gold:        '#FFC24B',
  goldDeep:    '#E8A21F',
  goldSoft:    '#3A2F16',
  accent:      '#3DCB8C',
  tabBar:      '#1B1926',
  danger:      '#FF6B81',
  dangerSoft:  '#3A1B25',
  success:     '#3DCB8C',
  successSoft: '#16332A',
  warning:     '#FFB547',
  warningSoft: '#3A2A12',
  series:      ['#8B7BFF', '#3FC6D6', '#F07CC0', '#3DCB8C'],
  heat:        ['#1E4A35', '#2E7A55', '#7E6220', '#A85D26', '#B03C52'],
  overlay:     'rgba(0,0,0,0.6)',
  gradient:    ['#6E5CF0', '#6E5CF0'],
  titleColor:  '#8B7BFF',
  tints:       noTints,
};

export type Theme = typeof light;

// ─── Режим темы: светлая / тёмная / авто (по системе) ────────────────────────

export type ThemeMode = 'light' | 'dark' | 'auto';
const MODE_KEY = 'theme_mode';

let _mode: ThemeMode = 'auto';
const listeners = new Set<() => void>();

export async function initThemeMode() {
  try {
    const raw = await SecureStore.getItemAsync(MODE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'auto') _mode = raw;
  } catch { /* default auto */ }
  listeners.forEach(l => l());
}

export async function setThemeMode(mode: ThemeMode) {
  _mode = mode;
  listeners.forEach(l => l());
  await SecureStore.setItemAsync(MODE_KEY, mode);
}

export function useThemeMode(): ThemeMode {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return _mode;
}

export function useTheme(): Theme {
  const system = useColorScheme();
  const mode = useThemeMode();
  const effective = mode === 'auto' ? system : mode;
  return effective === 'dark' ? dark : light;
}

// Эффективная схема для StatusBar
export function useEffectiveScheme(): 'light' | 'dark' {
  const system = useColorScheme();
  const mode = useThemeMode();
  return (mode === 'auto' ? system : mode) === 'dark' ? 'dark' : 'light';
}

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
};

// Радиусы как в вебе: --r-sm 8, --r-md 12, --r-lg 18
export const radius = {
  sm: 8, md: 12, lg: 18, xl: 24, pill: 999,
};

// Тени как --shadow-1 / --shadow-2
export const shadow1 = { shadowColor: '#1C1830', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 };
export const shadow2 = { shadowColor: '#1C1830', shadowOpacity: 0.16, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 };

export const font = {
  xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24, xxxl: 32,
};
