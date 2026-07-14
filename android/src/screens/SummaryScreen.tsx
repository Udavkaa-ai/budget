import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Line as SvgLine, Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { useTheme, spacing, font, radius } from '../theme';
import { summary as summaryApi, budgetPlan, ai, expenses as expApi, settings as settingsApi, type SummaryData, type BudgetPlan, type Expense } from '../api/client';
import { Card } from '../components/Card';
import { CATEGORIES } from '../classifier';
import { usePremium } from '../premium';
import { useBlocks } from '../blocks';
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

// Точка на дуге спидометра: 0% слева (180°), максимум справа (0°)
function polar(cx: number, cy: number, r: number, pct: number, maxPct = 160) {
  const a = Math.PI * (1 - Math.min(pct, maxPct) / maxPct);
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

function arcPath(cx: number, cy: number, r: number, fromPct: number, toPct: number, maxPct = 160) {
  const s = polar(cx, cy, r, fromPct, maxPct);
  const e = polar(cx, cy, r, toPct, maxPct);
  const large = (toPct - fromPct) / maxPct > 0.5 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

// Простой markdown: ## заголовки, * пункты, **жирный**
function MdText({ text, color, accent }: { text: string; color: string; accent: string }) {
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
      {text.split('\n').map((raw, i) => {
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
  const [prevData, setPrevData] = useState<SummaryData | null>(null);

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
      // Прошлый месяц для сравнения
      const pd = new Date(y, m - 2, 1);
      summaryApi.get(pd.getMonth() + 1, pd.getFullYear()).then(setPrevData).catch(() => setPrevData(null));
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
  const incomes = plan?.incomes ?? {};
  const totalIncome = Object.values(incomes).reduce((s, v) => s + v, 0);

  // Баблометр: факт против плана, пропорционально прошедшим дням
  const daysInMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear();
  const daysPassed = isCurrentMonth ? now.getDate() : daysInMonth;
  const planToDate = plannedMonthly > 0 ? plannedMonthly * daysPassed / daysInMonth : 0;
  const gaugePct = planToDate > 0 ? Math.round((data?.total ?? 0) / planToDate * 100) : null;

  // Heatmap: суммы по дням месяца
  const dayTotals: Record<number, number> = {};
  for (const e of monthExp) {
    const d = parseInt(e.date?.split('.')[0] ?? '');
    if (!isNaN(d)) dayTotals[d] = (dayTotals[d] ?? 0) + e.amount;
  }
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7; // Пн=0
  const heatColor = (v: number) =>
    v === 0 ? t.surface2 : v < 2000 ? '#bbf7d0' : v < 5000 ? '#22c55e' : v < 10000 ? '#f59e0b' : v < 20000 ? '#f97316' : '#ef4444';
  const heatText = (v: number) => (v === 0 ? t.textMuted : '#1e293b');

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
          {/* Сравнить */}
          <TouchableOpacity
            style={[styles.compareChip, { backgroundColor: compare ? t.primary : t.surface }]}
            onPress={() => setCompare(c => !c)}
          >
            <Text style={{ color: compare ? '#fff' : t.primary, fontSize: font.sm, fontWeight: '600' }}>
              ⚖️ Сравнить с прошлым месяцем
            </Text>
          </TouchableOpacity>

          {/* Total card */}
          <Card>
            <Text style={[styles.totalLabel, { color: t.textMuted }]}>Потрачено за месяц</Text>
            <Text style={[styles.totalAmt, { color: t.text }]}>{fmt(data?.total ?? 0)}</Text>
            {compare && prevData && (
              <Text style={{ fontSize: font.sm, marginTop: 2, color: (data?.total ?? 0) > prevData.total ? '#ef4444' : '#22c55e' }}>
                Прошлый месяц: {fmt(prevData.total)}
                {prevData.total > 0 ? ` (${(data?.total ?? 0) > prevData.total ? '▲' : '▼'}${Math.abs(Math.round(((data?.total ?? 0) - prevData.total) / prevData.total * 100))}%)` : ''}
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

          {/* Баблометр — спидометр как в вебе */}
          {blocks.gauge && gaugePct !== null && (
            <Card>
              <Text style={[styles.sectionTitle, { color: t.text }]}>💵 Баблометр</Text>
              <View style={{ alignItems: 'center' }}>
                <Svg width="100%" height={150} viewBox="0 0 260 150">
                  {/* Зоны: зелёная до 70%, жёлтая 70-100%, красная 100-160% */}
                  <Path d={arcPath(130, 130, 100, 0, 70)} stroke="#22c55e" strokeWidth={16} fill="none" strokeLinecap="round" />
                  <Path d={arcPath(130, 130, 100, 70, 100)} stroke="#f59e0b" strokeWidth={16} fill="none" />
                  <Path d={arcPath(130, 130, 100, 100, 160)} stroke="#ef4444" strokeWidth={16} fill="none" strokeLinecap="round" />
                  {/* Стрелка */}
                  {(() => {
                    const tip = polar(130, 130, 82, gaugePct);
                    return <SvgLine x1={130} y1={130} x2={tip.x} y2={tip.y} stroke={t.text} strokeWidth={3.5} strokeLinecap="round" />;
                  })()}
                  <Circle cx={130} cy={130} r={7} fill={t.text} />
                  {/* Подписи шкалы */}
                  <SvgText x={20} y={148} fontSize={11} fill={t.textMuted}>0%</SvgText>
                  <SvgText x={62} y={40} fontSize={11} fill={t.textMuted}>70%</SvgText>
                  <SvgText x={160} y={35} fontSize={11} fill={t.textMuted}>100%</SvgText>
                  <SvgText x={218} y={148} fontSize={11} fill={t.textMuted}>160%</SvgText>
                </Svg>
                <Text style={{
                  fontSize: 36, fontWeight: '800', marginTop: -58,
                  color: gaugePct <= 70 ? '#22c55e' : gaugePct <= 100 ? '#f59e0b' : '#ef4444',
                }}>
                  {gaugePct}%
                </Text>
                <Text style={{ color: t.textMuted, fontSize: font.xs }}>ФАКТ / ПЛАН</Text>
                <Text style={{ color: t.text, fontSize: font.sm, marginTop: 2 }}>
                  {gaugePct > 100 ? 'Перерасход 🔴' : gaugePct > 90 ? 'На грани 🟡' : 'В норме 🟢'}
                </Text>
              </View>
              <View style={styles.gaugeStats}>
                <Text style={{ color: t.textMuted, fontSize: font.xs }}>Потрачено{'\n'}{fmt(data?.total ?? 0)}</Text>
                <Text style={{ color: t.textMuted, fontSize: font.xs, textAlign: 'center' }}>По плану{'\n'}{fmt(planToDate)}</Text>
                <Text style={{ color: t.textMuted, fontSize: font.xs, textAlign: 'right' }}>Дней{'\n'}{daysPassed} из {daysInMonth}</Text>
              </View>
            </Card>
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
              const x = daysPassed > 1 ? (d - 1) / (daysPassed - 1) * (W - 30) + 15 : W / 2;
              const y = H - Math.min(pct, MAX) / MAX * (H - 15);
              pts.push({ x, y, pct, d });
            }
            const y100 = H - 100 / MAX * (H - 15);
            const dotColor = (p: number) => p > 100 ? '#ef4444' : p > 80 ? '#f59e0b' : '#22c55e';
            return (
              <Card>
                <Text style={[styles.sectionTitle, { color: t.text }]}>📈 Скорость трат</Text>
                <Svg width="100%" height={H + 20} viewBox={`0 0 ${W} ${H + 20}`}>
                  {/* Пунктир 100% плана */}
                  <SvgLine x1={15} y1={y100} x2={W - 15} y2={y100} stroke="#f0a5b5" strokeWidth={1.5} strokeDasharray="5 4" />
                  <SvgText x={W - 14} y={y100 - 3} fontSize={9} fill={t.textMuted} textAnchor="end">100%</SvgText>
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
                      onPress={() => v > 0 && setDrillDay(d)}
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
                    <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>
                      {drillDay} {getMonthName(month, year).toLowerCase()} · {fmt(dayTotals[drillDay] ?? 0)}
                    </Text>
                    <TouchableOpacity onPress={() => setDrillDay(null)} style={{ paddingHorizontal: 6 }}>
                      <Text style={{ color: t.textMuted }}>✕</Text>
                    </TouchableOpacity>
                  </View>
                  <ScrollView nestedScrollEnabled>
                    {monthExp
                      .filter(e => parseInt(e.date?.split('.')[0] ?? '') === drillDay)
                      .sort((a, b) => b.amount - a.amount)
                      .map(e => (
                        <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}>
                          <Text style={{ width: 26, fontSize: 16 }}>{ICONS[e.category] ?? '❓'}</Text>
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
                  .map(([c, v]) => `${ICONS[c] ?? ''} ${fmt(v)}`).join(' · ');
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
                <TouchableOpacity key={cat} style={styles.catRow} onPress={() => openDrill(cat)}>
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
                    {compare && prevData && (
                      <View style={[styles.barBg, { height: 4, marginTop: 2, opacity: 0.55 }]}>
                        <View style={[styles.barFill, {
                          width: `${Math.min((prevData.byCategory[cat] ?? 0) / maxCat, 1) * 100}%`,
                          backgroundColor: '#9ca3af',
                        }]} />
                      </View>
                    )}
                    <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 2 }}>
                      {cat}{limit > 0 ? ` · лимит ${fmt(limit)}` : ''}
                      {compare && prevData ? (() => {
                        const pv = prevData.byCategory[cat] ?? 0;
                        if (pv === 0) return ' · новое';
                        const dpct = Math.round((amt - pv) / pv * 100);
                        return ` · было ${fmt(pv)} (${dpct > 0 ? '▲' : '▼'}${Math.abs(dpct)}%)`;
                      })() : ''}
                    </Text>
                  </View>
                  <Text style={[styles.catAmt, { color: over ? '#ef4444' : t.text }]}>{fmt(amt)}</Text>
                </TouchableOpacity>
              );
            })}
          </Card>
        </ScrollView>
      )}

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

      {/* Category drill-down */}
      <Modal visible={!!drillCat} animationType="slide" onRequestClose={() => setDrillCat(null)}>
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setDrillCat(null)}>
              <Text style={{ color: t.primary }}>← Назад</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>
              {drillCat ? `${ICONS[drillCat] ?? ''} ${drillCat}` : ''}
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
  compareChip:  { alignSelf: 'flex-start', borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginBottom: spacing.md },
});
