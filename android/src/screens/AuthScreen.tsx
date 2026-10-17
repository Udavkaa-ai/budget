import React, { useState } from 'react';
import { showAlert } from '../dialog';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, font } from '../theme';
import { Field, PrimaryButton } from '../components/UI';
import { Finik } from '../components/Finik';
import { useFinikEnabled } from '../finik';
import { loginLocal } from '../hooks/useAuth';

// Первый запуск: без сервера и аккаунтов — только имя, под которым будут
// ваши расходы. Данные хранятся на телефоне; с телефоном партнёра — через
// общую папку на Яндекс Диске или напрямую по Wi-Fi (Настройки › Семья).
interface Props {
  onLoginSuccess: (token: string) => void;   // оставлено для совместимости с App
}

export default function AuthScreen(_props: Props) {
  const t = useTheme();
  const finikOn = useFinikEnabled();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!name.trim()) { showAlert('Введите имя', 'Под этим именем будут ваши расходы — например «Удав».'); return; }
    setBusy(true);
    try { await loginLocal(name.trim()); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={styles.inner}>
          {finikOn && (
            <View style={{ alignItems: 'center', marginBottom: spacing.sm }}>
              <Finik emotion="wave" size={128} />
              <Text style={{ color: t.textMuted, fontSize: font.sm, marginTop: -2 }}>
                Привет! Я Финик — ваш семейный бухгалтер 👋
              </Text>
            </View>
          )}
          <Text style={[styles.title, { color: t.text }]}>Семейный бюджет</Text>
          <Text style={[styles.sub, { color: t.textMuted }]}>Как вас зовут?</Text>
          <Field
            style={{ marginBottom: spacing.md }}
            value={name}
            onChangeText={setName}
            placeholder="Ваше имя (как в семейных расходах)"
            autoCorrect={false}
            onSubmitEditing={start}
          />
          <PrimaryButton title="Начать" loading={busy} onPress={start} />
          <Text style={{ color: t.textMuted, textAlign: 'center', fontSize: 12, marginTop: spacing.md }}>
            Всё хранится на телефоне. С телефоном партнёра — через общую папку на Яндекс Диске или напрямую по Wi-Fi (Настройки › Семья).
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1 },
  kav:   { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  title: { fontSize: font.xxl, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs },
  sub:   { fontSize: font.md, textAlign: 'center', marginBottom: spacing.xl },
});
