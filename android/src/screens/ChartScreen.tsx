import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, font, radius } from '../theme';
import {
  summary as summaryApi, cashflow as cfApi,
  type UnifiedChart, type Cashflow, type CashflowMember,
} from '../api/client';
import { Card } from '../components/Card';
import { useAuth } from '../hooks/useAuth';

const USER_COLORS = ['#6c5ce7', '#ec4899', '#f59e0b', '#22c55e'];

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function fmtShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}м`;
  if (a >= 1000) return `${Math.round(n / 1000)}к`;
  return String(Math.round(n));
}

function getMonthName(m: number, y: number) {
  const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${names[m - 1]} ${y}`;
}

async function fetchLast6Months() {
  const now = new Date();
  const results: Array<{ label: string; total: number }> = [];
  const short = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    try {
      const s = await summaryApi.get(m, y);
      results.push({ label: `${short[m - 1]} ${y}`, total: s.total });
    } catch {
      results.push({ label: `${short[m - 1]} ${y}`, total: 0 });
    }
  }
  return results;
}

export default function ChartScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const ym = `${year}-${String(month).padStart(2, '0')}`;

  const [unified, setUnified] = useState<UnifiedChart | null>(null);
  const [months6, setMonths6] = useState<Array<{ label: string; total: number }>>([]);
  const [loading, setLoading] = useState(true);

  // Кэшфлоу-редактор
  const [members, setMembers] = useState<Record<string, CashflowMember>>({});
  const [incomeDays, setIncomeDays] = useState<Array<{ day: string; amount: string }>>([]);
  const [savingCf, setSavingCf] = useState(false);
  const [selDay, setSelDay] = useState<number | null>(null);   // выбранный столбик расходов
  const [selBal, setSelBal] = useState<number | null>(null);   // выбранный столбик баланса

  const load = useCallback(async (m = month, y = year) => {
    setLoading(true);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    try {
      const [u, cf] = await Promise.all([
        cfApi.unified(key).catch(() => null),
        cfApi.get(key).catch(() => ({} as Cashflow)),
      ]);
      setUnified(u);
      const mem: Record<string, CashflowMember> = {};
      for (const [name, v] of Object.entries(cf.members ?? {})) {
        mem[name] = { debit: v.debit || 0, credit: v.credit || 0, savings: v.savings || 0 };
      }
      // Всегда показываем блок для текущего пользователя и участников графика
      const names = new Set<string>([
        ...Object.keys(mem),
        ...Object.keys(u?.userExpenses ?? {}),
        ...(user?.name ? [user.name] : []),
      ]);
      for (const n of names) if (!mem[n]) mem[n] = { debit: 0, credit: 0, savings: 0 };
      setMembers(mem);
      const inc = Array.isArray(cf.incomeDays) ? cf.incomeDays : [];
      setIncomeDays(inc.map(e => ({ day: String(e.day), amount: String(e.amount) })));
    } finally {
      setLoading(false);
    }
  }, [month, year, user?.name]);

  useEffect(() => { load(); }, []);
  useEffect(() => { fetchLast6Months().then(setMonths6); }, []);

  const nav = (dir: -1 | 1) => {
    const d = new Date(year, month - 1 + dir, 1);
    const cur = new Date(); cur.setDate(1); cur.setHours(0, 0, 0, 0);
    if (dir === 1 && d > cur) return;
    setMonth(d.getMonth() + 1); setYear(d.getFullYear());
    load(d.getMonth() + 1, d.getFullYear());
  };

  const saveCf = async () => {
    setSavingCf(true);
    try {
      const body: Cashflow = {
        members,
        incomeDays: incomeDays
          .map(e => ({ day: parseInt(e.day) || 0, amount: parseInt(e.amount) || 0 }))
          .filter(e => e.day >= 1 && e.day <= 31 && e.amount > 0),
      };
      await cfApi.save(ym, body);
      Alert.alert('Кэшфлоу сохранён');
      load();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setSavingCf(false);
    }
  };

  const setMemberField = (name: string, field: keyof CashflowMember, v: string) => {
    const n = parseInt(v.replace(/[^-\d]/g, '')) || 0;
    setMembers(m => ({ ...m, [name]: { ...m[name], [field]: n } }));
  };

  const userNames = Object.keys(unified?.userExpenses ?? {});
  const dayCount = unified?.labels.length ?? 0;
  const dayTotals = unified
    ? unified.labels.map((_, i) => userNames.reduce((s, u) => s + (unified.userExpenses[u][i] || 0), 0))
    : [];
  const maxDay = Math.max(...dayTotals, 1);
  const bal = unified?.balanceLine ?? null;
  const balMin = bal ? Math.min(...bal) : 0;
  const balMax = bal ? Math.max(...bal) : 0;
  const totalIncome = Object.values(unified?.incomeDays ?? {}).reduce((s, v) => s + v, 0);

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.primary }]}>График</Text>
      </View>

      {/* Month nav */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => nav(-1)} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.navLabel, { color: t.text }]}>{getMonthName(month, year)}</Text>
        <TouchableOpacity onPress={() => nav(1)} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 24 }}>

          {/* Дневные расходы по участникам */}
          {dayCount > 0 && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Расходы по дням</Text>
              <View style={styles.legend}>
                {userNames.map((u, i) => (
                  <View key={u} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: USER_COLORS[i % USER_COLORS.length] }]} />
                    <Text style={{ color: t.textMuted, fontSize: font.xs }}>{u}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.dayChart}>
                {unified!.labels.map((d, i) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dayCol, selDay === i && { backgroundColor: t.surface2, borderRadius: 4 }]}
                    onPress={() => setSelDay(s => s === i ? null : i)}
                  >
                    <View style={styles.dayBarWrap}>
                      {userNames.map((u, ui) => {
                        const v = unified!.userExpenses[u][i] || 0;
                        if (v === 0) return null;
                        return (
                          <View key={u} style={{
                            width: '100%',
                            height: Math.max(v / maxDay * 120, 2),
                            backgroundColor: USER_COLORS[ui % USER_COLORS.length],
                          }} />
                        );
                      })}
                    </View>
                    {(i === 0 || (i + 1) % 5 === 0) && (
                      <Text style={{ fontSize: 8, color: t.textMuted }}>{d}</Text>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              {selDay !== null && (
                <Text style={{ color: t.text, fontSize: font.sm, marginTop: spacing.sm }}>
                  День {selDay + 1}: {userNames
                    .map(u => ({ u, v: unified!.userExpenses[u][selDay] || 0 }))
                    .filter(x => x.v > 0)
                    .map(x => `${x.u} ${fmt(x.v)}`)
                    .join(' · ') || 'нет расходов'}
                  {' · итого '}{fmt(dayTotals[selDay] ?? 0)}
                </Text>
              )}
            </Card>
          )}

          {/* Баланс */}
          {bal && bal.length > 0 && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Баланс семьи</Text>
              <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
                Старт {fmt(unified!.startBalance)} · доход за месяц {fmt(totalIncome)}
              </Text>
              <View style={styles.dayChart}>
                {bal.map((v, i) => {
                  const range = Math.max(balMax - Math.min(balMin, 0), 1);
                  const h = Math.max((v - Math.min(balMin, 0)) / range * 100, 2);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayCol, selBal === i && { backgroundColor: t.surface2, borderRadius: 4 }]}
                      onPress={() => setSelBal(s => s === i ? null : i)}
                    >
                      <View style={[styles.balBar, {
                        height: h,
                        backgroundColor: v >= 0 ? '#22c55e' : '#ef4444',
                      }]} />
                      {(i === 0 || (i + 1) % 5 === 0) && (
                        <Text style={{ fontSize: 8, color: t.textMuted }}>{i + 1}</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {selBal !== null && (
                <Text style={{ color: t.text, fontSize: font.sm, marginTop: spacing.sm }}>
                  День {selBal + 1}: баланс {fmt(bal[selBal])}
                </Text>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                <Text style={{ color: t.textMuted, fontSize: font.xs }}>мин {fmtShort(balMin)}</Text>
                <Text style={{ color: t.textMuted, fontSize: font.xs }}>сейчас {fmtShort(bal[bal.length - 1])}</Text>
                <Text style={{ color: t.textMuted, fontSize: font.xs }}>макс {fmtShort(balMax)}</Text>
              </View>
            </Card>
          )}

          {/* Кэшфлоу редактор */}
          <Card>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Кэшфлоу</Text>
            {Object.entries(members).map(([name, m]) => (
              <View key={name} style={{ marginBottom: spacing.md }}>
                <Text style={{ color: t.primary, fontWeight: '700', marginBottom: spacing.xs }}>{name}</Text>
                <View style={styles.cfRow}>
                  {(['debit', 'credit', 'savings'] as const).map(f => (
                    <View key={f} style={{ flex: 1 }}>
                      <Text style={{ color: t.textMuted, fontSize: 9, textAlign: 'center' }}>
                        {f === 'debit' ? 'ДЕБЕТОВАЯ' : f === 'credit' ? 'КРЕДИТНАЯ' : 'СБЕРЕЖЕНИЯ'}
                      </Text>
                      <TextInput
                        style={[styles.cfInput, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                        value={m[f] ? String(m[f]) : ''}
                        onChangeText={v => setMemberField(name, f, v)}
                        placeholder="0"
                        placeholderTextColor={t.textMuted}
                        keyboardType="numbers-and-punctuation"
                      />
                    </View>
                  ))}
                </View>
              </View>
            ))}

            <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.xs }}>
              ПОСТУПЛЕНИЯ ПО ДНЯМ (день месяца → сумма)
            </Text>
            {incomeDays.map((e, i) => (
              <View key={i} style={[styles.cfRow, { marginBottom: spacing.xs }]}>
                <TextInput
                  style={[styles.cfInput, { flex: 1, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                  value={e.day}
                  onChangeText={v => setIncomeDays(d => d.map((x, xi) => xi === i ? { ...x, day: v } : x))}
                  placeholder="День"
                  placeholderTextColor={t.textMuted}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={[styles.cfInput, { flex: 2, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                  value={e.amount}
                  onChangeText={v => setIncomeDays(d => d.map((x, xi) => xi === i ? { ...x, amount: v } : x))}
                  placeholder="Сумма"
                  placeholderTextColor={t.textMuted}
                  keyboardType="number-pad"
                />
                <TouchableOpacity onPress={() => setIncomeDays(d => d.filter((_, xi) => xi !== i))} style={{ padding: spacing.sm }}>
                  <Text style={{ color: t.danger, fontSize: font.lg }}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity onPress={() => setIncomeDays(d => [...d, { day: '', amount: '' }])}>
              <Text style={{ color: t.primary, marginBottom: spacing.md }}>+ Добавить поступление</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: t.primary, opacity: savingCf ? 0.6 : 1 }]}
              onPress={saveCf}
              disabled={savingCf}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Сохранить кэшфлоу</Text>
            </TouchableOpacity>
          </Card>

          {/* 6 месяцев */}
          {months6.length > 0 && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Расходы за 6 месяцев</Text>
              <View style={styles.chart6}>
                {months6.map(({ label, total }) => {
                  const mx = Math.max(...months6.map(x => x.total), 1);
                  const pct = total / mx;
                  return (
                    <TouchableOpacity key={label} style={styles.barCol} onPress={() => Alert.alert(label, fmt(total))}>
                      <Text style={{ fontSize: 9, color: t.textMuted, marginBottom: 2 }}>
                        {total > 0 ? fmtShort(total) : ''}
                      </Text>
                      <View style={styles.barWrap}>
                        <View style={{
                          width: '100%',
                          height: Math.max(pct * 140, 4),
                          borderRadius: 4,
                          backgroundColor: t.primary,
                          opacity: pct > 0 ? 1 : 0.2,
                        }} />
                      </View>
                      <Text style={{ fontSize: 9, color: t.textMuted, marginTop: 4 }} numberOfLines={1}>
                        {label.split(' ')[0]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title:        { fontSize: font.xxl, fontWeight: '800' },
  nav:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  navBtn:       { padding: spacing.md },
  navLabel:     { fontSize: font.lg, fontWeight: '600' },
  sectionTitle: { fontSize: font.md, fontWeight: '700', marginBottom: spacing.md },
  legend:       { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:    { width: 10, height: 10, borderRadius: 5 },
  dayChart:     { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 1 },
  dayCol:       { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  dayBarWrap:   { width: '100%', justifyContent: 'flex-end' },
  balBar:       { width: '100%', borderRadius: 2, minHeight: 2 },
  cfRow:        { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  cfInput:      { borderRadius: radius.sm, borderWidth: 1, padding: spacing.sm, fontSize: font.sm, textAlign: 'center' },
  saveBtn:      { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  chart6:       { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 190 },
  barCol:       { flex: 1, alignItems: 'center' },
  barWrap:      { flex: 1, justifyContent: 'flex-end', width: '100%' },
});
