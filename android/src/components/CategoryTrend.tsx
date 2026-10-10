import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line as SvgLine, Text as SvgText, Circle } from 'react-native-svg';
import { useTheme, spacing, font } from '../theme';
import { Card } from './Card';
import { SectionTitle } from './UI';
import { expenses as expApi, type Expense } from '../api/client';

// Карточка категории: накопленные траты по дням за выбранный месяц (сплошная
// линия) против трёх прошлых месяцев (пунктир своим цветом). Видно, обгоняет ли
// категория обычный темп. Повторяет categoryTrend() в public/app.js.

const W = 340, H = 190;
const PL = 38, PR = 10, TOP = 12, PB = 22;
const PREV = 3;
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const kFmt = (v: number) => v >= 1_000_000 ? `${+(v / 1e6).toFixed(2)}м` : v >= 1000 ? `${Math.round(v / 1000)}к` : String(Math.round(v));
const shift = (m: number, y: number, d: number) => { const t = new Date(y, m - 1 + d, 1); return { m: t.getMonth() + 1, y: t.getFullYear() }; };
const dim = (m: number, y: number) => new Date(y, m, 0).getDate();

// Накопительная сумма по дням месяца
function cumulative(list: Expense[], days: number, upTo: number): Array<number | null> {
  const daily = new Array(days).fill(0);
  for (const e of list) {
    const d = parseInt(e.date?.split('.')[0] ?? '', 10);
    if (d >= 1 && d <= days) daily[d - 1] += e.amount || 0;
  }
  let acc = 0;
  return daily.map((v, i) => { acc += v; return i < upTo ? acc : null; });
}

export function CategoryTrend({ cat, month, year, user, current }: {
  cat: string; month: number; year: number; user: string | null; current: Expense[];
}) {
  const t = useTheme();
  const [prev, setPrev] = useState<Array<{ m: number; y: number; list: Expense[] }>>([]);

  useEffect(() => {
    let alive = true;
    setPrev([]);
    const months = Array.from({ length: PREV }, (_, i) => shift(month, year, -(i + 1)));
    Promise.all(months.map(({ m, y }) => expApi.byCategory(cat, m, y)
      .then(list => ({ m, y, list: Array.isArray(list) ? list : [] }))
      .catch(() => ({ m, y, list: [] as Expense[] }))))
      .then(r => { if (alive) setPrev(r); });
    return () => { alive = false; };
  }, [cat, month, year]);

  const now = new Date();
  const isCurrent = now.getMonth() + 1 === month && now.getFullYear() === year;
  const days = 31;
  const today = isCurrent ? now.getDate() : dim(month, year);
  const by = (l: Expense[]) => user ? l.filter(e => e.user === user) : l;

  const lines = useMemo(() => {
    const colors = [t.series[1], t.series[2], t.textFaint];
    return [
      { label: MONTHS[month - 1], cum: cumulative(by(current), days, today), color: t.primary, dashed: false },
      ...prev.map((p, i) => ({ label: MONTHS[p.m - 1], cum: cumulative(by(p.list), days, dim(p.m, p.y)), color: colors[i % colors.length], dashed: true })),
    ];
  }, [current, prev, user, month, year, t]);

  const totals = lines.map(l => l.cum.reduce<number>((mx, v) => v != null && v > mx ? v : mx, 0));
  const yMax = Math.max(1, ...totals) * 1.08;
  const x = (d: number) => PL + (d - 1) / (days - 1) * (W - PL - PR);
  const y = (v: number) => TOP + (H - TOP - PB) * (1 - v / yMax);
  const path = (cum: Array<number | null>) => cum.reduce((s, v, i) => v == null ? s : `${s}${s ? 'L' : 'M'}${x(i + 1).toFixed(1)} ${y(v).toFixed(1)}`, '');

  // Сравнение «к этому дню» со средним за прошлые месяцы, где были траты
  const nowVal = lines[0].cum[today - 1] ?? 0;
  // в коротком месяце (февраль) к 30-му значения нет — берём последнее известное
  const at = (cum: Array<number | null>, d: number) => { for (let i = d - 1; i >= 0; i--) if (cum[i] != null) return cum[i] as number; return 0; };
  const past = lines.slice(1).map(l => at(l.cum, today));
  const avg = past.length ? past.reduce((a, b) => a + b, 0) / past.length : 0;
  const delta = avg > 0 ? Math.round((nowVal / avg - 1) * 100) : null;

  return (
    <Card>
      <SectionTitle>По дням против прошлых месяцев</SectionTitle>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        {[0, 1, 2, 3, 4].map(k => {
          const v = yMax * k / 4;
          return (
            <React.Fragment key={k}>
              <SvgLine x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke={t.border} strokeWidth={1} />
              <SvgText x={PL - 6} y={y(v) + 3.5} fontSize={10} fill={t.textFaint} textAnchor="end">{kFmt(v)}</SvgText>
            </React.Fragment>
          );
        })}
        {[1, 5, 10, 15, 20, 25, 30].map(d => (
          <SvgText key={d} x={x(d)} y={H - 6} fontSize={10} fill={t.textFaint} textAnchor="middle">{String(d)}</SvgText>
        ))}
        {/* прошлые месяцы — пунктир, под текущим */}
        {lines.slice(1).reverse().map(l => (
          <Path key={l.label} d={path(l.cum)} stroke={l.color} strokeWidth={2} strokeDasharray="5 4" fill="none" opacity={0.85} />
        ))}
        {lines[0].cum.some(v => v) && (
          <Path d={`${path(lines[0].cum)} L${x(today)} ${y(0)} L${x(1)} ${y(0)} Z`} fill={t.primary} opacity={0.1} />
        )}
        <Path d={path(lines[0].cum)} stroke={t.primary} strokeWidth={2.8} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {nowVal > 0 && <Circle cx={x(today)} cy={y(nowVal)} r={4} fill={t.primary} stroke={t.surface} strokeWidth={2} />}
      </Svg>
      <View style={styles.legend}>
        {lines.map((l, i) => (
          <View key={l.label + i} style={styles.item}>
            <View style={[styles.swatch, { borderColor: l.color, borderStyle: l.dashed ? 'dashed' : 'solid', borderTopWidth: l.dashed ? 2 : 3 }]} />
            <Text style={{ color: i === 0 ? t.text : t.textMuted, fontSize: 12, fontWeight: i === 0 ? '700' : '400' }}>
              {l.label} · {fmt(totals[i])}{i === 0 && isCurrent ? ' (пока)' : ''}
            </Text>
          </View>
        ))}
      </View>
      {prev.length > 0 && delta != null && (
        <Text style={{ color: delta > 10 ? t.danger : delta < -10 ? t.success : t.textMuted, fontSize: font.sm, marginTop: spacing.sm }}>
          {isCurrent ? `На ${today}-е` : 'За месяц'}: {fmt(nowVal)}, обычно {isCurrent ? 'к этому дню ' : ''}{fmt(avg)}
          {delta === 0 ? ' — как обычно' : ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)}%)`}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 18, height: 0 },
});
