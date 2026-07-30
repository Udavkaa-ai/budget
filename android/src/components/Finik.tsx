import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View, ViewStyle } from 'react-native';
import Svg, {
  Defs, LinearGradient, RadialGradient, Stop, G, Path, Ellipse, Circle, Rect, Line, Text as SvgText,
} from 'react-native-svg';

// Маскот «Финик» — семейный бухгалтер. Эмоции 1:1 с вебом (public/app.js).
export type FinikEmotion =
  | 'idle' | 'record' | 'income' | 'overspend' | 'grumpy' | 'scold' | 'goal'
  | 'thinking' | 'walk' | 'spy' | 'fix' | 'inspect' | 'wave' | 'plus';

const AG = Animated.createAnimatedComponent(G);

type Feat = {
  mouth: 'smile' | 'grin' | 'frown' | 'focus' | 'flat' | 'smirk';
  browAngle?: number; browRdy?: number; browDy?: number;
  cheeks?: boolean; armL?: number; armR?: number;
  props?: string[]; // coin|pencil|ledger|sweat|confetti|sparkle|think|shades|wrench|magnifier
};

const FEATURES: Record<FinikEmotion, Feat> = {
  idle:      { mouth: 'smile' },
  walk:      { mouth: 'smile' },
  record:    { mouth: 'focus', armR: 24, props: ['ledger', 'pencil'] },
  income:    { mouth: 'grin', cheeks: true, browDy: -3, armR: -38, props: ['coin', 'sparkle'] },
  overspend: { mouth: 'frown', browAngle: 14, browRdy: -4, armR: -58, props: ['sweat'] },
  grumpy:    { mouth: 'frown', browAngle: 16, browRdy: -3 },
  scold:     { mouth: 'frown', browAngle: 16, browRdy: -3, armL: 60, armR: -60 },
  goal:      { mouth: 'grin', cheeks: true, browDy: -4, armL: 48, armR: -48, props: ['confetti', 'sparkle'] },
  thinking:  { mouth: 'flat', browRdy: -4, armR: -72, props: ['think'] },
  spy:       { mouth: 'smirk', browDy: -2, props: ['shades'] },
  fix:       { mouth: 'focus', armR: -26, props: ['wrench'] },
  inspect:   { mouth: 'flat', browRdy: -4, armR: -40, props: ['coin', 'magnifier'] },
  wave:      { mouth: 'grin', cheeks: true, browDy: -3, armR: -78 },
  plus:      { mouth: 'smile', armL: 52, armR: -52, props: ['plus'] },
};

const DUR: Record<FinikEmotion, number> = {
  idle: 1700, walk: 250, record: 1700, income: 430, overspend: 260, grumpy: 1700,
  scold: 150, goal: 360, thinking: 1100, spy: 1700, fix: 500, inspect: 2400,
  wave: 500, plus: 1700,
};

function motionStyle(emotion: FinikEmotion, v: Animated.Value) {
  const rot = (a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [`${a}deg`, `${b}deg`] });
  const y = (a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  const s = (a: number, b: number) => v.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  switch (emotion) {
    case 'income':    return { transform: [{ translateY: y(0, -9) }] };
    case 'goal':      return { transform: [{ translateY: y(0, -18) }, { scale: s(1, 1.04) }] };
    case 'overspend': return { transform: [{ rotate: rot(-3, 3) }] };
    case 'scold':     return { transform: [{ rotate: rot(-3, 3) }, { translateX: y(-2, 2) }] };
    case 'thinking':  return { transform: [{ rotate: rot(-2, 3) }] };
    case 'inspect':   return { transform: [{ rotate: rot(0, 3) }] };
    case 'fix':       return { transform: [{ rotate: rot(-2, 3) }] };
    case 'wave':      return { transform: [{ rotate: rot(-4, 4) }] };
    case 'walk':      return { transform: [{ translateY: y(0, -4) }] };
    default:          return { transform: [{ scale: s(1, 1.03) }] }; // дыхание
  }
}

// Пулы для случайных фиджетов и реакций на тап (через кратковременную смену эмоции)
const FIDGETS: FinikEmotion[] = ['income', 'inspect', 'goal', 'spy'];
const TAPS: FinikEmotion[] = ['goal', 'income', 'inspect', 'spy'];

