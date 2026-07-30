import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { goals as goalsApi, budgetPlan, expenses as expApi, settings as settingsApi, type Goal, type BudgetPlan, type Expense } from '../api/client';
import { useCategories } from '../categories';
import { PrimaryButton } from '../components/UI';
import { Card } from '../components/Card';
import { FadeInItem } from '../components/Motion';
import { ScreenGradient } from '../components/ScreenGradient';
import { SuccessFlash } from '../components/SuccessFlash';
import { haptics } from '../haptics';
import { useTourTarget } from '../tourTargets';
import { ACHIEVEMENTS, useAchievements, evaluateFromData } from '../achievements';
import { Finik } from '../components/Finik';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export default function GoalsScreen() {
  const t = useTheme();
  const { cats: allCats, icon: catIcon, custom } = useCategories();
  const { unlocked, count, total } = useAchievements();
  const [list, setList] = useState<Goal[]>([]);
  // Лимиты по категориям (как в вебе на вкладке Цели)
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});
  const [savingLimits, setSavingLimits] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [contribGoal, setContribGoal] = useState<Goal | null>(null);
  const [flash, setFlash] = useState(0);
  const goalsAddTarget = useTourTarget('goals.add');

  // Add form
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [emoji, setEmoji] = useState('🎯');

  // Contribution
  const [contribAmt, setContribAmt] = useState('');

  const load = async () => {
    try {
      const g = await goalsApi.list();
      setList(g);
      const p = await budgetPlan.get().catch(() => null);
      if (p) {
        setPlan(p);
        const ld: Record<string, string> = {};
        const budgets = p.categoryBudgets ?? {};
        for (const [c, v] of Object.entries(budgets)) ld[c] = v ? String(v) : '';
        setLimitDraft(ld);
      }
      evaluateAchievements(g).catch(() => {});
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  // Собираем данные за последние 3 месяца и проверяем достижения
  const evaluateAchievements = async (goalsList: Goal[]) => {
    const now = new Date();
    const months = [0, 1, 2].map(off => {
      const d = new Date(now.getFullYear(), now.getMonth() - off, 1);
      return { m: d.getMonth() + 1, y: d.getFullYear() };
    });
    const chunks = await Promise.all(
      months.map(({ m, y }) => expApi.forMonth(m, y).catch(() => [] as Expense[])),
    );
    const expenses = chunks.flat().filter(Boolean);
    const st = await settingsApi.get().catch(() => ({} as { plannedMonthly?: number }));
    const users = [...new Set(expenses.map(e => e.user).filter(Boolean))];
    evaluateFromData({
      expenses,
      plannedMonthly: st.plannedMonthly ?? 0,
      customCatCount: custom.length,
      goals: goalsList.map(g => ({ saved: g.saved, target: g.target })),
      users,
    });
  };

  const saveLimits = async () => {
    setSavingLimits(true);
    try {
      const categoryBudgets: Record<string, number> = {};
      for (const [cat, v] of Object.entries(limitDraft)) {
        const n = parseFloat((v || '').replace(',', '.'));
        if (!isNaN(n) && n > 0) categoryBudgets[cat] = n;
      }
      await budgetPlan.save({ ...(plan ?? {}), categoryBudgets } as BudgetPlan);
      Alert.alert('Лимиты сохранены');
      load();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setSavingLimits(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addGoal = async () => {
    if (!name.trim() || !target.trim()) return;
    const t2 = parseFloat(target.replace(',', '.'));
    if (isNaN(t2) || t2 <= 0) { Alert.alert('Некорректная сумма'); return; }
    try {
      await goalsApi.add({ name: name.trim(), target: t2, emoji });
      haptics.success();
      setAddVisible(false); setName(''); setTarget(''); setEmoji('🎯');
      setFlash(n => n + 1);
      load();
    } catch (e) { Alert.alert('Ошибка', String(e)); }
  };

  const contribute = async () => {
    if (!contribGoal) return;
    const amt = parseFloat(contribAmt.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) return;
    try {
      await goalsApi.contribute(contribGoal.id, amt);
      haptics.success();
      setContribGoal(null); setContribAmt('');
      setFlash(n => n + 1);
      load();
    } catch (e) { Alert.alert('Ошибка', String(e)); }
  };

  const deleteGoal = (id: string) => {
    Alert.alert('Удалить цель?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => { await goalsApi.delete(id); haptics.warning(); load(); } },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <ScreenGradient tint="goals" />
      <SuccessFlash token={flash} label="Готово" />
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.primary }]}>Цели</Text>
        <TouchableOpacity
          ref={goalsAddTarget}
          style={[styles.addBtn, { backgroundColor: t.primary }]}
          onPress={() => setAddVisible(true)}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>+ Новая</Text>
        </TouchableOpacity>
      </View>

      {loading
        ? <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
        : (
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            {/* Лимиты по категориям — как в вебе */}
            <FadeInItem index={0}>
            <Card>
              <Text style={{ fontSize: font.sm, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textMuted }}>
                Лимиты по категориям
              </Text>
              {allCats.map(cat => (
                <View key={cat} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs }}>
                  <Text style={{ color: t.text, flex: 1, fontSize: font.sm }} numberOfLines={1}>{catIcon(cat)} {cat}</Text>
                  <TextInput
                    style={{
                      width: 110, borderRadius: radius.sm, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 10,
                      fontSize: font.sm, textAlign: 'right',
                      color: t.text, borderColor: t.border, backgroundColor: t.surface2,
                    }}
                    value={limitDraft[cat] ?? ''}
                    onChangeText={v => setLimitDraft(d => ({ ...d, [cat]: v }))}
                    placeholder="—"
                    placeholderTextColor={t.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              ))}
              {(() => {
                const totalIncome = Object.values(plan?.incomes ?? {}).reduce((s2, v) => s2 + v, 0);
                const totalLimits = Object.values(limitDraft).reduce((s2, v) => {
                  const n = parseFloat((v || '').replace(',', '.'));
                  return s2 + (isNaN(n) ? 0 : n);
                }, 0);
                return totalIncome > 0 ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: spacing.sm }}>
                    <Text style={{ color: t.text }}>🏦 Сбережения</Text>
                    <Text style={{ color: t.success, fontWeight: '700' }}>{fmt(Math.max(totalIncome - totalLimits, 0))}</Text>
                  </View>
                ) : null;
              })()}
              <PrimaryButton title="Сохранить" onPress={saveLimits} loading={savingLimits} style={{ marginTop: spacing.sm }} />
            </Card>
            </FadeInItem>

            {list.length === 0 && (
              <Text style={[styles.empty, { color: t.textMuted }]}>Нет целей. Добавьте первую!</Text>
            )}
            {list.map((g, i) => {
              const pct = Math.min(g.saved / g.target, 1);
              return (
                <FadeInItem key={g.id} index={i + 1}>
                <Card>
                  <View style={styles.goalHeader}>
                    <Text style={{ fontSize: 28 }}>{g.emoji}</Text>
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[styles.goalName, { color: t.text }]}>{g.name}</Text>
                      <Text style={{ color: t.textMuted, fontSize: font.sm }}>
                        {fmt(g.saved)} / {fmt(g.target)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteGoal(g.id)} hitSlop={8} accessibilityLabel="Удалить цель" accessibilityRole="button">
                      <Text style={{ color: t.textMuted, fontSize: 18 }}>×</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Progress bar */}
                  <View style={[styles.progBg, { backgroundColor: t.surface2 }]}>
                    <View style={[styles.progFill, { width: `${pct * 100}%`, backgroundColor: pct >= 1 ? '#22c55e' : t.primary }]} />
                  </View>
                  <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 4 }}>
                    {Math.round(pct * 100)}% · осталось {fmt(Math.max(g.target - g.saved, 0))}
                  </Text>

                  <TouchableOpacity
                    style={[styles.contribBtn, { backgroundColor: t.surface2 }]}
                    onPress={() => { setContribGoal(g); setContribAmt(''); }}
                  >
                    <Text style={{ color: t.primary, fontWeight: '600' }}>+ Пополнить</Text>
                  </TouchableOpacity>
                </Card>
                </FadeInItem>
              );
            })}

            {/* Мои достижения */}
            <FadeInItem index={list.length + 1}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm }}>
                <Finik emotion={count > 0 ? 'goal' : 'idle'} size={46} />
                <Text style={{ flex: 1, fontSize: font.sm, textTransform: 'uppercase', letterSpacing: 0.5, color: t.textMuted }}>
                  🏅 Мои достижения
                </Text>
                <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm }}>{count} / {total}</Text>
              </View>
              {ACHIEVEMENTS.map(a => {
                const got = !!unlocked[a.id];
                const hidden = a.secret && !got;
                return (
                  <View key={a.id} style={[styles.achRow, { borderColor: t.border }]}>
                    <Text style={{ fontSize: 26, opacity: got ? 1 : 0.35, width: 36, textAlign: 'center' }}>
                      {hidden ? '❓' : a.emoji}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: got ? t.text : t.textMuted, fontWeight: got ? '700' : '600', fontSize: font.md }}>
                        {hidden ? 'Секретное достижение' : a.title}
                      </Text>
                      <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 1 }}>
                        {hidden ? 'Условие откроется, когда вы его выполните' : a.desc}
                      </Text>
                    </View>
                    {got
                      ? <Ionicons name="checkmark-circle" size={22} color={t.success} />
                      : <Ionicons name="lock-closed" size={16} color={t.textMuted} />}
                  </View>
                );
              })}
            </Card>
            </FadeInItem>
          </ScrollView>
        )}

      {/* Add goal modal */}
      <Modal visible={addVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAddVisible(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: t.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setAddVisible(false)}>
              <Text style={{ color: t.primary }}>Отмена</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>Новая цель</Text>
            <TouchableOpacity onPress={addGoal}>
              <Text style={{ color: t.primary, fontWeight: '700' }}>Добавить</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: spacing.lg }}>
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={emoji} onChangeText={setEmoji} placeholder="Эмодзи" />
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={name} onChangeText={setName} placeholder="Название цели" />
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={target} onChangeText={setTarget} placeholder="Целевая сумма, ₽" keyboardType="decimal-pad" />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Contribute modal */}
      <Modal visible={!!contribGoal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setContribGoal(null)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: t.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setContribGoal(null)}>
              <Text style={{ color: t.primary }}>Отмена</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>Пополнить {contribGoal?.emoji}</Text>
            <TouchableOpacity onPress={contribute}>
              <Text style={{ color: t.primary, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: spacing.lg }}>
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={contribAmt} onChangeText={setContribAmt} placeholder="Сумма, ₽" keyboardType="decimal-pad" autoFocus />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  title:       { fontSize: font.xxl, fontWeight: '800' },
  addBtn:      { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  empty:       { textAlign: 'center', marginTop: 60, fontSize: font.md },
  goalHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  goalName:    { fontSize: font.lg, fontWeight: '700' },
  progBg:      { height: 10, borderRadius: 5, overflow: 'hidden' },
  progFill:    { height: '100%', borderRadius: 5 },
  contribBtn:  { marginTop: spacing.md, borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center' },
  achRow:      { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  modal:       { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle:  { fontSize: font.lg, fontWeight: '700' },
  input:       { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
});
