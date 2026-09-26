import React, { useContext, useEffect, useState } from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps, useFrameCallback, useReducedMotion, useSharedValue,
} from 'react-native-reanimated';
import Svg, {
  ClipPath, Defs, G, Path, Ellipse, Circle, Rect, Line, Text as SvgText,
  type GProps,
} from 'react-native-svg';
import { NavigationContext } from '@react-navigation/native';
import { useFinikEnabled } from '../finik';
import { TARGETS, PROPS, initState, stepRig, computePose, type FinikEmotion } from '../finikRig';

export type { FinikEmotion } from '../finikRig';

// Маскот «Финик» — кошелёк-бухгалтер. Эмоции и разметка 1:1 с вебом (public/app.js).
//
// Каждая часть (корпус, руки, стопы, брови, веки, зрачки, рот) — своя группа,
// которой риг (finikRig.ts) каждый кадр задаёт нативный проп matrix прямо на
// UI-потоке. react-native-svg 15 не пересчитывает rotation/transform при
// анимации — понимает только matrix, поэтому разрешаем его как UI-проп.
Animated.addWhitelistedUIProps({ matrix: true });

// В типах GProps нет нативного matrix — добавляем его явно.
const AG = Animated.createAnimatedComponent(
  G as unknown as React.ComponentClass<GProps & { matrix?: number[] }>,
);

// Финик-кошелёк: плоская мультяшная палитра (фиолетовый + золото фермуара).
const C = {
  body: '#7A5CF0', hi: '#9B80FF', sh: '#5947E0', arm: '#5947E0',
  gold: '#FFC24B', goldSh: '#E8A21F', goldHi: '#FFE9A8',
  glove: '#FFFFFF', gloveLine: '#D9CEFF', shoe: '#3A2E80', shoeHi: '#6A58D6',
};
const INK = '#2B2160';
// Силуэт кошелька (пузатый книзу, сверху — под фермуар)
const POUCH = 'M50 70 C26 96 16 150 36 178 C56 199 144 199 164 178 C184 150 174 96 150 70 Q100 57 50 70 Z';

// Пулы для случайных фиджетов и реакций на тап (через кратковременную смену эмоции)
const FIDGETS: FinikEmotion[] = ['income', 'inspect', 'goal', 'spy'];
const TAPS: FinikEmotion[] = ['goal', 'income', 'inspect', 'spy'];

