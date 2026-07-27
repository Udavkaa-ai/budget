import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import Svg, {
  Path, Line as SvgLine, Circle, Polygon, Text as SvgText,
  Defs, LinearGradient, Stop, G,
} from 'react-native-svg';
import { useTheme, font } from '../theme';

const CX = 130, CY = 132, R = 96, MAX = 160, STROKE = 16;

// Точка на дуге: 0% слева (180°), максимум справа (0°)
function polar(r: number, pct: number) {
  const a = Math.PI * (1 - Math.min(Math.max(pct, 0), MAX) / MAX);
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}
function arc(r: number, from: number, to: number) {
  const s = polar(r, from), e = polar(r, to);
  const large = (to - from) / MAX > 0.5 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
}

// Барометр бюджета: ровный контур, зоны с градиентом, анимированные стрелка и число
export function BudgetGauge({ pct }: { pct: number }) {
  const t = useTheme();
  // Старт СРАЗУ со значения — без «раскрутки» с нуля. Иначе при листании
  // месяцев (пейджер пересоздаёт барометр) стрелка каждый раз прыгала
  // 0→…→pct. Анимируем только при РЕАЛЬНОЙ смене значения, от предыдущего.
  const [anim, setAnim] = useState(pct);
  const animRef = useRef(pct);
  const raf = useRef<number | null>(null);
  const startRef = useRef(0);

  useEffect(() => {
    const from = animRef.current;
    const target = pct;
    if (Math.abs(from - target) < 0.5) { animRef.current = target; setAnim(target); return; }
    startRef.current = Date.now();
    const dur = 500;
    const tick = () => {
      const k = Math.min((Date.now() - startRef.current) / dur, 1);
      const eased = 1 - Math.pow(1 - k, 3); // easeOutCubic
      const val = from + (target - from) * eased;
      animRef.current = val;
      setAnim(val);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [pct]);

  const shown = Math.round(anim);
  const color = pct <= 70 ? '#22c55e' : pct <= 100 ? '#f59e0b' : '#ef4444';
  const tip = polar(R - STROKE / 2 - 12, anim);
  // Направление стрелки и перпендикуляр — чтобы основание было конусом, а не точкой
  const ang = Math.PI * (1 - Math.min(Math.max(anim, 0), MAX) / MAX);
  const dir = { x: Math.cos(ang), y: -Math.sin(ang) };
  const perp = { x: -dir.y, y: dir.x };
  const BW = 6;
  const baseL = { x: CX + perp.x * BW, y: CY + perp.y * BW };
  const baseR = { x: CX - perp.x * BW, y: CY - perp.y * BW };
  const back = { x: CX - dir.x * 16, y: CY - dir.y * 16 };

  return (
    <View style={{ alignItems: 'center' }}>
      <Svg width="100%" height={168} viewBox="0 0 260 168">
        <Defs>
          <LinearGradient id="gGreen" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#34d399" /><Stop offset="1" stopColor="#16a34a" />
          </LinearGradient>
          <LinearGradient id="gAmber" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#fbbf24" /><Stop offset="1" stopColor="#f59e0b" />
          </LinearGradient>
          <LinearGradient id="gRed" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#f87171" /><Stop offset="1" stopColor="#dc2626" />
          </LinearGradient>
        </Defs>

        {/* Фон-дорожка с округлыми концами — задаёт единый аккуратный контур */}
        <Path d={arc(R, 0, MAX)} stroke={t.surface2} strokeWidth={STROKE + 4} fill="none" strokeLinecap="round" />
        {/* Зоны: стык встык (butt), концы прячутся за округлым фоном */}
        <Path d={arc(R, 0, 70)}    stroke="url(#gGreen)" strokeWidth={STROKE} fill="none" strokeLinecap="butt" />
        <Path d={arc(R, 70, 100)}  stroke="url(#gAmber)" strokeWidth={STROKE} fill="none" strokeLinecap="butt" />
        <Path d={arc(R, 100, MAX)} stroke="url(#gRed)"   strokeWidth={STROKE} fill="none" strokeLinecap="butt" />

        {/* Засечки на границах зон */}
        {[0, 70, 100, 160].map(v => {
          const a = polar(R + STROKE / 2 + 2, v), b = polar(R - STROKE / 2 - 2, v);
          return <SvgLine key={v} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={t.surface} strokeWidth={2} />;
        })}

        {/* Стрелка-треугольник + хвостик */}
        <G>
          <SvgLine x1={CX} y1={CY} x2={back.x} y2={back.y} stroke={t.text} strokeWidth={4} strokeLinecap="round" />
          <Polygon points={`${tip.x},${tip.y} ${baseL.x},${baseL.y} ${baseR.x},${baseR.y}`} fill={t.text} />
          <Circle cx={CX} cy={CY} r={9} fill={t.text} />
          <Circle cx={CX} cy={CY} r={4} fill={t.surface} />
        </G>

        {/* Подписи */}
        {([[0, '0%'], [70, '70%'], [100, '100%'], [160, '160%']] as const).map(([v, lbl]) => {
          const p = polar(R + STROKE / 2 + 12, v);
          return <SvgText key={v} x={p.x} y={p.y + 3} fontSize={11} fontWeight="600" fill={t.textMuted} textAnchor="middle">{lbl}</SvgText>;
        })}
      </Svg>

      <Text style={{ fontSize: 38, fontWeight: '800', marginTop: 2, color }}>{shown}%</Text>
      <Text style={{ color: t.textMuted, fontSize: font.xs, letterSpacing: 0.5 }}>ФАКТ / ПЛАН</Text>
      <Text style={{ color: t.text, fontSize: font.sm, marginTop: 2, fontWeight: '600' }}>
        {pct > 100 ? 'Перерасход 🔴' : pct > 90 ? 'На грани 🟡' : 'В норме 🟢'}
      </Text>
    </View>
  );
}
