import React, { useContext, useEffect, useState } from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps, useFrameCallback, useReducedMotion, useSharedValue,
} from 'react-native-reanimated';
import Svg, {
  ClipPath, Defs, LinearGradient, RadialGradient, Stop, G, Path, Ellipse, Circle, Rect, Line, Text as SvgText,
  type GProps,
} from 'react-native-svg';
import { NavigationContext } from '@react-navigation/native';
import { useFinikEnabled } from '../finik';
import { TARGETS, PROPS, initState, stepRig, computePose, type FinikEmotion } from '../finikRig';

export type { FinikEmotion } from '../finikRig';

// Маскот «Финик» — семейный бухгалтер. Эмоции 1:1 с вебом (public/app.js).
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

// Цвет века ≈ цвет градиента тела на высоте глаз (сплошной, чтобы не было шва).
const LID = '#8C74F7';
const INK = '#3A2E80';

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
        <LinearGradient id="fkBody" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#9B80FF" /><Stop offset="1" stopColor="#5947E0" />
        </LinearGradient>
        <RadialGradient id="fkBelly" cx="0.5" cy="0.4" r="0.7">
          <Stop offset="0" stopColor="#F3EFFF" /><Stop offset="1" stopColor="#DED3FF" />
        </RadialGradient>
        <ClipPath id="fkEyeL"><Circle cx="79" cy="97" r="19" /></ClipPath>
        <ClipPath id="fkEyeR"><Circle cx="121" cy="97" r="19" /></ClipPath>
      </Defs>

      <AG animatedProps={shadowP}>
        <Ellipse cx="100" cy="196" rx="52" ry="9" fill="rgba(60,40,120,0.18)" />
      </AG>

      {has('confetti') && (
        <G>
          <Rect x="60" y="30" width="7" height="10" rx="2" fill="#FF7AB3" />
          <Rect x="98" y="22" width="7" height="10" rx="2" fill="#34C7A0" />
          <Rect x="134" y="32" width="7" height="10" rx="2" fill="#FFC24B" />
          <Rect x="80" y="26" width="7" height="10" rx="2" fill="#8A6BFF" />
          <Rect x="118" y="26" width="7" height="10" rx="2" fill="#FF7AB3" />
        </G>
      )}

      {/* Задний план корпуса: руки (за телом) и само тело */}
      <AG animatedProps={bodyBackP}>
        {!plusPose && (
          <AG animatedProps={armLP}>
            <Ellipse cx="46" cy="128" rx="13" ry="20" fill="#7C63F0" /><Circle cx="46" cy="147" r="9" fill="#8E76F5" />
          </AG>
        )}
        {!plusPose && (
          <AG animatedProps={armRP}>
            <Ellipse cx="154" cy="128" rx="13" ry="20" fill="#7C63F0" /><Circle cx="154" cy="147" r="9" fill="#8E76F5" />
          </AG>
        )}
        <Path d="M100 58 C142 58 160 90 160 128 C160 172 134 192 100 192 C66 192 40 172 40 128 C40 90 58 58 100 58 Z" fill="url(#fkBody)" />
      </AG>

      {/* Стопы — отдельно: при шаге остаются на земле, пока корпус качается */}
      <AG animatedProps={footLP}><Ellipse cx="80" cy="190" rx="13" ry="8" fill="#4A39C4" /></AG>
      <AG animatedProps={footRP}><Ellipse cx="120" cy="190" rx="13" ry="8" fill="#4A39C4" /></AG>

      {/* Передний план корпуса: живот, лицо, предметы */}
      <AG animatedProps={bodyFrontP}>
        <Rect x="72" y="143" width="56" height="40" rx="12" fill="url(#fkBelly)" />
        {!plusPose && (<>
          <Line x1="82" y1="155" x2="118" y2="155" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />
          <Line x1="82" y1="164" x2="118" y2="164" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />
          <Line x1="82" y1="173" x2="104" y2="173" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" />
        </>)}
        {plusPose && (<G>
          <Rect x="85" y="158" width="30" height="10" rx="5" fill="#5947E0" />
          <Rect x="95" y="148" width="10" height="30" rx="5" fill="#5947E0" />
          <Circle cx="70" cy="150" r="9" fill="#8E76F5" />
          <Circle cx="130" cy="150" r="9" fill="#8E76F5" />
        </G>)}

        <AG animatedProps={cheeksP}>
          <Ellipse cx="66" cy="112" rx="9" ry="6" fill="#FF8FB8" /><Ellipse cx="134" cy="112" rx="9" ry="6" fill="#FF8FB8" />
        </AG>

        {/* Глаза: белки → зрачки → веки (обрезаны по кругу глаза) → оправа */}
        <Line x1="92" y1="96" x2="108" y2="96" stroke="#FFC24B" strokeWidth="4" />
        <Circle cx="79" cy="97" r="19" fill="#FFFFFF" /><Circle cx="121" cy="97" r="19" fill="#FFFFFF" />
        <AG animatedProps={pupilsP}>
          <Circle cx="79" cy="98" r="7.5" fill="#241C42" /><Circle cx="82" cy="95" r="2.4" fill="#fff" />
          <Circle cx="121" cy="98" r="7.5" fill="#241C42" /><Circle cx="124" cy="95" r="2.4" fill="#fff" />
        </AG>
        <G clipPath="url(#fkEyeL)">
          <AG animatedProps={lidLP}>
            <Rect x="58" y="36" width="42" height="41" fill={LID} />
            <Line x1="58" y1="77" x2="100" y2="77" stroke={INK} strokeWidth="2.5" />
          </AG>
        </G>
        <G clipPath="url(#fkEyeR)">
          <AG animatedProps={lidRP}>
            <Rect x="100" y="36" width="42" height="41" fill={LID} />
            <Line x1="100" y1="77" x2="142" y2="77" stroke={INK} strokeWidth="2.5" />
          </AG>
        </G>
        <Circle cx="79" cy="97" r="19" fill="none" stroke="#FFC24B" strokeWidth="4" />
        <Circle cx="121" cy="97" r="19" fill="none" stroke="#FFC24B" strokeWidth="4" />

        <AG animatedProps={browLP}><Rect x="66" y="72" width="20" height="6" rx="3" fill={INK} /></AG>
        <AG animatedProps={browRP}><Rect x="114" y="72" width="20" height="6" rx="3" fill={INK} /></AG>

        {/* Рты — все на месте, риг плавно переключает их прозрачностью */}
        <AG animatedProps={smileP}><Path d="M88 126 Q100 136 112 126" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" /></AG>
        <AG animatedProps={grinP}><Path d="M86 124 Q100 142 114 124 Q100 132 86 124 Z" fill={INK} /></AG>
        <AG animatedProps={frownP}><Path d="M88 132 Q100 123 112 132" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" /></AG>
        <AG animatedProps={focusP}><Ellipse cx="100" cy="128" rx="5" ry="4" fill={INK} /></AG>
        <AG animatedProps={flatP}><Line x1="90" y1="128" x2="110" y2="128" stroke={INK} strokeWidth="4" strokeLinecap="round" /></AG>
        <AG animatedProps={smirkP}><Path d="M89 128 Q100 133 113 126" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" /></AG>
        <AG animatedProps={yellOP}>
          <AG animatedProps={yellP}>
            <Ellipse cx="100" cy="129" rx="9" ry="8" fill={INK} />
            <Ellipse cx="100" cy="134" rx="5" ry="2.6" fill="#FF8FB8" />
          </AG>
        </AG>

        {/* Знак злости над головой и капля пота — видимость задаёт риг */}
        <AG animatedProps={angerP}>
          <Path d="M-7 -2 Q-7 -7 -2 -7 M2 -7 Q7 -7 7 -2 M7 2 Q7 7 2 7 M-2 7 Q-7 7 -7 2"
            stroke="#FF4D5E" strokeWidth="3" fill="none" strokeLinecap="round" />
        </AG>
        <AG animatedProps={sweatP}><Path d="M150 78 q6 9 0 14 q-6 -5 0 -14 Z" fill="#4FC3F7" /></AG>

        {has('coin') && (<G><Circle cx="170" cy="104" r="14" fill="#FFC24B" stroke="#E8A21F" strokeWidth="2.5" /><SvgText x="170" y="110" textAnchor="middle" fontSize="15" fontWeight="900" fill="#8a5a00">₽</SvgText></G>)}
        {has('pencil') && (<G transform="rotate(-32 164 116)"><Rect x="160" y="102" width="7" height="28" rx="3" fill="#FFC24B" /><Path d="M160 100 l7 0 l-3.5 -8 Z" fill={INK} /></G>)}
        {has('board') && (<G><Rect x="150" y="58" width="60" height="58" rx="6" fill="#F6F3FF" stroke="#B9A9F0" strokeWidth="3" /><SvgText x="163" y="80" fontSize="13" fontWeight="800" fill="#5947E0">₽</SvgText><Line x1="176" y1="76" x2="203" y2="76" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" /><Line x1="159" y1="93" x2="203" y2="93" stroke="#C9BBF5" strokeWidth="3" strokeLinecap="round" /><Path d="M159 108 l12 -7 l9 4 l16 -11" stroke="#34C7A0" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></G>)}
        {has('sparkle') && (<G fill="#FFC24B"><Path d="M40 60 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3 Z" /><Path d="M168 150 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#FF7AB3" /></G>)}
        {has('think') && (<G fill="#5947E0"><Circle cx="150" cy="70" r="4" /><Circle cx="164" cy="58" r="5.5" /><Circle cx="180" cy="44" r="7" /></G>)}
        {has('shades') && (<G><Rect x="59" y="86" width="40" height="23" rx="10" fill="#15111f" /><Rect x="101" y="86" width="40" height="23" rx="10" fill="#15111f" /><Line x1="99" y1="93" x2="101" y2="93" stroke="#15111f" strokeWidth="6" /><Rect x="63" y="90" width="30" height="6" rx="3" fill="#4a3f6e" /><Rect x="105" y="90" width="30" height="6" rx="3" fill="#4a3f6e" /></G>)}
        {has('wrench') && (<G transform="rotate(28 168 150)"><Rect x="163" y="120" width="10" height="42" rx="4" fill="#AEB6C4" /><Path d="M168 112 a11 11 0 1 0 0 22 a11 11 0 1 0 0 -22 M162 116 h12 v9 h-12 Z" fill="#8892A6" /><Circle cx="168" cy="123" r="5" fill="#F1EDFF" /></G>)}
        {has('magnifier') && (<G><Circle cx="156" cy="100" r="17" fill="rgba(180,220,255,0.30)" stroke="#8892A6" strokeWidth="4" /><Rect x="168" y="112" width="8" height="22" rx="4" fill="#7a6a50" transform="rotate(42 172 123)" /></G>)}
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
