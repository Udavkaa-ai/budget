import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedProps, useAnimatedReaction, useReducedMotion,
  withSpring, withRepeat, withSequence, withTiming, runOnJS, cancelAnimation,
} from 'react-native-reanimated';
import Svg, { Path, Line as SvgLine, Circle, G, Text as SvgText, type GProps } from 'react-native-svg';
import { useTheme, font, radius, spacing } from '../theme';
import { Finik, type FinikEmotion } from './Finik';
import { StatusChip } from './UI';

// Спидометр темпа трат — 1:1 с вебом (renderSpeedometer в public/app.js).
// Полукруг 180°, шкала 0–150% от нормы трат на сегодня. Зоны совпадают с
// ИИ-анализом: ≤85% — экономим, 85–100% — в графике, 100–110% — выше плана,
// >110% — перерасход. Стрелка — недодемпфированная пружина (разгон, лёгкий
// перелёт, успокоение); при перерасходе мелко дрожит.
const CX = 120, CY = 118, R = 90, SW = 14, MAX = 150, LOW = 85, PLAN = 100, HIGH = 110;
const ARC_LEN = Math.PI * R;

type Zone = 'good' | 'ok' | 'warn' | 'over';
export function gaugeZone(pct: number): Zone {
  return pct <= LOW ? 'good' : pct <= PLAN ? 'ok' : pct <= HIGH ? 'warn' : 'over';
}
const ZONE_TEXT: Record<Zone, string> = { good: 'Экономим', ok: 'В графике', warn: 'Выше плана', over: 'Перерасход' };

const angle = (v: number) => 180 - (Math.max(0, Math.min(MAX, v)) / MAX) * 180;
function pt(v: number, r: number): [number, number] {
  const a = angle(v) * Math.PI / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}
