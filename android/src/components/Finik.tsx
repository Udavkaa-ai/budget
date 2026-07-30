import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View, ViewStyle } from 'react-native';
import Svg, {
  Defs, LinearGradient, RadialGradient, Stop, G, Path, Ellipse, Circle, Rect, Line, Text as SvgText,
} from 'react-native-svg';

// Маскот «Финик» — семейный бухгалтер. Эмоции 1:1 с вебом (public/app.js).
export type FinikEmotion =
  | 'idle' | 'record' | 'income' | 'overspend' | 'grumpy' | 'scold' | 'goal' | 'thinking' | 'walk';

type Feat = {
  mouth: 'smile' | 'grin' | 'frown' | 'focus' | 'flat';
  browAngle?: number;   // симметричный наклон (внутренние концы вниз при >0)
  browRdy?: number;     // доп. подъём правой брови
  browDy?: number;      // обе брови вверх
  cheeks?: boolean;
  armL?: number; armR?: number; // поворот рук (deg)
  props?: string[];     // coin | pencil | ledger | sweat | confetti | sparkle | think
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
};

// Длительность полукадра «дыхания»/жеста
const DUR: Record<FinikEmotion, number> = {
  idle: 1700, walk: 250, record: 1700, income: 430, overspend: 260,
  grumpy: 1700, scold: 150, goal: 360, thinking: 1100,
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
    case 'walk':      return { transform: [{ translateY: y(0, -4) }] };
    default:          return { transform: [{ scale: s(1, 1.03) }] }; // idle / record / grumpy — дыхание
  }
}

export function Finik({ emotion = 'idle', size = 120, style }: { emotion?: FinikEmotion; size?: number; style?: ViewStyle }) {
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    v.setValue(0);
    const dur = DUR[emotion] ?? 1700;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [emotion, v]);

  const f = FEATURES[emotion] ?? FEATURES.idle;
  const browL = `translate(0 ${f.browDy ?? 0}) rotate(${f.browAngle ?? 0} 76 75)`;
  const browR = `translate(0 ${(f.browDy ?? 0) + (f.browRdy ?? 0)}) rotate(${-(f.browAngle ?? 0)} 124 75)`;
  const has = (p: string) => f.props?.includes(p);

  return (
    <View style={[{ width: size, height: size * 210 / 200 }, style]}>
      <Animated.View style={[{ flex: 1 }, motionStyle(emotion, v)]}>
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

          {/* руки (за телом) */}
          <G transform={`rotate(${f.armL ?? 0} 50 112)`}><Ellipse cx="46" cy="128" rx="13" ry="20" fill="#7C63F0" /></G>
          <G transform={`rotate(${f.armR ?? 0} 150 112)`}><Ellipse cx="154" cy="128" rx="13" ry="20" fill="#7C63F0" /></G>

          {/* тело */}
          <Path d="M100 58 C142 58 160 90 160 128 C160 172 134 192 100 192 C66 192 40 172 40 128 C40 90 58 58 100 58 Z" fill="url(#fkBody)" />
          <Ellipse cx="80" cy="190" rx="13" ry="8" fill="#4A39C4" /><Ellipse cx="120" cy="190" rx="13" ry="8" fill="#4A39C4" />

          {/* живот-книга (ниже линии рта) */}
          <Rect x="72" y="143" width="56" height="40" rx="12" fill="url(#fkBelly)" />
          <Line x1="82" y1="155" x2="118" y2="155" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />
          <Line x1="82" y1="164" x2="118" y2="164" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />
          <Line x1="82" y1="173" x2="104" y2="173" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />

          {f.cheeks && (<><Ellipse cx="66" cy="112" rx="9" ry="6" fill="#FF8FB8" /><Ellipse cx="134" cy="112" rx="9" ry="6" fill="#FF8FB8" /></>)}

          {/* очки + глаза */}
          <Line x1="92" y1="96" x2="108" y2="96" stroke="#FFC24B" strokeWidth="4" />
          <Circle cx="79" cy="97" r="19" fill="#FFFFFF" /><Circle cx="121" cy="97" r="19" fill="#FFFFFF" />
          <Circle cx="79" cy="98" r="7.5" fill="#241C42" /><Circle cx="82" cy="95" r="2.4" fill="#fff" />
          <Circle cx="121" cy="98" r="7.5" fill="#241C42" /><Circle cx="124" cy="95" r="2.4" fill="#fff" />
          <Circle cx="79" cy="97" r="19" fill="none" stroke="#FFC24B" strokeWidth="4" />
          <Circle cx="121" cy="97" r="19" fill="none" stroke="#FFC24B" strokeWidth="4" />

          {/* брови */}
          <G transform={browL}><Rect x="66" y="72" width="20" height="6" rx="3" fill="#3A2E80" /></G>
          <G transform={browR}><Rect x="114" y="72" width="20" height="6" rx="3" fill="#3A2E80" /></G>

          {/* рот */}
          {f.mouth === 'smile' && <Path d="M88 126 Q100 136 112 126" stroke="#3A2E80" strokeWidth="4" fill="none" strokeLinecap="round" />}
          {f.mouth === 'grin' && <Path d="M86 124 Q100 142 114 124 Q100 132 86 124 Z" fill="#3A2E80" />}
          {f.mouth === 'frown' && <Path d="M88 132 Q100 123 112 132" stroke="#3A2E80" strokeWidth="4" fill="none" strokeLinecap="round" />}
          {f.mouth === 'focus' && <Ellipse cx="100" cy="128" rx="5" ry="4" fill="#3A2E80" />}
          {f.mouth === 'flat' && <Line x1="90" y1="128" x2="110" y2="128" stroke="#3A2E80" strokeWidth="4" strokeLinecap="round" />}

          {/* реквизит */}
          {has('coin') && (<G><Circle cx="170" cy="104" r="14" fill="#FFC24B" stroke="#E8A21F" strokeWidth="2.5" /><SvgText x="170" y="110" textAnchor="middle" fontSize="15" fontWeight="900" fill="#8a5a00">₽</SvgText></G>)}
          {has('pencil') && (<G><Rect x="150" y="150" width="8" height="34" rx="3" fill="#FFC24B" transform="rotate(24 154 167)" /><Path d="M150 182 l8 0 l-4 8 Z" fill="#3A2E80" transform="rotate(24 154 167)" /></G>)}
          {has('ledger') && (<G><Rect x="120" y="150" width="46" height="34" rx="5" fill="#fff" stroke="#DED3FF" strokeWidth="2" transform="rotate(-8 143 167)" /><Line x1="128" y1="160" x2="158" y2="158" stroke="#C9BBF5" strokeWidth="2.5" transform="rotate(-8 143 167)" /><Line x1="128" y1="168" x2="158" y2="166" stroke="#C9BBF5" strokeWidth="2.5" transform="rotate(-8 143 167)" /></G>)}
          {has('sweat') && <Path d="M150 78 q6 9 0 14 q-6 -5 0 -14 Z" fill="#4FC3F7" />}
          {has('sparkle') && (<G fill="#FFC24B"><Path d="M40 60 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" /><Path d="M168 150 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#FF7AB3" /></G>)}
          {has('think') && (<G fill="#5947E0"><Circle cx="150" cy="70" r="4" /><Circle cx="164" cy="58" r="5.5" /><Circle cx="180" cy="44" r="7" /></G>)}
        </Svg>
      </Animated.View>
    </View>
  );
}
