import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Path, Rect, Circle, Line as SvgLine, Text as SvgText, G } from 'react-native-svg';
import { useTheme, spacing, font, radius, type Theme } from '../theme';
import { Card } from './Card';
import { SectionTitle, StatusChip } from './UI';
import { gaugeZone } from './BudgetGauge';
import { haptics } from '../haptics';
import type { UnifiedChart } from '../api/client';

// Экран «График» — три простые карточки, у каждой одна шкала (1:1 с вебом,
// renderChartCards в public/app.js):
// 1) накопительные траты против линии плана + прогноз; всё выше плана — красным,
// 2) траты по дням с разбивкой по участникам и дневной нормой; красная точка —
//    день дороже нормы,
// 3) остаток на счетах — если заполнен кэшфлоу.
// Палец по любому графику ведёт выбранный день (общий для всех трёх карточек).

const W = 340;
const PL = 34, PR = 10, TOP = 26, PB = 22;
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const kFmt = (v: number) => Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}м` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}к` : String(Math.round(v));
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
// «Красивый» верх шкалы: 1/2/2.5/5 × 10^k
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}
const alpha = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

type Frame = { H: number; dim: number; yMin: number; yMax: number };
const plotH = (f: Frame) => f.H - TOP - PB;
const xOf = (f: Frame, d: number) => PL + (d - 1) / Math.max(1, f.dim - 1) * (W - PL - PR);
const yOf = (f: Frame, v: number) => TOP + plotH(f) * (1 - (v - f.yMin) / Math.max(1, f.yMax - f.yMin));

function Axes({ f, t, sel }: { f: Frame; t: Theme; sel: number | null }) {
  const lines = [];
  for (let i = 0; i <= 4; i++) {
    const v = f.yMin + (f.yMax - f.yMin) * i / 4;
    const y = yOf(f, v);
    lines.push(<SvgLine key={`g${i}`} x1={PL} x2={W - PR} y1={y} y2={y} stroke={t.border} strokeWidth={1} />);
    lines.push(<SvgText key={`y${i}`} x={PL - 6} y={y + 3.5} fontSize={10} fill={t.textFaint} textAnchor="end">{kFmt(v)}</SvgText>);
  }
  for (let d = 1; d <= f.dim; d++) {
    if (!(d === 1 || d % 5 === 0)) continue;
    lines.push(<SvgText key={`x${d}`} x={xOf(f, d)} y={f.H - 6} fontSize={10} textAnchor="middle"
      fill={sel === d ? t.primary : t.textFaint} fontWeight={sel === d ? '700' : '400'}>{String(d)}</SvgText>);
  }
  return <>{lines}</>;
}

