import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useTheme, spacing, font, radius } from '../theme';
import { summary as summaryApi, budgetPlan, type SummaryData, type BudgetPlan } from '../api/client';
import { Card } from '../components/Card';

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
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<SummaryData | null>(null);
  const [plan, setPlan] = useState<BudgetPlan | null>(null);
  const [loading, setLoading] = useState(true);

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

  const cats = data
    ? Object.entries(data.byCategory)
        .filter(([, v]) => v > 0)
        .sort(([, a], [, b]) => b - a)
    : [];

  const maxCat = cats[0]?.[1] ?? 1;
  const budgets = plan?.categoryBudgets ?? {};

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
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
          </Card>

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
            <Text style={[styles.sectionTitle, { color: t.text }]}>Категории</Text>
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
  catRow:       { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  catAmt:       { fontSize: font.sm, fontWeight: '700', width: 80, textAlign: 'right' },
  barBg:        { height: 10, backgroundColor: '#e2e8f0', borderRadius: 5, overflow: 'visible', position: 'relative' },
  barFill:      { position: 'absolute', top: 0, bottom: 0, borderRadius: 5 },
  limitLine:    { position: 'absolute', top: -2, bottom: -2, width: 2, backgroundColor: '#f59e0b' },
});
