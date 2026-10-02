import React, { useState, useEffect } from 'react';
import { Toggle } from '../components/UI';
import { showAlert } from '../dialog';
import { haptics } from '../haptics';
import { BankSettings } from '../components/BankSettings';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet, Share, Modal, TextInput, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSupportUnread } from '../supportStore';
import { isPersonalBuild } from '../bank/inbox';
import { openSettingsPage, useSettingsPage, type SettingsPage } from '../settingsNav';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useTheme, useThemeMode, setThemeMode, spacing, font, radius } from '../theme';
import { Card } from '../components/Card';
import { SectionTitle } from '../components/UI';
import { api, invites, csv, pushSettings, support as supportApi, type SupportMessage, settings as settingsApi, categoriesApi, backups as backupsApi, type BackupMeta, setToken } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { usePremium, setPremium } from '../premium';
import { BLOCK_GROUPS, useBlocks, setBlock } from '../blocks';
import { useCategories, refreshCategories } from '../categories';
import { useLockEnabled, setLockEnabled, canUseBiometrics, authenticate, useHasPin, setPin, clearPin } from '../applock';
import { PinPad } from '../components/PinPad';
import { Field, PrimaryButton } from '../components/UI';
import { RecurringScreen } from './RecurringScreen';
import { Finik } from '../components/Finik';
import { useFinikEnabled, setFinikEnabled } from '../finik';
import { loadKey, generateKey, importKey, exportKeyHex, encryptJson, decryptJson, fingerprintOfHex, extractKeyHex } from '../crypto';
import { ScreenGradient } from '../components/ScreenGradient';
import { startTour } from '../tour';
import Constants from 'expo-constants';
import { useFocusEffect } from '@react-navigation/native';
import { setSupportUnread } from '../supportStore';
import { openHelp } from '../help';
import { RUSTORE_URL, openRuStoreListing } from '../rateApp';
import { useTourTarget, registerScroller, unregisterScroller, setTargetOffset } from '../tourTargets';
import { useE2E, isE2E } from '../e2e';
import { enableE2E } from '../e2e/enable';
import * as e2eData from '../e2e/compute';

const SETTINGS_PAGES: Array<{ id: SettingsPage; title: string; sub: string; icon: string; tone?: 'success' | 'gold' }> = [
  { id: 'family', title: 'Семья и бюджет', sub: 'Семья, приглашения, план, категории, регулярные платежи', icon: 'people-outline' },
  { id: 'look', title: 'Внешний вид и экраны', sub: 'Тема, Финик и что показывать на вкладках', icon: 'contrast-outline' },
  { id: 'notify', title: isPersonalBuild ? 'Уведомления и банк' : 'Уведомления',
    sub: isPersonalBuild ? 'О расходах партнёра, покупки из СМС и пушей банков' : 'О расходах партнёра', icon: 'notifications-outline' },
  { id: 'security', title: 'Безопасность и данные', sub: 'Замок, шифрование, резервные копии, экспорт и импорт', icon: 'shield-checkmark-outline', tone: 'success' },
  { id: 'premium', title: 'Премиум', sub: 'ИИ-разбор, сканирование чеков, анализ месяца', icon: 'diamond-outline', tone: 'gold' },
  { id: 'help', title: 'Помощь и поддержка', sub: 'Вопросы и ответы, тур, написать разработчику, оценить', icon: 'help-circle-outline', tone: 'gold' },
];

