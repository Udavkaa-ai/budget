import { useColorScheme } from 'react-native';

// Палитра повторяет веб-версию: лавандовый фон, фиолетовый примари,
// розовый акцент, мягкие белые карточки
export const palette = {
  purple:   '#6c5ce7',
  purpleHi: '#8b7cf7',
  pink:     '#ec4899',
  green:    '#22c55e',
  red:      '#ef4444',
  yellow:   '#f59e0b',
};

const light = {
  bg:          '#eef0fb',
  surface:     '#ffffff',
  surface2:    '#f1effc',
  border:      '#e4e1f5',
  text:        '#1e1b3a',
  textMuted:   '#8b87a8',
  primary:     palette.purple,
  primaryText: '#ffffff',
  accent:      palette.pink,
  tabBar:      '#ffffff',
  danger:      palette.red,
  success:     palette.green,
};

const dark = {
  bg:          '#17152b',
  surface:     '#232043',
  surface2:    '#2f2b56',
  border:      '#37325e',
  text:        '#f3f1ff',
  textMuted:   '#9d97c4',
  primary:     palette.purpleHi,
  primaryText: '#ffffff',
  accent:      '#f472b6',
  tabBar:      '#232043',
  danger:      palette.red,
  success:     palette.green,
};

export type Theme = typeof light;

export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? dark : light;
}

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32,
};

export const radius = {
  sm: 10, md: 14, lg: 20, xl: 28,
};

export const font = {
  xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24, xxxl: 32,
};