// Полилиния по точкам с пропусками (null)
function linePath(pts: Array<[number, number] | null>) {
  let d = '', pen = false;
  for (const p of pts) {
    if (!p) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)} `;
    pen = true;
  }
  return d;
}

// Подсказка выбранного дня: вертикальная линия + плашка со строками
function Tip({ f, t, day, rows }: { f: Frame; t: Theme; day: number; rows: Array<{ c?: string; label: string; value: string }> }) {
  const x = xOf(f, day);
  const bw = 132, bh = 18 + rows.length * 14;
  const bx = x + 10 + bw > W - PR ? x - 10 - bw : x + 10;
  return (
    <G>
      <SvgLine x1={x} x2={x} y1={TOP - 4} y2={TOP + plotH(f)} stroke={t.textFaint} strokeWidth={1} strokeDasharray="3 3" />
      <Rect x={bx} y={2} width={bw} height={bh} rx={8} fill={t.text} opacity={0.92} />
      {rows.map((r, i) => (
        <G key={i}>
          {r.c && <Circle cx={bx + 10} cy={16 + i * 14 + 1} r={3.5} fill={r.c} />}
          <SvgText x={bx + (r.c ? 18 : 8)} y={16 + i * 14 + 5} fontSize={10.5} fill={t.bg}>{r.label}</SvgText>
          <SvgText x={bx + bw - 8} y={16 + i * 14 + 5} fontSize={10.5} fontWeight="700" fill={t.bg} textAnchor="end">{r.value}</SvgText>
        </G>
      ))}
    </G>
  );
}

// Обёртка графика: меряет ширину и превращает касание/проведение пальцем в день
function Scrub({ dim, onDay, children, height }: { dim: number; onDay: (d: number) => void; children: React.ReactNode; height: number }) {
  const [w, setW] = useState(0);
  const toDay = (px: number) => {
    if (w <= 0) return;
    const vb = px / w * W;
    const d = Math.round((vb - PL) / ((W - PL - PR) / Math.max(1, dim - 1))) + 1;
    onDay(Math.max(1, Math.min(dim, d)));
  };
  const pan = Gesture.Pan().activeOffsetX([-6, 6]).failOffsetY([-12, 12]).runOnJS(true)
    .onBegin(e => toDay(e.x)).onUpdate(e => toDay(e.x));
  return (
    <GestureDetector gesture={pan}>
      <View style={{ height }} onLayout={e => setW(e.nativeEvent.layout.width)}>{children}</View>
    </GestureDetector>
  );
}

function Legend({ items }: { items: Array<{ kind: 'line' | 'dash' | 'dot' | 'sq' | 'over' | 'overDot' | 'gold'; color?: string; label: string }> }) {
  const t = useTheme();
  return (
    <View style={styles.legend}>
      {items.map((it, i) => {
        const mark = {
          line: <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: it.color ?? t.primary }} />,
          // пунктиры — через SVG: на Android односторонняя dashed-рамка не рисуется
          dash: <Svg width={16} height={4}><SvgLine x1={0} y1={2} x2={16} y2={2} stroke={t.textFaint} strokeWidth={2} strokeDasharray="4 3" /></Svg>,
          dot: <Svg width={16} height={4}><SvgLine x1={1.5} y1={2} x2={16} y2={2} stroke={it.color ?? t.primary} strokeWidth={3} strokeDasharray="0.1 5" strokeLinecap="round" /></Svg>,
          sq: <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: it.color }} />,
          over: <View style={{ width: 14, height: 10, borderRadius: 3, backgroundColor: t.dangerSoft, borderTopWidth: 3, borderTopColor: t.danger }} />,
          overDot: <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.danger }} />,
          gold: <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: t.gold }} />,
        }[it.kind];
        return <View key={i} style={styles.legendItem}>{mark}<Text style={{ color: t.textMuted, fontSize: 12 }}>{it.label}</Text></View>;
      })}
    </View>
  );
}

export function MonthCharts({ data, plan, month, year, show = { cum: true, daily: true, balance: true } }: {
  data: UnifiedChart; plan: number; month: number; year: number; show?: { cum: boolean; daily: boolean; balance: boolean };
}) {
  const t = useTheme();
  const [sel, setSel] = useState<number | null>(null);
  const pick = (d: number) => { if (d !== sel) haptics.select(); setSel(d); };

  const users = Object.keys(data.userExpenses || {});
  const lastDay = data.labels?.length || 0;
  const now = new Date();
  const dim = new Date(year, month, 0).getDate();
  const isCur = year === now.getFullYear() && month === now.getMonth() + 1;
  if (!lastDay || (!users.length && !data.hasBalance)) {
    return <Card><Text style={{ color: t.textMuted, textAlign: 'center', paddingVertical: spacing.lg }}>Нет расходов за этот месяц</Text></Card>;
  }

  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const userDay = (u: string, d: number) => d <= lastDay ? (data.userExpenses[u][d - 1] || 0) : 0;
  const daily = days.map(d => d <= lastDay ? users.reduce((s, u) => s + userDay(u, d), 0) : null);
  let acc = 0;
  const cum = daily.map(v => v === null ? null : (acc += v));
  const spent = acc;
  const perDay = spent / lastDay;
  const projected = Math.round(perDay * dim);
  const showProj = isCur && lastDay < dim;
  const planAt = (d: number) => Math.round(plan * d / dim);
  const normNow = plan ? planAt(lastDay) : 0;
  const zone = plan ? gaugeZone(Math.round(spent / Math.max(1, normNow) * 100)) : null;
  const ZONE_TEXT = { good: 'Экономим', ok: 'В графике', warn: 'Выше плана', over: 'Перерасход' } as const;
  const overDay = (d: number) => plan > 0 && cum[d - 1] != null && (cum[d - 1] as number) > planAt(d);
  let overSince = 0;
  if (overDay(lastDay)) { overSince = lastDay; while (overSince > 1 && overDay(overSince - 1)) overSince--; }
  const overDays = days.filter(overDay).length;
  const normDay = plan ? Math.round(plan / dim) : 0;
  const dailyOver = days.filter(d => normDay > 0 && (daily[d - 1] ?? 0) > normDay).length;
  const userTotals = users.map(u => data.userExpenses[u].reduce((s, v) => s + (v || 0), 0));
  const series = t.series;
  const bal = data.hasBalance ? (data.balanceLine || []) : null;
  const balNow = bal ? bal[Math.min(bal.length, lastDay) - 1] ?? 0 : 0;
  const dayLabel = (d: number) => `${d} ${MONTHS_SHORT[month - 1]}`;

  // ── 1) Накопительно против плана ─────────────────────────────────────────
  const f1: Frame = { H: 220, dim, yMin: 0, yMax: niceMax(Math.max(spent, showProj ? projected : 0, plan, 1)) };
  const cumPts = days.map(d => cum[d - 1] == null ? null : [xOf(f1, d), yOf(f1, cum[d - 1] as number)] as [number, number]);
  const area = `${linePath(cumPts)} L${xOf(f1, lastDay).toFixed(1)} ${yOf(f1, 0)} L${xOf(f1, 1).toFixed(1)} ${yOf(f1, 0)} Z`;
  // Заливка перерасхода: четырёхугольники между тратами и планом на отрезках выше плана
  // (с точкой пересечения, чтобы край заливки ложился ровно на линию плана)
  const overPolys: string[] = [];
  const redSegs: string[] = [];
  if (plan > 0) {
    for (let d = 1; d < lastDay; d++) {
      const a = (cum[d - 1] as number) - planAt(d), b = (cum[d] as number) - planAt(d + 1);
      if (a <= 0 && b <= 0) continue;
      const x1 = xOf(f1, d), x2 = xOf(f1, d + 1);
      const s1 = yOf(f1, cum[d - 1] as number), s2 = yOf(f1, cum[d] as number);
      const p1 = yOf(f1, planAt(d)), p2 = yOf(f1, planAt(d + 1));
      if (a > 0 && b > 0) {
        overPolys.push(`M${x1} ${s1} L${x2} ${s2} L${x2} ${p2} L${x1} ${p1} Z`);
        redSegs.push(`M${x1} ${s1} L${x2} ${s2}`);
      } else {
        const r = Math.abs(a) / (Math.abs(a) + Math.abs(b) || 1);
        const xc = x1 + (x2 - x1) * r, yc = s1 + (s2 - s1) * r;
        if (a > 0) { overPolys.push(`M${x1} ${s1} L${xc} ${yc} L${x1} ${p1} Z`); redSegs.push(`M${x1} ${s1} L${xc} ${yc}`); }
        else { overPolys.push(`M${xc} ${yc} L${x2} ${s2} L${x2} ${p2} Z`); redSegs.push(`M${xc} ${yc} L${x2} ${s2}`); }
      }
    }
  }
  const projPath = showProj ? `M${xOf(f1, lastDay)} ${yOf(f1, spent)} L${xOf(f1, dim)} ${yOf(f1, projected)}` : '';
  const projColor = plan && projected > plan ? t.danger : t.primary;

  // ── 2) По дням ────────────────────────────────────────────────────────────
  const maxDaily = Math.max(0, ...daily.map(v => v ?? 0));
  const f2: Frame = { H: 190, dim, yMin: 0, yMax: niceMax(Math.max(maxDaily * 1.1, normDay, 1)) };
  const colW = (W - PL - PR) / dim;
  const barW = Math.max(2, colW * 0.72);

  // ── 3) Остаток ───────────────────────────────────────────────────────────
  const balVals = bal ? days.map(d => d <= lastDay ? bal[d - 1] ?? null : null) : [];
  const bMin = bal ? Math.min(0, ...balVals.filter((v): v is number => v != null)) : 0;
  const bMax = bal ? Math.max(1, ...balVals.filter((v): v is number => v != null)) : 1;
  const f3: Frame = { H: 170, dim, yMin: bMin < 0 ? -niceMax(-bMin) : 0, yMax: niceMax(bMax) };

  const selD = sel && sel <= dim ? sel : null;

  return (
    <>
      {show.cum && (
      <Card>
        <View style={styles.head}>
          <SectionTitle style={{ marginBottom: 0, flex: 1 }}>Траты за месяц</SectionTitle>
          {zone && <StatusChip kind={zone} label={ZONE_TEXT[zone]} small />}
        </View>
        <View style={styles.kpis}>
          <View style={styles.kpi}><Text style={[styles.kpiL, { color: t.textMuted }]}>Потрачено</Text><Text style={[styles.kpiV, { color: t.text }]}>{fmt(spent)}</Text></View>
          {plan > 0 && <View style={styles.kpi}><Text style={[styles.kpiL, { color: t.textMuted }]}>План на месяц</Text><Text style={[styles.kpiV, { color: t.text }]}>{fmt(plan)}</Text></View>}
          {showProj && <View style={styles.kpi}><Text style={[styles.kpiL, { color: t.textMuted }]}>Прогноз</Text><Text style={[styles.kpiV, { color: plan && projected > plan ? t.danger : t.text }]}>{fmt(projected)}</Text></View>}
        </View>
        <Scrub dim={dim} onDay={pick} height={f1.H}>
          <Svg width="100%" height={f1.H} viewBox={`0 0 ${W} ${f1.H}`}>
            <Axes f={f1} t={t} sel={selD} />
            <Path d={area} fill={alpha(t.primary, 0.12)} />
            {overPolys.map((p, i) => <Path key={`op${i}`} d={p} fill={alpha(t.danger, 0.22)} />)}
            {plan > 0 && <SvgLine x1={xOf(f1, 1)} y1={yOf(f1, planAt(1))} x2={xOf(f1, dim)} y2={yOf(f1, plan)} stroke={t.textFaint} strokeWidth={2} strokeDasharray="6 5" />}
            {showProj && <Path d={projPath} stroke={alpha(projColor, 0.7)} strokeWidth={2.5} strokeDasharray="2 5" strokeLinecap="round" fill="none" />}
            <Path d={linePath(cumPts)} stroke={t.primary} strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            {redSegs.map((p, i) => <Path key={`rs${i}`} d={p} stroke={t.danger} strokeWidth={3} fill="none" strokeLinecap="round" />)}
            {overSince > 0 && (() => {
              const x = xOf(f1, overSince), y = yOf(f1, cum[overSince - 1] as number);
              const label = `с ${overSince}`, bw = label.length * 6.5 + 12;
              const bx = Math.max(PL, Math.min(W - PR - bw, x - bw / 2)), by = Math.max(TOP - 18, y - 28);
              return (
                <G>
                  <SvgLine x1={x} x2={x} y1={y + 6} y2={yOf(f1, 0)} stroke={alpha(t.danger, 0.55)} strokeWidth={1.5} strokeDasharray="3 3" />
                  <Rect x={bx} y={by} width={bw} height={18} rx={9} fill={t.danger} />
                  <SvgText x={bx + bw / 2} y={by + 12.5} fontSize={11} fontWeight="700" fill={t.surface} textAnchor="middle">{label}</SvgText>
                  <Circle cx={x} cy={y} r={5} fill={t.danger} stroke={t.surface} strokeWidth={2} />
                </G>
              );
            })()}
            {isCur && <Circle cx={xOf(f1, lastDay)} cy={yOf(f1, spent)} r={5} fill={overDay(lastDay) ? t.danger : t.primary} stroke={t.surface} strokeWidth={2} />}
            {selD && (
              <>
                {selD <= lastDay && <Circle cx={xOf(f1, selD)} cy={yOf(f1, cum[selD - 1] as number)} r={4.5} fill={overDay(selD) ? t.danger : t.primary} stroke={t.surface} strokeWidth={2} />}
                <Tip f={f1} t={t} day={selD} rows={[
                  { label: dayLabel(selD), value: '' },
                  ...(selD <= lastDay ? [{ c: overDay(selD) ? t.danger : t.primary, label: 'Потрачено', value: fmt(cum[selD - 1] as number) }] : []),
                  ...(plan ? [{ c: t.textFaint, label: 'План', value: fmt(planAt(selD)) }] : []),
                  ...(showProj && selD >= lastDay ? [{ c: alpha(projColor, 0.7), label: 'Прогноз', value: fmt(spent + perDay * (selD - lastDay)) }] : []),
                ]} />
              </>
            )}
          </Svg>
        </Scrub>
        <Legend items={[
          { kind: 'line', label: 'Потрачено' },
          ...(plan ? [{ kind: 'dash' as const, label: 'План' }] : []),
          ...(showProj ? [{ kind: 'dot' as const, color: projColor, label: 'Прогноз' }] : []),
          ...(overDays ? [{ kind: 'over' as const, label: 'Выше плана' }] : []),
        ]} />
        {overSince > 0 && (
          <View style={[styles.alert, { backgroundColor: t.dangerSoft }]}>
            <View style={[styles.alertDot, { backgroundColor: t.danger }]} />
            <Text style={{ color: t.danger, fontWeight: '600', fontSize: 13, flex: 1 }}>
              Траты выше плана с {overSince} {MONTHS_GEN[month - 1]} — на {fmt((cum[lastDay - 1] as number) - planAt(lastDay))} больше нормы
            </Text>
          </View>
        )}
        {!plan && <Text style={{ color: t.textMuted, fontSize: 13, marginTop: spacing.sm }}>Укажите плановые расходы в настройках — появится линия плана.</Text>}
        <Text style={{ color: t.textFaint, fontSize: 12, marginTop: spacing.sm, textAlign: 'center' }}>Ведите пальцем по графику, чтобы смотреть дни</Text>
      </Card>
      )}

      {show.daily && (
      <Card>
        <View style={styles.head}>
          <SectionTitle style={{ marginBottom: 0, flex: 1 }}>Траты по дням</SectionTitle>
          <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600' }}>в среднем {fmt(perDay)} в день</Text>
        </View>
        <Scrub dim={dim} onDay={pick} height={f2.H}>
          <Svg width="100%" height={f2.H} viewBox={`0 0 ${W} ${f2.H}`}>
            <Axes f={f2} t={t} sel={selD} />
            {days.map(d => {
              if (d > lastDay) return null;
              let base = 0;
              const x = xOf(f2, d) - barW / 2;
              return (
                <G key={`b${d}`} opacity={selD && selD !== d ? 0.55 : 1}>
                  {users.map((u, i) => {
                    const v = userDay(u, d);
                    if (!v) return null;
                    const y1 = yOf(f2, base + v), h = yOf(f2, base) - y1;
                    base += v;
                    return <Rect key={u} x={x} y={y1} width={barW} height={Math.max(0.5, h - 0.6)} rx={Math.min(2, barW / 3)} fill={series[i % series.length]} />;
                  })}
                </G>
              );
            })}
            {normDay > 0 && <SvgLine x1={PL} x2={W - PR} y1={yOf(f2, normDay)} y2={yOf(f2, normDay)} stroke={t.textFaint} strokeWidth={1.5} strokeDasharray="6 5" />}
            {normDay > 0 && days.map(d => (daily[d - 1] ?? 0) > normDay && (
              <Circle key={`od${d}`} cx={xOf(f2, d)} cy={yOf(f2, (daily[d - 1] as number) + f2.yMax * 0.045)} r={3.6} fill={t.danger} stroke={t.surface} strokeWidth={1.5} />
            ))}
            {selD && selD <= lastDay && (
              <Tip f={f2} t={t} day={selD} rows={[
                { label: dayLabel(selD), value: fmt(daily[selD - 1] ?? 0) },
                ...users.map((u, i) => ({ c: series[i % series.length], label: u, value: fmt(userDay(u, selD)) })).filter(r => r.value !== fmt(0)),
                ...(normDay ? [{ c: (daily[selD - 1] ?? 0) > normDay ? t.danger : t.textFaint, label: 'Норма', value: fmt(normDay) }] : []),
              ]} />
            )}
          </Svg>
        </Scrub>
        <Legend items={[
          ...users.map((u, i) => ({ kind: 'sq' as const, color: series[i % series.length], label: `${u} · ${fmt(userTotals[i])}` })),
          ...(normDay ? [{ kind: 'dash' as const, label: `Норма ${fmt(normDay)} в день` }] : []),
          ...(dailyOver ? [{ kind: 'overDot' as const, label: `Выше нормы · ${dailyOver} ${plural(dailyOver, 'день', 'дня', 'дней')}` }] : []),
        ]} />
      </Card>
      )}

      {bal && show.balance && (
        <Card>
          <View style={styles.head}>
            <SectionTitle style={{ marginBottom: 0, flex: 1 }}>Остаток на счетах</SectionTitle>
            <Text style={{ color: balNow < 0 ? t.danger : t.text, fontSize: 14, fontWeight: '800' }}>{fmt(balNow)}</Text>
          </View>
          <Scrub dim={dim} onDay={pick} height={f3.H}>
            <Svg width="100%" height={f3.H} viewBox={`0 0 ${W} ${f3.H}`}>
              <Axes f={f3} t={t} sel={selD} />
              {f3.yMin < 0 && <SvgLine x1={PL} x2={W - PR} y1={yOf(f3, 0)} y2={yOf(f3, 0)} stroke={t.textFaint} strokeWidth={1} strokeDasharray="3 3" />}
              <Path d={`${linePath(balVals.map((v, i) => v == null ? null : [xOf(f3, i + 1), yOf(f3, v)]))} L${xOf(f3, Math.min(lastDay, dim))} ${yOf(f3, Math.max(0, f3.yMin))} L${xOf(f3, 1)} ${yOf(f3, Math.max(0, f3.yMin))} Z`} fill={alpha(t.primary, 0.1)} />
              {balVals.map((v, i) => {
                const nv = balVals[i + 1];
                if (v == null || nv == null) return null;
                return <SvgLine key={`bl${i}`} x1={xOf(f3, i + 1)} y1={yOf(f3, v)} x2={xOf(f3, i + 2)} y2={yOf(f3, nv)}
                  stroke={nv < 0 ? t.danger : t.primary} strokeWidth={2.5} strokeLinecap="round" />;
              })}
              {days.map(d => data.incomeDays?.[String(d)] && d <= lastDay && balVals[d - 1] != null ? (
                <Circle key={`inc${d}`} cx={xOf(f3, d)} cy={yOf(f3, balVals[d - 1] as number)} r={4.5} fill={t.gold} stroke={t.surface} strokeWidth={2} />
              ) : null)}
              {selD && selD <= lastDay && balVals[selD - 1] != null && (
                <Tip f={f3} t={t} day={selD} rows={[
                  { label: dayLabel(selD), value: '' },
                  { c: (balVals[selD - 1] as number) < 0 ? t.danger : t.primary, label: 'Остаток', value: fmt(balVals[selD - 1] as number) },
                  ...(data.incomeDays?.[String(selD)] ? [{ c: t.gold, label: 'Поступления', value: fmt(data.incomeDays[String(selD)]) }] : []),
                ]} />
              )}
            </Svg>
          </Scrub>
          <Legend items={[{ kind: 'line', label: 'Остаток' }, { kind: 'gold', label: 'Поступления' }]} />
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg, marginBottom: spacing.sm },
  kpi: { minWidth: 90 },
  kpiL: { fontSize: 12 },
  kpiV: { fontSize: font.lg, fontWeight: '800', marginTop: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, columnGap: 14, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.sm, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.sm },
  alertDot: { width: 7, height: 7, borderRadius: 4 },
});
