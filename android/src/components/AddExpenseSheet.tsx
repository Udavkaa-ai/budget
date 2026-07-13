import React, { forwardRef, useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { useTheme, spacing, font, radius } from '../theme';
import { CATEGORIES, predict, learn, queueContribution, type PredictResult } from '../classifier';
import { expenses, type AuthUser } from '../api/client';

const ICONS: Record<string, string> = {
  Продукты: '🛒', Кафе: '🍽', Транспорт: '🚇', Одежда: '👗', Красота: '💄',
  Медицина: '💊', Развлечения: '🎮', Дети: '👶', Дом: '🏠', Связь: '📱', Прочее: '❓',
};

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
  const snapPoints = ['70%', '92%'];

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<PredictResult | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Predict category as user types
  useEffect(() => {
    if (description.length < 3) { setPrediction(null); return; }
    const timer = setTimeout(async () => {
      setPredicting(true);
      const p = await predict(description);
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
    try {
      await expenses.add({
        expenses: [{ date: todayStr(), category: selectedCat, amount: amt, description: description.trim() }],
      });
      await learn(description, selectedCat);
      queueContribution(description, selectedCat);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      sheetRef?.current?.close();
      onAdded();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setSubmitting(false);
    }
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
        <Text style={[styles.title, { color: t.text }]}>Добавить расход</Text>

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
                    {ICONS[cat]} {cat}
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
          {CATEGORIES.map(cat => {
            const active = selectedCat === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.catBtn, { backgroundColor: active ? t.primary : t.surface2 }]}
                onPress={() => handleCategorySelect(cat)}
              >
                <Text style={{ fontSize: 20 }}>{ICONS[cat]}</Text>
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
      </BottomSheetScrollView>
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  title:     { fontSize: font.xl, fontWeight: '700', marginBottom: spacing.lg },
  label:     { fontSize: font.sm, marginBottom: spacing.xs, marginTop: spacing.md },
  input:     { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md },
  predRow:   { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  predChip:  { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  catGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  catBtn:    { alignItems: 'center', borderRadius: radius.md, padding: spacing.sm, minWidth: 72 },
  submitBtn: { borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginTop: spacing.sm },
  submitText:{ color: '#fff', fontSize: font.md, fontWeight: '600' },
});
