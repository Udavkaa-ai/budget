import React, { forwardRef, useState, useEffect, useCallback } from 'react';
import { showAlert } from '../dialog';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, ScrollView } from 'react-native';
import BottomSheet, { BottomSheetScrollView, BottomSheetFooter, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, spacing, font, radius } from '../theme';
import { predict, learn, queueContribution, type PredictResult } from '../classifier';
import { useCategories, getCategories } from '../categories';
import { PrimaryButton, SecondaryButton, Segmented, Chip } from '../components/UI';
import { expenses, ai, type AuthUser, type ParsedExpense } from '../api/client';
import { usePremium } from '../premium';
import { queueExpense, isNetworkError } from '../offline';
import { DayPickerModal } from '../components/Pickers';
import { Finik } from '../components/Finik';
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
  const [focusedField, setFocusedField] = useState<'free' | 'desc' | 'amount' | null>(null);
  const [parsing, setParsing] = useState(false);
  // Тематическое превью ИИ-разбора (вместо системного Alert) — позиции редактируемы
  const [preview, setPreview] = useState<{ items: ParsedExpense[]; source: 'text' | 'photo' } | null>(null);
  const [adding, setAdding] = useState(false);
  const [catEditIdx, setCatEditIdx] = useState<number | null>(null);
  const [dateEditIdx, setDateEditIdx] = useState<number | null>(null);
  const [formDate, setFormDate] = useState(todayStr());
  const [formDatePicker, setFormDatePicker] = useState(false);

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
    setFormDate(todayStr());
  };

  const submit = async () => {
    if (!description.trim() || !amount.trim() || !selectedCat) {
      showAlert('Заполните все поля');
      return;
    }
    const amt = parseFloat(amount.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) { showAlert('Некорректная сумма'); return; }

    setSubmitting(true);
    const item = { date: formDate, category: selectedCat, amount: amt, description: description.trim() };
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
        showAlert(
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
        showAlert('Ошибка', String(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Photo receipt scan (premium): camera/gallery → server AI → add expenses
  const scanReceipt = () => {
    if (!premium) {
      showAlert('💎 Премиум', 'Сканирование чеков доступно в Премиуме. Активировать можно в Настройках (бесплатно на время теста).');
      return;
    }
    showAlert('Скан чека', 'Откуда взять фото?', [
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
          if (!perm.granted) { showAlert('Нет доступа к камере'); return; }
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
        showAlert('Не удалось распознать', 'На фото не нашлось расходов');
        return;
      }
      setPreview({ items: parsed, source: 'photo' });
    } catch (e) {
      showAlert('Ошибка', String(e));
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
      showAlert('Ошибка', String(e));
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
      if (parsed.length === 0) { showAlert('Не удалось разобрать текст'); return; }
      setPreview({ items: parsed, source: 'text' });
    } catch (e) {
      showAlert('Ошибка', String(e));
    } finally {
      setParsing(false);
    }
  };

  const switchMode = (m: 'form' | 'text') => {
    if (m === 'text' && !premium) {
      showAlert('💎 Премиум', 'Ввод текстом через ИИ доступен в Премиуме. Активировать можно в Настройках (бесплатно на время теста).');
      return;
    }
    setMode(m);
  };

  const catBtns = prediction?.mode === 'buttons'
    ? prediction.top3
    : prediction?.mode === 'auto'
    ? [prediction.category]
    : null;

  // Закреплённая кнопка действия — всегда над клавиатурой (BottomSheetFooter),
  // чтобы «Разобрать»/«Добавить» не прятались при вводе. Едина для обеих вкладок.
  const renderFooter = useCallback((props: BottomSheetFooterProps) => (
    <BottomSheetFooter {...props} bottomInset={0}>
      <View style={[styles.footer, { backgroundColor: t.surface, borderTopColor: t.border }]}>
        {mode === 'text' ? (
          <PrimaryButton title="Разобрать" onPress={parseFreeText} loading={parsing} disabled={!freeText.trim()} />
        ) : (
          <PrimaryButton title="Добавить расход" onPress={submit} loading={submitting} />
        )}
      </View>
    </BottomSheetFooter>
  ), [mode, parsing, submitting, freeText, description, amount, selectedCat, formDate, t]);

  return (
    <BottomSheet
      ref={ref}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: t.surface }}
      handleIndicatorStyle={{ backgroundColor: t.borderStrong, width: 40 }}
      footerComponent={renderFooter}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      // Поверх всего экрана: иначе карточки с elevation (напр. «Итого за день»)
      // на Android «пробивают» лист ввода
      containerStyle={{ elevation: 30, zIndex: 30 }}
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: t.text }]}>Добавить расход</Text>
          <Finik emotion="record" size={46} />
        </View>

        <Segmented
          value={mode}
          options={[{ value: 'text', label: premium ? 'Текстом' : 'Текстом 💎' }, { value: 'form', label: 'Вручную' }]}
          onChange={m => switchMode(m)}
          style={{ marginBottom: spacing.lg }}
        />

        {mode === 'text' ? (
          <>
            {/* ИИ-поле: текст + инструменты в одной рамке (как в вебе) */}
            <View style={[styles.aiBox, {
              backgroundColor: t.surface2,
              borderColor: focusedField === 'free' ? t.primary : t.border,
            }]}>
              <TextInput
                style={[styles.freeText, { color: t.text }]}
                value={freeText}
                onChangeText={setFreeText}
                onFocus={() => setFocusedField('free')}
                onBlur={() => setFocusedField(null)}
                placeholder="продукты 2300, вчера такси 450, кофе 180"
                placeholderTextColor={t.textFaint}
                multiline
                textAlignVertical="top"
              />
              <View style={styles.aiFoot}>
                <Text style={{ color: t.textFaint, fontSize: 12, flex: 1 }}>
                  {scanning ? 'Читаю чек…' : 'ИИ разберёт суммы, категории и даты'}
                </Text>
                <TouchableOpacity
                  style={[styles.toolBtn, { backgroundColor: t.surface, borderColor: t.border }]}
                  onPress={scanReceipt}
                  disabled={scanning}
                  accessibilityLabel="Распознать фото чека"
                >
                  {scanning
                    ? <ActivityIndicator size="small" color={t.primary} />
                    : <Ionicons name="camera-outline" size={21} color={t.primary} />}
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.chipRow}>
              {['кофе 180', 'вчера такси 450', 'аптека 640'].map(ex => (
                <Chip key={ex} label={ex} onPress={() => {
                  Haptics.selectionAsync();
                  setFreeText(v => v.trim() ? `${v.trim().replace(/,$/, '')}, ${ex}` : ex);
                }} />
              ))}
            </View>
          </>
        ) : (
        <>
        {/* Крупная сумма */}
        <View style={[styles.amountBox, {
          backgroundColor: t.surface2, borderColor: focusedField === 'amount' ? t.primary : t.border,
        }]}>
          <TextInput
            style={[styles.amountInput, { color: t.text }]}
            value={amount}
            onChangeText={setAmount}
            onFocus={() => setFocusedField('amount')}
            onBlur={() => setFocusedField(null)}
            placeholder="0"
            placeholderTextColor={t.textFaint}
            keyboardType="decimal-pad"
            accessibilityLabel="Сумма, ₽"
          />
          <Text style={[styles.amountCur, { color: t.textFaint }]}>₽</Text>
        </View>
        <View style={[styles.chipRow, { justifyContent: 'center' }]}>
          {[100, 200, 500, 1000, 2000, 5000].map(v => (
            <Chip key={v} label={new Intl.NumberFormat('ru-RU').format(v)} active={amount === String(v)}
              onPress={() => { Haptics.selectionAsync(); setAmount(String(v)); }} />
          ))}
        </View>

        <Text style={[styles.label, { color: t.textMuted }]}>ОПИСАНИЕ</Text>
        <TextInput
          style={[styles.input, { color: t.text, backgroundColor: t.surface2, borderColor: focusedField === 'desc' ? t.primary : t.border }]}
          value={description}
          onChangeText={setDescription}
          onFocus={() => setFocusedField('desc')}
          onBlur={() => setFocusedField(null)}
          placeholder="Что купили?"
          placeholderTextColor={t.textFaint}
          autoCapitalize="none"
        />

        {/* Подсказки классификатора */}
        {catBtns && (
          <View style={styles.chipRow}>
            {predicting
              ? <ActivityIndicator size="small" color={t.primary} />
              : catBtns.map(cat => (
                <Chip key={cat} label={`${catIcon2(cat)} ${cat}`} active={selectedCat === cat} onPress={() => handleCategorySelect(cat)} />
              ))}
          </View>
        )}

        <Text style={[styles.label, { color: t.textMuted }]}>КАТЕГОРИЯ</Text>
        <View style={styles.catGrid}>
          {cats.map(cat => {
            const active = selectedCat === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.catBtn, {
                  backgroundColor: active ? t.primarySoft : t.surface2,
                  borderColor: active ? t.primary : 'transparent',
                }]}
                onPress={() => handleCategorySelect(cat)}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 22 }}>{catIcon2(cat)}</Text>
                <Text style={{ fontSize: 11, fontWeight: '600', color: active ? t.primary : t.textMuted, textAlign: 'center' }} numberOfLines={1}>{cat}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[styles.label, { color: t.textMuted }]}>ДАТА</Text>
        <TouchableOpacity
          style={[styles.input, styles.dateBtn, { backgroundColor: t.surface2, borderColor: t.border }]}
          onPress={() => { Haptics.selectionAsync(); setFormDatePicker(true); }}
        >
          <Text style={{ color: t.text, fontSize: 16 }}>{formDate === todayStr() ? `Сегодня, ${formDate}` : formDate}</Text>
          <Ionicons name="calendar-outline" size={20} color={t.textMuted} />
        </TouchableOpacity>
        <DayPickerModal
          visible={formDatePicker}
          date={formDate}
          onClose={() => setFormDatePicker(false)}
          onPick={d => { setFormDate(d); setFormDatePicker(false); }}
        />
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
              <SecondaryButton title="Отмена" style={{ flex: 1 }} disabled={adding}
                onPress={() => { setPreview(null); setCatEditIdx(null); setDateEditIdx(null); }} />
              <PrimaryButton title="Добавить всё" style={{ flex: 1 }} onPress={confirmPreview} loading={adding} />
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
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  title:     { fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  aiBox:     { borderRadius: radius.md, borderWidth: 1 },
  aiFoot:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.sm, paddingBottom: spacing.sm },
  toolBtn:   { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.md },
  amountBox: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 6, borderRadius: radius.md, borderWidth: 1, paddingVertical: 8, paddingHorizontal: spacing.lg },
  amountInput: { fontSize: 38, fontWeight: '800', minWidth: 40, textAlign: 'right', padding: 0 },
  amountCur: { fontSize: 26, fontWeight: '700' },
  dateBtn:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scanBtn:   { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  modeRow:   { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  modeBtn:   { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  freeText:  {
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs,
    fontSize: 16, lineHeight: 22, minHeight: 96,
  },
  inputFocused: {
    shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  freeHint:  { fontSize: font.xs, lineHeight: 16, marginTop: spacing.sm, marginBottom: spacing.xs },
  label:     { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6, marginTop: spacing.lg },
  input:     { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: 16 },
  footer:    { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  predRow:   { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  predChip:  { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(17,16,24,0.5)', justifyContent: 'center', padding: spacing.lg },
  previewBox: { borderRadius: radius.lg, padding: spacing.lg },
  previewRow: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  previewBtn: { flex: 1, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
  prevCatBtn: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  prevCatChip:{ width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  catGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  catBtn:    { alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: radius.md, borderWidth: 1.5, width: '23%', flexGrow: 1, maxWidth: '24%', paddingVertical: 9, paddingHorizontal: 2 },
  submitBtn: { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  submitText:{ color: '#fff', fontSize: font.md, fontWeight: '600' },
});
