import React, { forwardRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, ScrollView,
} from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, spacing, font, radius } from '../theme';
import { predict, learn, queueContribution, type PredictResult } from '../classifier';
import { useCategories, getCategories } from '../categories';
import { PrimaryButton } from '../components/UI';
import { expenses, ai, type AuthUser, type ParsedExpense } from '../api/client';
import { usePremium } from '../premium';
import { queueExpense, isNetworkError } from '../offline';
import { DayPickerModal } from '../components/Pickers';
import { checkOnAddExpense } from '../achievements';
import { beginSystemUi, endSystemUi } from '../applock';

function todayStr() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

interface Props {
  user: AuthUser;
  onAdded: () => void;
}

export const AddExpenseSheet = forwardRef<BottomSheet, Props>(function AddExpenseSheet({ user, onAdded }, ref) {
  const t = useTheme();
  const premium = usePremium();
  const { cats, icon: catIcon2 } = useCategories();
  const snapPoints = ['70%', '92%'];

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  // По умолчанию — свободный ввод текстом с ИИ-распознаванием (если премиум).
  // Без премиума открываем форму, чтобы не упереться в платный разбор.
  const [mode, setMode] = useState<'form' | 'text'>(premium ? 'text' : 'form');
  const [freeText, setFreeText] = useState('');
  const [freeTextFocused, setFreeTextFocused] = useState(false);
  const [parsing, setParsing] = useState(false);
  // Тематическое превью ИИ-разбора (вместо системного Alert) — позиции редактируемы
  const [preview, setPreview] = useState<{ items: ParsedExpense[]; source: 'text' | 'photo' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [catEditIdx, setCatEditIdx] = useState<number | null>(null);
  const [dateEditIdx, setDateEditIdx] = useState<number | null>(null);

  const updateItem = (idx: number, patch: Partial<ParsedExpense>) =>
    setPreview(p => p ? { ...p, items: p.items.map((it, i) => i === idx ? { ...it, ...patch } : it) } : p);

  // Премиум мог инициализироваться асинхронно после монтирования —
  // тогда переключаем дефолт на «Текстом» (срабатывает один раз, при появлении премиума)
  useEffect(() => {
    if (premium) setMode('text');
  }, [premium]);

  // Predict category as user types
  useEffect(() => {
    if (description.length < 3) { setPrediction(null); return; }
    const timer = setTimeout(async () => {
      setPredicting(true);
      const p = await predict(description, getCategories());
      setPrediction(p);
      if (p.mode === 'auto' && !selectedCat) setSelectedCat(p.category);
      setPredicting(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [description, selectedCat]);

  const handleCategorySelect = (cat: string) => {
    setSelectedCat(cat);
    Haptics.selectionAsync();
  };

  const sheetRef = ref as React.RefObject<BottomSheet>;

  const reset = () => {
    setDescription('');
    setAmount('');
    setSelectedCat(null);
    setPrediction(null);
  };

  const submit = async () => {
    if (!description.trim() || !amount.trim() || !selectedCat) {
      Alert.alert('Заполните все поля');
      return;
    }
    const amt = parseFloat(amount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) { Alert.alert('Некорректная сумма'); return; }

    setSubmitting(true);
    const item = { date: todayStr(), category: selectedCat, amount: amt, description: description.trim() };
    try {
      await expenses.add({ expenses: [item] });
      await learn(description, selectedCat);
      queueContribution(description, selectedCat);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      checkOnAddExpense();
      reset();
      sheetRef?.current?.close();
      onAdded();
    } catch (e) {
      if (isNetworkError(e)) {
        // Сети нет — предлагаем офлайн-режим с последующей синхронизацией
        Alert.alert(
          'Нет соединения',
          'Внести расход в офлайн-режиме? Он появится в ленте с меткой ⏳ и уйдёт на сервер, когда сеть вернётся.',
          [
            { text: 'Отмена', style: 'cancel' },
            {
              text: '📴 Внести офлайн',
              onPress: async () => {
                await queueExpense(item);
                await learn(description, selectedCat!);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                checkOnAddExpense();
                reset();
                sheetRef?.current?.close();
                onAdded();
              },
            },
          ],
        );
      } else {
        Alert.alert('Ошибка', String(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Photo receipt scan (premium): camera/gallery → server AI → add expenses
  const scanReceipt = () => {
    if (!premium) {
      Alert.alert('💎 Премиум', 'Сканирование чеков доступно в Премиуме. Активировать можно в Настройках (бесплатно на время теста).');
      return;
    }
    Alert.alert('Скан чека', 'Откуда взять фото?', [
      { text: 'Отмена', style: 'cancel' },
      { text: '📷 Камера', onPress: () => pickImage(true) },
      { text: '🖼 Галерея', onPress: () => pickImage(false) },
    ]);
  };

  const pickImage = async (camera: boolean) => {
    try {
      // Системные экраны (запрос доступа, камера, галерея) уводят приложение в
      // background — подавляем автоблокировку, иначе после выбора фото процесс
      // скана чека сбрасывается на экран разблокировки.
      let result: ImagePicker.ImagePickerResult | null = null;
      beginSystemUi();
      try {
        if (camera) {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { Alert.alert('Нет доступа к камере'); return; }
        }
        const opts: ImagePicker.ImagePickerOptions = {
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          base64: true,
          quality: 0.5,
        };
        result = camera
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync(opts);
      } finally {
        endSystemUi();
      }
      if (!result || result.canceled || !result.assets?.[0]?.base64) return;

      setScanning(true);
      const res = await ai.parseImage(result.assets[0].base64);
      const parsed = res.expenses ?? [];
      if (parsed.length === 0) {
        Alert.alert('Не удалось распознать', 'На фото не нашлось расходов');
        return;
      }
      setPreview({ items: parsed, source: 'photo' });
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setScanning(false);
    }
  };

  // Подтверждение ИИ-превью: добавляем все распознанные позиции
  const confirmPreview = async () => {
    if (!preview) return;
    setAdding(true);
    try {
      await expenses.add({
        expenses: preview.items.map(e => ({
          date: e.date || todayStr(),
          category: e.category || 'Прочее',
          amount: e.amount,
          description: e.description,
        })),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      checkOnAddExpense({ receipt: preview.source === 'photo' });
      setPreview(null); setCatEditIdx(null); setDateEditIdx(null);
      setFreeText('');
      sheetRef?.current?.close();
      onAdded();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setAdding(false);
    }
  };

  // Free-text AI parse (premium): "продукты 2300, вчера такси 450" → expenses
  const parseFreeText = async () => {
    if (!freeText.trim()) return;
    setParsing(true);
    try {
      const res = await ai.parseText(freeText.trim());
      const parsed = res.expenses ?? [];
      if (parsed.length === 0) { Alert.alert('Не удалось разобрать текст'); return; }
      setPreview({ items: parsed, source: 'text' });
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setParsing(false);
    }
  };

  const switchMode = (m: 'form' | 'text') => {
    if (m === 'text' && !premium) {
      Alert.alert('💎 Премиум', 'Ввод текстом через ИИ доступен в Премиуме. Активировать можно в Настройках (бесплатно на время теста).');
      return;
    }
    setMode(m);
  };

  const catBtns = prediction?.mode === 'buttons'
    ? prediction.top3
    : prediction?.mode === 'auto'
    ? [prediction.category]
    : null;

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: t.surface }}
      handleIndicatorStyle={{ backgroundColor: t.border }}
      // Поверх всего экрана: иначе карточки с elevation (напр. «Итого за день»)
      // на Android «пробивают» лист ввода
      containerStyle={{ elevation: 30, zIndex: 30 }}
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: t.text }]}>Добавить расход</Text>
          <TouchableOpacity
            style={[styles.scanBtn, { backgroundColor: t.surface2 }]}
            onPress={scanReceipt}
            disabled={scanning}
          >
            {scanning
              ? <ActivityIndicator size="small" color="#a855f7" />
              : <Text style={{ fontSize: font.sm }}>📸 Чек{premium ? '' : ' 💎'}</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Mode toggle */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, { backgroundColor: mode === 'form' ? t.primary : t.surface2 }]}
            onPress={() => switchMode('form')}
          >
            <Text style={{ color: mode === 'form' ? '#fff' : t.text, fontSize: font.sm }}>📋 Форма</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, { backgroundColor: mode === 'text' ? t.primary : t.surface2 }]}
            onPress={() => switchMode('text')}
          >
            <Text style={{ color: mode === 'text' ? '#fff' : t.text, fontSize: font.sm }}>
              ✍️ Текстом{premium ? '' : ' 💎'}
            </Text>
          </TouchableOpacity>
        </View>

        {mode === 'text' ? (
          <>
            <Text style={[styles.label, { color: t.textMuted }]}>
              Напишите расходы в свободной форме — ИИ разберёт их сам
            </Text>
            <TextInput
              style={[
                styles.freeText,
                {
                  color: t.text,
                  backgroundColor: t.surface2,
                  borderColor: freeTextFocused ? t.primary : t.border,
                },
                freeTextFocused && styles.freeTextFocused,
                freeTextFocused && { shadowColor: t.primary },
              ]}
              value={freeText}
              onChangeText={setFreeText}
              onFocus={() => setFreeTextFocused(true)}
              onBlur={() => setFreeTextFocused(false)}
              placeholder={'Пример:\nпродукты 2300\nвчера такси 450\nкофе 180'}
              placeholderTextColor={t.textMuted}
              multiline
              textAlignVertical="top"
            />
            <Text style={[styles.freeHint, { color: t.textMuted }]}>
              По одной трате на строку или через запятую — ИИ сам определит суммы, даты и категории.
            </Text>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: '#9333EA', opacity: parsing ? 0.7 : 1 }]}
              onPress={parseFreeText}
              disabled={parsing}
              activeOpacity={0.85}
            >
              {parsing
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.submitText}>🤖 Разобрать</Text>
              }
            </TouchableOpacity>
          </>
        ) : (
        <>
        {/* Description */}
        <Text style={[styles.label, { color: t.textMuted }]}>Описание</Text>
        <TextInput
          style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
          value={description}
          onChangeText={setDescription}
          placeholder="Что купили?"
          placeholderTextColor={t.textMuted}
          autoCapitalize="none"
        />

        {/* AI prediction chips */}
        {catBtns && (
          <View style={styles.predRow}>
            {predicting
              ? <ActivityIndicator size="small" color={t.primary} />
              : catBtns.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.predChip, { backgroundColor: selectedCat === cat ? t.primary : t.surface2 }]}
                  onPress={() => handleCategorySelect(cat)}
                >
                  <Text style={{ color: selectedCat === cat ? '#fff' : t.text, fontSize: font.sm }}>
                    {catIcon2(cat)} {cat}
                  </Text>
                </TouchableOpacity>
              ))
            }
          </View>
        )}

        {/* Amount */}
        <Text style={[styles.label, { color: t.textMuted }]}>Сумма, ₽</Text>
        <TextInput
          style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
          value={amount}
          onChangeText={setAmount}
          placeholder="0"
          placeholderTextColor={t.textMuted}
          keyboardType="decimal-pad"
        />

        {/* Category grid */}
        <Text style={[styles.label, { color: t.textMuted }]}>Категория</Text>
        <View style={styles.catGrid}>
          {cats.map(cat => {
            const active = selectedCat === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.catBtn, {
                  backgroundColor: active ? t.primary : t.surface2,
                  borderWidth: 2, borderColor: active ? t.primary : 'transparent',
                }]}
                onPress={() => handleCategorySelect(cat)}
              >
                <Text style={{ fontSize: 26 }}>{catIcon2(cat)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Submit */}
        <PrimaryButton title="Добавить" onPress={submit} loading={submitting} style={{ marginTop: spacing.sm }} />
        </>
        )}
      </BottomSheetScrollView>

      {/* Тематическое превью ИИ-разбора */}
      <Modal visible={!!preview} animationType="fade" transparent onRequestClose={() => { setPreview(null); setCatEditIdx(null); setDateEditIdx(null); }}>
        <View style={styles.previewOverlay}>
          <View style={[styles.previewBox, { backgroundColor: t.surface }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
              <Ionicons name={preview?.source === 'photo' ? 'receipt' : 'sparkles'} size={22} color={t.primary} />
              <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800', flex: 1 }}>
                Распознано: {preview?.items.length ?? 0} поз.
              </Text>
              <Text style={{ color: t.primary, fontSize: font.lg, fontWeight: '800' }}>
                {new Intl.NumberFormat('ru-RU').format(Math.round((preview?.items ?? []).reduce((s, e) => s + (e.amount || 0), 0)))} ₽
              </Text>
            </View>
            <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
              Проверьте и при необходимости поправьте — иконку категории, название, дату или сумму можно нажать.
            </Text>
            <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
              {(preview?.items ?? []).map((e, idx) => (
                <View key={idx} style={[styles.previewRow, { borderBottomColor: t.border }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); setCatEditIdx(catEditIdx === idx ? null : idx); }}
                      style={[styles.prevCatBtn, { backgroundColor: t.surface2 }]}
                    >
                      <Text style={{ fontSize: 22 }}>{catIcon2(e.category || 'Прочее')}</Text>
                    </TouchableOpacity>
                    <View style={{ flex: 1 }}>
                      <TextInput
                        value={e.description}
                        onChangeText={v => updateItem(idx, { description: v })}
                        placeholder="Название"
                        placeholderTextColor={t.textMuted}
                        style={{ color: t.text, fontSize: font.md, paddingVertical: 2 }}
                      />
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setDateEditIdx(idx); }}>
                          <Text style={{ color: t.primary, fontSize: font.xs }}>📅 {e.date || todayStr()}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { Haptics.selectionAsync(); setCatEditIdx(catEditIdx === idx ? null : idx); }}>
                          <Text style={{ color: t.textMuted, fontSize: font.xs }} numberOfLines={1}>{e.category || 'Прочее'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TextInput
                        value={String(e.amount ?? '')}
                        onChangeText={v => updateItem(idx, { amount: parseFloat(v.replace(',', '.')) || 0 })}
                        keyboardType="decimal-pad"
                        style={{ color: t.text, fontSize: font.md, fontWeight: '700', minWidth: 56, textAlign: 'right' }}
                      />
                      <Text style={{ color: t.text, fontSize: font.md, fontWeight: '700' }}> ₽</Text>
                    </View>
                  </View>
                  {catEditIdx === idx && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ marginTop: spacing.sm }}>
                      {cats.map(c => (
                        <TouchableOpacity
                          key={c}
                          onPress={() => { updateItem(idx, { category: c }); setCatEditIdx(null); Haptics.selectionAsync(); }}
                          style={[styles.prevCatChip, { backgroundColor: e.category === c ? t.primary : t.surface2 }]}
                        >
                          <Text style={{ fontSize: 20 }}>{catIcon2(c)}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
              <TouchableOpacity
                style={[styles.previewBtn, { backgroundColor: t.surface2 }]}
                onPress={() => { setPreview(null); setCatEditIdx(null); setDateEditIdx(null); }}
                disabled={adding}
              >
                <Text style={{ color: t.text, fontWeight: '600' }}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1 }} onPress={confirmPreview} disabled={adding} activeOpacity={0.85}>
                <LinearGradient
                  colors={t.gradient}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={styles.previewBtn}
                >
                  {adding
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={{ color: '#fff', fontWeight: '700' }}>Добавить всё</Text>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Изменение даты позиции */}
        <DayPickerModal
          visible={dateEditIdx !== null}
          date={(dateEditIdx !== null && preview?.items[dateEditIdx]?.date) || todayStr()}
          onClose={() => setDateEditIdx(null)}
          onPick={d => { if (dateEditIdx !== null) updateItem(dateEditIdx, { date: d }); setDateEditIdx(null); }}
        />
      </Modal>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title:     { fontSize: font.xl, fontWeight: '700' },
  scanBtn:   { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  modeRow:   { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  modeBtn:   { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  freeText:  {
    borderRadius: radius.md, borderWidth: 1.5,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: 16, lineHeight: 22, minHeight: 140, marginTop: spacing.sm,
  },
  freeTextFocused: {
    shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  freeHint:  { fontSize: font.xs, lineHeight: 16, marginTop: spacing.sm, marginBottom: spacing.xs },
  label:     { fontSize: font.sm, marginBottom: spacing.xs, marginTop: spacing.md },
  input:     { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md },
  predRow:   { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  predChip:  { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: spacing.lg },
  previewBox: { borderRadius: radius.lg, padding: spacing.lg },
  previewRow: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  previewBtn: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
  prevCatBtn: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  prevCatChip:{ width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  catGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  catBtn:    { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, width: 52, height: 52 },
  submitBtn: { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  submitText:{ color: '#fff', fontSize: font.md, fontWeight: '600' },
});
