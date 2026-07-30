import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Палитра 1:1 с веб-версией (:root в style.css)
export const palette = {
  primary:     '#5947E0',
  primaryHi:   '#8A6BFF',
  primaryDark: '#4233C8',
  pink:        '#FF7AB3',
  mint:        '#7AE0C3',
  red:         '#FF5C87',
  yellow:      '#FFB47A',
  green:       '#22c55e',
};

// Ненавязчивый цветовой «дымок» вверху каждой вкладки — свой оттенок,
// как акцентные фоны в вебе. Верхний цвет тает в прозрачность к ~45% экрана.
export type TabTint = 'home' | 'summary' | 'chart' | 'settings' | 'goals';

const light = {
  bg:          '#EAE4FF',
  surface:     '#FDFCFF',
  surface2:    '#F1EDFF',
  border:      'rgba(89,71,224,0.18)',
  text:        '#1A1530',
  textMuted:   '#645E82', /* WCAG AA: #7A7396 давал 3.6–4.3:1, теперь ≥4.9:1 */
  primary:     palette.primary,
  primaryText: '#ffffff',
  accent:      palette.pink,
  tabBar:      '#FDFCFF',
  danger:      palette.red,
  success:     palette.green,
  gradient:    [palette.primaryHi, palette.primary] as [string, string],
  titleColor:  palette.primary,
  tints: {
    home:     'rgba(137,107,255,0.22)',
    summary:  'rgba(255,122,179,0.20)',
    chart:    'rgba(122,224,195,0.22)',
    settings: 'rgba(122,115,150,0.16)',
    goals:    'rgba(255,180,122,0.22)',
  } as Record<TabTint, string>,
};

const dark = {
  bg:          '#17152B',
  surface:     '#232043',
  surface2:    '#2F2B56',
  border:      'rgba(138,107,255,0.30)',
  text:        '#F3F1FF',
  textMuted:   '#9D97C4',
  primary:     palette.primaryHi,
  primaryText: '#ffffff',
  accent:      palette.pink,
  tabBar:      '#232043',
  danger:      palette.red,
  success:     palette.green,
  gradient:    [palette.primaryHi, palette.primary] as [string, string],
  titleColor:  palette.primaryHi,
  tints: {
    home:     'rgba(137,107,255,0.18)',
    summary:  'rgba(255,122,179,0.15)',
    chart:    'rgba(122,224,195,0.14)',
    settings: 'rgba(157,151,196,0.12)',
    goals:    'rgba(255,180,122,0.15)',
  } as Record<TabTint, string>,
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

// Радиусы как в вебе: --radius 20, --radius-sm 14, --radius-xs 10
export const radius = {
  sm: 10, md: 14, lg: 20, xl: 28,
};

export const font = {
  xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24, xxxl: 32,
};
