import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, Alert, Share, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, font, radius } from '../theme';
import { Card } from '../components/Card';
import { invites, csv, pushSettings, setToken } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { usePremium, setPremium } from '../premium';

export default function SettingsScreen() {
  const t = useTheme();
  const { user, logout, onLoginSuccess } = useAuth();
  const premium = usePremium();
  const [pushEnabled, setPushEnabled] = useState(true);
  const [joinVisible, setJoinVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushSettings.get().then(r => setPushEnabled(r.enabled)).catch(() => {});
  }, []);

  const handleLogout = () => {
    Alert.alert('Выйти?', 'Данные на устройстве сохранятся', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: logout },
    ]);
  };

  const togglePush = async (v: boolean) => {
    setPushEnabled(v);
    try { await pushSettings.set(v); } catch { setPushEnabled(!v); }
  };

  // Тестовый режим: премиум включается бесплатно.
  // TODO: заменить на Google Play Billing перед публикацией
  const activatePremium = () => {
    Alert.alert(
      '💎 Премиум (тестовый режим)',
      'На время тестирования Премиум активируется бесплатно. Откроются ИИ-аналитика и сканирование чеков.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Активировать', onPress: async () => { await setPremium(true); } },
      ],
    );
  };

  const deactivatePremium = () => {
    Alert.alert('Отключить Премиум?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отключить', style: 'destructive', onPress: async () => { await setPremium(false); } },
    ]);
  };

  const inviteFamily = async () => {
    setBusy(true);
    try {
      const { link, code } = await invites.create();
      await Share.share({
        message: `Присоединяйся к нашему семейному бюджету!\n${link}\n\nИли введи код в приложении: ${code}`,
      });
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const joinFamily = async () => {
    const code = joinCode.trim();
    if (!code) return;
    setBusy(true);
    try {
      const res = await invites.join(code);
      await setToken(res.token);
      onLoginSuccess(res.token);
      setJoinVisible(false); setJoinCode('');
      Alert.alert('Готово', 'Вы присоединились к семье');
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      const text = await csv.export();
      await Share.share({ message: text, title: 'Экспорт расходов (CSV)' });
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const importCsv = async () => {
    if (!importText.trim()) return;
    setBusy(true);
    try {
      const res = await csv.import(importText);
      setImportVisible(false); setImportText('');
      Alert.alert('Готово', `Импортировано записей: ${res.imported ?? '—'}`);
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
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

        {/* Family */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Семья</Text>
          <TouchableOpacity style={styles.row} onPress={inviteFamily} disabled={busy}>
            <Text style={{ color: t.text }}>👨‍👩‍👧 Пригласить в семью</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => setJoinVisible(true)}>
            <Text style={{ color: t.text }}>🔑 Ввести код приглашения</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
        </Card>

        {/* Subscription */}
        {premium ? (
          <Card style={{ borderColor: '#a855f7', borderWidth: 1.5 }}>
            <Text style={[styles.sectionTitle, { color: '#a855f7' }]}>💎 Премиум активен</Text>
            <Text style={{ color: t.textMuted, fontSize: font.sm, lineHeight: 20 }}>
              Тестовый режим — бесплатно на время тестирования.{'\n'}
              Доступны ИИ-аналитика и сканирование чеков.
            </Text>
            <TouchableOpacity onPress={deactivatePremium} style={{ marginTop: spacing.md }}>
              <Text style={{ color: t.textMuted, fontSize: font.sm }}>Отключить</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <Card style={{ borderColor: '#f59e0b', borderWidth: 1.5 }}>
            <Text style={[styles.sectionTitle, { color: '#f59e0b' }]}>⭐ Бесплатный тариф</Text>
            <Text style={{ color: t.textMuted, fontSize: font.sm, lineHeight: 20, marginBottom: spacing.md }}>
              Все основные функции работают без интернета и без стоимости.{'\n'}
              Категории определяет локальный ИИ — быстро, приватно, бесплатно.
            </Text>
            <Text style={{ color: t.textMuted, fontSize: font.sm, marginBottom: spacing.md }}>
              {'🤖 ИИ-аналитика\n📸 Сканирование чеков\n— только в Премиуме'}
            </Text>
            <TouchableOpacity
              style={[styles.upgradeBtn, { backgroundColor: '#f59e0b' }]}
              onPress={activatePremium}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Активировать Премиум (тест)</Text>
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
              onValueChange={togglePush}
              trackColor={{ true: t.primary }}
            />
          </View>
        </Card>

        {/* Data */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Данные</Text>
          <TouchableOpacity style={styles.row} onPress={exportCsv} disabled={busy}>
            <Text style={{ color: t.text }}>📤 Экспорт в CSV</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => setImportVisible(true)}>
            <Text style={{ color: t.text }}>📥 Импорт из CSV</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
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

      {/* Join family modal */}
      <Modal visible={joinVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: t.surface }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>Код приглашения</Text>
            <TextInput
              style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
              value={joinCode}
              onChangeText={setJoinCode}
              placeholder="Например: a1b2c3"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              autoFocus
            />
            <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.md }}>
              Внимание: вы перейдёте в другую семью, текущие данные останутся в старой.
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.surface2 }]} onPress={() => setJoinVisible(false)}>
                <Text style={{ color: t.text }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.primary }]} onPress={joinFamily} disabled={busy}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Присоединиться</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Import CSV modal */}
      <Modal visible={importVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: t.surface }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>Импорт CSV</Text>
            <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
              Вставьте содержимое CSV-файла (формат экспорта веб-версии)
            </Text>
            <TextInput
              style={[styles.input, styles.multiline, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
              value={importText}
              onChangeText={setImportText}
              placeholder="Дата;Категория;Сумма;Описание;Пользователь"
              placeholderTextColor={t.textMuted}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.surface2 }]} onPress={() => setImportVisible(false)}>
                <Text style={{ color: t.text }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.primary }]} onPress={importCsv} disabled={busy}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Импортировать</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  title:        { fontSize: font.xl, fontWeight: '700' },
  sectionTitle: { fontSize: font.sm, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  profileName:  { fontSize: font.xl, fontWeight: '700', marginBottom: 2 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  upgradeBtn:   { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  logoutBtn:    { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', borderWidth: 1.5, marginBottom: spacing.xl },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalBox:     { borderRadius: radius.lg, padding: spacing.lg },
  modalTitle:   { fontSize: font.lg, fontWeight: '700', marginBottom: spacing.md },
  input:        { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
  multiline:    { height: 140, textAlignVertical: 'top' },
  modalBtn:     { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
});
