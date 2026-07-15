import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, ActivityIndicator, View, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { flushOutbox } from './src/offline';
import { refreshCategories } from './src/categories';
import { initThemeMode, useEffectiveScheme, useTheme } from './src/theme';
import { initAppLock, useLockEnabled, authenticate } from './src/applock';
import { Text, TouchableOpacity } from 'react-native';

import { AppNavigator } from './src/navigation';
import AuthScreen from './src/screens/AuthScreen';
import { useAuth } from './src/hooks/useAuth';
import { initClassifier } from './src/classifier';
import { importSeed } from './src/classifier/db';
import { initPremium } from './src/premium';
import { initBlocks } from './src/blocks';
import { crowd, api } from './src/api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

initClassifier().catch(console.error);
initPremium().catch(console.error);
initBlocks().catch(console.error);
initThemeMode().catch(console.error);
initAppLock().catch(console.error);

// Download crowd dictionary from server and merge into local DB
async function syncCrowdDict() {
  try {
    const dict = await crowd.getDictionary();
    const entries = Object.entries(dict).map(([word, category]) => ({
      word, category: category as string, cnt: 2,
    }));
    if (entries.length > 0) await importSeed(entries);
  } catch { /* offline — use cached seed */ }
}

// Register device for push notifications and send token to server
async function registerPushToken() {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync();
    // Send token to server so family members can receive push when someone adds an expense
    await api.post('/api/push/subscribe', {
      endpoint: token,
      keys: { p256dh: '', auth: '' }, // Expo push — server detects by endpoint prefix
      platform: 'expo',
    }).catch(() => {});
  } catch { /* notifications not available */ }
}

function Root() {
  const { user, loading, onLoginSuccess } = useAuth();
  const scheme = useColorScheme();
  const t = useTheme();
  const lockEnabled = useLockEnabled();
  const [unlocked, setUnlocked] = React.useState(false);
  const [tried, setTried] = React.useState(false);

  const tryUnlock = React.useCallback(async () => {
    setTried(true);
    if (await authenticate()) setUnlocked(true);
  }, []);

  useEffect(() => {
    if (lockEnabled && !unlocked && !tried && !loading) tryUnlock();
  }, [lockEnabled, unlocked, tried, loading, tryUnlock]);

  // Блокируем заново при уходе в фон
  useEffect(() => {
    if (!lockEnabled) return;
    const sub = AppState.addEventListener('change', st => {
      if (st === 'background') { setUnlocked(false); setTried(false); }
    });
    return () => sub.remove();
  }, [lockEnabled]);

  useEffect(() => {
    if (user) {
      syncCrowdDict();
      registerPushToken();
      refreshCategories();
      flushOutbox().catch(() => {});
    }
  }, [user]);

  // Офлайн-очередь: пробуем дослать при возврате в приложение и раз в 30 секунд
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') flushOutbox().catch(() => {});
    });
    const timer = setInterval(() => { flushOutbox().catch(() => {}); }, 30_000);
    return () => { sub.remove(); clearInterval(timer); };
  }, [user]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  if (lockEnabled && !unlocked && !loading && user) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: t.bg, padding: 32 }}>
        <Text style={{ fontSize: 56, marginBottom: 12 }}>🔒</Text>
        <Text style={{ color: t.text, fontSize: 20, fontWeight: '800', marginBottom: 6 }}>Семейный бюджет</Text>
        <Text style={{ color: t.textMuted, textAlign: 'center', marginBottom: 24 }}>
          Приложение заблокировано
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: t.primary, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28 }}
          onPress={tryUnlock}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>Разблокировать</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!user) {
    return <AuthScreen onLoginSuccess={onLoginSuccess} />;
  }

  return (
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  const scheme = useEffectiveScheme();
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <Root />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