function arc(v1: number, v2: number, r: number) {
  const [x1, y1] = pt(v1, r), [x2, y2] = pt(v2, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

Animated.addWhitelistedUIProps({ matrix: true });
const AG = Animated.createAnimatedComponent(G as unknown as React.ComponentClass<GProps & { matrix?: number[] }>);
const APath = Animated.createAnimatedComponent(Path);

// Стрелка начинает с прошлого показания — при возврате на экран не «раскручивается» с нуля
let lastShown = 0;

const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';

export function BudgetGauge({ pct, spent, norm, plan, daysPassed, daysInMonth }: {
  pct: number; spent: number; norm: number; plan: number; daysPassed: number; daysInMonth: number;
}) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const zone = gaugeZone(pct);
  const color = { good: t.success, ok: t.primary, warn: t.warning, over: t.danger }[zone];
  const target = Math.min(pct, MAX);
  const projected = daysPassed > 0 ? Math.round(spent / daysPassed * daysInMonth) : spent;

  const v = useSharedValue(lastShown);
  const [shown, setShown] = useState(Math.round(lastShown));

  useEffect(() => {
    cancelAnimation(v);
    lastShown = target;
    if (reduce) { v.value = target; return; }
    // ω≈8.5, ζ≈0.42 — как в вебе
    v.value = withSpring(target, { stiffness: 72, damping: 7.1, mass: 1 }, done => {
      'worklet';
      if (done && zone === 'over') {
        v.value = withRepeat(withSequence(
          withTiming(target + 0.5, { duration: 55 }),
          withTiming(target - 0.45, { duration: 70 }),
        ), -1, true);
      }
    });
  }, [target, zone, reduce, v]);

  useAnimatedReaction(() => Math.round(Math.max(0, Math.min(MAX, v.value))), (cur, prev) => {
    if (cur !== prev) runOnJS(setShown)(cur);
  });

  const needleProps = useAnimatedProps(() => {
    const c = Math.max(0, Math.min(MAX, v.value));
    const a = (c / MAX * 180 - 90) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    return { matrix: [cos, sin, -sin, cos, CX - cos * CX + sin * CY, CY - sin * CX - cos * CY] };
  });
  const arcProps = useAnimatedProps(() => {
    const c = Math.max(0, Math.min(MAX, v.value));
    return { strokeDashoffset: ARC_LEN * (1 - c / MAX) };
  });

  // Финик: выше плана — волнуется, перерасход — ругается, потом стоит угрюмый
  const calm: FinikEmotion = zone === 'good' ? 'income' : zone === 'warn' ? 'overspend' : zone === 'over' ? 'scold' : 'idle';
  const [emo, setEmo] = useState<FinikEmotion>(calm);
  useEffect(() => {
    setEmo(calm);
    if (zone !== 'over') return;
    const id = setTimeout(() => setEmo('grumpy'), 2300);
    return () => clearTimeout(id);
  }, [zone, calm]);

  // Деления: мелкие каждые 10%, крупные с подписями — 0/50/100/150
  const ticks: React.ReactNode[] = [];
  for (let val = 0; val <= MAX; val += 10) {
    const major = val % 50 === 0;
    const [x1, y1] = pt(val, R + SW / 2 + 3), [x2, y2] = pt(val, R + SW / 2 + (major ? 10 : 6));
    ticks.push(<SvgLine key={`t${val}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={major ? t.text : t.textFaint}
      strokeWidth={major ? 2 : 1.2} strokeLinecap="round" opacity={major ? 0.55 : 0.5} />);
    if (major) {
      const end = val === 0 || val === MAX;
      const [lx, ly] = end ? [val === 0 ? CX - R : CX + R, CY + SW / 2 + 14] : pt(val, R + SW / 2 + 21);
      ticks.push(<SvgText key={`l${val}`} x={lx} y={ly + (end ? 0 : 3.5)} textAnchor="middle" fontSize={10.5} fontWeight="700"
        fill={val === 100 ? t.goldDeep : t.textMuted}>{`${val}%`}</SvgText>);
    }
  }
  // «застёжка» на дорожке шкалы у отметки 100% = план
  const [kx, ky] = pt(100, R);
  const ka = (90 - angle(100)) * Math.PI / 180;
  const kdx = 4.2 * Math.cos(ka), kdy = 4.2 * Math.sin(ka);
  const band = (a: number, b: number, c: string) =>
    <Path d={arc(a, b, R - SW / 2 - 3)} fill="none" stroke={c} strokeWidth={3} strokeLinecap="round" opacity={0.75} />;

  return (
    <View>
      <Svg width="100%" height={210} viewBox="0 0 240 176" accessibilityLabel={`Темп трат: ${pct}% от нормы, ${ZONE_TEXT[zone].toLowerCase()}`}>
        <Path d={arc(0, MAX, R)} fill="none" stroke={t.surface3} strokeWidth={SW} strokeLinecap="round" />
        {band(1, LOW - 1.5, t.success)}{band(LOW + 1.5, PLAN - 1.5, t.primary)}
        {band(PLAN + 1.5, HIGH - 1.5, t.warning)}{band(HIGH + 1.5, MAX - 1, t.danger)}
        <APath d={arc(0, MAX, R)} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round"
          strokeDasharray={[ARC_LEN, ARC_LEN]} animatedProps={arcProps} />
        {ticks}
        <Circle cx={kx - kdx} cy={ky - kdy} r={3.6} fill={t.gold} stroke={t.surface} strokeWidth={1.6} />
        <Circle cx={kx + kdx} cy={ky + kdy} r={3.6} fill={t.gold} stroke={t.surface} strokeWidth={1.6} />
        <AG animatedProps={needleProps}>
          <Path d={`M ${CX - 5} ${CY} L ${CX - 1} ${CY - R + 22} Q ${CX} ${CY - R + 19} ${CX + 1} ${CY - R + 22} L ${CX + 5} ${CY} Z`} fill={t.text} />
        </AG>
        <Circle cx={CX} cy={CY} r={9} fill={t.surface} stroke={t.text} strokeWidth={2.5} />
        <Circle cx={CX} cy={CY} r={3.2} fill={t.gold} />
        <SvgText x={CX} y={CY + 33} textAnchor="middle" fontSize={25} fontWeight="800" fill={color}>{`${pct > MAX ? pct : shown}%`}</SvgText>
        <SvgText x={CX} y={CY + 49} textAnchor="middle" fontSize={10} fill={t.textMuted}>от нормы трат на сегодня</SvgText>
      </Svg>

      <View style={styles.verdictRow}>
        <Finik emotion={emo} size={72} />
        <StatusChip kind={zone} label={ZONE_TEXT[zone]} />
      </View>

      <View style={styles.stats}>
        {[
          ['Потрачено', fmt(spent), false],
          ['Норма на сегодня', fmt(norm), false],
          ['Прогноз на месяц', fmt(projected), projected > plan],
        ].map(([l, val, bad]) => (
          <View key={String(l)} style={[styles.stat, { backgroundColor: t.surface2, borderColor: t.border }]}>
            <Text style={{ color: t.textMuted, fontSize: 11, textAlign: 'center' }} numberOfLines={2}>{l}</Text>
            <Text style={{ color: bad ? t.danger : t.text, fontSize: font.sm, fontWeight: '800', marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>{val}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: t.textFaint, fontSize: 12, textAlign: 'center', marginTop: spacing.sm }}>
        День {daysPassed} из {daysInMonth} · план на месяц {fmt(plan)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  verdictRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 2 },
  stats: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
});
