import React from 'react';
import { View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useBlocks } from '../blocks';
import { haptics } from '../haptics';

// Ref для программного переключения вкладок (используется вводным туром)
export const navigationRef = createNavigationContainerRef();
export function goToTab(name: string) {
  if (navigationRef.isReady()) navigationRef.navigate(name as never);
}

import HomeScreen from '../screens/HomeScreen';
import SummaryScreen from '../screens/SummaryScreen';
import ChartScreen from '../screens/ChartScreen';
import GoalsScreen from '../screens/GoalsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import { FinikWander } from '../components/FinikWander';

const Tab = createBottomTabNavigator();

type IonName = React.ComponentProps<typeof Ionicons>['name'];

// Единый набор иконок (Ionicons): заливка на активной вкладке, контур на неактивной
function tabIcon(base: string) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Ionicons name={(focused ? base : `${base}-outline`) as IonName} size={23} color={color} />
  );
}

export function AppNavigator() {
  const t = useTheme();
  const blocks = useBlocks();
  return (
    <View style={{ flex: 1 }}>
    <Tab.Navigator
      screenListeners={{ tabPress: () => haptics.select() }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: t.tabBar,
          borderTopColor: t.border,
          borderTopWidth: 1,
          height: 60,
          paddingTop: 6,
          paddingBottom: 8,
        },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: 'Бюджет', tabBarIcon: tabIcon('wallet') }}
      />
      <Tab.Screen
        name="Summary"
        component={SummaryScreen}
        options={{ tabBarLabel: 'Месяц', tabBarIcon: tabIcon('pie-chart') }}
      />
      {blocks.chartTab && (
        <Tab.Screen
          name="Chart"
          component={ChartScreen}
          options={{ tabBarLabel: 'График', tabBarIcon: tabIcon('trending-up') }}
        />
      )}
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: 'Настройки', tabBarIcon: tabIcon('settings') }}
      />
      {blocks.goalsTab && (
        <Tab.Screen
          name="Goals"
          component={GoalsScreen}
          options={{ tabBarLabel: 'Цели', tabBarIcon: tabIcon('flag') }}
        />
      )}
    </Tab.Navigator>
    <FinikWander />
    </View>
  );
}
