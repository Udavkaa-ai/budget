import 'react-native-gesture-handler';
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme, ActivityIndicator, View } from 'react-native';

import { AppNavigator } from './src/navigation';
import AuthScreen from './src/screens/AuthScreen';
import { useAuth } from './src/hooks/useAuth';
import { initClassifier } from './src/classifier';

// Init classifier once at startup
initClassifier().catch(console.error);

function Root() {
  const { user, loading, onLoginSuccess } = useAuth();
  const scheme = useColorScheme();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
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
  const scheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Root />
    </GestureHandlerRootView>
  );
}
