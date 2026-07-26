import React, { useState } from 'react';
import Animated, {
  FadeInDown, FadeIn, useSharedValue, useAnimatedStyle, withSpring, withTiming,
  runOnJS, useReducedMotion, Easing,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, View, Dimensions, type ViewStyle, type StyleProp } from 'react-native';

// Мягкое появление элемента списка: выезжает снизу с лёгкой пружиной.
// Задержка растёт с индексом, но ограничена, чтобы длинные списки не «ползли».
// Под reduce-motion сдвиг убираем — остаётся только проявление.
export function FadeInItem({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const delay = Math.min(index * 45, 320);
  return (
    <Animated.View
      entering={reduce
        ? FadeIn.duration(180).delay(delay)
        : FadeInDown.springify().damping(18).delay(delay)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// «Отклик прежде всего»: элемент вжимается на нажатии (не на отпускании).
// Пружина без перелёта (критически задемпфированная) — снапово и по-эппловски.
// Под reduce-motion press-scale отключаем.
export function PressableScale({
  children, onPress, disabled, style, scaleTo = 0.96,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
}) {
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  const aStyle = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  const to = reduce ? 1 : scaleTo;
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => { s.value = withSpring(to, { damping: 26, stiffness: 420, mass: 0.5 }); }}
      onPressOut={() => { s.value = withSpring(1, { damping: 22, stiffness: 380, mass: 0.5 }); }}
      style={[aStyle, style]}
    >
      {children}
    </AnimatedPressable>
  );
}

// ── Прямое манипулирование: горизонтальный свайп-пейджер ──────────────────────
// 1:1-трекинг пальца, передача скорости в пружину на отпускании (velocity handoff),
// проекция инерции (лёгкий флик = переход), резиновое сопротивление на закрытой
// границе. Вход/выход симметричны (ушло влево — новое пришло справа).

// Резинка: чем дальше за границу, тем меньше следует за пальцем (раздел 9 скилла).
function rubber(x: number, dim: number, c = 0.55): number {
  'worklet';
  return (x * dim * c) / (dim + c * Math.abs(x));
}
// Проекция точки покоя по скорости (экспоненциальное затухание, раздел 6).
function project(v: number, d = 0.998): number {
  'worklet';
  return (v / 1000) * d / (1 - d);
}

export function SwipePager({
  canPrev = true, canNext = true, onPrev, onNext, onCommit, children, style, prev, next,
}: {
  canPrev?: boolean;
  canNext?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onCommit?: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  // Соседние страницы (вчера/завтра). Если заданы — включается режим карусели:
  // во время свайпа виден и текущий, и соседний день одновременно.
  prev?: React.ReactNode;
  next?: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const tx = useSharedValue(0);
  const op = useSharedValue(1);
  const committing = useSharedValue(0); // 1 пока идёт анимация перехода — не сбрасываем
  const [w, setW] = useState(Dimensions.get('window').width);
  const width = w;
  const peek = prev !== undefined || next !== undefined;

  const OUT = { damping: 22, stiffness: 210, mass: 0.6 };
  const BACK = { damping: 20, stiffness: 300, mass: 0.5 };
  const EXIT = Easing.in(Easing.cubic); // ускорение на выход старого контента

  // Жёстко разводим оси, чтобы горизонтальный свайп и вертикальный pull-to-refresh
  // НЕ срабатывали одновременно: горизонталь активируется только после 24px и
  // только если вертикаль ещё не ушла за 12px (иначе жест проваливается — работает
  // скролл/refresh). failOffsetY гарантирует, что вертикальный потяг отдаётся списку.
  const pan = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-12, 12])
    // Новое касание всегда возвращает чистое видимое состояние — если предыдущий
    // переход ещё доигрывал, перехватываем его без «залипания».
    .onBegin(() => {
      'worklet';
      committing.value = 0;
      op.value = 1;
    })
    .onUpdate(e => {
      'worklet';
      // Дополнительная страховка: если жест всё же вертикально-доминантный — не тянем вбок.
      if (Math.abs(e.translationY) > Math.abs(e.translationX)) { tx.value = 0; return; }
      let d = e.translationX;
      if ((d > 0 && !canPrev) || (d < 0 && !canNext)) d = rubber(d, width);
      tx.value = d;
    })
    .onEnd(e => {
      'worklet';
      const projected = e.translationX + project(e.velocityX);
      const th = width * 0.26;
      const horizontal = Math.abs(e.translationX) > Math.abs(e.translationY);
      const goNext = horizontal && canNext && projected < -th;
      const goPrev = horizontal && canPrev && projected > th;
      if (!goNext && !goPrev) { tx.value = withSpring(0, { ...BACK, velocity: e.velocityX }); return; }
      committing.value = 1;
      if (onCommit) runOnJS(onCommit)();
      const dir = goNext ? -1 : 1;                 // -1: следующий слева-направо уходит влево
      const commit = goNext ? onNext : onPrev;
      if (peek) {
        // Карусель: соседний день доезжает ДО ЦЕНТРА пружиной (виден по-настоящему),
        // затем незаметно «пересобираем» — короткий fade маскирует единственный кадр
        // рекицла (данные соседа уже предзагружены, поэтому подмены не видно).
        tx.value = withSpring(dir * width, { ...OUT, velocity: e.velocityX }, fin => {
          if (fin) {
            op.value = 0;
            runOnJS(commit)();
            tx.value = 0;
            op.value = withTiming(1, { duration: 120 }, () => { committing.value = 0; });
          }
        });
      } else {
        // Без соседей (месяц/график): выезд + возврат нового с противоположного края.
        tx.value = withTiming(dir * width, { duration: 190, easing: EXIT }, fin => {
          if (fin) {
            runOnJS(commit)();
            tx.value = -dir * width * 0.6; op.value = 0;
            op.value = withTiming(1, { duration: 240 });
            tx.value = withSpring(0, { ...OUT, velocity: e.velocityX }, f2 => { if (f2) committing.value = 0; });
          }
        });
      }
    })
    // Любое прерывание/отмена жеста возвращает экран на место — не «залипает» вбок.
    .onFinalize(() => {
      'worklet';
      if (committing.value === 0) { tx.value = withSpring(0, BACK); op.value = 1; }
    });

  const aStyle = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateX: tx.value }] }));

  // Под reduce-motion жест-слайд отключаем — навигация остаётся по кнопкам-стрелкам.
  if (reduce) {
    return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
  }

  // Режим карусели: соседние дни лежат по краям (−w и +w) внутри движущегося
  // слоя, поэтому во время свайпа виден и текущий, и соседний день. Внешний
  // контейнер обрезает их за краями в покое. pointerEvents=none — соседи не
  // перехватывают касания. Ширину меряем по факту (onLayout).
  if (peek) {
    return (
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[{ flex: 1, overflow: 'hidden' }, style]}
          onLayout={ev => { const lw = ev.nativeEvent.layout.width; if (lw && Math.abs(lw - w) > 0.5) setW(lw); }}
        >
          <Animated.View style={[{ flex: 1 }, aStyle]}>
            {prev != null && (
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: -w, width: w }} pointerEvents="none">{prev}</View>
            )}
            {children}
            {next != null && (
              <View style={{ position: 'absolute', top: 0, bottom: 0, left: w, width: w }} pointerEvents="none">{next}</View>
            )}
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ flex: 1 }, aStyle, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}
