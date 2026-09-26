import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useTheme, spacing, radius } from '../theme';
import { useCategories } from '../categories';
import { Card } from './Card';
import { SectionTitle } from './UI';
import { haptics } from '../haptics';

// «Расходы за 6 месяцев»: столбик месяца = топ-3 его категорий своими цветами
// (цвет закреплён за категорией, чтобы было видно, как меняется топ) + всё
// остальное одним серым. Тап по месяцу — разбор: итог, изменение к прошлому
// месяцу, категории с долями и динамикой.

export type MonthAgg = { m: number; y: number; total: number; byCategory: Record<string, number> };

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const kFmt = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}м` : v >= 1000 ? `${Math.round(v / 1000)}к` : String(Math.round(v));
const BAR_H = 120;

function top3(bc: Record<string, number>) {
  return Object.entries(bc).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);
}

export function SixMonths({ months }: { months: MonthAgg[] }) {
  const t = useTheme();
  const { icon } = useCategories();
  const [sel, setSel] = useState(months.length - 1);

  // Палитра категорий: серии темы + три запасных, в порядке веса за полгода
  const palette = useMemo(() => [...t.series, t.goldDeep, t.scheme === 'dark' ? '#6FA8FF' : '#2F7AE0', t.scheme === 'dark' ? '#FF9A6B' : '#D8662E'], [t]);
  const colorOf = useMemo(() => {
    const inTop = new Set(months.flatMap(mo => top3(mo.byCategory)));
    const weight = (c: string) => months.reduce((s, mo) => s + (mo.byCategory[c] || 0), 0);
    const order = [...inTop].sort((a, b) => weight(b) - weight(a));
    const map: Record<string, string> = {};
    order.forEach((c, i) => { map[c] = palette[i % palette.length]; });
    return map;
  }, [months, palette]);
  const other = t.scheme === 'dark' ? '#4A4566' : '#CFC9E3';

  const max = Math.max(...months.map(mo => mo.total), 1);
  const cur = months[sel];
  const prev = sel > 0 ? months[sel - 1] : null;
  const delta = prev && prev.total > 0 ? Math.round((cur.total - prev.total) / prev.total * 100) : null;
  const cats = Object.entries(cur?.byCategory ?? {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const curTop = new Set(top3(cur?.byCategory ?? {}));
  const shown = cats.slice(0, 5);
  const rest = cats.slice(5);
  const restSum = rest.reduce((s, [, v]) => s + v, 0);
  const legend = Object.keys(colorOf);

  return (
    <Card>
      <SectionTitle>Расходы за 6 месяцев</SectionTitle>

      <View style={styles.chart}>
        {months.map((mo, i) => {
          const top = top3(mo.byCategory);
          const topSum = top.reduce((s, c) => s + (mo.byCategory[c] || 0), 0);
          const h = mo.total / max * BAR_H;
          const active = i === sel;
          return (
            <Pressable key={`${mo.y}-${mo.m}`} style={styles.col} onPress={() => { haptics.select(); setSel(i); }}
              accessibilityRole="button" accessibilityLabel={`${MONTHS[mo.m - 1]}: ${fmt(mo.total)}`}>
              <Text style={{ fontSize: 11, fontWeight: active ? '800' : '600', color: active ? t.text : t.textFaint, marginBottom: 4 }}>
                {mo.total > 0 ? kFmt(mo.total) : ''}
              </Text>
              <View style={[styles.barWrap, { height: BAR_H }]}>
                <View style={[styles.bar, { height: Math.max(h, mo.total > 0 ? 3 : 0), opacity: active ? 1 : 0.55 }]}>
                  {mo.total - topSum > 0 && <View style={{ flex: mo.total - topSum, backgroundColor: other }} />}
                  {[...top].reverse().map(c => (
                    <View key={c} style={{ flex: mo.byCategory[c], backgroundColor: colorOf[c], borderTopWidth: 1, borderTopColor: t.surface }} />
                  ))}
                </View>
              </View>
              <Text style={{ fontSize: 12, marginTop: 6, fontWeight: active ? '800' : '500', color: active ? t.primary : t.textMuted }}>
                {MONTHS[mo.m - 1].slice(0, 3)}
              </Text>
              {active && <View style={[styles.selDot, { backgroundColor: t.gold }]} />}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.legend}>
        {legend.map(c => (
          <View key={c} style={styles.legendItem}>
            <View style={[styles.sq, { backgroundColor: colorOf[c] }]} />
            <Text style={{ color: t.textMuted, fontSize: 12 }}>{c}</Text>
          </View>
        ))}
        <View style={styles.legendItem}>
          <View style={[styles.sq, { backgroundColor: other }]} />
          <Text style={{ color: t.textMuted, fontSize: 12 }}>Остальное</Text>
        </View>
      </View>

      {cur && (
        <Animated.View key={sel} entering={FadeIn.duration(180)} style={[styles.detail, { backgroundColor: t.surface2, borderColor: t.border }]}>
          <View style={styles.detailHead}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '800', flex: 1 }}>{MONTHS[cur.m - 1]} {cur.y}</Text>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '800' }}>{fmt(cur.total)}</Text>
          </View>
          {delta !== null && prev && (
            <Text style={{ color: delta > 0 ? t.danger : t.success, fontSize: 13, fontWeight: '600', marginTop: 2 }}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {Math.abs(delta)}% к {MONTHS_DAT[prev.m - 1]}
              <Text style={{ color: t.textMuted, fontWeight: '400' }}> ({delta > 0 ? '+' : ''}{fmt(cur.total - prev.total)})</Text>
            </Text>
          )}
          {cats.length === 0 && <Text style={{ color: t.textMuted, marginTop: spacing.sm }}>Расходов нет</Text>}
          <View style={{ marginTop: spacing.sm }}>
            {shown.map(([c, v]) => {
              const pv = prev?.byCategory[c] || 0;
              const d = pv > 0 ? Math.round((v - pv) / pv * 100) : null;
              return (
                <View key={c} style={[styles.row, { borderTopColor: t.border }]}>
                  <View style={[styles.sq, { backgroundColor: curTop.has(c) ? colorOf[c] : other }]} />
                  <Text style={{ fontSize: 15 }}>{icon(c)}</Text>
                  <Text style={{ color: t.text, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                    {c}<Text style={{ color: t.textFaint, fontSize: 12, fontWeight: '400' }}>  {Math.round(v / Math.max(1, cur.total) * 100)}%</Text>
                  </Text>
                  <Text style={{ color: t.text, fontSize: 14, fontWeight: '700', textAlign: 'right' }}>{fmt(v)}</Text>
                  <Text style={{ fontSize: 11, fontWeight: '700', width: 44, textAlign: 'right',
                    color: d === null ? t.textFaint : d > 10 ? t.danger : d < -10 ? t.success : t.textMuted }}>
                    {d === null ? 'новая' : `${d > 0 ? '▲' : d < 0 ? '▼' : ''}${Math.abs(d)}%`}
                  </Text>
                </View>
              );
            })}
            {rest.length > 0 && (
              <View style={[styles.row, { borderTopColor: t.border }]}>
                <View style={[styles.sq, { backgroundColor: other }]} />
                <Text style={{ color: t.textMuted, fontSize: 14, flex: 1 }} numberOfLines={1}>
                  Ещё {rest.length} {rest.length === 1 ? 'категория' : rest.length < 5 ? 'категории' : 'категорий'}
                </Text>
                <Text style={{ color: t.textMuted, fontSize: 14, fontWeight: '700', textAlign: 'right' }}>{fmt(restSum)}</Text>
                <View style={{ width: 44 }} />
              </View>
            )}
          </View>
          {prev && <Text style={{ color: t.textFaint, fontSize: 11, marginTop: spacing.sm }}>▲▼ — изменение категории к прошлому месяцу</Text>}
        </Animated.View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  col: { flex: 1, alignItems: 'center' },
  barWrap: { width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6, overflow: 'hidden' },
  selDot: { width: 5, height: 5, borderRadius: 3, marginTop: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, columnGap: 14, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sq: { width: 10, height: 10, borderRadius: 3 },
  detail: { marginTop: spacing.md, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
});