// Экран в фокусе? Вне навигатора (оверлеи, корень) считаем, что да.
function useScreenFocused() {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(true);
  useEffect(() => {
    if (!nav) return;
    setFocused(nav.isFocused());
    const offFocus = nav.addListener('focus', () => setFocused(true));
    const offBlur = nav.addListener('blur', () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [nav]);
  return focused;
}

export function Finik({
  emotion = 'idle', size = 120, style, interactive = true,
}: { emotion?: FinikEmotion; size?: number; style?: ViewStyle; interactive?: boolean }) {
  const enabled = useFinikEnabled();
  const focused = useScreenFocused();
  const reduced = useReducedMotion();
  const [fx, setFx] = useState<FinikEmotion | null>(null);
  const shown = fx ?? emotion;

  // Риг: цель (параметры эмоции), состояние (сглаженные параметры + фазы) и поза.
  const tgt = useSharedValue(TARGETS[emotion] ?? TARGETS.idle);
  const state = useSharedValue(initState(TARGETS[emotion] ?? TARGETS.idle));
  const pose = useSharedValue(computePose(state.value));

  const frame = useFrameCallback((fi) => {
    const dt = fi.timeSincePreviousFrame == null ? 1 / 60 : fi.timeSincePreviousFrame / 1000;
    const next = stepRig(state.value, tgt.value, dt);
    state.value = next;
    pose.value = computePose(next);
  }, false);

  // Не тратим кадры, когда Финика не видно (выключен или вкладка неактивна).
  useEffect(() => { frame.setActive(enabled && focused); }, [enabled, focused, frame]);

  // Смена эмоции — просто новая цель: риг плавно перетечёт к ней сам.
  useEffect(() => {
    const t = TARGETS[shown] ?? TARGETS.idle;
    tgt.value = reduced ? { ...t, fA: 0, fB: 0, blink: 0 } : t;
  }, [shown, reduced, tgt]);

  // idle-фиджеты: раз в 6–16с спокойный Финик делает случайное микродействие
  useEffect(() => {
    if (emotion !== 'idle' || !interactive || reduced) return;
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
  }, [emotion, interactive, reduced]);

  const onPress = () => {
    setFx(TAPS[Math.floor(Math.random() * TAPS.length)]);
    setTimeout(() => setFx(null), 1300);
  };

  // Анимированные пропсы частей
  const bodyBackP  = useAnimatedProps(() => ({ matrix: pose.value.bodyM }));
  const bodyFrontP = useAnimatedProps(() => ({ matrix: pose.value.bodyM }));
  const shadowP    = useAnimatedProps(() => ({ matrix: pose.value.shadowM }));
  const armLP      = useAnimatedProps(() => ({ matrix: pose.value.armLM }));
  const armRP      = useAnimatedProps(() => ({ matrix: pose.value.armRM }));
  const footLP     = useAnimatedProps(() => ({ matrix: pose.value.footLM }));
  const footRP     = useAnimatedProps(() => ({ matrix: pose.value.footRM }));
  const browLP     = useAnimatedProps(() => ({ matrix: pose.value.browLM }));
  const browRP     = useAnimatedProps(() => ({ matrix: pose.value.browRM }));
  const pupilsP    = useAnimatedProps(() => ({ matrix: pose.value.pupilsM }));
  const lidLP      = useAnimatedProps(() => ({ matrix: pose.value.lidM }));
  const lidRP      = useAnimatedProps(() => ({ matrix: pose.value.lidM }));
  const yellP      = useAnimatedProps(() => ({ matrix: pose.value.yellM }));
  const angerP     = useAnimatedProps(() => ({ matrix: pose.value.angerM, opacity: pose.value.angerO }));
  const sweatP     = useAnimatedProps(() => ({ matrix: pose.value.sweatM, opacity: pose.value.sweatO }));
  const cheeksP    = useAnimatedProps(() => ({ opacity: pose.value.cheeksO }));
  const smileP     = useAnimatedProps(() => ({ opacity: pose.value.mSmile }));
  const grinP      = useAnimatedProps(() => ({ opacity: pose.value.mGrin }));
  const frownP     = useAnimatedProps(() => ({ opacity: pose.value.mFrown }));
  const focusP     = useAnimatedProps(() => ({ opacity: pose.value.mFocus }));
  const flatP      = useAnimatedProps(() => ({ opacity: pose.value.mFlat }));
  const smirkP     = useAnimatedProps(() => ({ opacity: pose.value.mSmirk }));
  const yellOP     = useAnimatedProps(() => ({ opacity: pose.value.mYell }));

  if (!enabled) return null; // маскот выключен в настройках

  const plusPose = shown === 'plus';
  const has = (p: string) => (PROPS[shown] ?? []).includes(p);

  const svg = (
    <Svg viewBox="-6 0 220 210" width="100%" height="100%">
      <Defs>
        <ClipPath id="fkPouch"><Path d={POUCH} /></ClipPath>
        <ClipPath id="fkEyeL"><Circle cx="79" cy="97" r="19" /></ClipPath>
        <ClipPath id="fkEyeR"><Circle cx="121" cy="97" r="19" /></ClipPath>
      </Defs>

      <AG animatedProps={shadowP}>
        <Ellipse cx="100" cy="197" rx="54" ry="8" fill="rgba(60,40,120,0.16)" />
      </AG>

      {has('confetti') && (
        <G>
          <Rect x="60" y="22" width="7" height="10" rx="2" fill="#FF7AB3" />
          <Rect x="98" y="14" width="7" height="10" rx="2" fill="#34C7A0" />
          <Rect x="134" y="24" width="7" height="10" rx="2" fill="#FFC24B" />
          <Rect x="80" y="18" width="7" height="10" rx="2" fill="#8A6BFF" />
          <Rect x="118" y="18" width="7" height="10" rx="2" fill="#FF7AB3" />
        </G>
      )}

      {/* Задний план: руки-«шланги» в перчатках (за телом) и сам кошелёк со светотенью */}
      <AG animatedProps={bodyBackP}>
        {!plusPose && (
          <AG animatedProps={armLP}>
            <Path d="M42 112 Q14 116 14 140" stroke={C.arm} strokeWidth="7" fill="none" strokeLinecap="round" />
            <Circle cx="14" cy="144" r="9" fill={C.glove} stroke={C.gloveLine} strokeWidth="2" />
            <Circle cx="7" cy="140" r="3.6" fill={C.glove} stroke={C.gloveLine} strokeWidth="1.6" />
          </AG>
        )}
        {!plusPose && (
          <AG animatedProps={armRP}>
            <Path d="M158 112 Q186 116 186 140" stroke={C.arm} strokeWidth="7" fill="none" strokeLinecap="round" />
            <Circle cx="186" cy="144" r="9" fill={C.glove} stroke={C.gloveLine} strokeWidth="2" />
            <Circle cx="193" cy="140" r="3.6" fill={C.glove} stroke={C.gloveLine} strokeWidth="1.6" />
          </AG>
        )}
        <Path d={POUCH} fill={C.body} />
        <G clipPath="url(#fkPouch)">
          <Path d="M146 76 Q164 112 160 156 Q154 184 118 194 L210 210 L210 60 Z" fill={C.sh} />
          <Path d="M52 104 Q34 128 42 156 Q50 172 68 166 Q80 158 70 142 Q62 128 66 112 Q62 98 52 104 Z" fill={C.hi} opacity={0.75} />
        </G>
      </AG>

      {/* Ботиночки — отдельно: при шаге остаются на земле, пока корпус качается */}
      <AG animatedProps={footLP}>
        <Path d="M94 196 Q96 184 80 184 Q62 184 62 192 Q62 199 76 199 L90 199 Q94 199 94 196 Z" fill={C.shoe} />
        <Ellipse cx="70" cy="189" rx="4.5" ry="2.6" fill={C.shoeHi} />
      </AG>
      <AG animatedProps={footRP}>
        <Path d="M106 196 Q104 184 120 184 Q138 184 138 192 Q138 199 124 199 L110 199 Q106 199 106 196 Z" fill={C.shoe} />
        <Ellipse cx="130" cy="189" rx="4.5" ry="2.6" fill={C.shoeHi} />
      </AG>

      {/* Передний план: шов/кнопка «+», фермуар с застёжкой, лицо, предметы */}
      <AG animatedProps={bodyFrontP}>
        {plusPose ? (<G>
          <Circle cx="100" cy="156" r="20" fill={C.gold} stroke={C.goldSh} strokeWidth="3" />
          <Rect x="89" y="152" width="22" height="8" rx="4" fill="#fff" />
          <Rect x="96" y="145" width="8" height="22" rx="4" fill="#fff" />
          <Circle cx="72" cy="160" r="9" fill={C.glove} stroke={C.gloveLine} strokeWidth="2" />
          <Circle cx="128" cy="160" r="9" fill={C.glove} stroke={C.gloveLine} strokeWidth="2" />
        </G>) : (
          <Path d="M52 180 Q100 194 148 180" stroke={C.sh} strokeWidth="2.5" fill="none" strokeDasharray="4 4" strokeLinecap="round" />
        )}

        <Line x1="95" y1="58" x2="105" y2="45" stroke={C.goldSh} strokeWidth="4" strokeLinecap="round" />
        <Line x1="105" y1="58" x2="95" y2="45" stroke={C.goldSh} strokeWidth="4" strokeLinecap="round" />
        <Circle cx="93" cy="40" r="7.5" fill={C.gold} /><Circle cx="107" cy="40" r="7.5" fill={C.gold} />
        <Circle cx="91" cy="37.5" r="2.4" fill={C.goldHi} /><Circle cx="105" cy="37.5" r="2.4" fill={C.goldHi} />
        <Path d="M40 69 Q100 51 160 69" stroke={C.goldSh} strokeWidth="11" fill="none" strokeLinecap="round" />
        <Path d="M40 66 Q100 48 160 66" stroke={C.gold} strokeWidth="10" fill="none" strokeLinecap="round" />
        <Path d="M60 60 Q100 49 140 60" stroke={C.goldHi} strokeWidth="2.6" fill="none" strokeLinecap="round" opacity={0.9} />

        <AG animatedProps={cheeksP}>
          <Ellipse cx="60" cy="122" rx="9" ry="5.5" fill="#FF8FB8" /><Ellipse cx="140" cy="122" rx="9" ry="5.5" fill="#FF8FB8" />
        </AG>

        {/* Глаза: белки → зрачки → веки (обрезаны по кругу глаза) → обводка */}
        <Circle cx="79" cy="97" r="19" fill="#FFFFFF" /><Circle cx="121" cy="97" r="19" fill="#FFFFFF" />
        <AG animatedProps={pupilsP}>
          <Circle cx="79" cy="99" r="9" fill={INK} /><Circle cx="82.5" cy="95" r="3.2" fill="#fff" /><Circle cx="76" cy="102.5" r="1.5" fill="#fff" />
          <Circle cx="121" cy="99" r="9" fill={INK} /><Circle cx="124.5" cy="95" r="3.2" fill="#fff" /><Circle cx="118" cy="102.5" r="1.5" fill="#fff" />
        </AG>
        <G clipPath="url(#fkEyeL)">
          <AG animatedProps={lidLP}>
            <Rect x="58" y="36" width="42" height="41" fill={C.body} />
            <Line x1="58" y1="77" x2="100" y2="77" stroke={INK} strokeWidth="2.5" />
          </AG>
        </G>
        <G clipPath="url(#fkEyeR)">
          <AG animatedProps={lidRP}>
            <Rect x="100" y="36" width="42" height="41" fill={C.body} />
            <Line x1="100" y1="77" x2="142" y2="77" stroke={INK} strokeWidth="2.5" />
          </AG>
        </G>
        <Circle cx="79" cy="97" r="19" fill="none" stroke={INK} strokeWidth="2.6" />
        <Circle cx="121" cy="97" r="19" fill="none" stroke={INK} strokeWidth="2.6" />

        <AG animatedProps={browLP}><Rect x="66" y="71" width="20" height="6" rx="3" fill={INK} /></AG>
        <AG animatedProps={browRP}><Rect x="114" y="71" width="20" height="6" rx="3" fill={INK} /></AG>

        {/* Рты — все на месте, риг плавно переключает их прозрачностью */}
        <AG animatedProps={smileP}><Path d="M86 126 Q100 139 114 126" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" /></AG>
        <AG animatedProps={grinP}><Path d="M84 124 Q100 146 116 124 Q100 131 84 124 Z" fill={INK} /></AG>
        <AG animatedProps={frownP}><Path d="M87 133 Q100 123 113 133" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" /></AG>
        <AG animatedProps={focusP}><Ellipse cx="100" cy="129" rx="5" ry="4" fill={INK} /></AG>
        <AG animatedProps={flatP}><Line x1="89" y1="129" x2="111" y2="129" stroke={INK} strokeWidth="4.5" strokeLinecap="round" /></AG>
        <AG animatedProps={smirkP}><Path d="M88 129 Q100 134 114 126" stroke={INK} strokeWidth="4.5" fill="none" strokeLinecap="round" /></AG>
        <AG animatedProps={yellOP}>
          <AG animatedProps={yellP}>
            <Ellipse cx="100" cy="130" rx="10" ry="9" fill={INK} />
            <Ellipse cx="100" cy="135.5" rx="5.5" ry="2.8" fill="#FF8FB8" />
          </AG>
        </AG>

        {/* Знак злости над застёжкой и капля пота — видимость задаёт риг */}
        <AG animatedProps={angerP}>
          <Path d="M-7 -2 Q-7 -7 -2 -7 M2 -7 Q7 -7 7 -2 M7 2 Q7 7 2 7 M-2 7 Q-7 7 -7 2"
            stroke="#FF4D5E" strokeWidth="3" fill="none" strokeLinecap="round" />
        </AG>
        <AG animatedProps={sweatP}><Path d="M150 78 q6 9 0 14 q-6 -5 0 -14 Z" fill="#4FC3F7" /></AG>

        {has('think') && (<G fill="#5947E0"><Circle cx="160" cy="54" r="4" /><Circle cx="173" cy="42" r="5.5" /><Circle cx="189" cy="28" r="7" /></G>)}
        {has('shades') && (<G><Rect x="57" y="85" width="42" height="24" rx="11" fill="#15111f" /><Rect x="101" y="85" width="42" height="24" rx="11" fill="#15111f" /><Line x1="99" y1="92" x2="101" y2="92" stroke="#15111f" strokeWidth="6" /><Rect x="62" y="89" width="30" height="6" rx="3" fill="#4a3f6e" /><Rect x="106" y="89" width="30" height="6" rx="3" fill="#4a3f6e" /></G>)}
        {has('wrench') && (<G transform="rotate(20 196 118)"><Rect x="191" y="88" width="10" height="42" rx="4" fill="#AEB6C4" /><Path d="M196 80 a11 11 0 1 0 0 22 a11 11 0 1 0 0 -22 M190 84 h12 v9 h-12 Z" fill="#8892A6" /><Circle cx="196" cy="91" r="5" fill="#F1EDFF" /></G>)}
        {has('coin') && (<G><Circle cx="186" cy="112" r="14" fill="#FFC24B" stroke="#E8A21F" strokeWidth="2.5" /><SvgText x="186" y="118" textAnchor="middle" fontSize="15" fontWeight="900" fill="#8a5a00">₽</SvgText></G>)}
        {has('magnifier') && (<G><Circle cx="186" cy="112" r="18" fill="rgba(180,220,255,0.30)" stroke="#8892A6" strokeWidth="4" /><Rect x="178" y="128" width="8" height="20" rx="4" fill="#7a6a50" transform="rotate(20 182 138)" /></G>)}
        {has('board') && (<G transform="translate(0 12)"><Rect x="150" y="58" width="60" height="58" rx="6" fill="#F6F3FF" stroke="#B9A9F0" strokeWidth="3" /><SvgText x="163" y="80" fontSize="13" fontWeight="800" fill="#5947E0">₽</SvgText><Line x1="176" y1="76" x2="203" y2="76" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" /><Line x1="159" y1="93" x2="203" y2="93" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" /><Path d="M159 108 l12 -7 l9 4 l16 -11" stroke="#34C7A0" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></G>)}
        {has('sparkle') && (<G fill="#FFC24B"><Path d="M30 52 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" /><Path d="M172 150 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#FF7AB3" /></G>)}
      </AG>
    </Svg>
  );

  // viewBox расширен до 220×210, чтобы доска (поза record) и правые пропсы
  // не обрезались — соотношение сторон бокса должно совпадать с viewBox.
  const box: ViewStyle = { width: size, height: size * 210 / 220 };
  return interactive
    ? <Pressable onPress={onPress} android_ripple={null} style={[box, style]}>{svg}</Pressable>
    : <View style={[box, style]}>{svg}</View>;
}
