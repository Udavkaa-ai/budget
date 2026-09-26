import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, ActivityIndicator, Pressable, Switch, type SwitchProps,
  StyleSheet, type TextInputProps, type ViewStyle, type StyleProp, type TextStyle,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { useTheme, spacing, font, radius } from '../theme';
import { PressableScale } from './Motion';

// Базовые элементы дизайн-системы — 1:1 с каноническим блоком компонентов
// в public/style.css: заливки вместо градиентов, одна форма для похожих вещей.

// Поле ввода: заливка surface2, тонкая рамка, на фокусе — фиолетовая рамка
export function Field(props: TextInputProps) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={t.textFaint}
      {...props}
      onFocus={e => { setFocus(true); props.onFocus?.(e); }}
      onBlur={e => { setFocus(false); props.onBlur?.(e); }}
      style={[
        styles.field,
        { color: t.text, borderColor: focus ? t.primary : t.border, backgroundColor: t.surface2 },
        props.style,
      ]}
    />
  );
}

// Три вида кнопок, как в вебе: основная (ровный фиолетовый), вторичная (заливка
// surface2), контурная (фиолетовый текст и рамка).
type BtnProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  icon?: React.ReactNode;
};

export function PrimaryButton({ title, onPress, disabled, loading, style, icon }: BtnProps) {
  const t = useTheme();
  return (
    <PressableScale onPress={onPress} disabled={disabled || loading} style={style} scaleTo={0.97}>
      <View style={[styles.btn, { backgroundColor: t.primaryStrong, opacity: disabled || loading ? 0.55 : 1 }]}>
        {loading
          ? <ActivityIndicator color="#fff" />
          : <>{icon}<Text style={[styles.btnText, { color: t.primaryText }]}>{title}</Text></>}
      </View>
    </PressableScale>
  );
}

export function SecondaryButton({ title, onPress, disabled, loading, style, icon }: BtnProps) {
  const t = useTheme();
  return (
    <PressableScale onPress={onPress} disabled={disabled || loading} style={style} scaleTo={0.97}>
      <View style={[styles.btn, { backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border, opacity: disabled ? 0.55 : 1 }]}>
        {loading ? <ActivityIndicator color={t.primary} /> : <>{icon}<Text style={[styles.btnText, { color: t.text }]}>{title}</Text></>}
      </View>
    </PressableScale>
  );
}

export function OutlineButton({ title, onPress, disabled, loading, style, icon }: BtnProps) {
  const t = useTheme();
  return (
    <PressableScale onPress={onPress} disabled={disabled || loading} style={style} scaleTo={0.97}>
      <View style={[styles.btn, { backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.borderStrong, opacity: disabled ? 0.55 : 1 }]}>
        {loading ? <ActivityIndicator color={t.primary} /> : <>{icon}<Text style={[styles.btnText, { color: t.primary }]}>{title}</Text></>}
      </View>
    </PressableScale>
  );
}

// Заголовок секции с «золотой застёжкой»: две золотые точки + капс
export function SectionTitle({ children, style, right }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.secRow, style]}>
      <View style={styles.clasp}>
        <View style={[styles.claspDot, { backgroundColor: t.gold }]} />
        <View style={[styles.claspDot, { backgroundColor: t.gold }]} />
      </View>
      <Text style={[styles.secText, { color: t.textMuted }]} numberOfLines={1}>
        {typeof children === 'string' ? children.toUpperCase() : children}
      </Text>
      {right}
    </View>
  );
}

// Чип: быстрые суммы, примеры, фильтры
export function Chip({ label, active, onPress, style, textStyle }: {
  label: string; active?: boolean; onPress?: () => void; style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return (
    <PressableScale onPress={onPress} scaleTo={0.95}>
      <View style={[styles.chip, {
        backgroundColor: active ? t.primarySoft : t.surface,
        borderColor: active ? t.primary : t.border,
      }, style]}>
        <Text style={[styles.chipText, { color: active ? t.primary : t.textMuted }, textStyle]}>{label}</Text>
      </View>
    </PressableScale>
  );
}

// Статус-чип с точкой: good / ok / warn / over
export function StatusChip({ kind, label, small }: { kind: 'good' | 'ok' | 'warn' | 'over'; label: string; small?: boolean }) {
  const t = useTheme();
  const c = { good: [t.successSoft, t.success], ok: [t.primarySoft, t.primary], warn: [t.warningSoft, t.warning], over: [t.dangerSoft, t.danger] }[kind];
  return (
    <View style={[styles.status, small && { paddingVertical: 4, paddingHorizontal: 10 }, { backgroundColor: c[0] }]}>
      <View style={[styles.statusDot, { backgroundColor: c[1] }]} />
      <Text style={{ color: c[1], fontWeight: '700', fontSize: small ? 12 : 14 }}>{label}</Text>
    </View>
  );
}

// Сегмент-переключатель со скользящей «таблеткой»
export function Segmented<T extends string>({ value, options, onChange, style }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex(o => o.value === value));
  const x = useSharedValue(0);
  const segW = w > 0 ? (w - 8) / options.length : 0;
  useEffect(() => { x.value = withSpring(idx * segW, { damping: 24, stiffness: 260, mass: 0.7 }); }, [idx, segW, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View style={[styles.seg, { backgroundColor: t.surface2 }, style]} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {segW > 0 && (
        <Animated.View style={[styles.segThumb, { width: segW, backgroundColor: t.scheme === 'dark' ? t.surface3 : t.surface }, thumb]} />
      )}
      {options.map(o => (
        <Pressable key={o.value} style={styles.segBtn} onPress={() => onChange(o.value)} accessibilityRole="tab" accessibilityState={{ selected: o.value === value }}>
          <Text style={{ fontWeight: '700', fontSize: 14, color: o.value === value ? t.text : t.textMuted }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Переключатель в цветах темы (системный — бирюзовый/серый, не наш)
export function Toggle(props: SwitchProps) {
  const t = useTheme();
  return (
    <Switch
      {...props}
      trackColor={{ false: t.surface3, true: t.primary }}
      thumbColor={props.value ? '#FFFFFF' : (t.scheme === 'dark' ? t.textMuted : '#FFFFFF')}
      ios_backgroundColor={t.surface3}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: font.md, fontWeight: '700' },
  secRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: spacing.md },
  clasp: { flexDirection: 'row', gap: 2, marginRight: 4 },
  claspDot: { width: 6, height: 6, borderRadius: 3 },
  secText: { fontSize: 12, fontWeight: '700', letterSpacing: 1, flex: 1 },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 12 },
  chipText: { fontSize: 13, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14, alignSelf: 'flex-start' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  seg: { flexDirection: 'row', padding: 4, borderRadius: radius.pill },
  segThumb: { position: 'absolute', top: 4, bottom: 4, left: 4, borderRadius: radius.pill, shadowColor: '#1C1830', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 9 },
});
