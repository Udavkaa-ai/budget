import React from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

// Мягкое появление элемента списка: выезжает снизу с лёгкой пружиной.
// Задержка растёт с индексом, но ограничена, чтобы длинные списки не «ползли».
export function FadeInItem({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).delay(Math.min(index * 45, 320))}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
