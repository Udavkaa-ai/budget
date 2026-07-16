import React from 'react';
import { StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, type TabTint } from '../theme';

// Абсолютный фон-градиент вкладки: свой оттенок вверху, тающий в базовый фон.
// Кладётся первым ребёнком корневого View экрана — рисуется за контентом.
export function ScreenGradient({ tint }: { tint: TabTint }) {
  const t = useTheme();
  return (
    <LinearGradient
      colors={[t.tints[tint], 'transparent']}
      locations={[0, 0.45]}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    />
  );
}
