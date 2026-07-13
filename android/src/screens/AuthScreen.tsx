import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { useTheme, spacing, font, radius } from '../theme';
import { setServerUrl, setToken, api } from '../api/client';

WebBrowser.maybeCompleteAuthSession();

interface Props {
  onLoginSuccess: (token: string) => void;
}

export default function AuthScreen({ onLoginSuccess }: Props) {
  const t = useTheme();
  const [serverUrl, setServerUrlState] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'url' | 'auth'>('url');

  const handleServerUrl = async () => {
    const url = serverUrl.trim().replace(/\/$/, '');
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

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      // Open the server's Google OAuth page in a browser session
      // The server redirects back with a token in the URL fragment or query
      const redirectUri = AuthSession.makeRedirectUri({ scheme: 'familybudget' });
      const result = await WebBrowser.openAuthSessionAsync(
        `${serverUrl.trim()}/auth/google/mobile?redirect=${encodeURIComponent(redirectUri)}`,
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
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={styles.inner}>
          <Text style={[styles.logo, { color: t.text }]}>💰</Text>
          <Text style={[styles.title, { color: t.text }]}>Семейный бюджет</Text>
          <Text style={[styles.sub, { color: t.textMuted }]}>
            {step === 'url' ? 'Введите адрес вашего сервера' : 'Войдите через Google'}
          </Text>

          {step === 'url' ? (
            <>
              <TextInput
                style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
                value={serverUrl}
                onChangeText={setServerUrlState}
                placeholder="https://your-app.railway.app"
                placeholderTextColor={t.textMuted}
                autoCapitalize="none"
                keyboardType="url"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: t.primary }]}
                onPress={handleServerUrl}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnText}>Продолжить →</Text>
                }
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: t.primary }]}
                onPress={handleGoogleLogin}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.btnText}>🔐 Войти через Google</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setStep('url')} style={{ marginTop: spacing.lg }}>
                <Text style={{ color: t.textMuted, textAlign: 'center' }}>← Изменить сервер</Text>
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