export function Finik({
  emotion = 'idle', size = 120, style, interactive = true,
}: { emotion?: FinikEmotion; size?: number; style?: ViewStyle; interactive?: boolean }) {
  const v = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(0)).current;
  const [fx, setFx] = useState<FinikEmotion | null>(null);
  const shown = fx ?? emotion;

  // базовое движение под текущую (показываемую) эмоцию
  useEffect(() => {
    v.setValue(0);
    const dur = DUR[shown] ?? 1700;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [shown, v]);

  // моргание
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(3200),
      Animated.timing(blink, { toValue: 1, duration: 80, useNativeDriver: false }),
      Animated.timing(blink, { toValue: 0, duration: 90, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [blink]);

  // idle-фиджеты: раз в 6–16с спокойный Финик делает случайное микродействие
  useEffect(() => {
    if (emotion !== 'idle' || !interactive) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(() => {
        if (!alive) return;
        setFx(FIDGETS[Math.floor(Math.random() * FIDGETS.length)]);
        setTimeout(() => alive && setFx(null), 1500);
        schedule();
      }, 6000 + Math.random() * 10000);
    };
    schedule();
    return () => { alive = false; clearTimeout(t); };
  }, [emotion, interactive]);

  const onPress = () => {
    setFx(TAPS[Math.floor(Math.random() * TAPS.length)]);
    setTimeout(() => setFx(null), 1300);
  };

  const f = FEATURES[shown] ?? FEATURES.idle;
  const browL = `translate(0 ${f.browDy ?? 0}) rotate(${f.browAngle ?? 0} 76 75)`;
  const browR = `translate(0 ${(f.browDy ?? 0) + (f.browRdy ?? 0)}) rotate(${-(f.browAngle ?? 0)} 124 75)`;
  const has = (p: string) => f.props?.includes(p);

  const svg = (
    <Animated.View style={[{ flex: 1 }, motionStyle(shown, v)]}>
      <Svg viewBox="0 0 200 210" width="100%" height="100%">
        <Defs>
          <LinearGradient id="fkBody" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#9B80FF" /><Stop offset="1" stopColor="#5947E0" />
          </LinearGradient>
          <RadialGradient id="fkBelly" cx="0.5" cy="0.4" r="0.7">
            <Stop offset="0" stopColor="#F3EFFF" /><Stop offset="1" stopColor="#DED3FF" />
          </RadialGradient>
        </Defs>

        <Ellipse cx="100" cy="196" rx="52" ry="9" fill="rgba(60,40,120,0.18)" />

        {has('confetti') && (
          <G>
            <Rect x="60" y="30" width="7" height="10" rx="2" fill="#FF7AB3" />
            <Rect x="98" y="22" width="7" height="10" rx="2" fill="#34C7A0" />
            <Rect x="134" y="32" width="7" height="10" rx="2" fill="#FFC24B" />
            <Rect x="80" y="26" width="7" height="10" rx="2" fill="#8A6BFF" />
            <Rect x="118" y="26" width="7" height="10" rx="2" fill="#FF7AB3" />
          </G>
        )}

        <G transform={`rotate(${f.armL ?? 0} 50 112)`}><Ellipse cx="46" cy="128" rx="13" ry="20" fill="#7C63F0" /><Circle cx="46" cy="147" r="9" fill="#8E76F5" /></G>
        <G transform={`rotate(${f.armR ?? 0} 150 112)`}><Ellipse cx="154" cy="128" rx="13" ry="20" fill="#7C63F0" /><Circle cx="154" cy="147" r="9" fill="#8E76F5" /></G>

        <Path d="M100 58 C142 58 160 90 160 128 C160 172 134 192 100 192 C66 192 40 172 40 128 C40 90 58 58 100 58 Z" fill="url(#fkBody)" />
        <Ellipse cx="80" cy="190" rx="13" ry="8" fill="#4A39C4" /><Ellipse cx="120" cy="190" rx="13" ry="8" fill="#4A39C4" />

        <Rect x="72" y="143" width="56" height="40" rx="12" fill="url(#fkBelly)" />
        <Line x1="82" y1="155" x2="118" y2="155" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />
        <Line x1="82" y1="164" x2="118" y2="164" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />
        <Line x1="82" y1="173" x2="104" y2="173" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />

        {f.cheeks && (<><Ellipse cx="66" cy="112" rx="9" ry="6" fill="#FF8FB8" /><Ellipse cx="134" cy="112" rx="9" ry="6" fill="#FF8FB8" /></>)}

        <Line x1="92" y1="96" x2="108" y2="96" stroke="#FFC24B" strokeWidth="4" />
        <Circle cx="79" cy="97" r="19" fill="#FFFFFF" /><Circle cx="121" cy="97" r="19" fill="#FFFFFF" />
        <Circle cx="79" cy="98" r="7.5" fill="#241C42" /><Circle cx="82" cy="95" r="2.4" fill="#fff" />
        <Circle cx="121" cy="98" r="7.5" fill="#241C42" /><Circle cx="124" cy="95" r="2.4" fill="#fff" />
        {/* моргание — веки */}
        <AG opacity={blink}>
          <Rect x="60" y="79" width="38" height="19" rx="9" fill="url(#fkBody)" />
          <Rect x="102" y="79" width="38" height="19" rx="9" fill="url(#fkBody)" />
        </AG>
        <Circle cx="79" cy="97" r="19" fill="none" stroke="#FFC24B" strokeWidth="4" />
        <Circle cx="121" cy="97" r="19" fill="none" stroke="#FFC24B" strokeWidth="4" />

        <G transform={browL}><Rect x="66" y="72" width="20" height="6" rx="3" fill="#3A2E80" /></G>
        <G transform={browR}><Rect x="114" y="72" width="20" height="6" rx="3" fill="#3A2E80" /></G>

        {f.mouth === 'smile' && <Path d="M88 126 Q100 136 112 126" stroke="#3A2E80" strokeWidth="4" fill="none" strokeLinecap="round" />}
        {f.mouth === 'grin' && <Path d="M86 124 Q100 142 114 124 Q100 132 86 124 Z" fill="#3A2E80" />}
        {f.mouth === 'frown' && <Path d="M88 132 Q100 123 112 132" stroke="#3A2E80" strokeWidth="4" fill="none" strokeLinecap="round" />}
        {f.mouth === 'focus' && <Ellipse cx="100" cy="128" rx="5" ry="4" fill="#3A2E80" />}
        {f.mouth === 'flat' && <Line x1="90" y1="128" x2="110" y2="128" stroke="#3A2E80" strokeWidth="4" strokeLinecap="round" />}
        {f.mouth === 'smirk' && <Path d="M89 128 Q100 133 113 126" stroke="#3A2E80" strokeWidth="4" fill="none" strokeLinecap="round" />}

        {has('coin') && (<G><Circle cx="170" cy="104" r="14" fill="#FFC24B" stroke="#E8A21F" strokeWidth="2.5" /><SvgText x="170" y="110" textAnchor="middle" fontSize="15" fontWeight="900" fill="#8a5a00">₽</SvgText></G>)}
        {has('pencil') && (<G><Rect x="150" y="150" width="8" height="34" rx="3" fill="#FFC24B" transform="rotate(24 154 167)" /><Path d="M150 182 l8 0 l-4 8 Z" fill="#3A2E80" transform="rotate(24 154 167)" /></G>)}
        {has('ledger') && (<G><Rect x="120" y="150" width="46" height="34" rx="5" fill="#fff" stroke="#DED3FF" strokeWidth="2" transform="rotate(-8 143 167)" /><Line x1="128" y1="160" x2="158" y2="158" stroke="#C9BBF5" strokeWidth="2.5" transform="rotate(-8 143 167)" /><Line x1="128" y1="168" x2="158" y2="166" stroke="#C9BBF5" strokeWidth="2.5" transform="rotate(-8 143 167)" /></G>)}
        {has('sweat') && <Path d="M150 78 q6 9 0 14 q-6 -5 0 -14 Z" fill="#4FC3F7" />}
        {has('sparkle') && (<G fill="#FFC24B"><Path d="M40 60 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" /><Path d="M168 150 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#FF7AB3" /></G>)}
        {has('think') && (<G fill="#5947E0"><Circle cx="150" cy="70" r="4" /><Circle cx="164" cy="58" r="5.5" /><Circle cx="180" cy="44" r="7" /></G>)}
        {has('shades') && (<G><Rect x="59" y="86" width="40" height="23" rx="10" fill="#15111f" /><Rect x="101" y="86" width="40" height="23" rx="10" fill="#15111f" /><Line x1="99" y1="93" x2="101" y2="93" stroke="#15111f" strokeWidth="6" /><Rect x="63" y="90" width="30" height="6" rx="3" fill="#4a3f6e" /><Rect x="105" y="90" width="30" height="6" rx="3" fill="#4a3f6e" /></G>)}
        {has('wrench') && (<G transform="rotate(28 168 150)"><Rect x="163" y="120" width="10" height="42" rx="4" fill="#AEB6C4" /><Path d="M168 112 a11 11 0 1 0 0 22 a11 11 0 1 0 0 -22 M162 116 h12 v9 h-12 Z" fill="#8892A6" /><Circle cx="168" cy="123" r="5" fill="#F1EDFF" /></G>)}
        {has('magnifier') && (<G><Circle cx="156" cy="100" r="17" fill="rgba(180,220,255,0.30)" stroke="#8892A6" strokeWidth="4" /><Rect x="168" y="112" width="8" height="22" rx="4" fill="#7a6a50" transform="rotate(42 172 123)" /></G>)}
        {has('plus') && (<G><Circle cx="100" cy="150" r="34" fill="#5947E0" /><Rect x="80" y="143" width="40" height="14" rx="7" fill="#fff" /><Rect x="93" y="130" width="14" height="40" rx="7" fill="#fff" /><Circle cx="72" cy="166" r="11" fill="#8E76F5" /><Circle cx="128" cy="166" r="11" fill="#8E76F5" /></G>)}
      </Svg>
    </Animated.View>
  );

  const box: ViewStyle = { width: size, height: size * 210 / 200 };
  return interactive
    ? <Pressable onPress={onPress} style={[box, style]}>{svg}</Pressable>
    : <View style={[box, style]}>{svg}</View>;
}