export default function SettingsScreen() {
  const t = useTheme();
  const { user, logout, onLoginSuccess } = useAuth();
  const premium = usePremium();
  const blocks = useBlocks();
  const finikOn = useFinikEnabled();
  const themeMode = useThemeMode();
  const lockEnabled = useLockEnabled();
  const hasPinSet = useHasPin();
  const e2e = useE2E();

  const doEnableE2E = () => {
    showAlert(
      'Включить сквозное шифрование?',
      'Все данные семьи переедут в зашифрованный вид. После этого сервер (и тот, кто им владеет) не сможет видеть ваши суммы и расходы — только зашифрованные блобы.\n\n⚠️ Ключ хранится ТОЛЬКО на устройствах. Если потеряете ключ-фразу и все устройства — данные восстановить будет НЕЛЬЗЯ. Сразу сохраните ключ-фразу и передайте её членам семьи.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Включить', style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const r = await enableE2E();
            setBusy(false);
            if (r.ok) {
              showAlert(
                '🔒 Шифрование включено',
                `Перенесено расходов: ${r.migrated}.\n\nСОХРАНИТЕ ключ-фразу — без неё данные не восстановить и не подключить второе устройство:\n\n${r.keyPhrase}`,
                [
                  { text: '📋 Поделиться', onPress: () => Share.share({ message: r.keyPhrase }) },
                  { text: 'Я сохранил(а)' },
                ],
              );
            } else {
              showAlert('Не удалось включить', r.error);
            }
          },
        },
      ],
    );
  };
  // Разделы Настроек: главный экран со списком, каждый раздел — своя страница
  const page = useSettingsPage();
  const supportUnread = useSupportUnread();
  const openPage = (p: SettingsPage) => { haptics.select(); openSettingsPage(p); };
  const closePage = () => openSettingsPage(null);
  useEffect(() => { scrollRef.current?.scrollTo({ y: 0, animated: false }); }, [page]);
  // «Назад» на Android возвращает из раздела на главный экран Настроек
  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page !== null) { openSettingsPage(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [page]));

  // Цели тура + прокрутка длинного экрана к нужной карточке
  const scrollRef = React.useRef<ScrollView>(null);
  const inviteTarget = useTourTarget('settings.invite');
  const blocksTarget = useTourTarget('settings.blocks');
  const securityTarget = useTourTarget('settings.security');
  const premiumTarget = useTourTarget('settings.premium');
  useEffect(() => {
    registerScroller('settings', (y) => scrollRef.current?.scrollTo({ y, animated: true }));
    return () => unregisterScroller('settings');
  }, []);
  const offset = (id: string) => (e: any) => setTargetOffset(id, e.nativeEvent.layout.y);
  // PIN-модалка: setup = задать (ввод дважды), change/remove через подтверждение
  const [pinModal, setPinModal] = useState(false);
  const [pinStage, setPinStage] = useState<'enter' | 'confirm'>('enter');
  const [pinFirst, setPinFirst] = useState('');
  const [pinErr, setPinErr] = useState(false);
  const [pinAfterSet, setPinAfterSet] = useState(false); // включить замок после задания PIN
  const { custom } = useCategories();
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('');
  const [pushEnabled, setPushEnabled] = useState(true);
  const [joinVisible, setJoinVisible] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [importVisible, setImportVisible] = useState(false);
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState(false);
  const [supportText, setSupportText] = useState('');
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportThread, setSupportThread] = useState<SupportMessage[]>([]);

  // Переписка с поддержкой: при открытии настроек подгружаем и отмечаем ответы прочитанными
  const loadSupportThread = React.useCallback(async () => {
    try {
      const r = await supportApi.thread();
      setSupportThread(r.messages || []);
      if (r.unread) { await supportApi.seen(); setSupportUnread(0); }
    } catch { /* офлайн — покажем позже */ }
  }, []);
  useFocusEffect(React.useCallback(() => { loadSupportThread(); }, [loadSupportThread]));
  // Закрыть диалог: переписка пропадает из настроек (у разработчика остаётся)
  const closeSupport = () => showAlert(
    'Закрыть диалог?',
    'Переписка пропадёт из настроек. Если понадобится — просто напишите снова, начнётся новый диалог.',
    [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Закрыть', onPress: async () => {
        try { await supportApi.close(); setSupportThread([]); setSupportUnread(0); haptics.success(); }
        catch { showAlert('Не удалось закрыть диалог', 'Проверьте соединение и попробуйте ещё раз.'); }
      } },
    ],
  );
  const [recurringVisible, setRecurringVisible] = useState(false);

  const [familyName, setFamilyName] = useState('');
  const [plannedMonthly, setPlannedMonthly] = useState('');
  const [backupList, setBackupList] = useState<BackupMeta[]>([]);
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyInput, setKeyInput] = useState('');

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
      showAlert('Сохранено');
    } catch (e) {
      showAlert('Ошибка', String(e));
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
      showAlert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = (name: string) => {
    showAlert(
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
              if (r.moved) showAlert('Готово', `Перенесено расходов в «Прочее»: ${r.moved}`);
            } catch (e) {
              showAlert('Ошибка', String(e));
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
      showAlert(
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
      // В E2E данные лежат локально (сервер пуст) — снапшот берём с устройства
      const snap = isE2E() ? await e2eData.localSnapshot() : await backupsApi.snapshot();
      const blob = await encryptJson(snap);
      await backupsApi.create(blob);
      refreshBackups();
      showAlert('Готово', 'Шифрованная копия сохранена на сервере');
    } catch (e) {
      showAlert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const restoreBackup = (b: BackupMeta) => {
    showAlert(
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
              if (isE2E()) {
                // Восстанавливаем в локальное хранилище, а не на (пустой) сервер
                await e2eData.restoreLocalSnapshot(snap);
                showAlert('Готово', `Восстановлено расходов: ${(snap as any).expenses?.length ?? 0}`);
              } else {
                const r = await backupsApi.restore(snap);
                showAlert('Готово', `Восстановлено расходов: ${r.expenses}`);
              }
            } catch (e) {
              showAlert('Ошибка', 'Не удалось расшифровать или восстановить: ' + String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  // Ввод фразы-ключа с другого устройства (для восстановления чужих копий)
  const applyImportedKey = async () => {
    const clean = extractKeyHex(keyInput);
    if (!clean) {
      const hexCount = (keyInput.match(/[0-9a-fA-F]/g) || []).length;
      showAlert('Не нашёл ключ', `Ключ — это 64 символа из цифр и букв a–f. Во вставленном тексте таких символов ${hexCount}. Скопируйте ключ целиком кнопкой «Скопировать» на устройстве, где данные открываются правильно.`);
      return;
    }
    const finish = async () => {
      await importKey(clean);
      setKeyVisible(false);
      setKeyInput('');
      showAlert('Готово', 'Ключ сохранён — теперь копии семьи можно восстанавливать на этом устройстве.');
    };
    // Сверяем отпечаток вводимого ключа с зарегистрированным у семьи на сервере.
    // Если не совпал — ключ ЧУЖОЙ: записи не расшифруются, и всё, что внесёшь,
    // не увидят остальные (а ты — их). Раньше это молча ломало синхронизацию.
    const fp = fingerprintOfHex(clean);
    let familyFp: string | null = null;
    try { familyFp = (await api.get<{ enabled: boolean; keyFingerprint: string | null }>('/api/family/e2e')).keyFingerprint; } catch { /* оффлайн — пропускаем проверку */ }
    if (familyFp && fp && familyFp !== fp) {
      showAlert(
        '⚠️ Ключ не от этой семьи',
        `Отпечаток введённого ключа (${fp}) не совпадает с ключом семьи (${familyFp}).\n\nЕсли всё равно сохранить — твои записи не увидят другие участники, а их записи не увидишь ты. Скопируй фразу точь-в-точь с устройства, где данные открываются правильно (там: 🔑 «Показать ключ шифрования»).`,
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Всё равно сохранить', style: 'destructive', onPress: finish },
        ],
      );
      return;
    }
    const existing = await exportKeyHex();
    if (existing && existing !== clean) {
      showAlert(
        'Заменить ключ?',
        'На этом устройстве уже есть свой ключ. После замены копии, созданные со старым ключом, откроются только по старой фразе.',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Заменить', style: 'destructive', onPress: finish },
        ],
      );
      return;
    }
    await finish();
  };

  const showKey = async () => {
    const phrase = await exportKeyHex();
    if (!phrase) { showAlert('Ключа ещё нет', 'Он создастся при первом бэкапе'); return; }
    const fp = fingerprintOfHex(phrase);
    showAlert('🔑 Ключ шифрования', `${phrase}\n\nОтпечаток: ${fp}\n(должен совпадать на всех устройствах семьи)`, [
      { text: '📋 Поделиться', onPress: () => Share.share({ message: phrase }) },
      { text: 'Закрыть' },
    ]);
  };

  const toggleLock = async (v: boolean) => {
    if (v) {
      const bio = await canUseBiometrics();
      if (bio) {
        if (await authenticate()) await setLockEnabled(true);
      } else if (hasPinSet) {
        await setLockEnabled(true);
      } else {
        // Ни биометрии, ни PIN — предлагаем задать PIN, затем включим замок
        showAlert(
          'Нужен способ разблокировки',
          'Отпечаток/Face ID недоступны. Задайте PIN-код, чтобы включить замок.',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Задать PIN', onPress: () => openPinSetup(true) },
          ],
        );
      }
    } else {
      // подтверждаем личность перед отключением
      const bio = await canUseBiometrics();
      if (bio ? await authenticate() : hasPinSet) {
        await setLockEnabled(false);
      }
    }
  };

  const openPinSetup = (afterSet = false) => {
    setPinAfterSet(afterSet);
    setPinStage('enter'); setPinFirst(''); setPinErr(false); setPinModal(true);
  };

  const onPinEntered = async (pin: string) => {
    if (pinStage === 'enter') {
      setPinFirst(pin);
      setPinStage('confirm');
    } else {
      if (pin === pinFirst) {
        await setPin(pin);
        setPinModal(false);
        if (pinAfterSet) { await setLockEnabled(true); setPinAfterSet(false); }
        showAlert('Готово', 'PIN-код установлен.');
      } else {
        setPinErr(true);
        setTimeout(() => { setPinErr(false); setPinStage('enter'); setPinFirst(''); }, 900);
      }
    }
  };

  const removePin = () => {
    showAlert('Убрать PIN-код?', 'Разблокировка останется только по отпечатку/Face ID (если доступны).', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Убрать', style: 'destructive', onPress: () => clearPin() },
    ]);
  };

  const handleLogout = () => {
    showAlert('Выйти?', 'Данные на устройстве сохранятся', [
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
    showAlert(
      '💎 Премиум (тестовый режим)',
      'На время тестирования Премиум активируется бесплатно. Откроются ИИ-аналитика и сканирование чеков.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Активировать', onPress: async () => { await setPremium(true); } },
      ],
    );
  };

  const deactivatePremium = () => {
    showAlert('Отключить Премиум?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Отключить', style: 'destructive', onPress: async () => { await setPremium(false); } },
    ]);
  };

  const sendSupport = async () => {
    const text = supportText.trim();
    if (text.length < 3) { showAlert('Поддержка', 'Напишите пару слов о проблеме или идее'); return; }
    setSupportBusy(true);
    try {
      await supportApi.send(text, Constants.expoConfig?.version ?? '');
      setSupportText('');
      loadSupportThread();
      showAlert('Спасибо!', 'Сообщение отправлено разработчику. Ответ появится здесь.');
    } catch (e) {
      showAlert('Не удалось отправить', String((e as Error)?.message ?? e));
    } finally {
      setSupportBusy(false);
    }
  };

  const inviteFamily = async () => {
    setBusy(true);
    try {
      // link — это ссылка на ВЕБ-версию с кодом (origin/?invite=code): открывается
      // в браузере на любом устройстве, код подставляется автоматически.
      const { link, code } = await invites.create();
      const android = `Присоединяйся к нашему семейному бюджету в ФИНИК! 🟣\n\nУстанови приложение из RuStore:\n${RUSTORE_URL}\n\nи введи код приглашения: ${code}\n\nНет Android? Открой веб-версию: ${link}`;
      const web = `Присоединяйся к нашему семейному бюджету в ФИНИК! 🟣\n\nОткрой веб-версию (работает в браузере на любом устройстве):\n${link}\n\nКод приглашения уже в ссылке. Если попросит — введи вручную: ${code}`;
      const iphone = `Присоединяйся к нашему семейному бюджету в ФИНИК! 🟣\n\nНа iPhone приложение работает через браузер. Открой ссылку в Safari:\n${link}\n\nМожно добавить на экран «Домой»: кнопка «Поделиться» → «На экран «Домой»» — будет как обычное приложение.\n\nКод (если попросит): ${code}`;
      showAlert(
        'Пригласить в семью',
        'Кого приглашаете? Для Android — приложение из RuStore. Для iPhone и компьютера — веб-версия, она открывается прямо в браузере.',
        [
          { text: '📱 Android — RuStore', onPress: () => { void Share.share({ message: android }); } },
          { text: '🍎 iPhone — веб-версия', onPress: () => { void Share.share({ message: iphone }); } },
          { text: '💻 Компьютер — веб-версия', onPress: () => { void Share.share({ message: web }); } },
          { text: 'Отмена', style: 'cancel' },
        ],
      );
    } catch (e) {
      showAlert('Ошибка', String(e));
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
      showAlert('Готово', 'Вы присоединились к семье');
    } catch (e) {
      showAlert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    setBusy(true);
    try {
      // В E2E экспорт считаем из локальных данных (сервер пуст)
      const text = isE2E() ? await e2eData.exportCsv() : await csv.export();
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
      showAlert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  // Убрать задвоенные расходы (последствие старого бага восстановления).
  // Достаточно нажать на ОДНОМ устройстве — удаления разъедутся на остальные.
  const dedupe = () => {
    if (!isE2E()) { showAlert('Недоступно', 'Убрать дубликаты можно только при включённом шифровании.'); return; }
    showAlert(
      'Убрать дубликаты?',
      'Удалит повторяющиеся расходы (одинаковые дата, сумма, описание и время создания), оставив по одному. Изменения синхронизируются на все устройства семьи.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Убрать', style: 'destructive', onPress: async () => {
            setBusy(true);
            try {
              const n = await e2eData.dedupeExpenses();
              showAlert(n ? 'Готово' : 'Дубликатов нет', n ? `Удалено дубликатов: ${n}. Обновление уедет на другие устройства.` : 'Повторов не найдено.');
            } catch (e) {
              showAlert('Ошибка', String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
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
      showAlert('Готово', `Импортировано записей: ${r.imported ?? '—'}`);
    } catch (e) {
      showAlert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseImport = () => {
    showAlert('Импорт CSV', 'Формат экспорта веб-версии или бота', [
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
      showAlert('Готово', `Импортировано записей: ${res.imported ?? '—'}`);
    } catch (e) {
      showAlert('Ошибка', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <ScreenGradient tint="settings" />
      <View style={[styles.header, { borderBottomColor: t.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
        <Text style={[styles.title, { color: t.primary }]}>Настройки</Text>
        <Finik emotion="fix" size={54} />
      </View>
      <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.md }}>

        {page === null && (
          <>
            <Card style={styles.profileCard}>
              <View style={[styles.ava, { backgroundColor: t.primary }]}>
                <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{(user?.name || '?').trim().slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.profileName, { color: t.text }]} numberOfLines={1}>{user?.name ?? '—'}</Text>
                <Text style={{ color: t.textMuted, fontSize: font.sm }} numberOfLines={1}>
                  {familyName.trim() ? `Семья «${familyName.trim()}»` : 'Семья без названия'}
                </Text>
              </View>
            </Card>
            <Card style={{ paddingVertical: 4, paddingHorizontal: 4 }}>
              {SETTINGS_PAGES.map((pg, i) => (
                <TouchableOpacity key={pg.id} onPress={() => openPage(pg.id)} activeOpacity={0.7}
                  style={[styles.menuRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border }]}>
                  <View style={[styles.menuIco, { backgroundColor: pg.tone === 'success' ? t.successSoft : pg.tone === 'gold' ? t.goldSoft : t.primarySoft }]}>
                    <Ionicons name={pg.icon as never} size={20} color={pg.tone === 'success' ? t.success : pg.tone === 'gold' ? t.goldDeep : t.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontSize: font.md, fontWeight: '700' }}>{pg.title}</Text>
                    <Text style={{ color: t.textMuted, fontSize: 12.5, marginTop: 2, lineHeight: 17 }}>{pg.sub}</Text>
                  </View>
                  {pg.id === 'help' && supportUnread > 0 && <View style={[styles.menuDot, { backgroundColor: t.danger }]} />}
                  <Text style={{ color: t.textFaint, fontSize: 22 }}>›</Text>
                </TouchableOpacity>
              ))}
            </Card>
        {/* Logout */}
        <TouchableOpacity
          style={[styles.logoutBtn, { borderColor: t.danger }]}
          onPress={handleLogout}
        >
          <Text style={{ color: t.danger, fontWeight: '600' }}>Выйти из аккаунта</Text>
        </TouchableOpacity>
          </>
        )}

        {page !== null && (
          <View style={styles.pageHead}>
            <TouchableOpacity onPress={closePage} hitSlop={10}>
              <Text style={{ color: t.primary, fontSize: font.md, fontWeight: '700' }}>‹ Настройки</Text>
            </TouchableOpacity>
            <Text style={[styles.pageTitle, { color: t.text }]}>{SETTINGS_PAGES.find(pg => pg.id === page)?.title}</Text>
          </View>
        )}

        {page === 'family' && (
          <>
        {/* Family */}
        <View ref={inviteTarget} collapsable={false} onLayout={offset('settings.invite')}>
        <Card>
          <SectionTitle>Семья</SectionTitle>
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
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: -2, marginBottom: 2 }}>
            Android — приложение из RuStore · iPhone и компьютер — веб-версия в браузере
          </Text>
          <TouchableOpacity style={styles.row} onPress={() => setJoinVisible(true)}>
            <Text style={{ color: t.text }}>🔑 Ввести код приглашения</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
        </Card>
        </View>

        {/* Custom categories */}
        <Card>
          <SectionTitle>Мои категории</SectionTitle>
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

        {/* Планирование */}
        <TouchableOpacity activeOpacity={0.85} onPress={() => setRecurringVisible(true)}
          style={{
            backgroundColor: t.primary, borderRadius: 18, padding: 16, marginBottom: 12,
            flexDirection: 'row', alignItems: 'center', gap: 14,
          }}>
          <Text style={{ fontSize: 30 }}>🔁</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Регулярные платежи</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 }}>
              Подписки, аренда, проездной · автопоиск в истории
            </Text>
          </View>
          <Text style={{ color: '#fff', fontSize: 22 }}>›</Text>
        </TouchableOpacity>
          </>
        )}



        {page === 'look' && (
          <>
        {/* Theme */}
        <Card>
          <SectionTitle>Оформление</SectionTitle>
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

        {/* Маскот */}
        <Card>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text }}>🧮 Маскот Финик</Text>
              <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                Виртуальный бухгалтер, который реагирует на ваши деньги
              </Text>
            </View>
            <Toggle value={finikOn} onValueChange={setFinikEnabled} />
          </View>
        </Card>

        {/* Analytics constructor */}
        <View ref={blocksTarget} collapsable={false} onLayout={offset('settings.blocks')}>
        <Card>
          <SectionTitle>Что показывать на вкладках</SectionTitle>
          <Text style={{ color: t.textMuted, fontSize: font.sm, marginBottom: spacing.sm, lineHeight: 19 }}>
            Включайте только то, чем пользуетесь. Настройка личная для этого устройства.
          </Text>
          {BLOCK_GROUPS.map(g => {
            const off = (g.tab === 'chart' && !blocks.chartTab) || (g.tab === 'goals' && !blocks.goalsTab);
            return (
              <View key={g.title} style={{ marginTop: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>{g.title.toUpperCase()}</Text>
                  {off && <Text style={{ color: t.warning, fontSize: 11, fontWeight: '600' }}>вкладка скрыта</Text>}
                </View>
                {'hint' in g && g.hint ? <Text style={{ color: t.textMuted, fontSize: 12, marginTop: 2 }}>{g.hint}</Text> : null}
                {g.items.map(b => (
                  <View key={b.id} style={[styles.toggleRow, off && { opacity: 0.45 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '600' }}>{b.label}</Text>
                      <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>{b.hint}</Text>
                    </View>
                    <Toggle value={blocks[b.id]} onValueChange={v => setBlock(b.id, v)} />
                  </View>
                ))}
              </View>
            );
          })}
        </Card>
        </View>
          </>
        )}

        {page === 'notify' && (
          <>
        {/* Notifications */}
        <Card>
          <SectionTitle>Уведомления</SectionTitle>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text }}>🔔 Расходы партнёра</Text>
              <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                Пуш при добавлении новой траты
              </Text>
            </View>
            <Toggle
              value={pushEnabled}
              onValueChange={togglePush}
            />
          </View>
        </Card>

        {/* Покупки из банка — только личная сборка */}
        <BankSettings />
          </>
        )}

        {page === 'security' && (
          <>
        {/* App lock */}
        <View ref={securityTarget} collapsable={false} onLayout={offset('settings.security')}>
        <Card>
          <SectionTitle>Безопасность</SectionTitle>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text }}>🔒 Замок при открытии</Text>
              <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                Разблокировка по отпечатку / Face ID или PIN-коду
              </Text>
            </View>
            <Toggle value={lockEnabled} onValueChange={toggleLock} />
          </View>
          <TouchableOpacity style={styles.row} onPress={() => openPinSetup()}>
            <Text style={{ color: t.text }}>🔢 {hasPinSet ? 'Изменить PIN-код' : 'Задать PIN-код'}</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          {hasPinSet && (
            <TouchableOpacity style={styles.row} onPress={removePin}>
              <Text style={{ color: t.danger }}>Убрать PIN-код</Text>
            </TouchableOpacity>
          )}
        </Card>
        </View>

        {/* End-to-end encryption */}
        <Card style={e2e.enabled ? { borderColor: t.success, borderWidth: 1.5 } : undefined}>
          <SectionTitle>Приватность</SectionTitle>
          {e2e.enabled ? (
            <>
              <Text style={{ color: t.text, fontSize: font.sm, lineHeight: 20 }}>
                Сквозное шифрование включено. Сервер и его владелец видят только зашифрованные блобы — ваши суммы и расходы им недоступны.
              </Text>
              {!e2e.hasKey && (
                <Text style={{ color: t.danger, fontSize: font.sm, marginTop: spacing.sm }}>
                  На этом устройстве нет ключа — введите ключ-фразу ниже, иначе данные не расшифровать.
                </Text>
              )}
              <TouchableOpacity style={styles.row} onPress={showKey}>
                <Text style={{ color: t.text }}>🔑 Показать ключ (для второго устройства)</Text>
                <Text style={{ color: t.textMuted }}>›</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.row} onPress={() => { setKeyInput(''); setKeyVisible(true); }}>
                <Text style={{ color: t.text }}>📥 Ввести ключ с другого устройства</Text>
                <Text style={{ color: t.textMuted }}>›</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={{ color: t.textMuted, fontSize: font.sm, lineHeight: 20, marginBottom: spacing.md }}>
                Сейчас сервер видит ваши расходы. Включите шифрование — данные будут храниться на сервере только зашифрованными, а ключ останется лишь на ваших устройствах. Тогда даже владелец сервера не сможет их прочитать.
              </Text>
              <PrimaryButton title="🔒 Включить шифрование" onPress={doEnableE2E} loading={busy} />
            </>
          )}
        </Card>

        {/* Encrypted backups */}
        <Card>
          <SectionTitle>Резервные копии</SectionTitle>
          <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
            Шифруются на телефоне вашим ключом — сервер содержимое не видит. Без ключа копию не восстановить.
          </Text>
          <PrimaryButton title="🔐 Создать копию" onPress={createBackup} loading={busy} />
          {backupList.length === 0 && (
            <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: spacing.sm }}>
              Копий пока нет. Созданные копии появятся здесь списком — рядом с каждой будет кнопка «Восстановить».
            </Text>
          )}
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
                onPress={() => showAlert('Удалить копию?', undefined, [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Удалить', style: 'destructive', onPress: async () => { await backupsApi.remove(b.id); refreshBackups(); } },
                ])}
                style={{ padding: 6 }}
                hitSlop={8}
                accessibilityLabel="Удалить копию"
                accessibilityRole="button"
              >
                <Text style={{ color: t.danger, fontSize: font.sm }}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity onPress={showKey} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>🔑 Показать ключ шифрования</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setKeyInput(''); setKeyVisible(true); }} style={{ marginTop: spacing.sm }}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>📥 Ввести ключ с другого устройства</Text>
          </TouchableOpacity>
        </Card>

        {/* Data */}
        <Card>
          <SectionTitle>Данные</SectionTitle>
          <TouchableOpacity style={styles.row} onPress={exportCsv} disabled={busy}>
            <Text style={{ color: t.text }}>📤 Экспорт в CSV</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={chooseImport} disabled={busy}>
            <Text style={{ color: t.text }}>📥 Импорт из CSV-файла</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          {isE2E() && (
            <TouchableOpacity style={styles.row} onPress={dedupe} disabled={busy}>
              <Text style={{ color: t.text }}>🧹 Убрать дубликаты расходов</Text>
              <Text style={{ color: t.textMuted }}>›</Text>
            </TouchableOpacity>
          )}
        </Card>
          </>
        )}



        {page === 'premium' && (
          <>
        {/* Subscription */}
        <View ref={premiumTarget} collapsable={false} onLayout={offset('settings.premium')}>
        {premium ? (
          <Card style={{ borderColor: t.primary, borderWidth: 1.5 }}>
            <SectionTitle>Премиум активен</SectionTitle>
            <Text style={{ color: t.textMuted, fontSize: font.sm, lineHeight: 20 }}>
              Тестовый режим — бесплатно на время тестирования.{'\n'}
              Доступны ИИ-аналитика и сканирование чеков.
            </Text>
            <TouchableOpacity onPress={deactivatePremium} style={{ marginTop: spacing.md }}>
              <Text style={{ color: t.textMuted, fontSize: font.sm }}>Отключить</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <Card style={{ borderColor: t.warning, borderWidth: 1.5 }}>
            <SectionTitle>Бесплатный тариф</SectionTitle>
            <Text style={{ color: t.textMuted, fontSize: font.sm, lineHeight: 20, marginBottom: spacing.md }}>
              Все основные функции работают без интернета и без стоимости.{'\n'}
              Категории определяет локальный ИИ — быстро, приватно, бесплатно.
            </Text>
            <Text style={{ color: t.textMuted, fontSize: font.sm, marginBottom: spacing.md }}>
              {'🤖 ИИ-аналитика\n📸 Сканирование чеков\n— только в Премиуме'}
            </Text>
            <TouchableOpacity
              style={[styles.upgradeBtn, { backgroundColor: t.warning }]}
              onPress={activatePremium}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Активировать Премиум (тест)</Text>
            </TouchableOpacity>
          </Card>
        )}
        </View>
          </>
        )}



        {page === 'help' && (
          <>
        {/* Guide & Help */}
        <Card>
          <SectionTitle>Помощь</SectionTitle>
          <TouchableOpacity style={styles.row} onPress={() => openRuStoreListing()}>
            <Text style={{ color: t.text }}>⭐ Оценить приложение в RuStore</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => openHelp()}>
            <Text style={{ color: t.text }}>❓ Помощь и частые вопросы</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => startTour()}>
            <Text style={{ color: t.text }}>🧭 Пройти вводный тур</Text>
            <Text style={{ color: t.textMuted }}>›</Text>
          </TouchableOpacity>
        </Card>

        <Card>
          <SectionTitle>Поддержка</SectionTitle>
          <Text style={{ color: t.textMuted, fontSize: font.sm, marginBottom: spacing.sm, lineHeight: 20 }}>
            Нашли ошибку, есть идея или вопрос? Напишите — сообщение придёт напрямую разработчику, ответ появится здесь.
          </Text>
          {supportThread.length > 0 && (
            <View style={{ gap: 8, marginBottom: spacing.md }}>
              {supportThread.map(m => {
                const mine = m.from !== 'admin';
                return (
                  <View key={m.id} style={[styles.supBubble, mine
                    ? { alignSelf: 'flex-end', backgroundColor: t.primary, borderBottomRightRadius: 6 }
                    : { alignSelf: 'flex-start', backgroundColor: t.surface2, borderColor: t.border, borderWidth: 1, borderBottomLeftRadius: 6 }]}>
                    <Text style={{ color: mine ? '#fff' : t.text, fontSize: font.sm, lineHeight: 20 }}>{m.text}</Text>
                    <Text style={{ color: mine ? 'rgba(255,255,255,0.75)' : t.textMuted, fontSize: 11, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                      {mine ? 'Вы' : 'Разработчик'} · {new Date(m.createdAt).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                );
              })}
              <TouchableOpacity onPress={closeSupport} style={{ alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 2 }} accessibilityRole="button">
                <Text style={{ color: t.textMuted, fontSize: 13, fontWeight: '600' }}>Закрыть диалог</Text>
              </TouchableOpacity>
            </View>
          )}
          <TextInput
            style={[styles.input, styles.multiline, { height: 110, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
            value={supportText}
            onChangeText={setSupportText}
            placeholder="Опишите, что случилось или что хотелось бы улучшить"
            placeholderTextColor={t.textMuted}
            maxLength={2000}
            multiline
          />
          <PrimaryButton title="Отправить разработчику" onPress={sendSupport} loading={supportBusy} />
        </Card>

        {/* About */}
        <Card>
          <SectionTitle>О приложении</SectionTitle>
          <Text style={{ color: t.textMuted, fontSize: font.sm }}>Версия {Constants.expoConfig?.version ?? '2.27.0'} A</Text>
          <Text style={{ color: t.textMuted, fontSize: font.sm, marginTop: 4 }}>
            Классификатор категорий работает полностью на устройстве.{'\n'}
            Ваши данные не передаются без разрешения.
          </Text>
        </Card>
          </>
        )}

      </ScrollView>

      <RecurringScreen visible={recurringVisible} onClose={() => setRecurringVisible(false)} />

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

      {/* Import encryption key modal */}
      <Modal visible={keyVisible} animationType="slide" transparent onRequestClose={() => setKeyVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: t.surface }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>Ключ шифрования</Text>
            <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
              Вставьте фразу из 64 символов с устройства, где создавалась копия (там: 🔑 «Показать ключ шифрования»).
            </Text>
            <TextInput
              style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
              value={keyInput}
              onChangeText={setKeyInput}
              placeholder="a1b2c3…"
              placeholderTextColor={t.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              keyboardType="visible-password"
              multiline
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.surface2 }]} onPress={() => setKeyVisible(false)}>
                <Text style={{ color: t.text }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.primary }]} onPress={applyImportedKey}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Сохранить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* PIN setup modal */}
      <Modal visible={pinModal} animationType="slide" transparent onRequestClose={() => setPinModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: t.surface, alignItems: 'center' }]}>
            <Text style={[styles.modalTitle, { color: t.text }]}>
              {pinStage === 'enter' ? 'Придумайте PIN-код' : 'Повторите PIN-код'}
            </Text>
            <Text style={{ color: pinErr ? t.danger : t.textMuted, fontSize: font.sm, marginBottom: spacing.lg, textAlign: 'center' }}>
              {pinErr ? 'PIN не совпал — попробуйте снова' : '4 цифры для разблокировки приложения'}
            </Text>
            <PinPad key={pinStage + (pinErr ? 'e' : '')} onComplete={onPinEntered} error={pinErr} />
            <TouchableOpacity style={{ marginTop: spacing.xl }} onPress={() => setPinModal(false)}>
              <Text style={{ color: t.textMuted }}>Отмена</Text>
            </TouchableOpacity>
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
  profileCard:  { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ava:          { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  menuRow:      { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12, paddingHorizontal: 10 },
  menuIco:      { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  menuDot:      { width: 10, height: 10, borderRadius: 5 },
  pageHead:     { gap: 4, marginBottom: spacing.md, marginHorizontal: 2 },
  pageTitle:    { fontSize: 22, fontWeight: '800', letterSpacing: -0.2 },
  row:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md },
  toggleRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  upgradeBtn:   { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  logoutBtn:    { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', borderWidth: 1.5, marginBottom: spacing.xl },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalBox:     { borderRadius: radius.lg, padding: spacing.lg },
  modalTitle:   { fontSize: font.lg, fontWeight: '700', marginBottom: spacing.md },
  input:        { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
  multiline:    { height: 140, textAlignVertical: 'top' },
  supBubble:    { maxWidth: '84%', paddingHorizontal: 12, paddingTop: 9, paddingBottom: 6, borderRadius: 16 },
  modalBtn:     { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
});
