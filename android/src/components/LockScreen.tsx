import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AppState } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { canUseBiometrics, authenticate, hasPin, verifyPin } from '../applock';
import { haptics } from '../haptics';
import { PinPad } from './PinPad';

// Экран блокировки: при каждом появлении сам пробует биометрию.
// Если её нет или юзер выбрал PIN — показывает цифровую клавиатуру.
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const t = useTheme();
  const [bioAvailable, setBioAvailable] = useState(false);
  const [pinSet, setPinSet] = useState(false);
  const [mode, setMode] = useState<'bio' | 'pin'>('bio');
  const [pinError, setPinError] = useState(false);
  const unlockedRef = useRef(false);

  const runBio = async () => {
    if (unlockedRef.current) return;
    if (!(await canUseBiometrics())) return;
    const ok = await authenticate();
    if (ok && !unlockedRef.current) { unlockedRef.current = true; onUnlock(); }
  };
  const tryBiometrics = () => { runBio(); };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bio = await canUseBiometrics();
      const pin = hasPin();
      if (cancelled) return;
      setBioAvailable(bio);
      setPinSet(pin);
      setMode(bio ? 'bio' : (pin ? 'pin' : 'bio'));
      // Небольшая задержка: после возврата из фона Android-активность ещё не
      // «resumed», и ранний authenticateAsync молча падает — ждём и пробуем.
      if (bio) { await new Promise(r => setTimeout(r, 350)); if (!cancelled) runBio(); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Повторяем запрос биометрии при каждом возврате приложения на передний план
  // (промпт биометрии сам уводит app в фон — поэтому реагируем именно на 'active')
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && mode === 'bio') runBio();
    });
    return () => sub.remove();
  }, [mode]);

  const onPin = async (pin: string) => {
    if (await verifyPin(pin)) {
      haptics.success();
      onUnlock();
    } else {
      haptics.warning();
      setPinError(true);
      setTimeout(() => setPinError(false), 800);
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: t.bg }]}>
      <View style={styles.top}>
        <View style={[styles.iconCircle, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Ionicons name="lock-closed" size={40} color={t.primary} />
        </View>
        <Text style={[styles.title, { color: t.text }]}>Семейный бюджет</Text>
        <Text style={{ color: t.textMuted, marginTop: 4 }}>
          {mode === 'pin' ? (pinError ? 'Неверный PIN' : 'Введите PIN-код') : 'Приложение заблокировано'}
        </Text>
      </View>

      {mode === 'pin' ? (
        <PinPad onComplete={onPin} error={pinError} />
      ) : (
        <TouchableOpacity
          style={[styles.bioBtn, { backgroundColor: t.primary }]}
          onPress={tryBiometrics}
        >
          <Ionicons name="finger-print" size={22} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: font.md }}>Разблокировать</Text>
        </TouchableOpacity>
      )}

      {/* Переключение способа, если доступны оба */}
      {bioAvailable && pinSet && (
        <TouchableOpacity
          style={{ marginTop: spacing.xl }}
          onPress={() => { setPinError(false); setMode(m => (m === 'pin' ? 'bio' : 'pin')); if (mode === 'bio') haptics.select(); }}
        >
          <Text style={{ color: t.primary, fontSize: font.sm, fontWeight: '600' }}>
            {mode === 'pin' ? 'Использовать отпечаток' : 'Ввести PIN-код'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  top:        { alignItems: 'center', marginBottom: spacing.xxl },
  iconCircle: { width: 84, height: 84, borderRadius: 42, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title:      { fontSize: font.xl, fontWeight: '800' },
  bioBtn:     { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 28 },
});
