import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line as SvgLine, Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { summary as summaryApi, budgetPlan, ai, expenses as expApi, settings as settingsApi, type SummaryData, type BudgetPlan, type Expense } from '../api/client';
import { Card } from '../components/Card';
import { useCategories } from '../categories';
import { MonthPickerModal } from '../components/Pickers';
import { usePremium } from '../premium';
import { useBlocks } from '../blocks';
import { useAuth } from '../hooks/useAuth';
import { ScreenGradient } from '../components/ScreenGradient';
import { BudgetGauge } from '../components/BudgetGauge';
import { haptics } from '../haptics';
import { useTourTarget, registerScroller, unregisterScroller, setTargetOffset } from '../tourTargets';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function getMonthName(m: number, y: number) {
  const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${names[m - 1]} ${y}`;
}

// Шрифт Onest не содержит стрелочных глифов (→ ↑ ↓ ←) — они рендерятся мусором
// («'n», «ij»). Заменяем на глифы, которые в шрифте есть.
function sanitizeArrows(s: string): string {
  return (s || '')
    .replace(/[→⟶➜➡⇒⟹➔➙🡒]/g, '›')
    .replace(/[↑↗⬆🡑]/g, '▲')
    .replace(/[↓↘⬇🡓]/g, '▼')
    .replace(/[←⟵⬅🡐]/g, '‹');
}

// Простой markdown: ## заголовки, * пункты, **жирный**
function MdText({ text, color, accent }: { text: string; color: string; accent: string }) {
  const safe = sanitizeArrows(text);
  const renderInline = (line: string, base: object) => {
    const parts = line.split('**');
    return (
      <Text style={base}>
        {parts.map((p, i) => i % 2 === 1
          ? <Text key={i} style={{ fontWeight: '800' }}>{p}</Text>
          : p)}
      </Text>
    );
  };
  return (
    <>
      {safe.split('\n').map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <View key={i} style={{ height: 8 }} />;
        if (line.startsWith('## ')) {
          return <Text key={i} style={{ color: accent, fontSize: font.lg, fontWeight: '800', marginTop: 10, marginBottom: 4 }}>{line.slice(3)}</Text>;
        }
        if (line.startsWith('# ')) {
          return <Text key={i} style={{ color: accent, fontSize: font.xl, fontWeight: '800', marginTop: 10, marginBottom: 4 }}>{line.slice(2)}</Text>;
        }
        if (/^\s*[*•-]\s+/.test(line)) {
          const item = line.replace(/^\s*[*•-]\s+/, '');
          return (
            <View key={i} style={{ flexDirection: 'row', marginBottom: 2 }}>
              <Text style={{ color: accent, marginRight: 6 }}>•</Text>
              <View style={{ flex: 1 }}>{renderInline(item, { color, fontSize: font.md, lineHeight: 22 })}</View>
            </View>
          );
        }
        return <View key={i}>{renderInline(line, { color, fontSize: font.md, lineHeight: 24 })}</View>;
      })}
    </>
  );
}

export default function SummaryScreen() {
  const t = useTheme();
  const premium = usePremium();
  const blocks = useBlocks();
  const { cats: allCats, icon: catIcon2 } = useCategories();
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

  // Сравнение с прошлым месяцем
  const [compare, setCompare] = useState(false);
  const [prevExp, setPrevExp] = useState<Expense[]>([]);
  // Режим сравнения: 'date' — до того же числа, 'full' — весь прошлый месяц
  const [cmpMode, setCmpMode] = useState<'date' | 'full'>('date');

  // Фильтр категорий по участнику
  const [selUser, setSelUser] = useState<string | null>(null);
  // Фильтр тепловой карты по участнику
  const [heatUser, setHeatUser] = useState<string | null>(null);
  const gaugeTarget = useTourTarget('summary.gauge');
  const totalTarget = useTourTarget('summary.total');
  const scrollRef = React.useRef<ScrollView>(null);
  useEffect(() => {
    registerScroller('summary', (y) => scrollRef.current?.scrollTo({ y, animated: true }));
    return () => unregisterScroller('summary');
  }, []);
  const tOffset = (id: string) => (e: any) => setTargetOffset(id, e.nativeEvent.layout.y);
  const [monthPicker, setMonthPicker] = useState(false);

  // Heatmap + drill-down + planned budget
  const [monthExp, setMonthExp] = useState<Expense[]>([]);
  const [plannedMonthly, setPlannedMonthly] = useState(0);
  const [drillCat, setDrillCat] = useState<string | null>(null);
  const [drillList, setDrillList] = useState<Expense[]>([]);
  const [drillUser, setDrillUser] = useState<string | null>(null);
  const [drillDay, setDrillDay] = useState<number | null>(null);

  const load = useCallback(async (m = month, y = year) => {
    setLoading(true);
    try {
      const [s, p, me, st] = await Promise.all([
        summaryApi.get(m, y),
        budgetPlan.get(),
        expApi.forMonth(m, y).catch(() => [] as Expense[]),
        settingsApi.get().catch(() => ({} as { plannedMonthly?: number })),
      ]);
      setData(s);
      setPlan(p);
      setMonthExp(Array.isArray(me) ? me : []);
      setPlannedMonthly(st.plannedMonthly ?? 0);
      // Прошлый месяц для сравнения — берём расходы по дням, чтобы можно было
      // сравнивать как с полным месяцем, так и до того же числа
      const pd = new Date(y, m - 2, 1);
      expApi.forMonth(pd.getMonth() + 1, pd.getFullYear())
        .then(r => setPrevExp(Array.isArray(r) ? r : []))
        .catch(() => setPrevExp([]));
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [month, year]);

  const openDrill = async (cat: string) => {
    setDrillCat(cat);
    setDrillUser(null);
    setDrillList([]);
    try {
      const list = await expApi.byCategory(cat, month, year);
      setDrillList(Array.isArray(list) ? list : []);
    } catch { /* ignore */ }
  };

  useEffect(() => { load(); }, []);

  const prev = () => {
    const d = new Date(year, month - 2, 1);
    haptics.light();
    setMonth(d.getMonth() + 1); setYear(d.getFullYear());
    load(d.getMonth() + 1, d.getFullYear());
  };

  const next = () => {
    const cur = new Date(); cur.setDate(1);
    const d = new Date(year, month, 1);
    if (d > cur) return;
    haptics.light();
    setMonth(d.getMonth() + 1); setYear(d.getFullYear());
    load(d.getMonth() + 1, d.getFullYear());
  };

  const openPlanEditor = () => {
    const budgets = plan?.categoryBudgets ?? {};
    const incomes = plan?.incomes ?? {};
    const ld: Record<string, string> = {};
    for (const c of allCats) ld[c] = budgets[c] ? String(budgets[c]) : '';
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

  const catSource = selUser && data?.byUser[selUser]
    ? data.byUser[selUser].byCategory
    : data?.byCategory ?? {};
  const cats = Object.entries(catSource)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const maxCat = cats[0]?.[1] ?? 1;
  const memberNames = Object.keys(data?.byUser ?? {});
  const budgets = plan?.categoryBudgets ?? {};
  const incomes = plan?.incomes ?? {};
  const totalIncome = Object.values(incomes).reduce((s, v) => s + v, 0);

  // Барометр бюджета: факт против плана, пропорционально прошедшим дням
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
  const daysPassed = isCurrentMonth ? now.getDate() : daysInMonth;
  const planToDate = plannedMonthly > 0 ? plannedMonthly * daysPassed / daysInMonth : 0;
  const gaugePct = planToDate > 0 ? Math.round((data?.total ?? 0) / planToDate * 100) : null;

  // Агрегат прошлого месяца для сравнения: до того же числа ('date') или весь ('full')
  const prevCutoff = cmpMode === 'full' ? 31 : daysPassed;
  const prevAgg = { total: 0, byCategory: {} as Record<string, number> };
  for (const e of prevExp) {
    const d = parseInt(e.date?.split('.')[0] ?? '');
    if (!isNaN(d) && d <= prevCutoff) {
      prevAgg.total += e.amount;
      prevAgg.byCategory[e.category] = (prevAgg.byCategory[e.category] ?? 0) + e.amount;
    }
  }
  const hasPrev = prevExp.length > 0;

  // Heatmap: суммы по дням месяца (с учётом фильтра по участнику)
  const dayTotals: Record<number, number> = {};
  for (const e of monthExp) {
    if (heatUser && e.user !== heatUser) continue;
    const d = parseInt(e.date?.split('.')[0] ?? '');
    if (!isNaN(d)) dayTotals[d] = (dayTotals[d] ?? 0) + e.amount;
  }
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Пн=0
  // При фильтре по участнику пороги цветов — его доля: 1/число участников семьи
  const memberCount = Math.max(memberNames.length, Object.keys(incomes).length, 1);
  const heatScale = heatUser ? 1 / memberCount : 1;
  const heatColor = (v: number) =>
    v === 0 ? t.surface2
    : v < 2000 * heatScale ? '#bbf7d0'
    : v < 5000 * heatScale ? '#22c55e'
    : v < 10000 * heatScale ? '#f59e0b'
    : v < 20000 * heatScale ? '#f97316'
    : '#ef4444';
  const heatText = (v: number) => (v === 0 ? t.textMuted : '#1e293b');
  const dailyPlanShare = plannedMonthly > 0 ? Math.round(plannedMonthly / daysInMonth * heatScale) : 0;

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <ScreenGradient tint="summary" />
      {/* Nav */}
      <View style={[styles.nav, { borderBottomColor: t.border }]}>
        <TouchableOpacity onPress={prev} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMonthPicker(true)}>
          <Text style={[styles.navLabel, { color: t.text }]}>{getMonthName(month, year)} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={next} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>›</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load()} />}
        >
          {/* Сравнить */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md }}>
            <TouchableOpacity
              style={[styles.compareChip, { backgroundColor: compare ? t.primary : t.surface, marginBottom: 0 }]}
              onPress={() => { haptics.select(); setCompare(c => !c); }}
            >
              <Text style={{ color: compare ? '#fff' : t.primary, fontSize: font.sm, fontWeight: '600' }}>
                ⚖️ Сравнить с прошлым месяцем
              </Text>
            </TouchableOpacity>
            {compare && isCurrentMonth && (
              <>
                <TouchableOpacity
                  style={[styles.cmpModeChip, { backgroundColor: cmpMode === 'date' ? t.surface2 : t.surface, borderColor: cmpMode === 'date' ? t.primary : t.border }]}
                  onPress={() => { haptics.select(); setCmpMode('date'); }}
                >
                  <Text style={{ color: cmpMode === 'date' ? t.primary : t.textMuted, fontSize: font.xs, fontWeight: '600' }}>до {daysPassed}-го</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cmpModeChip, { backgroundColor: cmpMode === 'full' ? t.surface2 : t.surface, borderColor: cmpMode === 'full' ? t.primary : t.border }]}
                  onPress={() => { haptics.select(); setCmpMode('full'); }}
                >
                  <Text style={{ color: cmpMode === 'full' ? t.primary : t.textMuted, fontSize: font.xs, fontWeight: '600' }}>весь месяц</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          {/* Total card */}
          <View ref={totalTarget} collapsable={false} onLayout={tOffset('summary.total')}>
          <Card>
            <Text style={[styles.totalLabel, { color: t.textMuted }]}>Потрачено за месяц</Text>
            <Text style={[styles.totalAmt, { color: t.text }]}>{fmt(data?.total ?? 0)}</Text>
            {compare && hasPrev && (
              <Text style={{ fontSize: font.sm, marginTop: 2, color: (data?.total ?? 0) > prevAgg.total ? '#ef4444' : '#22c55e' }}>
                Прошлый месяц{cmpMode === 'date' && isCurrentMonth ? ` (до ${daysPassed}-го)` : ''}: {fmt(prevAgg.total)}
                {prevAgg.total > 0 ? ` (${(data?.total ?? 0) > prevAgg.total ? '▲' : '▼'}${Math.abs(Math.round(((data?.total ?? 0) - prevAgg.total) / prevAgg.total * 100))}%)` : ''}
              </Text>
            )}
            {plannedMonthly > 0 && (
              <Text style={{ color: t.textMuted, fontSize: font.sm, marginTop: 4 }}>
                Остаток от плана {fmt(plannedMonthly - (data?.total ?? 0))}
              </Text>
            )}
            {totalIncome > 0 && (
              <Text style={{ color: t.textMuted, fontSize: font.sm, marginTop: 2 }}>
                Доход {fmt(totalIncome)} · остаток {fmt(totalIncome - (data?.total ?? 0))}
              </Text>
            )}
          </Card>
          </View>

          {/* Барометр бюджета — спидометр как в вебе */}
          {blocks.gauge && gaugePct !== null && (
            <View ref={gaugeTarget} collapsable={false} onLayout={tOffset('summary.gauge')}>
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>💵 Барометр бюджета</Text>
              <BudgetGauge pct={gaugePct} />
              <View style={styles.gaugeStats}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.textMuted, fontSize: font.xs }}>Потрачено</Text>
                  <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700' }}>{fmt(data?.total ?? 0)}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'center' }}>
                  <Text style={{ color: t.textMuted, fontSize: font.xs }}>По плану</Text>
                  <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700' }}>{fmt(planToDate)}</Text>
                </View>
                <View style={{ flex: 1, alignItems: 'flex-end' }}>
                  <Text style={{ color: t.textMuted, fontSize: font.xs }}>Дней</Text>
                  <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '700' }}>{daysPassed} из {daysInMonth}</Text>
                </View>
              </View>
            </Card>
            </View>
          )}

          {/* Скорость трат: линия % факт/план нарастающим итогом, как в вебе */}
          {blocks.speed && plannedMonthly > 0 && monthExp.length > 0 && (() => {
            const pts: Array<{ x: number; y: number; pct: number; d: number }> = [];
            const W = 300, H = 120, MAX = 250;
            for (let d = 1; d <= daysPassed; d++) {
              let cum = 0;
              for (let k = 1; k <= d; k++) cum += dayTotals[k] ?? 0;
              const planCum = plannedMonthly * d / daysInMonth;
              const pct = planCum > 0 ? Math.round(cum / planCum * 100) : 0;
              const x = daysPassed > 1 ? (d - 1) / (daysPassed - 1) * (W - 44) + 34 : W / 2;
              const y = H - Math.min(pct, MAX) / MAX * (H - 15);
              pts.push({ x, y, pct, d });
            }
            const y100 = H - 100 / MAX * (H - 15);
            const dotColor = (p: number) => p > 100 ? '#ef4444' : p > 80 ? '#f59e0b' : '#22c55e';
            return (
              <Card>
                <Text style={[styles.sectionTitle, { color: t.text }]}>📈 Скорость трат</Text>
                <Svg width="100%" height={H + 20} viewBox={`0 0 ${W} ${H + 20}`}>
                  {/* Сетка и ось Y в процентах — как в вебе */}
                  {[0, 50, 100, 150, 200, 250].map(pv => {
                    const gy = H - Math.min(pv, MAX) / MAX * (H - 15);
                    return (
                      <React.Fragment key={pv}>
                        <SvgLine x1={30} y1={gy} x2={W - 6} y2={gy}
                          stroke={pv === 100 ? '#f0a5b5' : t.border} strokeWidth={pv === 100 ? 1.5 : 0.6}
                          strokeDasharray={pv === 100 ? '5 4' : undefined} />
                        <SvgText x={26} y={gy + 3} fontSize={8.5} fill={t.textMuted} textAnchor="end">{pv}%</SvgText>
                      </React.Fragment>
                    );
                  })}
                  <Polyline
                    points={pts.map(p => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#ef4444" strokeWidth={2.5} strokeLinejoin="round"
                  />
                  {pts.map(p => (
                    <Circle key={p.d} cx={p.x} cy={p.y} r={3.5} fill={dotColor(p.pct)} />
                  ))}
                  {/* Значения на каждой 3-й точке и последней */}
                  {pts.filter((p, i) => i === pts.length - 1 || p.d % 3 === 0 || p.d === 1).map(p => (
                    <SvgText key={`v${p.d}`} x={p.x} y={p.y - 7} fontSize={8.5} fill={t.text} textAnchor="middle" fontWeight="bold">
                      {p.pct}%
                    </SvgText>
                  ))}
                  {pts.filter(p => p.d === 1 || p.d % 5 === 0).map(p => (
                    <SvgText key={`d${p.d}`} x={p.x} y={H + 16} fontSize={9} fill={t.textMuted} textAnchor="middle">{p.d}</SvgText>
                  ))}
                </Svg>
              </Card>
            );
          })()}

          {/* Heatmap по дням */}
          {blocks.heatmap && monthExp.length > 0 && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>📅 Расходы по дням</Text>
              {memberNames.length > 1 && (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    style={[styles.userChip, { backgroundColor: heatUser === null ? t.primary : t.surface2 }]}
                    onPress={() => { haptics.select(); setHeatUser(null); setDrillDay(null); }}
                  >
                    <Text style={{ color: heatUser === null ? '#fff' : t.text, fontSize: font.sm }}>Все</Text>
                  </TouchableOpacity>
                  {memberNames.map(u => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.userChip, { backgroundColor: heatUser === u ? t.primary : t.surface2 }]}
                      onPress={() => { haptics.select(); setHeatUser(x => x === u ? null : u); setDrillDay(null); }}
                    >
                      <Text style={{ color: heatUser === u ? '#fff' : t.text, fontSize: font.sm }}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {heatUser && (
                <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
                  Доля {heatUser}: {Math.round(100 / memberCount)}% семейного плана
                  {dailyPlanShare > 0 ? ` — ${fmt(dailyPlanShare)} в день` : ''}, пороги цветов снижены соответственно.
                </Text>
              )}
              <View style={styles.heatGrid}>
                {['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].map(d => (
                  <Text key={d} style={[styles.heatHead, { color: t.textMuted }]}>{d}</Text>
                ))}
                {Array.from({ length: firstWeekday }).map((_, i) => (
                  <View key={`pad${i}`} style={styles.heatCell} />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const d = i + 1;
                  const v = dayTotals[d] ?? 0;
                  return (
                    <TouchableOpacity
                      key={d}
                      style={[styles.heatCell, { backgroundColor: heatColor(v) }]}
                      onPress={() => { if (v > 0) { haptics.select(); setDrillDay(d); } }}
                    >
                      <Text numberOfLines={1} style={{ fontSize: font.xs, fontWeight: '700', color: heatText(v) }}>{d}</Text>
                      {v > 0 && (
                        <Text numberOfLines={1} style={{ fontSize: 8, color: '#1e293b' }}>
                          {v >= 1000 ? `${Math.round(v / 1000)}к` : Math.round(v)}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* Расходы выбранного дня — фиксированная высота, скролл внутри */}
              {drillDay !== null && (
                <View style={{ marginTop: spacing.md, borderTopWidth: 1, borderTopColor: t.border, paddingTop: spacing.md, height: 220 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                    <Text style={{ color: t.text, fontWeight: '700', flex: 1 }} numberOfLines={1}>
                      {drillDay} {getMonthName(month, year).toLowerCase()}{heatUser ? ` · ${heatUser}` : ''} · {fmt(dayTotals[drillDay] ?? 0)}
                      {monthExp.filter(e => (!heatUser || e.user === heatUser) && parseInt(e.date?.split('.')[0] ?? '') === drillDay).length > 4
                        ? `  (${monthExp.filter(e => (!heatUser || e.user === heatUser) && parseInt(e.date?.split('.')[0] ?? '') === drillDay).length} поз. ▾)` : ''}
                    </Text>
                    <TouchableOpacity onPress={() => setDrillDay(null)} style={{ paddingHorizontal: 6 }}>
                      <Text style={{ color: t.textMuted }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView nestedScrollEnabled showsVerticalScrollIndicator persistentScrollbar>
                    {monthExp
                      .filter(e => (!heatUser || e.user === heatUser) && parseInt(e.date?.split('.')[0] ?? '') === drillDay)
                      .sort((a, b) => b.amount - a.amount)
                      .map(e => (
                        <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}>
                          <Text style={{ width: 26, fontSize: 16 }}>{catIcon2(e.category)}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: t.text }} numberOfLines={1}>{e.description}</Text>
                            <Text style={{ color: t.textMuted, fontSize: font.xs }} numberOfLines={1}>{e.user} · {e.category}</Text>
                          </View>
                          <Text style={{ color: t.text, fontWeight: '700' }}>{fmt(e.amount)}</Text>
                        </View>
                      ))}
                  </ScrollView>
                </View>
              )}
            </Card>
          )}

          {/* AI analysis (premium) */}
          {blocks.ai && <TouchableOpacity
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
          </TouchableOpacity>}

          {/* By user */}
          {blocks.byUser && data && Object.keys(data.byUser).length > 1 && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>По участникам</Text>
              {Object.entries(data.byUser).map(([name, ud]) => {
                const inc = incomes[name] ?? 0;
                const topCats = Object.entries(ud.byCategory ?? {})
                  .sort(([, a], [, b]) => b - a).slice(0, 3)
                  .map(([c, v]) => `${catIcon2(c)} ${fmt(v)}`).join(' · ');
                return (
                  <View key={name} style={styles.userRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text }}>
                        {name}{inc > 0 ? ` · ${Math.round(ud.total / inc * 100)}% дохода` : ''}
                      </Text>
                      {!!topCats && (
                        <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>{topCats}</Text>
                      )}
                    </View>
                    <Text style={{ color: t.text, fontWeight: '700' }}>{fmt(ud.total)}</Text>
                  </View>
                );
              })}
            </Card>
          )}

          {/* Categories — карточки как в вебе */}
          <Card>
            <View style={styles.catHeader}>
              <Text style={[styles.sectionTitle, { color: t.text, marginBottom: 0 }]}>Категории</Text>
              <TouchableOpacity onPress={openPlanEditor}>
                <Text style={{ color: t.primary, fontSize: font.sm, fontWeight: '600' }}>⚙️ Лимиты</Text>
              </TouchableOpacity>
            </View>
            {memberNames.length > 1 && (
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
                <TouchableOpacity
                  style={[styles.userChip, { backgroundColor: selUser === null ? t.primary : t.surface2 }]}
                  onPress={() => { haptics.select(); setSelUser(null); }}
                >
                  <Text style={{ color: selUser === null ? '#fff' : t.text, fontSize: font.sm }}>Все</Text>
                </TouchableOpacity>
                {memberNames.map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.userChip, { backgroundColor: selUser === u ? t.primary : t.surface2 }]}
                    onPress={() => { haptics.select(); setSelUser(x => x === u ? null : u); }}
                  >
                    <Text style={{ color: selUser === u ? '#fff' : t.text, fontSize: font.sm }}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {selUser && (
              <Text style={{ color: t.textMuted, fontSize: font.sm, marginTop: spacing.sm }}>
                {selUser}: {fmt(data?.byUser[selUser]?.total ?? 0)} за месяц
              </Text>
            )}
            {cats.length === 0 && (
              <Text style={{ color: t.textMuted, marginTop: spacing.md }}>Нет расходов за месяц</Text>
            )}
          </Card>

          {cats.map(([cat, amt]) => {
            const limit = selUser ? 0 : budgets[cat] ?? 0;
            const over = limit > 0 && amt > limit;
            const fillPct = limit > 0 ? Math.min(amt / limit, 1) : amt / maxCat;
            const prevAmt = compare && hasPrev ? prevAgg.byCategory[cat] ?? 0 : null;
            return (
              <TouchableOpacity key={cat} onPress={() => openDrill(cat)} activeOpacity={0.7}>
                <Card>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <Text style={{ fontSize: 32 }}>{catIcon2(cat)}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: t.text, fontSize: font.lg, fontWeight: '700', marginRight: spacing.sm }} numberOfLines={1}>{cat}</Text>
                        <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800' }}>{fmt(amt)}</Text>
                      </View>
                      {/* Градиентный прогрессбар как в вебе */}
                      <View style={[styles.gradBarBg, { backgroundColor: t.surface2 }]}>
                        <LinearGradient
                          colors={over ? ['#FF5C87', '#FF7AB3'] : ['#8A6BFF', '#FF7AB3']}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                          style={[styles.gradBarFill, { width: `${fillPct * 100}%` }]}
                        />
                      </View>
                      {/* При фильтре по участнику строку лимита не показываем — лимиты общие на семью */}
                      {(limit > 0 || !selUser) && (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, gap: spacing.sm }}>
                          {limit > 0 ? (
                            <Text numberOfLines={1} style={{ flexShrink: 1, color: over ? '#FF5C87' : t.success, fontSize: font.sm, fontWeight: '600' }}>
                              {over ? `перерасход ${fmt(amt - limit)}` : `осталось ${fmt(limit - amt)}`}
                            </Text>
                          ) : <Text style={{ color: t.textMuted, fontSize: font.sm }}>без лимита</Text>}
                          {limit > 0 && (
                            <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: font.sm }}>лимит {fmt(limit)}</Text>
                          )}
                        </View>
                      )}
                      {prevAmt !== null && prevAmt > 0 && (
                        <Text numberOfLines={1} style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                          прошлый месяц: {fmt(prevAmt)} ({amt >= prevAmt ? '▲' : '▼'}{Math.abs(Math.round((amt - prevAmt) / prevAmt * 100))}%)
                        </Text>
                      )}
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <MonthPickerModal
        visible={monthPicker}
        month={month}
        year={year}
        onClose={() => setMonthPicker(false)}
        onPick={(m, y) => { setMonth(m); setYear(y); load(m, y); }}
      />

      {/* Budget plan editor */}
      <Modal visible={planVisible} animationType="slide" onRequestClose={() => setPlanVisible(false)}>
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
            {allCats.map(cat => (
              <View key={cat} style={styles.planRow}>
                <Text style={{ color: t.text, flex: 1 }}>{catIcon2(cat)} {cat}</Text>
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

      {/* Category drill-down */}
      <Modal visible={!!drillCat} animationType="slide" onRequestClose={() => setDrillCat(null)}>
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setDrillCat(null)} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="chevron-back" size={20} color={t.primary} />
              <Text style={{ color: t.primary }}>Назад</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>
              {drillCat ? `${catIcon2(drillCat)} ${drillCat}` : ''}
            </Text>
            <View style={{ width: 56 }} />
          </View>
          {/* Фильтр по пользователю */}
          {(() => {
            const users = [...new Set(drillList.map(e => e.user))];
            return users.length > 1 ? (
              <View style={{ flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
                <TouchableOpacity
                  style={[styles.userChip, { backgroundColor: drillUser === null ? t.primary : t.surface }]}
                  onPress={() => setDrillUser(null)}
                >
                  <Text style={{ color: drillUser === null ? '#fff' : t.text, fontSize: font.sm }}>Все</Text>
                </TouchableOpacity>
                {users.map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.userChip, { backgroundColor: drillUser === u ? t.primary : t.surface }]}
                    onPress={() => setDrillUser(x => x === u ? null : u)}
                  >
                    <Text style={{ color: drillUser === u ? '#fff' : t.text, fontSize: font.sm }}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null;
          })()}
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            {drillList.length === 0 && (
              <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} />
            )}
            {drillList.filter(e => !drillUser || e.user === drillUser).map(e => (
              <Card key={e.id}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.text, fontWeight: '500' }}>{e.description}</Text>
                    <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                      {e.user} · {e.date}
                    </Text>
                  </View>
                  <Text style={{ color: t.text, fontWeight: '700' }}>{fmt(e.amount)}</Text>
                </View>
              </Card>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* AI report modal */}
      <Modal visible={aiVisible} animationType="slide" onRequestClose={() => setAiVisible(false)}>
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
              <MdText text={aiReport} color={t.text} accent={t.primary} />
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
  gaugeRow:     { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  gaugeBg:      { height: 12, borderRadius: 6, overflow: 'hidden' },
  gaugeFill:    { height: '100%', borderRadius: 6 },
  gaugeStats:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  heatGrid:     { flexDirection: 'row', flexWrap: 'wrap' },
  heatHead:     { width: `${100 / 7}%`, textAlign: 'center', fontSize: font.xs, marginBottom: 4 },
  heatCell:     { width: `${100 / 7 - 1}%`, aspectRatio: 1, margin: '0.5%', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  speedChart:   { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 2 },
  speedCol:     { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  speedBar:     { width: '100%', borderRadius: 3, minHeight: 4 },
  userChip:     { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  gradBarBg:    { height: 9, borderRadius: 5, overflow: 'hidden', marginTop: 6 },
  gradBarFill:  { height: '100%', borderRadius: 5 },
  compareChip:  { alignSelf: 'flex-start', borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
  cmpModeChip:  { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1.5 },
});
