import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, Switch, Alert,
} from 'react-native';
import { useTheme, spacing, font, radius } from '../theme';
import { Card } from '../components/Card';
import { clearAuth } from '../api/client';
import { useAuth } from '../hooks/useAuth';

// Free tier: local classifier only
// Premium tier: AI analysis, photo receipt parsing
const IS_PREMIUM = false; // TODO: integrate RevenueCat / Google Play Billing

export default function SettingsScreen() {
  const t = useTheme();
  const { user, logout } = useAuth();
  const [pushEnabled, setPushEnabled] = useState(true);

  const handleLogout = () => {
    Alert.alert('Выйти?', 'Данные на устройстве сохранятся', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: logout },
    ]);
  };

  const upgradeToPremium = () => {
    // TODO: launch Google Play Billing flow via react-native-purchases (RevenueCat)
    Alert.alert('Премиум', 'Интеграция с Google Play Billing — в следующей версии.');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.text }]}>Настройки</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>

        {/* Profile */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Профиль</Text>
          <Text style={[styles.profileName, { color: t.text }]}>{user?.name ?? '—'}</Text>
          <Text style={{ color: t.textMuted, fontSize: font.sm }}>Семья: {user?.family ?? '—'}</Text>
        </Card>

        {/* Subscription */}
        {!IS_PREMIUM && (
          <Card style={{ borderColor: '#f59e0b', borderWidth: 1.5 }}>
            <Text style={[styles.sectionTitle, { color: '#f59e0b' }]}>⭐ Бесплатный тариф</Text>
            <Text style={{ color: t.textMuted, fontSize: font.sm, lineHeight: 20, marginBottom: spacing.md }}>
              Все основные функции работают без интернета и без стоимости.{'\n'}
              Категории определяет локальный ИИ — быстро, приватно, бесплатно.
            </Text>
            <Text style={{ color: t.textMuted, fontSize: font.sm, marginBottom: spacing.md }}>
              {'🤖 ИИ-аналитика\n📸 Сканирование чеков'}
              {'\n→ Только в Премиуме'}
            </Text>
            <TouchableOpacity
              style={[styles.upgradeBtn, { backgroundColor: '#f59e0b' }]}
              onPress={upgradeToPremium}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Перейти на Премиум</Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* Notifications */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Уведомления</Text>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text }}>🔔 Расходы партнёра</Text>
              <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                Пуш при добавлении новой траты
              </Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={setPushEnabled}
              trackColor={{ true: t.primary }}
            />
          </View>
        </Card>

        {/* About */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>О приложении</Text>
          <Text style={{ color: t.textMuted, fontSize: font.sm }}>Версия 1.0.0</Text>
          <Text style={{ color: t.textMuted, fontSize: font.sm, marginTop: 4 }}>
            Классификатор категорий работает полностью на устройстве.{'\n'}
            Ваши данные не передаются без разрешения.
          </Text>
        </Card>

        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutBtn, { borderColor: t.danger }]}
          onPress={handleLogout}
        >
          <Text style={{ color: t.danger, fontWeight: '600' }}>Выйти из аккаунта</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  title:        { fontSize: font.xl, fontWeight: '700' },
  sectionTitle: { fontSize: font.sm, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  profileName:  { fontSize: font.xl, fontWeight: '700', marginBottom: 2 },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  upgradeBtn:   { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  logoutBtn:    { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', borderWidth: 1.5, marginBottom: spacing.xl },
});
