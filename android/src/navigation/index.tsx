import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { useTheme } from '../theme';
import { useBlocks } from '../blocks';

import HomeScreen from '../screens/HomeScreen';
import SummaryScreen from '../screens/SummaryScreen';
import ChartScreen from '../screens/ChartScreen';
import GoalsScreen from '../screens/GoalsScreen';
import SettingsScreen from '../screens/SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function icon(emoji: string, focused: boolean) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

export function AppNavigator() {
  const t = useTheme();
  const blocks = useBlocks();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: t.tabBar,
          borderTopColor: t.border,
        },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: { fontSize: 11, marginBottom: 2 },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: 'Расходы', tabBarIcon: ({ focused }) => icon('💰', focused) }}
      />
      <Tab.Screen
        name="Summary"
        component={SummaryScreen}
        options={{ tabBarLabel: 'Месяц', tabBarIcon: ({ focused }) => icon('📊', focused) }}
      />
      {blocks.chartTab && (
        <Tab.Screen
          name="Chart"
          component={ChartScreen}
          options={{ tabBarLabel: 'График', tabBarIcon: ({ focused }) => icon('📈', focused) }}
        />
      )}
      {blocks.goalsTab && (
        <Tab.Screen
          name="Goals"
          component={GoalsScreen}
          options={{ tabBarLabel: 'Цели', tabBarIcon: ({ focused }) => icon('🎯', focused) }}
        />
      )}
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ tabBarLabel: 'Настройки', tabBarIcon: ({ focused }) => icon('⚙️', focused) }}
      />
    </Tab.Navigator>
  );
}
