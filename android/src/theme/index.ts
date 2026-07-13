import { useColorScheme } from 'react-native';

export const palette = {
  blue:    '#3b82f6',
  blueDim: '#1d4ed8',
  green:   '#22c55e',
  red:     '#ef4444',
  yellow:  '#f59e0b',
  purple:  '#a855f7',
};

const light = {
  bg:          '#f8fafc',
  surface:     '#ffffff',
  surface2:    '#f1f5f9',
  border:      '#e2e8f0',
  text:        '#0f172a',
  textMuted:   '#64748b',
  primary:     palette.blue,
  primaryText: '#ffffff',
  tabBar:      '#ffffff',
  danger:      palette.red,
  success:     palette.green,
};

const dark = {
  bg:          '#0f172a',
  surface:     '#1e293b',
  surface2:    '#334155',
  border:      '#334155',
  text:        '#f8fafc',
  textMuted:   '#94a3b8',
  primary:     palette.blue,
  primaryText: '#ffffff',
  tabBar:      '#1e293b',
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
  sm: 8, md: 12, lg: 16, xl: 24,
};

export const font = {
  xs: 11, sm: 13, md: 15, lg: 17, xl: 20, xxl: 24, xxxl: 32,
};
