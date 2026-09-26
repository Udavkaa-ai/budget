import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, spacing, radius, shadow1 } from '../theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// Карточка как в вебе: ровная заливка, тонкая рамка, едва заметная тень
export function Card({ children, style }: Props) {
  const t = useTheme();
  return (
    <View style={[styles.card, shadow1, { backgroundColor: t.surface, borderColor: t.border }, t.scheme === 'dark' && { shadowOpacity: 0.3 }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
});
