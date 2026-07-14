import React, { forwardRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useTheme, spacing, font, radius } from '../theme';
import { predict, learn, queueContribution, type PredictResult } from '../classifier';
import { useCategories, getCategories } from '../categories';
import { expenses, ai, type AuthUser } from '../api/client';
import { usePremium } from '../premium';
import { queueExpense, isNetworkError } from '../offline';

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
  const [mode, setMode] = useState<'form' | 'text'>('form');
  const [freeText, setFreeText] = useState('');
  const [parsing, setParsing] = useState(false);

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
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Нет доступа к камере'); return; }
      }
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.5,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      if (result.canceled || !result.assets?.[0]?.base64) return;

      setScanning(true);
      const res = await ai.parseImage(result.assets[0].base64);
      const parsed = res.expenses ?? [];
      if (parsed.length === 0) {
        Alert.alert('Не удалось распознать', 'На фото не нашлось расходов');
        return;
      }
      const total = parsed.reduce((s, e) => s + (e.amount || 0), 0);
      const preview = parsed.slice(0, 6).map(e => `• ${e.description} — ${e.amount} ₽`).join('\n')
        + (parsed.length > 6 ? `\n… и ещё ${parsed.length - 6}` : '');
      Alert.alert(
        `Распознано: ${parsed.length} поз. на ${Math.round(total)} ₽`,
        preview,
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Добавить всё',
            onPress: async () => {
              await expenses.add({
                expenses: parsed.map(e => ({
                  date: e.date || todayStr(),
                  category: e.category || 'Прочее',
                  amount: e.amount,
                  description: e.description,
                })),
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              sheetRef?.current?.close();
              onAdded();
            },
          },
        ],
      );
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setScanning(false);
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
      const total = parsed.reduce((s, e) => s + (e.amount || 0), 0);
      const preview = parsed.map(e => `• ${e.description} (${e.category}) — ${e.amount} ₽`).join('\n');
      Alert.alert(`Распознано: ${parsed.length} поз. на ${Math.round(total)} ₽`, preview, [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Добавить всё',
          onPress: async () => {
            await expenses.add({
              expenses: parsed.map(e => ({
                date: e.date || todayStr(),
                category: e.category || 'Прочее',
                amount: e.amount,
                description: e.description,
              })),
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setFreeText('');
            sheetRef?.current?.close();
            onAdded();
          },
        },
      ]);
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
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: spacing.lg }}>
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
              style={[styles.input, styles.textArea, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
              value={freeText}
              onChangeText={setFreeText}
              placeholder="Пример: продукты 2300, вчера такси 450, кофе 180"
              placeholderTextColor={t.textMuted}
              multiline
            />
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: '#a855f7', opacity: parsing ? 0.6 : 1 }]}
              onPress={parseFreeText}
              disabled={parsing}
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
                style={[styles.catBtn, { backgroundColor: active ? t.primary : t.surface2 }]}
                onPress={() => handleCategorySelect(cat)}
              >
                <Text style={{ fontSize: 20 }}>{catIcon2(cat)}</Text>
                <Text style={{ fontSize: font.xs, color: active ? '#fff' : t.text, marginTop: 2 }}>{cat}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: t.primary, opacity: submitting ? 0.6 : 1 }]}
          onPress={submit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.submitText}>Добавить</Text>
          }
        </TouchableOpacity>
        </>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  titleRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title:     { fontSize: font.xl, fontWeight: '700' },
  scanBtn:   { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  modeRow:   { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  modeBtn:   { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  textArea:  { height: 110, textAlignVertical: 'top', marginTop: spacing.sm },
  label:     { fontSize: font.sm, marginBottom: spacing.xs, marginTop: spacing.md },
  input:     { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md },
  predRow:   { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  predChip:  { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  catGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  catBtn:    { alignItems: 'center', borderRadius: radius.md, padding: spacing.sm, minWidth: 72 },
  submitBtn: { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  submitText:{ color: '#fff', fontSize: font.md, fontWeight: '600' },
});
