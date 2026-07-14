import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { useTheme, spacing, radius } from '../theme';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
}

export function Card({ children, style }: Props) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.surface, shadowColor: t.primary }, style]}>
      {children}
    </View>
  );
}

// Мягкие карточки без рамок с лёгкой фиолетовой тенью — как в веб-версии
const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    elevation: 3,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
});
