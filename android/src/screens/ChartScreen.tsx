import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  SafeAreaView, ActivityIndicator,
} from 'react-native';
import { useTheme, spacing, font, radius } from '../theme';
import { summary as summaryApi, type SummaryData } from '../api/client';
import { Card } from '../components/Card';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function getMonthName(m: number, y: number) {
  const names = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  return `${names[m - 1]} ${y}`;
}

// Fetch last N months of summary data for a simple bar chart
async function fetchLast6Months() {
  const now = new Date();
  const results: Array<{ label: string; total: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    try {
      const s = await summaryApi.get(m, y);
      results.push({ label: getMonthName(m, y), total: s.total });
    } catch {
      results.push({ label: getMonthName(m, y), total: 0 });
    }
  }
  return results;
}

export default function ChartScreen() {
  const t = useTheme();
  const [data, setData] = useState<Array<{ label: string; total: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLast6Months().then(d => { setData(d); setLoading(false); });
  }, []);

  const maxVal = Math.max(...data.map(d => d.total), 1);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.text }]}>График расходов</Text>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md }}>
          <Card>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Расходы за 6 месяцев</Text>
            <View style={styles.chart}>
              {data.map(({ label, total }) => {
                const pct = total / maxVal;
                return (
                  <View key={label} style={styles.barCol}>
                    <Text style={[styles.barAmt, { color: t.textMuted }]}>
                      {total > 0 ? (total >= 1000 ? `${Math.round(total/1000)}к` : String(Math.round(total))) : ''}
                    </Text>
                    <View style={styles.barWrap}>
                      <View style={[styles.bar, {
                        height: Math.max(pct * 140, 4),
                        backgroundColor: t.primary,
                        opacity: pct > 0 ? 1 : 0.2,
                      }]} />
                    </View>
                    <Text style={[styles.barLabel, { color: t.textMuted }]} numberOfLines={1}>
                      {label.split(' ')[0]}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Card>

          {/* Month-over-month delta */}
          {data.length >= 2 && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Изменение к прошлому месяцу</Text>
              {data.slice(1).map(({ label, total }, i) => {
                const prev = data[i].total;
                const delta = prev > 0 ? Math.round((total - prev) / prev * 100) : null;
                return (
                  <View key={label} style={styles.deltaRow}>
                    <Text style={{ color: t.text }}>{label}</Text>
                    <Text style={{ color: t.text, fontWeight: '700' }}>{fmt(total)}</Text>
                    {delta !== null && (
                      <Text style={{ color: delta > 0 ? '#ef4444' : '#22c55e', width: 56, textAlign: 'right' }}>
                        {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}%
                      </Text>
                    )}
                  </View>
                );
              })}
            </Card>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  title:        { fontSize: font.xl, fontWeight: '700' },
  sectionTitle: { fontSize: font.md, fontWeight: '700', marginBottom: spacing.lg },
  chart:        { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 200 },
  barCol:       { flex: 1, alignItems: 'center' },
  barWrap:      { flex: 1, justifyContent: 'flex-end', width: '100%' },
  bar:          { width: '100%', borderRadius: 4, minHeight: 4 },
  barAmt:       { fontSize: 9, marginBottom: 2 },
  barLabel:     { fontSize: 9, marginTop: 4, width: '100%', textAlign: 'center' },
  deltaRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
});
