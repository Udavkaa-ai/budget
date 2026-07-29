import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, Alert, StyleSheet, ActivityIndicator, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { recurring as recurringApi, expenses as expApi, type RecurringItem } from '../api/client';
import { useCategories } from '../categories';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/Card';
import { Field, PrimaryButton } from '../components/UI';
import { haptics } from '../haptics';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}
function genId() {
  return `r_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}
function curYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type Draft = { id?: string; name: string; amount: string; category: string; day: string; user: string; active: boolean };

export function RecurringScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const { user } = useAuth();
  const { cats, icon: catIcon } = useCategories();
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await recurringApi.get()); } catch { /* оффлайн */ } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const persist = async (next: RecurringItem[]) => {
    setItems(next);
    try { await recurringApi.save(next); } catch { Alert.alert('Не удалось сохранить'); }
  };

  const now = new Date();
  const ym = curYm();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const upcoming = items.filter(i => i.active && i.lastPaid !== ym).sort((a, b) => a.day - b.day);
  const dueLabel = (day: number) => {
    const diff = Math.min(day, daysInMonth) - now.getDate();
    if (diff === 0) return 'сегодня';
    if (diff > 0) return `через ${diff} дн.`;
    return `просрочено ${-diff} дн.`;
  };
  const dueColor = (day: number) => {
    const diff = Math.min(day, daysInMonth) - now.getDate();
    return diff < 0 ? t.danger : diff <= 2 ? '#f59e0b' : t.textMuted;
  };

  const payNow = async (item: RecurringItem) => {
    setBusy(true);
    try {
      const d = Math.min(Math.max(item.day, 1), daysInMonth);
      const date = `${String(d).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
      await expApi.add({ expenses: [{ date, category: item.category, amount: item.amount, description: item.name }] });
      haptics.success();
      await persist(items.map(i => i.id === item.id ? { ...i, lastPaid: ym } : i));
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally { setBusy(false); }
  };

  const toggleActive = (id: string) => persist(items.map(i => i.id === id ? { ...i, active: !i.active } : i));
  const removeItem = (item: RecurringItem) => {
    Alert.alert('Удалить платёж?', item.name, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => persist(items.filter(i => i.id !== item.id)) },
    ]);
  };

  const openNew = () => setDraft({ name: '', amount: '', category: cats[0] ?? '', day: '1', user: user?.name ?? '', active: true });
  const openEdit = (i: RecurringItem) => setDraft({ id: i.id, name: i.name, amount: String(i.amount), category: i.category, day: String(i.day), user: i.user, active: i.active });

  const saveDraft = async () => {
    if (!draft) return;
    const amount = parseInt(draft.amount.replace(/[^\d]/g, '')) || 0;
    const day = Math.min(Math.max(parseInt(draft.day) || 1, 1), 31);
    if (!draft.name.trim()) { Alert.alert('Введите название'); return; }
    if (amount <= 0) { Alert.alert('Введите сумму'); return; }
    const base = { name: draft.name.trim(), amount, category: draft.category, day, user: draft.user || (user?.name ?? ''), active: draft.active };
    const next = draft.id
      ? items.map(i => i.id === draft.id ? { ...i, ...base } : i)
      : [...items, { id: genId(), ...base }];
    await persist(next);
    setDraft(null);
  };

  // Кандидаты «кто платит»: текущий пользователь + уже встречавшиеся в платежах
  const memberNames = Array.from(new Set([user?.name, ...items.map(i => i.user)].filter(Boolean))) as string[];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <TouchableOpacity onPress={onClose} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="chevron-back" size={22} color={t.primary} />
            <Text style={{ color: t.primary }}>Назад</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.text }]}>Регулярные платежи</Text>
          <TouchableOpacity onPress={openNew}><Text style={{ color: t.primary, fontSize: 26, fontWeight: '700' }}>＋</Text></TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />
        ) : (
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
            {upcoming.length > 0 && (
              <Card>
                <Text style={[styles.section, { color: t.text }]}>🔁 Предстоящие в этом месяце</Text>
                {upcoming.map(i => (
                  <View key={i.id} style={styles.upRow}>
                    <Text style={{ fontSize: 22 }}>{catIcon(i.category)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{i.name}</Text>
                      <Text style={{ color: dueColor(i.day), fontSize: font.xs }}>{i.day}-го · {dueLabel(i.day)}</Text>
                    </View>
                    <Text style={{ color: t.text, fontWeight: '700', marginRight: spacing.sm }}>{fmt(i.amount)}</Text>
                    <TouchableOpacity
                      style={[styles.payBtn, { backgroundColor: t.primary, opacity: busy ? 0.6 : 1 }]}
                      onPress={() => payNow(i)}
                      disabled={busy}
                    >
                      <Text style={{ color: '#fff', fontWeight: '700', fontSize: font.sm }}>Внести</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>
            )}

            <Card>
              <Text style={[styles.section, { color: t.text }]}>Все платежи</Text>
              {items.length === 0 && (
                <Text style={{ color: t.textMuted }}>Пока пусто. Добавьте подписку, аренду или ЖКХ по кнопке «＋».</Text>
              )}
              {items.map(i => (
                <TouchableOpacity key={i.id} style={styles.listRow} activeOpacity={0.7} onPress={() => openEdit(i)} onLongPress={() => removeItem(i)}>
                  <Text style={{ fontSize: 22, opacity: i.active ? 1 : 0.4 }}>{catIcon(i.category)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: i.active ? t.text : t.textMuted, fontWeight: '600' }} numberOfLines={1}>{i.name}</Text>
                    <Text style={{ color: t.textMuted, fontSize: font.xs }} numberOfLines={1}>
                      {i.day}-го · {i.category}{i.user ? ` · ${i.user}` : ''}{i.lastPaid === ym ? ' · ✓ внесён' : ''}
                    </Text>
                  </View>
                  <Text style={{ color: i.active ? t.text : t.textMuted, fontWeight: '700', marginRight: spacing.sm }}>{fmt(i.amount)}</Text>
                  <Switch value={i.active} onValueChange={() => toggleActive(i.id)} />
                </TouchableOpacity>
              ))}
              <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: spacing.sm }}>Тап — изменить · долгое нажатие — удалить</Text>
            </Card>
          </ScrollView>
        )}

        {/* Форма добавления/редактирования */}
        <Modal visible={!!draft} animationType="slide" transparent onRequestClose={() => setDraft(null)}>
          <View style={styles.overlay}>
            <View style={[styles.sheet, { backgroundColor: t.surface }]}>
              <Text style={[styles.title, { color: t.text, marginBottom: spacing.md }]}>{draft?.id ? 'Изменить платёж' : 'Новый платёж'}</Text>
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={[styles.lbl, { color: t.textMuted }]}>Название</Text>
                <Field value={draft?.name} onChangeText={v => setDraft(d => d && ({ ...d, name: v }))} placeholder="Напр. Интернет" />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 2 }}>
                    <Text style={[styles.lbl, { color: t.textMuted }]}>Сумма, ₽</Text>
                    <Field value={draft?.amount} onChangeText={v => setDraft(d => d && ({ ...d, amount: v }))} placeholder="0" keyboardType="number-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lbl, { color: t.textMuted }]}>День</Text>
                    <Field value={draft?.day} onChangeText={v => setDraft(d => d && ({ ...d, day: v }))} placeholder="1" keyboardType="number-pad" />
                  </View>
                </View>

                <Text style={[styles.lbl, { color: t.textMuted }]}>Категория</Text>
                <View style={styles.chips}>
                  {cats.map(c => (
                    <TouchableOpacity key={c} onPress={() => setDraft(d => d && ({ ...d, category: c }))}
                      style={[styles.chip, { backgroundColor: draft?.category === c ? t.primary : t.surface2, borderColor: t.border }]}>
                      <Text style={{ color: draft?.category === c ? '#fff' : t.text, fontSize: font.sm }}>{catIcon(c)} {c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {memberNames.length > 1 && (
                  <>
                    <Text style={[styles.lbl, { color: t.textMuted }]}>Кто платит</Text>
                    <View style={styles.chips}>
                      {memberNames.map(n => (
                        <TouchableOpacity key={n} onPress={() => setDraft(d => d && ({ ...d, user: n }))}
                          style={[styles.chip, { backgroundColor: draft?.user === n ? t.primary : t.surface2, borderColor: t.border }]}>
                          <Text style={{ color: draft?.user === n ? '#fff' : t.text, fontSize: font.sm }}>{n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
                  <Text style={{ color: t.text }}>Активен</Text>
                  <Switch value={draft?.active ?? true} onValueChange={v => setDraft(d => d && ({ ...d, active: v }))} />
                </View>

                <PrimaryButton title="Сохранить" onPress={saveDraft} style={{ marginTop: spacing.lg }} />
                <TouchableOpacity onPress={() => setDraft(null)} style={{ alignItems: 'center', padding: spacing.md }}>
                  <Text style={{ color: t.textMuted }}>Отмена</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  title:   { fontSize: font.lg, fontWeight: '700' },
  section: { fontSize: font.md, fontWeight: '700', marginBottom: spacing.sm },
  upRow:   { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  payBtn:  { borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 7 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet:   { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, maxHeight: '88%' },
  lbl:     { fontSize: font.xs, letterSpacing: 0.5, marginTop: spacing.md, marginBottom: 4 },
  chips:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip:    { borderRadius: radius.xl, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
