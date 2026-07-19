import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { flushOutbox } from './src/offline';
import { refreshCategories } from './src/categories';
import { initThemeMode, useEffectiveScheme } from './src/theme';
import { initAppLock, useLockEnabled, isAuthInProgress, isSystemUiInProgress } from './src/applock';
import { LockScreen } from './src/components/LockScreen';
import { Tour } from './src/components/Tour';
import { HelpScreen } from './src/components/HelpScreen';
import { AchievementToast } from './src/components/AchievementToast';
import { initTour, tourSeen, isTourActive, startTour, useTourLoaded } from './src/tour';
import { initAchievements } from './src/achievements';
import { initE2E, isE2E } from './src/e2e';
import { syncNow } from './src/e2e/sync';

import { AppNavigator, navigationRef } from './src/navigation';
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
initTour().catch(console.error);
initAchievements().catch(console.error);

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
  const lockEnabled = useLockEnabled();
  const [unlocked, setUnlocked] = React.useState(false);
  const tourReady = useTourLoaded();

  // Автозапуск тура для новых пользователей (после входа и загрузки флага)
  useEffect(() => {
    if (user && tourReady && !tourSeen() && !isTourActive()) startTour();
  }, [user, tourReady]);

  // Блокируем заново при уходе в фон. Игнорируем ложный уход в фон, вызванный
  // системным окном биометрии или выбором фото/камерой (иначе промпт «мигает»
  // и не срабатывает, а скан чека сбрасывается на экран разблокировки).
  useEffect(() => {
    if (!lockEnabled) return;
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active' && !isAuthInProgress() && !isSystemUiInProgress()) setUnlocked(false);
    });
    return () => sub.remove();
  }, [lockEnabled]);

  useEffect(() => {
    if (user) {
      syncCrowdDict();
      registerPushToken();
      refreshCategories();
      flushOutbox().catch(() => {});
      // E2E: узнаём статус семьи и подтягиваем шифрованные изменения
      initE2E().then(() => { if (isE2E()) syncNow().catch(() => {}); }).catch(() => {});
    }
  }, [user]);

  // E2E: досинхронизация при возврате в приложение
  useEffect(() => {
    if (!user) return;
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && isE2E()) syncNow().catch(() => {});
    });
    return () => sub.remove();
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
    return <LockScreen onUnlock={() => setUnlocked(true)} />;
  }

  if (!user) {
    return <AuthScreen onLoginSuccess={onLoginSuccess} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef}>
        <AppNavigator />
      </NavigationContainer>
      <Tour />
      <HelpScreen />
      <AchievementToast />
    </View>
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
