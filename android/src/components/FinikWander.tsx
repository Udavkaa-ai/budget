import React, { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Finik } from './Finik';

const TAB_BAR = 60; // высота нижней панели (см. navigation/index.tsx)

// Иногда Финик проходит по верхнему краю нижней панели: раз в ~минуту,
// поочерёдно слева-направо и справа-налево, лицом по ходу движения.
export function FinikWander() {
  const insets = useSafeAreaInsets();
  const W = Dimensions.get('window').width;
  const size = 44;
  const x = useRef(new Animated.Value(-100)).current;
  const count = useRef(0);
  const [walk, setWalk] = useState<{ on: boolean; rtl: boolean }>({ on: false, rtl: false });

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const cross = () => {
      const rtl = count.current % 2 === 1;
      count.current += 1;
      setWalk({ on: true, rtl });
      x.setValue(rtl ? W + 40 : -70);
      Animated.timing(x, {
        toValue: rtl ? -70 : W + 40,
        duration: 9000, easing: Easing.linear, useNativeDriver: true,
      }).start(({ finished }) => { if (finished && alive) setWalk(w => ({ ...w, on: false })); });
    };
    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        if (!alive) return;
        cross();
        schedule(55000 + Math.random() * 15000); // примерно раз в минуту
      }, delay);
    };
    schedule(15000 + Math.random() * 8000);
    return () => { alive = false; clearTimeout(timer); };
  }, [W, x]);

  if (!walk.on) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: TAB_BAR + insets.bottom - 4, height: 52, justifyContent: 'flex-end' }}>
      <Animated.View style={{ width: size, transform: [{ translateX: x }, { scaleX: walk.rtl ? -1 : 1 }] }}>
        <Finik emotion="walk" size={size} interactive={false} />
      </Animated.View>
    </View>
  );
}
