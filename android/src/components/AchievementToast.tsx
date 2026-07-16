import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, runOnJS,
} from 'react-native-reanimated';
import { useTheme, spacing, font, radius } from '../theme';
import { useAchievements, nextToast, getAchievement, type Achievement } from '../achievements';

// Плашка «🏆 Достижение получено!» — всплывает сверху при новой ачивке.
export function AchievementToast() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  useAchievements(); // подписка на ре-рендер при новой ачивке
  const [current, setCurrent] = useState<Achievement | null>(null);
  const p = useSharedValue(0);

  // Как только освобождаемся — берём следующую из очереди
  useEffect(() => {
    if (!current) {
      const id = nextToast();
      if (id) setCurrent(getAchievement(id));
    }
  });

  useEffect(() => {
    if (!current) return;
    p.value = 0;
    p.value = withSequence(
      withTiming(1, { duration: 260 }),
      withDelay(2800, withTiming(0, { duration: 300 }, (fin) => {
        if (fin) runOnJS(setCurrent)(null);
      })),
    );
  }, [current]);

  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * -24 }],
  }));

  if (!current) return null;

  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="none">
      <Animated.View style={[styles.card, { backgroundColor: t.surface, borderColor: t.primary }, style]}>
        <Text style={{ fontSize: 30 }}>{current.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.primary, fontWeight: '800', fontSize: font.xs, letterSpacing: 0.4 }}>ДОСТИЖЕНИЕ ПОЛУЧЕНО</Text>
          <Text style={{ color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{current.title}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    maxWidth: 420, marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: radius.lg, borderWidth: 1.5,
    shadowColor: '#5947E0', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 10,
  },
});
