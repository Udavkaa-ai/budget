import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, Alert, Share, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTheme, useThemeMode, setThemeMode, spacing, font, radius } from '../theme';
import { Card } from '../components/Card';
import { invites, csv, pushSettings, settings as settingsApi, categoriesApi, backups as backupsApi, type BackupMeta, setToken } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { usePremium, setPremium } from '../premium';
import { BLOCKS, useBlocks, setBlock } from '../blocks';
import { useCategories, refreshCategories } from '../categories';
import { useLockEnabled, setLockEnabled, canUseBiometrics, authenticate } from '../applock';
import { Field, PrimaryButton } from '../components/UI';
import { loadKey, generateKey, exportKeyHex, encryptJson, decryptJson } from '../crypto';

export default function SettingsScreen() {
  const t = useTheme();
  const { user, logout, onLoginSuccess } = useAuth();
  const premium = usePremium();
  const blocks = useBlocks();
  const themeMode = useThemeMode();
  const lockEnabled = useLockEnabled();
  const { custom } = useCategories();
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [joinVisible, setJoinVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);

  const [familyName, setFamilyName] = useState('');
  const [plannedMonthly, setPlannedMonthly] = useState('');
  const [backupList, setBackupList] = useState<BackupMeta[]>([]);

  const refreshBackups = () => {
    backupsApi.list().then(setBackupList).catch(() => {});
  };

  useEffect(() => {
    refreshBackups();
    pushSettings.get().then(r => setPushEnabled(r.enabled)).catch(() => {});
    settingsApi.get().then(s => {
      if (s.familyName) setFamilyName(s.familyName);
      if (s.plannedMonthly) setPlannedMonthly(String(s.plannedMonthly));
    }).catch(() => {});
  }, []);

  const saveFamilySettings = async () => {
    setBusy(true);
    try {
      if (familyName.trim()) await settingsApi.set('familyName', familyName.trim());
      const n = parseFloat(plannedMonthly.replace(',', '.'));
      if (!isNaN(n) && n > 0) await settingsApi.set('plannedMonthly', n);
      Alert.alert('Сохранено');
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async () => {
    const name = newCatName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await categoriesApi.add(name, newCatEmoji.trim() || '🏷️');
      setNewCatName(''); setNewCatEmoji('');
      await refreshCategories();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = (name: string) => {
    Alert.alert(
      `Удалить «${name}»?`,
      'Все расходы этой категории будут перенесены в «Прочее».',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Удалить', style: 'destructive',
          onPress: async () => {
            try {
              const r = await categoriesApi.remove(name);
              await refreshCategories();
              if (r.moved) Alert.alert('Готово', `Перенесено расходов в «Прочее»: ${r.moved}`);
            } catch (e) {
              Alert.alert('Ошибка', String(e));
            }
          },
        },
      ],
    );
  };

  // Ключ шифрования: создаём при первом бэкапе и просим сохранить фразу
  const ensureKey = async (): Promise<boolean> => {
    if (await loadKey()) return true;
    await generateKey();
    const phrase = await exportKeyHex();
    await new Promise<void>(resolve => {
      Alert.alert(
        '🔑 Создан ключ шифрования',
        `Бэкапы шифруются этим ключом ПРЯМО НА ТЕЛЕФОНЕ — сервер их прочитать не может.\n\nСохраните фразу в надёжном месте (без неё бэкап не восстановить!) и передайте жене/мужу:\n\n${phrase}`,
        [
          { text: '📋 Поделиться фразой', onPress: async () => { await Share.share({ message: phrase ?? '' }); resolve(); } },
          { text: 'Я сохранил(а)', onPress: () => resolve() },
        ],
      );
    });
    return true;
  };

  const createBackup = async () => {
    setBusy(true);
    try {
      await ensureKey();
      const snap = await backupsApi.snapshot();
      const blob = await encryptJson(snap);
      await backupsApi.create(blob);
      refreshBackups();
      Alert.alert('Готово', 'Шифрованная копия сохранена на сервере');
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = (b: BackupMeta) => {
    Alert.alert(
      'Восстановить из копии?',
      `Данные семьи будут ЗАМЕНЕНЫ состоянием на ${new Date(b.createdAt).toLocaleString('ru')}.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Восстановить', style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const { blob } = await backupsApi.get(b.id);
              const snap = await decryptJson<Record<string, unknown>>(blob);
              const r = await backupsApi.restore(snap);
              Alert.alert('Готово', `Восстановлено расходов: ${r.expenses}`);
            } catch (e) {
              Alert.alert('Ошибка', 'Не удалось расшифровать или восстановить: ' + String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const showKey = async () => {
    const phrase = await exportKeyHex();
    if (!phrase) { Alert.alert('Ключа ещё нет', 'Он создастся при первом бэкапе'); return; }
    Alert.alert('🔑 Ключ шифрования', phrase, [
      { text: '📋 Поделиться', onPress: () => Share.share({ message: phrase }) },
      { text: 'Закрыть' },
    ]);
  };

  const toggleLock = async (v: boolean) => {
    if (v) {
      if (!(await canUseBiometrics())) {
        Alert.alert('Недоступно', 'На устройстве не настроен отпечаток/пароль. Настройте блокировку экрана в системе.');
        return;
      }
      if (await authenticate()) await setLockEnabled(true);
    } else {
      // подтверждаем личность перед отключением
      if (await authenticate()) await setLockEnabled(false);
    }
  };

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
      // Отдаём настоящий .csv файл, а не текст в сообщении
      const stamp = new Date().toISOString().slice(0, 10);
      const uri = `${FileSystem.cacheDirectory}expenses-${stamp}.csv`;
      await FileSystem.writeAsStringAsync(uri, text);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Экспорт расходов' });
      } else {
        await Share.share({ message: text, title: 'Экспорт расходов (CSV)' });
      }
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  // Импорт: выбор CSV-файла напрямую (вставка текста — запасной вариант)
  const importCsvFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/octet-stream', 'application/vnd.ms-excel'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      setBusy(true);
      let text = await FileSystem.readAsStringAsync(res.assets[0].uri);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
      const r = await csv.import(text);
      Alert.alert('Готово', `Импортировано записей: ${r.imported ?? '—'}`);
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseImport = () => {
    Alert.alert('Импорт CSV', 'Формат экспорта веб-версии или бота', [
      { text: 'Отмена', style: 'cancel' },
      { text: '✍️ Вставить текстом', onPress: () => setImportVisible(true) },
      { text: '📄 Выбрать файл', onPress: importCsvFile },
    ]);
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
        <Text style={[styles.title, { color: t.primary }]}>Настройки</Text>
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
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: 4 }}>Название семьи</Text>
          <Field
            style={{ marginBottom: spacing.md }}
            value={familyName}
            onChangeText={setFamilyName}
            placeholder="Например: Ивановы"
          />
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: 4 }}>Плановые расходы на месяц, ₽</Text>
          <Field
            style={{ marginBottom: spacing.md }}
            value={plannedMonthly}
            onChangeText={setPlannedMonthly}
            placeholder="300000"
            keyboardType="decimal-pad"
          />
          <PrimaryButton title="Сохранить" onPress={saveFamilySettings} loading={busy} style={{ marginBottom: spacing.sm }} />
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

        {/* App lock */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Безопасность</Text>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text }}>🔒 Вход по отпечатку / паролю</Text>
              <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                Запрашивать разблокировку при открытии приложения
              </Text>
            </View>
            <Switch value={lockEnabled} onValueChange={toggleLock} trackColor={{ true: t.primary }} />
          </View>
        </Card>

        {/* Theme */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Оформление</Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {([['light', '☀️ Светлая'], ['dark', '🌙 Тёмная'], ['auto', '🔄 Авто']] as const).map(([m, label]) => (
              <TouchableOpacity
                key={m}
                style={{
                  flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center',
                  backgroundColor: themeMode === m ? t.primary : t.surface2,
                }}
                onPress={() => setThemeMode(m)}
              >
                <Text style={{ color: themeMode === m ? '#fff' : t.text, fontSize: font.sm }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: spacing.sm }}>
            «Авто» следует системной теме телефона
          </Text>
        </Card>

        {/* Custom categories */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Мои категории</Text>
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
            Общие для всей семьи. При удалении расходы переносятся в «Прочее».
          </Text>
          {custom.map(c => (
            <View key={c.name} style={styles.row}>
              <Text style={{ color: t.text }}>{c.emoji} {c.name}</Text>
              <TouchableOpacity onPress={() => removeCategory(c.name)} style={{ padding: 4 }}>
                <Text style={{ color: t.danger }}>Удалить</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
            <TextInput
              style={[styles.input, { width: 64, marginBottom: 0, textAlign: 'center', color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
              value={newCatEmoji}
              onChangeText={setNewCatEmoji}
              placeholder="🎣"
              placeholderTextColor={t.textMuted}
            />
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
              value={newCatName}
              onChangeText={setNewCatName}
              placeholder="Название (напр. Рыбалка)"
              placeholderTextColor={t.textMuted}
            />
            <TouchableOpacity
              style={[styles.upgradeBtn, { backgroundColor: t.primary, paddingHorizontal: spacing.lg }]}
              onPress={addCategory}
              disabled={busy}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>+</Text>
            </TouchableOpacity>
          </View>
        </Card>

        {/* Analytics constructor */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Конструктор аналитики</Text>
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
            Включайте только те блоки, которыми пользуетесь. Настройка — личная для этого устройства.
          </Text>
          {BLOCKS.map(b => (
            <View key={b.id} style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text }}>{b.label}</Text>
                <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>{b.hint}</Text>
              </View>
              <Switch
                value={blocks[b.id]}
                onValueChange={v => setBlock(b.id, v)}
                trackColor={{ true: t.primary }}
              />
            </View>
          ))}
        </Card>

        {/* Data */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Данные</Text>
          <TouchableOpacity style={styles.row} onPress={exportCsv} disabled={busy}>
            <Text style={{ color: t.text }}>📤 Экспорт в CSV</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={chooseImport} disabled={busy}>
            <Text style={{ color: t.text }}>📥 Импорт из CSV-файла</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
        </Card>

        {/* Encrypted backups */}
        <Card>
          <Text style={[styles.sectionTitle, { color: t.textMuted }]}>Резервные копии</Text>
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
            Шифруются на телефоне вашим ключом — сервер содержимое не видит. Без ключа копию не восстановить.
          </Text>
          <PrimaryButton title="🔐 Создать шифрованную копию" onPress={createBackup} loading={busy} />
          {backupList.map(b => (
            <View key={b.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: font.sm }}>
                  {new Date(b.createdAt).toLocaleString('ru')}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: font.xs }}>{Math.round(b.size / 1024)} КБ</Text>
              </View>
              <TouchableOpacity onPress={() => restoreBackup(b)} style={{ padding: 6 }}>
                <Text style={{ color: t.primary, fontSize: font.sm }}>Восстановить</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => Alert.alert('Удалить копию?', undefined, [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Удалить', style: 'destructive', onPress: async () => { await backupsApi.remove(b.id); refreshBackups(); } },
                ])}
                style={{ padding: 6 }}
              >
                <Text style={{ color: t.danger, fontSize: font.sm }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={showKey} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>🔑 Показать ключ шифрования</Text>
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
      <Modal visible={joinVisible} animationType="slide" transparent onRequestClose={() => setJoinVisible(false)}>
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
      <Modal visible={importVisible} animationType="slide" transparent onRequestClose={() => setImportVisible(false)}>
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
              placeholder="Дата;Категория;Описание;Сумма;Пользователь"
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
  title:        { fontSize: font.xxl, fontWeight: '800' },
  sectionTitle: { fontSize: font.sm, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  profileName:  { fontSize: font.xl, fontWeight: '700', marginBottom: 2 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  upgradeBtn:   { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  logoutBtn:    { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', borderWidth: 1.5, marginBottom: spacing.xl },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalBox:     { borderRadius: radius.lg, padding: spacing.lg },
  modalTitle:   { fontSize: font.lg, fontWeight: '700', marginBottom: spacing.md },
  input:        { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
  multiline:    { height: 140, textAlignVertical: 'top' },
  modalBtn:     { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
});
