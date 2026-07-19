import React from 'react';
import {
  Text, TextInput, ActivityIndicator,
  StyleSheet, type TextInputProps, type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme, spacing, font, radius } from '../theme';
import { PressableScale } from './Motion';

// Поле ввода в стиле веба: скругление 14, фиолетовая полупрозрачная рамка
export function Field(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.textMuted}
      {...props}
      style={[
        styles.field,
        { color: t.text, borderColor: t.border, backgroundColor: t.surface },
        props.style,
      ]}
    />
  );
}

// Кнопка в стиле веб-версии: градиент 135° #8A6BFF → #5947E0, мягкая тень
export function PrimaryButton({ title, onPress, disabled, loading, style }: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <PressableScale onPress={onPress} disabled={disabled || loading} style={style} scaleTo={0.97}>
      <LinearGradient
        colors={t.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.btn, { opacity: disabled || loading ? 0.6 : 1 }]}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>{title}</Text>}
      </LinearGradient>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  field: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingVertical: 13,
    paddingHorizontal: 16,
    fontSize: font.md,
  },
  btn: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5947E0',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  btnText: { color: '#fff', fontSize: font.md, fontWeight: '700' },
});
