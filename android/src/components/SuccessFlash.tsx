import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, withDelay, runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, font, radius, spacing } from '../theme';

// Плашка-подтверждение «✓ …» по центру: всплывает, держится, тает.
// Триггер — смена числа `token` (каждый раз новое значение = новый показ).
export function SuccessFlash({ token, label }: { token: number; label: string }) {
  const t = useTheme();
  const progress = useSharedValue(0);
  const [mounted, setMounted] = React.useState(false);

  useEffect(() => {
    if (token === 0) return;
    setMounted(true);
    progress.value = 0;
    progress.value = withSequence(
      withTiming(1, { duration: 220 }),
      withDelay(760, withTiming(0, { duration: 260 }, (fin) => {
        if (fin) runOnJS(setMounted)(false);
      })),
    );
  }, [token]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.85 + progress.value * 0.15 }, { translateY: (1 - progress.value) * 10 }],
  }));

  if (!mounted) return null;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.View style={[styles.badge, { backgroundColor: t.surface, borderColor: t.border }, style]}>
        <Ionicons name="checkmark-circle" size={22} color={t.success} />
        <Text style={{ color: t.text, fontWeight: '700', fontSize: font.sm }}>{label}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowColor: '#5947E0',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
});
