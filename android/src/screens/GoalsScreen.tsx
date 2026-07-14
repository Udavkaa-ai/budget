import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, font, radius } from '../theme';
import { goals as goalsApi, budgetPlan, type Goal, type BudgetPlan } from '../api/client';
import { useCategories } from '../categories';
import { PrimaryButton } from '../components/UI';
import { Card } from '../components/Card';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export default function GoalsScreen() {
  const t = useTheme();
  const { cats: allCats, icon: catIcon } = useCategories();
  const [list, setList] = useState<Goal[]>([]);
  // Лимиты по категориям (как в вебе на вкладке Цели)
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});
  const [savingLimits, setSavingLimits] = useState(false);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [contribGoal, setContribGoal] = useState<Goal | null>(null);

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
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
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
      setAddVisible(false); setName(''); setTarget(''); setEmoji('🎯');
      load();
    } catch (e) { Alert.alert('Ошибка', String(e)); }
  };

  const contribute = async () => {
    if (!contribGoal) return;
    const amt = parseFloat(contribAmt.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) return;
    try {
      await goalsApi.contribute(contribGoal.id, amt);
      setContribGoal(null); setContribAmt('');
      load();
    } catch (e) { Alert.alert('Ошибка', String(e)); }
  };

  const deleteGoal = (id: string) => {
    Alert.alert('Удалить цель?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => { await goalsApi.delete(id); load(); } },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.primary }]}>Цели</Text>
        <TouchableOpacity
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

            {list.length === 0 && (
              <Text style={[styles.empty, { color: t.textMuted }]}>Нет целей. Добавьте первую!</Text>
            )}
            {list.map(g => {
              const pct = Math.min(g.saved / g.target, 1);
              return (
                <Card key={g.id}>
                  <View style={styles.goalHeader}>
                    <Text style={{ fontSize: 28 }}>{g.emoji}</Text>
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[styles.goalName, { color: t.text }]}>{g.name}</Text>
                      <Text style={{ color: t.textMuted, fontSize: font.sm }}>
                        {fmt(g.saved)} / {fmt(g.target)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteGoal(g.id)}>
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
              );
            })}
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
  modal:       { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle:  { fontSize: font.lg, fontWeight: '700' },
  input:       { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
});
