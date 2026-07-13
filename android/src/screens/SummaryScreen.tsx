import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, font, radius } from '../theme';
import { summary as summaryApi, budgetPlan, ai, type SummaryData, type BudgetPlan } from '../api/client';
import { Card } from '../components/Card';
import { CATEGORIES } from '../classifier';
import { usePremium } from '../premium';
import { useAuth } from '../hooks/useAuth';

const ICONS: Record<string, string> = {
  Продукты: '🛒', Кафе: '🍽', Транспорт: '🚇', Одежда: '👗', Красота: '💄',
  Медицина: '💊', Развлечения: '🎮', Дети: '👶', Дом: '🏠', Связь: '📱', Прочее: '❓',
};

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function getMonthName(m: number, y: number) {
  const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${names[m - 1]} ${y}`;
}

export default function SummaryScreen() {
  const t = useTheme();
  const premium = usePremium();
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<SummaryData | null>(null);
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [loading, setLoading] = useState(true);

  // Budget plan editing
  const [planVisible, setPlanVisible] = useState(false);
  const [limitDraft, setLimitDraft] = useState<Record<string, string>>({});
  const [incomeDraft, setIncomeDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // AI analysis
  const [aiVisible, setAiVisible] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReport, setAiReport] = useState('');

  const load = useCallback(async (m = month, y = year) => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([summaryApi.get(m, y), budgetPlan.get()]);
      setData(s);
      setPlan(p);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, []);

  const prev = () => {
    const d = new Date(year, month - 2, 1);
    setMonth(d.getMonth() + 1); setYear(d.getFullYear());
    load(d.getMonth() + 1, d.getFullYear());
  };

  const next = () => {
    const cur = new Date(); cur.setDate(1);
    const d = new Date(year, month, 1);
    if (d > cur) return;
    setMonth(d.getMonth() + 1); setYear(d.getFullYear());
    load(d.getMonth() + 1, d.getFullYear());
  };

  const openPlanEditor = () => {
    const budgets = plan?.categoryBudgets ?? {};
    const incomes = plan?.incomes ?? {};
    const ld: Record<string, string> = {};
    for (const c of CATEGORIES) ld[c] = budgets[c] ? String(budgets[c]) : '';
    // Income rows: existing keys + family members from summary + current user
    const names = new Set<string>([
      ...Object.keys(incomes),
      ...Object.keys(data?.byUser ?? {}),
      ...(user?.name ? [user.name] : []),
    ]);
    const idd: Record<string, string> = {};
    for (const n of names) idd[n] = incomes[n] ? String(incomes[n]) : '';
    setLimitDraft(ld);
    setIncomeDraft(idd);
    setPlanVisible(true);
  };

  const savePlan = async () => {
    setSaving(true);
    try {
      const categoryBudgets: Record<string, number> = {};
      for (const [cat, v] of Object.entries(limitDraft)) {
        const n = parseFloat(v.replace(',', '.'));
        if (!isNaN(n) && n > 0) categoryBudgets[cat] = n;
      }
      const incomes: Record<string, number> = {};
      for (const [name, v] of Object.entries(incomeDraft)) {
        const n = parseFloat(v.replace(',', '.'));
        if (!isNaN(n) && n > 0) incomes[name] = n;
      }
      // Preserve any other plan fields the web version may store
      await budgetPlan.save({ ...(plan ?? {}), categoryBudgets, incomes } as BudgetPlan);
      setPlanVisible(false);
      load();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setSaving(false);
    }
  };

  const runAnalysis = async () => {
    setAiVisible(true);
    setAiLoading(true);
    setAiReport('');
    try {
      const res = await ai.analyze(month, year);
      setAiReport(res.report);
    } catch (e) {
      setAiReport(`Не удалось получить анализ: ${String(e)}`);
    } finally {
      setAiLoading(false);
    }
  };

  const cats = data
    ? Object.entries(data.byCategory)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
    : [];

  const maxCat = cats[0]?.[1] ?? 1;
  const budgets = plan?.categoryBudgets ?? {};
  const totalIncome = Object.values(plan?.incomes ?? {}).reduce((s, v) => s + v, 0);

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      {/* Nav */}
      <View style={[styles.nav, { borderBottomColor: t.border }]}>
        <TouchableOpacity onPress={prev} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.navLabel, { color: t.text }]}>{getMonthName(month, year)}</Text>
        <TouchableOpacity onPress={next} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}
        >
          {/* Total card */}
          <Card>
            <Text style={[styles.totalLabel, { color: t.textMuted }]}>Потрачено за месяц</Text>
            <Text style={[styles.totalAmt, { color: t.text }]}>{fmt(data?.total ?? 0)}</Text>
            {totalIncome > 0 && (
              <Text style={{ color: t.textMuted, fontSize: font.sm, marginTop: 4 }}>
                Доход {fmt(totalIncome)} · остаток {fmt(totalIncome - (data?.total ?? 0))}
              </Text>
            )}
          </Card>

          {/* AI analysis (premium) */}
          <TouchableOpacity
            style={[styles.aiBtn, { backgroundColor: premium ? '#a855f7' : t.surface, borderColor: '#a855f7' }]}
            onPress={() => {
              if (!premium) {
                Alert.alert('💎 Премиум', 'ИИ-анализ доступен в Премиуме. Активировать можно в Настройках (бесплатно на время теста).');
                return;
              }
              runAnalysis();
            }}
          >
            <Text style={{ color: premium ? '#fff' : '#a855f7', fontWeight: '700' }}>
              🤖 ИИ-анализ месяца{premium ? '' : ' · 💎'}
            </Text>
          </TouchableOpacity>

          {/* By user */}
          {data && Object.keys(data.byUser).length > 1 && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>По участникам</Text>
              {Object.entries(data.byUser).map(([name, ud]) => (
                <View key={name} style={styles.userRow}>
                  <Text style={{ color: t.text }}>{name}</Text>
                  <Text style={{ color: t.text, fontWeight: '700' }}>{fmt(ud.total)}</Text>
                </View>
              ))}
            </Card>
          )}

          {/* Categories */}
          <Card>
            <View style={styles.catHeader}>
              <Text style={[styles.sectionTitle, { color: t.text, marginBottom: 0 }]}>Категории</Text>
              <TouchableOpacity onPress={openPlanEditor}>
                <Text style={{ color: t.primary, fontSize: font.sm, fontWeight: '600' }}>⚙️ Лимиты</Text>
              </TouchableOpacity>
            </View>
            {cats.length === 0 && (
              <Text style={{ color: t.textMuted, marginTop: spacing.md }}>Нет расходов за месяц</Text>
            )}
            {cats.map(([cat, amt]) => {
              const limit = budgets[cat] ?? 0;
              const over = limit > 0 && amt > limit;
              const pct = amt / maxCat;
              const limitPct = limit > 0 ? Math.min(limit / maxCat, 1) : 0;
              return (
                <View key={cat} style={styles.catRow}>
                  <Text style={{ width: 28, fontSize: 18 }}>{ICONS[cat]}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.barBg}>
                      <View style={[styles.barFill, {
                        width: `${pct * 100}%`,
                        backgroundColor: over ? '#ef4444' : t.primary,
                      }]} />
                      {limit > 0 && (
                        <View style={[styles.limitLine, { left: `${limitPct * 100}%` }]} />
                      )}
                    </View>
                    <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                      {cat}{limit > 0 ? ` · лимит ${fmt(limit)}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.catAmt, { color: over ? '#ef4444' : t.text }]}>{fmt(amt)}</Text>
                </View>
              );
            })}
          </Card>
        </ScrollView>
      )}

      {/* Budget plan editor */}
      <Modal visible={planVisible} animationType="slide">
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setPlanVisible(false)}>
              <Text style={{ color: t.primary }}>Отмена</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>Планирование</Text>
            <TouchableOpacity onPress={savePlan} disabled={saving}>
              <Text style={{ color: t.primary, fontWeight: '700' }}>{saving ? '…' : 'Сохранить'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
            <Text style={[styles.groupTitle, { color: t.textMuted }]}>ДОХОДЫ, ₽/МЕС</Text>
            {Object.keys(incomeDraft).map(name => (
              <View key={name} style={styles.planRow}>
                <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>{name}</Text>
                <TextInput
                  style={[styles.planInput, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
                  value={incomeDraft[name]}
                  onChangeText={v => setIncomeDraft(d => ({ ...d, [name]: v }))}
                  placeholder="0"
                  placeholderTextColor={t.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
            ))}

            <Text style={[styles.groupTitle, { color: t.textMuted, marginTop: spacing.lg }]}>ЛИМИТЫ ПО КАТЕГОРИЯМ, ₽/МЕС</Text>
            {CATEGORIES.map(cat => (
              <View key={cat} style={styles.planRow}>
                <Text style={{ color: t.text, flex: 1 }}>{ICONS[cat]} {cat}</Text>
                <TextInput
                  style={[styles.planInput, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
                  value={limitDraft[cat]}
                  onChangeText={v => setLimitDraft(d => ({ ...d, [cat]: v }))}
                  placeholder="—"
                  placeholderTextColor={t.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* AI report modal */}
      <Modal visible={aiVisible} animationType="slide">
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setAiVisible(false)}>
              <Text style={{ color: t.primary }}>Закрыть</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>🤖 Анализ · {getMonthName(month, year)}</Text>
            <View style={{ width: 56 }} />
          </View>
          {aiLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator size="large" color="#a855f7" />
              <Text style={{ color: t.textMuted, marginTop: spacing.md }}>Анализирую расходы…</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
              <Text style={{ color: t.text, fontSize: font.md, lineHeight: 24 }}>{aiReport}</Text>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  nav:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  navBtn:       { padding: spacing.md },
  navLabel:     { fontSize: font.lg, fontWeight: '600' },
  totalLabel:   { fontSize: font.sm },
  totalAmt:     { fontSize: 36, fontWeight: '800', marginTop: 4 },
  sectionTitle: { fontSize: font.md, fontWeight: '700', marginBottom: spacing.md },
  userRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  catHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  catRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  catAmt:       { fontSize: font.sm, fontWeight: '700', width: 80, textAlign: 'right' },
  barBg:        { height: 10, backgroundColor: '#e2e8f0', borderRadius: 5, overflow: 'visible', position: 'relative' },
  barFill:      { position: 'absolute', top: 0, bottom: 0, borderRadius: 5 },
  limitLine:    { position: 'absolute', top: -2, bottom: -2, width: 2, backgroundColor: '#f59e0b' },
  aiBtn:        { borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginBottom: spacing.md, borderWidth: 1.5 },
  modalHeader:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle:   { fontSize: font.lg, fontWeight: '700' },
  groupTitle:   { fontSize: font.xs, letterSpacing: 0.5, marginBottom: spacing.sm },
  planRow:      { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  planInput:    { width: 120, borderRadius: radius.sm, borderWidth: 1, padding: spacing.sm, fontSize: font.md, textAlign: 'right' },
});
