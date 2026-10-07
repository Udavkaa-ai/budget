import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, AppState, Linking } from 'react-native';
import { flushOutbox } from './src/offline';
import { refreshCategories } from './src/categories';
import { initThemeMode, useEffectiveScheme } from './src/theme';
import { initAppLock, useLockEnabled, isAuthInProgress, isSystemUiInProgress } from './src/applock';
import { LockScreen } from './src/components/LockScreen';
import { Tour } from './src/components/Tour';
import { HelpScreen } from './src/components/HelpScreen';
import { DialogHost } from './src/components/DialogHost';
import { AchievementToast } from './src/components/AchievementToast';
import { initTour, tourSeen, isTourActive, startTour, useTourLoaded } from './src/tour';
import { initAchievements } from './src/achievements';
import { initE2E, isE2E } from './src/e2e';
import { syncNow } from './src/e2e/sync';

import { AppNavigator, navigationRef, goToTab } from './src/navigation';
import { requestQuickAdd } from './src/quickAdd';
import AuthScreen from './src/screens/AuthScreen';
import { useAuth } from './src/hooks/useAuth';
import { checkUpdateNotices } from './src/updateNotices';
import { showAlert } from './src/dialog';
import { BankInboxHost, openBankInbox } from './src/components/BankInbox';
import { consumeShared, drainNative, isPersonalBuild } from './src/bank/inbox';
import { initClassifier } from './src/classifier';
import { importSeed } from './src/classifier/db';
import { initPremium } from './src/premium';
import { initFinik } from './src/finik';
import { initBlocks } from './src/blocks';
import { crowd } from './src/api/client';
import { registerPush } from './src/push';   // там же фоновая задача и обработчик пушей


initClassifier().catch(console.error);
initPremium().catch(console.error);
initFinik().catch(console.error);
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

function Root() {
  const { user, loading, onLoginSuccess } = useAuth();
  const lockEnabled = useLockEnabled();
  const [unlocked, setUnlocked] = React.useState(false);
  const tourReady = useTourLoaded();

  // Автозапуск тура для новых пользователей (после входа и загрузки флага)
  useEffect(() => {
    if (user && tourReady && !tourSeen() && !isTourActive()) startTour();
  }, [user, tourReady]);

  // После обновления версии: просьба оценить в RuStore + рассказ о веб-версии.
  // Ждём разблокировки, чтобы окна не легли поверх экрана PIN-кода.
  const ready = !!user && tourReady && (!lockEnabled || unlocked);
  useEffect(() => {
    if (!ready) return;
    const existing = tourSeen() && !isTourActive();
    const id = setTimeout(() => { checkUpdateNotices(existing).catch(() => {}); }, 1200);
    return () => clearTimeout(id);
  }, [ready]);

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
      registerPush(user.name).catch(() => {});
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

  // «Поделиться → ФИНИК»: банковское сообщение — во «Входящие», любой другой
  // текст — в окно добавления (ИИ-разбор). Личная сборка: забираем перехваченные
  // СМС/уведомления при запуске, возврате в приложение и раз в 30 секунд.
  useEffect(() => {
    if (!user) return;
    const check = async () => {
      const shared = await consumeShared().catch(() => null);
      if (shared) {
        if (shared.item) openBankInbox();
        else if (shared.sensitive) showAlert('Это код подтверждения', 'Такие сообщения ФИНИК не принимает — коды не должны попадать никуда, кроме банка.');
        else { goToTab('Home'); requestQuickAdd(shared.text); }
      }
      if (isPersonalBuild) drainNative().catch(() => {});
    };
    check();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check(); });
    const timer = isPersonalBuild ? setInterval(() => { drainNative().catch(() => {}); }, 30_000) : null;
    return () => { sub.remove(); if (timer) clearInterval(timer); };
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

  // Виджет на домашнем экране: familybudget://add открывает форму добавления.
  // (Не мешаем familybudget://auth — там host 'auth', обрабатывается отдельно.)
  useEffect(() => {
    const isAddLink = (url: string | null) => {
      if (!url) return false;
      const m = url.match(/^[a-z]+:\/\/\/?([^/?#]*)/i);
      return (m?.[1] || '').toLowerCase() === 'add';
    };
    const handle = (url: string | null) => {
      if (!isAddLink(url)) return;
      goToTab('Home');
      requestQuickAdd();
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const sub = Linking.addEventListener('url', e => handle(e.url));
    return () => sub.remove();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#5947E0" />
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
      <BankInboxHost />
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
        <DialogHost />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
