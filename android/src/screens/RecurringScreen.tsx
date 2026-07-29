import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, Alert, StyleSheet, ActivityIndicator, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { recurring as recurringApi, expenses as expApi, type RecurringItem, type RecurringFreq } from '../api/client';
import { useCategories } from '../categories';
import { useAuth } from '../hooks/useAuth';
import { Card } from '../components/Card';
import { Field, PrimaryButton } from '../components/UI';
import { haptics } from '../haptics';
import {
  remaining, dueDate, dueLabel, daysUntil, scheduleLabel, periodKey, paidInPeriod,
  FREQ_LABEL, WEEKDAYS_SHORT,
} from '../recurring';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}
function genId() {
  return `r_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

type Draft = {
  id?: string; name: string; amount: string; category: string;
  freq: RecurringFreq; day: number; times: string; user: string; active: boolean;
};

const FREQS: RecurringFreq[] = ['daily', 'weekly', 'monthly'];

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
  const upcoming = items
    .filter(i => i.active && remaining(i, now) > 0)
    .sort((a, b) => daysUntil(a, now) - daysUntil(b, now) || a.name.localeCompare(b.name));

  const dueColor = (i: RecurringItem) => {
    const diff = daysUntil(i, now);
    return diff < 0 ? t.danger : diff <= 1 ? '#f59e0b' : t.textMuted;
  };

  const payNow = async (item: RecurringItem) => {
    setBusy(true);
    try {
      const date = dueDate(item, now);
      await expApi.add({ expenses: [{ date, category: item.category, amount: item.amount, description: item.name }] });
      haptics.success();
      const key = periodKey(item, now);
      const paid = paidInPeriod(item, now) + 1;
      await persist(items.map(i => i.id === item.id ? { ...i, lastPaid: key, paidCount: paid } : i));
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

  const openNew = () => setDraft({ name: '', amount: '', category: cats[0] ?? '', freq: 'monthly', day: 1, times: '1', user: user?.name ?? '', active: true });
  const openEdit = (i: RecurringItem) => setDraft({
    id: i.id, name: i.name, amount: String(i.amount), category: i.category,
    freq: i.freq || 'monthly', day: i.day, times: String(Math.max(1, i.times || 1)), user: i.user, active: i.active,
  });

  const saveDraft = async () => {
    if (!draft) return;
    const amount = parseInt(draft.amount.replace(/[^\d]/g, '')) || 0;
    const times = Math.max(1, parseInt(draft.times) || 1);
    let day = draft.day;
    if (draft.freq === 'monthly') day = Math.min(Math.max(day, 1), 31);
    if (draft.freq === 'weekly') day = ((day % 7) + 7) % 7;
    if (!draft.name.trim()) { Alert.alert('Введите название'); return; }
    if (amount <= 0) { Alert.alert('Введите сумму'); return; }
    const base = {
      name: draft.name.trim(), amount, category: draft.category, user: draft.user || (user?.name ?? ''),
      active: draft.active, freq: draft.freq, day, times,
    };
    const next = draft.id
      ? items.map(i => i.id === draft.id ? { ...i, ...base } : i)
      : [...items, { id: genId(), ...base }];
    await persist(next);
    setDraft(null);
  };

  const memberNames = Array.from(new Set([user?.name, ...items.map(i => i.user)].filter(Boolean))) as string[];

  const setDayField = (v: string) => setDraft(d => d && ({ ...d, day: Math.max(1, parseInt(v.replace(/[^\d]/g, '')) || 1) }));

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
                <Text style={[styles.section, { color: t.text }]}>🔁 К оплате</Text>
                {upcoming.map(i => (
                  <View key={i.id} style={styles.upRow}>
                    <Text style={{ fontSize: 22 }}>{catIcon(i.category)}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontWeight: '600' }} numberOfLines={1}>{i.name}</Text>
                      <Text style={{ color: dueColor(i), fontSize: font.xs }}>{dueLabel(i, now)}</Text>
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
                <Text style={{ color: t.textMuted }}>Пока пусто. Добавьте подписку, аренду, проездной или что-то ежедневное по кнопке «＋».</Text>
              )}
              {items.map(i => (
                <TouchableOpacity key={i.id} style={styles.listRow} activeOpacity={0.7} onPress={() => openEdit(i)} onLongPress={() => removeItem(i)}>
                  <Text style={{ fontSize: 22, opacity: i.active ? 1 : 0.4 }}>{catIcon(i.category)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: i.active ? t.text : t.textMuted, fontWeight: '600' }} numberOfLines={1}>{i.name}</Text>
                    <Text style={{ color: t.textMuted, fontSize: font.xs }} numberOfLines={1}>
                      {scheduleLabel(i)} · {i.category}{i.user ? ` · ${i.user}` : ''}
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
                <Field value={draft?.name} onChangeText={v => setDraft(d => d && ({ ...d, name: v }))} placeholder="Напр. Маршрутка" />

                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <View style={{ flex: 2 }}>
                    <Text style={[styles.lbl, { color: t.textMuted }]}>Сумма, ₽</Text>
                    <Field value={draft?.amount} onChangeText={v => setDraft(d => d && ({ ...d, amount: v }))} placeholder="0" keyboardType="number-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.lbl, { color: t.textMuted }]}>Раз за период</Text>
                    <Field value={draft?.times} onChangeText={v => setDraft(d => d && ({ ...d, times: v }))} placeholder="1" keyboardType="number-pad" />
                  </View>
                </View>

                <Text style={[styles.lbl, { color: t.textMuted }]}>Как часто</Text>
                <View style={styles.chips}>
                  {FREQS.map(f => (
                    <TouchableOpacity key={f} onPress={() => setDraft(d => d && ({ ...d, freq: f, day: f === 'weekly' ? 1 : d.day }))}
                      style={[styles.chip, { backgroundColor: draft?.freq === f ? t.primary : t.surface2, borderColor: t.border }]}>
                      <Text style={{ color: draft?.freq === f ? '#fff' : t.text, fontSize: font.sm }}>{FREQ_LABEL[f]}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {draft?.freq === 'weekly' && (
                  <>
                    <Text style={[styles.lbl, { color: t.textMuted }]}>День недели</Text>
                    <View style={styles.chips}>
                      {[1, 2, 3, 4, 5, 6, 0].map(wd => (
                        <TouchableOpacity key={wd} onPress={() => setDraft(d => d && ({ ...d, day: wd }))}
                          style={[styles.chip, { backgroundColor: draft?.day === wd ? t.primary : t.surface2, borderColor: t.border }]}>
                          <Text style={{ color: draft?.day === wd ? '#fff' : t.text, fontSize: font.sm }}>{WEEKDAYS_SHORT[wd]}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                )}
                {draft?.freq === 'monthly' && (
                  <>
                    <Text style={[styles.lbl, { color: t.textMuted }]}>День месяца</Text>
                    <Field value={String(draft?.day ?? 1)} onChangeText={setDayField} placeholder="1" keyboardType="number-pad" />
                  </>
                )}

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
