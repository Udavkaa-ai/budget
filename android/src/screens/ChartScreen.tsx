import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Rect, Polyline, Circle, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import { useTheme, spacing, font, radius } from '../theme';
import {
  summary as summaryApi, cashflow as cfApi,
  type UnifiedChart, type Cashflow, type CashflowMember,
} from '../api/client';
import { Card } from '../components/Card';
import { useAuth } from '../hooks/useAuth';
import { useBlocks } from '../blocks';
import { MonthPickerModal } from '../components/Pickers';

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
  const blocks = useBlocks();
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
  const [monthPicker, setMonthPicker] = useState(false);

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
        <TouchableOpacity onPress={() => setMonthPicker(true)}>
          <Text style={[styles.navLabel, { color: t.text }]}>{getMonthName(month, year)} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => nav(1)} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>›</Text>
        </TouchableOpacity>
      </View>

      <MonthPickerModal
        visible={monthPicker}
        month={month}
        year={year}
        onClose={() => setMonthPicker(false)}
        onPick={(m, y) => { setMonth(m); setYear(y); load(m, y); }}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 24 }}>

          {/* Единый график как в вебе: бары расходов по участникам,
              зелёные бары доходов, фиолетовая линия баланса */}
          {dayCount > 0 && (() => {
            const W = 340, H = 170, PB = 16, PL = 6, PR = 34;
            const plotW = W - PL - PR;
            const n = unified!.labels.length;
            const colW = plotW / n;
            const incomeVals = unified!.labels.map((d, i) => unified!.incomeDays[String(i + 1)] || 0);
            const maxLeft = Math.max(...dayTotals, ...incomeVals, 1);
            const balMinAll = bal ? Math.min(...bal, 0) : 0;
            const balRange = bal ? Math.max(balMax - balMinAll, 1) : 1;
            const balY = (v: number) => (H - PB) - (v - balMinAll) / balRange * (H - PB - 12);
            return (
              <Card>
                <Text style={[styles.sectionTitle, { color: t.text }]}>Расходы, доход и баланс</Text>
                <View style={styles.legend}>
                  {userNames.map((u, i) => (
                    <View key={u} style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: USER_COLORS[i % USER_COLORS.length] }]} />
                      <Text style={{ color: t.textMuted, fontSize: font.xs }}>{u}</Text>
                    </View>
                  ))}
                  <View style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: '#7AE0C3' }]} />
                    <Text style={{ color: t.textMuted, fontSize: font.xs }}>Доход</Text>
                  </View>
                  {bal && (
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: t.primary }]} />
                      <Text style={{ color: t.textMuted, fontSize: font.xs }}>Баланс</Text>
                    </View>
                  )}
                </View>
                <Svg width="100%" height={H + 18} viewBox={`0 0 ${W} ${H + 18}`}>
                  {/* Сетка */}
                  {[0.25, 0.5, 0.75, 1].map(f => (
                    <SvgLine key={f} x1={PL} y1={(H - PB) * (1 - f) + 12 * f} x2={W - PR}
                      y2={(H - PB) * (1 - f) + 12 * f} stroke={t.border} strokeWidth={0.5} />
                  ))}
                  {/* Бары доходов (зелёные, за спиной) */}
                  {incomeVals.map((v, i) => v > 0 && (
                    <Rect key={`inc${i}`} x={PL + i * colW + 0.5} width={Math.max(colW - 1, 1.5)}
                      y={(H - PB) - v / maxLeft * (H - PB - 12)} height={v / maxLeft * (H - PB - 12)}
                      fill="#7AE0C3" opacity={0.75} rx={1.5} />
                  ))}
                  {/* Стек-бары расходов по участникам */}
                  {unified!.labels.map((d, i) => {
                    let yCursor = H - PB;
                    return userNames.map((u, ui) => {
                      const v = unified!.userExpenses[u][i] || 0;
                      if (v === 0) return null;
                      const h = v / maxLeft * (H - PB - 12);
                      yCursor -= h;
                      return (
                        <Rect key={`e${i}_${ui}`} x={PL + i * colW + colW * 0.22} width={Math.max(colW * 0.56, 1.5)}
                          y={yCursor} height={h} fill={USER_COLORS[ui % USER_COLORS.length]} rx={1.5}
                          onPress={() => setSelDay(sd => sd === i ? null : i)} />
                      );
                    });
                  })}
                  {/* Линия баланса */}
                  {bal && (
                    <>
                      <Polyline
                        points={bal.map((v, i) => `${PL + i * colW + colW / 2},${balY(v)}`).join(' ')}
                        fill="none" stroke={t.primary} strokeWidth={2.2} strokeLinejoin="round" />
                      {bal.map((v, i) => (i === 0 || (i + 1) % 5 === 0 || i === bal.length - 1) && (
                        <Circle key={`b${i}`} cx={PL + i * colW + colW / 2} cy={balY(v)} r={3} fill={t.primary} />
                      ))}
                      <SvgText x={W - 2} y={balY(balMax) + 3} fontSize={8.5} fill={t.primary} textAnchor="end">{fmtShort(balMax)}</SvgText>
                      <SvgText x={W - 2} y={balY(balMinAll) + 3} fontSize={8.5} fill={t.primary} textAnchor="end">{fmtShort(balMinAll)}</SvgText>
                    </>
                  )}
                  {/* Ось X */}
                  {unified!.labels.map((d, i) => (i === 0 || (i + 1) % 5 === 0) && (
                    <SvgText key={`x${i}`} x={PL + i * colW + colW / 2} y={H + 12} fontSize={9}
                      fill={t.textMuted} textAnchor="middle">{d}</SvgText>
                  ))}
                  <SvgText x={PL} y={10} fontSize={8.5} fill={t.textMuted}>{fmtShort(maxLeft)}</SvgText>
                </Svg>
                <View style={{ height: 44, justifyContent: 'center', marginTop: spacing.xs }}>
                {selDay !== null ? (
                  <Text numberOfLines={2} style={{ color: t.text, fontSize: font.sm }}>
                    День {selDay + 1}: {userNames
                      .map(u => ({ u, v: unified!.userExpenses[u][selDay] || 0 }))
                      .filter(x => x.v > 0)
                      .map(x => `${x.u} ${fmt(x.v)}`)
                      .join(' · ') || 'нет расходов'}
                    {' · итого '}{fmt(dayTotals[selDay] ?? 0)}
                    {bal ? ` · баланс ${fmt(bal[selDay] ?? 0)}` : ''}
                  </Text>
                ) : (
                  <Text style={{ color: t.textMuted, fontSize: font.xs }}>Нажмите на столбик — детали дня</Text>
                )}
                </View>
                {unified!.hasBalance && (
                  <Text style={{ color: t.textMuted, fontSize: font.xs }}>
                    Старт {fmt(unified!.startBalance)} · доход за месяц {fmt(totalIncome)}
                  </Text>
                )}
              </Card>
            );
          })()}

          {/* Кэшфлоу редактор */}
          <Card>
            <Text style={[styles.sectionTitle, { color: t.text }]}>Кэшфлоу</Text>
            <View style={[styles.cfRow, { marginBottom: 2 }]}>
              <View style={{ flex: 1.1 }} />
              {['ДЕБЕТ', 'КРЕДИТ', 'СБЕРЕЖ.'].map(h => (
                <Text key={h} style={{ flex: 1, color: t.textMuted, fontSize: 9, textAlign: 'center' }}>{h}</Text>
              ))}
            </View>
            {Object.entries(members).map(([name, m]) => (
              <View key={name} style={[styles.cfRow, { marginBottom: spacing.xs }]}>
                <Text style={{ flex: 1.1, color: t.primary, fontWeight: '600', fontSize: font.sm }} numberOfLines={1}>{name}</Text>
                {(['debit', 'credit', 'savings'] as const).map(f => (
                  <TextInput
                    key={f}
                    style={[styles.cfInputSm, { flex: 1, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                    value={m[f] ? String(m[f]) : ''}
                    onChangeText={v => setMemberField(name, f, v)}
                    placeholder="0"
                    placeholderTextColor={t.textMuted}
                    keyboardType="numbers-and-punctuation"
                  />
                ))}
              </View>
            ))}

            <Text style={{ color: t.text, fontSize: font.md, fontWeight: '700', marginTop: spacing.sm }}>
              💵 Поступления по дням
            </Text>
            <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
              Укажите день месяца и сумму зачисления
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
          {blocks.months6 !== false && months6.length > 0 && (
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
                          height: Math.max(pct * 70, 3),
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
  cfInputSm:    { borderRadius: radius.sm, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 6, fontSize: font.sm, textAlign: 'center' },
  saveBtn:      { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  chart6:       { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 110 },
  barCol:       { flex: 1, alignItems: 'center' },
  barWrap:      { flex: 1, justifyContent: 'flex-end', width: '100%' },
});
