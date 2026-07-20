import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useTheme, spacing, font, radius } from '../theme';
import { setServerUrl, setToken, passwordLogin, api } from '../api/client';
import { Field, PrimaryButton } from '../components/UI';

WebBrowser.maybeCompleteAuthSession();

// Демо-сборка: включает вход по логину/паролю (lena/Lena) и предзаполняет сервер.
// EXPO_PUBLIC_* вшивается в JS-бандл при сборке (надёжнее Constants.extra,
// который в prebuild-сборке часто пустой). Constants — запасной вариант.
const IS_DEMO = process.env.EXPO_PUBLIC_APP_VARIANT === 'demo'
  || Constants.expoConfig?.extra?.isDemo === true;
const DEMO_SERVER = 'https://semejnyj-budzet-udavkaa.amvera.io';

interface Props {
  onLoginSuccess: (token: string) => void;
}

export default function AuthScreen({ onLoginSuccess }: Props) {
  const t = useTheme();
  const [serverUrl, setServerUrlState] = useState(IS_DEMO ? DEMO_SERVER : '');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'url' | 'auth'>('url');
  const [pwLogin, setPwLogin] = useState('lena');
  const [pwPass, setPwPass] = useState('Lena');

  const handlePasswordLogin = async () => {
    setLoading(true);
    try {
      await setServerUrl((serverUrl || DEMO_SERVER).trim().replace(/\/+$/, ''));
      const token = await passwordLogin(pwLogin.trim(), pwPass);
      onLoginSuccess(token);
    } catch (e) {
      Alert.alert('Не удалось войти', 'Проверьте логин и пароль');
    } finally {
      setLoading(false);
    }
  };

  const handleServerUrl = async () => {
    const url = serverUrl.trim().replace(/\/+$/, '');
    setServerUrlState(url);
    if (!url.startsWith('http')) { Alert.alert('Введите корректный URL'); return; }
    setLoading(true);
    try {
      await setServerUrl(url);
      // Ping the server
      await api.get('/health').catch(() => {});
      setStep('auth');
    } catch {
      Alert.alert('Не удалось подключиться к серверу', url);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: 'google' | 'yandex' | 'vk') => {
    setLoading(true);
    try {
      // Открываем OAuth-страницу сервера в браузер-сессии; сервер редиректит
      // обратно с токеном в query (?token=). Один флоу на всех провайдеров.
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'familybudget' });
      const result = await WebBrowser.openAuthSessionAsync(
        `${serverUrl.trim().replace(/\/+$/, '')}/auth/${provider}/mobile?redirect=${encodeURIComponent(redirectUri)}`,
        redirectUri,
      );
      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const token = url.searchParams.get('token') ?? url.hash.replace('#token=', '');
        if (token) {
          await setToken(token);
          onLoginSuccess(token);
          return;
        }
      }
      Alert.alert('Не удалось войти', 'Попробуйте ещё раз');
    } catch (e) {
      Alert.alert('Ошибка входа', String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={styles.inner}>
          <Text style={[styles.logo, { color: t.text }]}>💰</Text>
          <Text style={[styles.title, { color: t.text }]}>{IS_DEMO ? 'Бюджет · Демо' : 'Семейный бюджет'}</Text>
          <Text style={[styles.sub, { color: t.textMuted }]}>
            {IS_DEMO ? 'Демо-режим: вход по паролю' : (step === 'url' ? 'Введите адрес вашего сервера' : 'Выберите способ входа')}
          </Text>

          {IS_DEMO ? (
            <>
              <Field
                style={{ marginBottom: spacing.md }}
                value={pwLogin}
                onChangeText={setPwLogin}
                placeholder="Логин"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Field
                style={{ marginBottom: spacing.md }}
                value={pwPass}
                onChangeText={setPwPass}
                placeholder="Пароль"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <PrimaryButton title="Войти" onPress={handlePasswordLogin} loading={loading} />
            </>
          ) : step === 'url' ? (
            <>
              <Field
                style={{ marginBottom: spacing.md }}
                value={serverUrl}
                onChangeText={setServerUrlState}
                placeholder="https://your-app.railway.app"
                autoCapitalize="none"
                keyboardType="url"
                autoCorrect={false}
              />
              <PrimaryButton title="Продолжить" onPress={handleServerUrl} loading={loading} />
            </>
          ) : (
            <>
              <PrimaryButton title="Войти через Яндекс" onPress={() => handleOAuth('yandex')} loading={loading} />
              <View style={{ height: spacing.md }} />
              <PrimaryButton title="Войти через VK" onPress={() => handleOAuth('vk')} loading={loading} />
              {/* Google-кнопку в RuStore-сборке не показываем. Существующие
                  Google-аккаунты переносятся привязкой Яндекс/VK в веб-версии. */}
              <TouchableOpacity onPress={() => setStep('url')} style={{ marginTop: spacing.lg }}>
                <Text style={{ color: t.textMuted, textAlign: 'center' }}>‹ Изменить сервер</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1 },
  kav:   { flex: 1 },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  logo:  { fontSize: 64, textAlign: 'center', marginBottom: spacing.md },
  title: { fontSize: font.xxl, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs },
  sub:   { fontSize: font.md, textAlign: 'center', marginBottom: spacing.xl },
  input: { borderRadius: radius.md, borderWidth: 1, padding: spacing.lg, fontSize: font.md, marginBottom: spacing.md },
  btn:   { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: font.md, fontWeight: '600' },
});
