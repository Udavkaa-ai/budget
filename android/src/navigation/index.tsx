import React, { useEffect, useRef } from 'react';
import { Animated, AppState, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNavigationContainerRef } from '@react-navigation/native';
import { SvgXml } from 'react-native-svg';
import { tabIconXml, type TabIconName } from '../tabIcons';
import { refreshSupportUnread, useSupportUnread } from '../supportStore';
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

// Свои иконки в стиле Финика: активная — в цвете с лёгким «пружинящим» увеличением,
// неактивные — приглушённый силуэт (1:1 с вебом).
function TabIcon({ name, focused }: { name: TabIconName; focused: boolean }) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(focused ? 1.12 : 1)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? 1.12 : 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [focused, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <SvgXml xml={tabIconXml(name, focused, t.textMuted, t.tabBar)} width={26} height={26} />
    </Animated.View>
  );
}
function tabIcon(name: TabIconName) {
  return ({ focused }: { focused: boolean }) => <TabIcon name={name} focused={focused} />;
}

export function AppNavigator() {
  const t = useTheme();
  const blocks = useBlocks();
  const supportUnread = useSupportUnread();
  // Ответ поддержки: проверяем при запуске и при каждом возвращении в приложение
  useEffect(() => {
    refreshSupportUnread();
    const sub = AppState.addEventListener('change', st => { if (st === 'active') refreshSupportUnread(); });
    return () => sub.remove();
  }, []);
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
        options={{ tabBarLabel: 'Бюджет', tabBarIcon: tabIcon('budget') }}
      />
      <Tab.Screen
        name="Summary"
        component={SummaryScreen}
        options={{ tabBarLabel: 'Месяц', tabBarIcon: tabIcon('month') }}
      />
      {blocks.chartTab && (
        <Tab.Screen
          name="Chart"
          component={ChartScreen}
          options={{ tabBarLabel: 'График', tabBarIcon: tabIcon('chart') }}
        />
      )}
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Настройки', tabBarIcon: tabIcon('settings'),
          // красная точка, пока ответ поддержки не прочитан
          tabBarBadge: supportUnread > 0 ? '' : undefined,
          tabBarBadgeStyle: { minWidth: 10, maxHeight: 10, borderRadius: 5, backgroundColor: t.danger, top: 4 },
        }}
      />
      {blocks.goalsTab && (
        <Tab.Screen
          name="Goals"
          component={GoalsScreen}
          options={{ tabBarLabel: 'Цели', tabBarIcon: tabIcon('goals') }}
        />
      )}
    </Tab.Navigator>
    <FinikWander />
    </View>
  );
}
