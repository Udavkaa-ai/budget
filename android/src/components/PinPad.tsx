import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing } from '../theme';
import { haptics } from '../haptics';

// Цифровая клавиатура ввода PIN: точки-индикатор + сетка 0–9 и удаление.
// Как только набрано `length` цифр — вызывает onComplete и очищается.
export function PinPad({
  length = 4,
  onComplete,
  error,
}: {
  length?: number;
  onComplete: (pin: string) => void;
  error?: boolean;
}) {
  const t = useTheme();
  const [digits, setDigits] = useState('');

  const press = (d: string) => {
    if (digits.length >= length) return;
    const next = digits + d;
    haptics.select();
    setDigits(next);
    if (next.length === length) {
      setTimeout(() => { onComplete(next); setDigits(''); }, 130);
    }
  };
  const del = () => { haptics.select(); setDigits(d => d.slice(0, -1)); };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

  return (
    <View style={styles.wrap}>
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                borderColor: error ? t.danger : t.primary,
                backgroundColor: i < digits.length ? (error ? t.danger : t.primary) : 'transparent',
              },
            ]}
          />
        ))}
      </View>
      <View style={styles.grid}>
        {keys.map((k, i) => {
          if (k === '') return <View key={i} style={styles.key} />;
          if (k === 'del') {
            return (
              <TouchableOpacity key={i} style={styles.key} onPress={del} activeOpacity={0.6}>
                <Ionicons name="backspace-outline" size={26} color={t.textMuted} />
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity
              key={i}
              style={[styles.key, styles.keyNum, { backgroundColor: t.surface, borderColor: t.border }]}
              onPress={() => press(k)}
              activeOpacity={0.6}
            >
              <Text style={{ color: t.text, fontSize: 26, fontWeight: '600' }}>{k}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const KEY = 72;
const styles = StyleSheet.create({
  wrap:  { alignItems: 'center' },
  dots:  { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
  dot:   { width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  grid:  { width: KEY * 3 + spacing.lg * 2, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, justifyContent: 'center' },
  key:   { width: KEY, height: KEY, alignItems: 'center', justifyContent: 'center' },
  keyNum:{ borderRadius: KEY / 2, borderWidth: 1 },
});
