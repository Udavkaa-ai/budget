// СГЕНЕРИРОВАНО из android/src/finikRig.ts — руками не править.
// Та же математика анимаций Финика, что в приложении (веб и APK 1:1).
// Перегенерация: транспилировать android/src/finikRig.ts TypeScript'ом
// (module ES2020, target ES2019) в этот файл.

// Риг Финика: плавные анимации по частям — корпус, руки, стопы, брови,
// веки, зрачки, рот. Всё здесь — чистые функции-воркелеты без импортов RN:
// они считаются на UI-потоке Reanimated и 1:1 переиспользуются в веб-превью.
//
// Идея: у эмоции есть набор числовых параметров (Rig). При смене эмоции каждое
// число плавно перетекает к новому значению (экспоненциальное сглаживание),
// поэтому переходы без рывков. Движение задают двое «часов»: A (быстрые
// движения: шаги, мах, тряска) и B (медленные: дыхание, «хмф», взгляд).
// Фазы накапливаются, а не считаются как t·f, — смена темпа тоже без скачков.
const PI = Math.PI;
// Точки крепления рук (плечи) в координатах viewBox — на боках кошелька.
export const SHOULDER_L = [40, 112];
export const SHOULDER_R = [160, 112];
const BASE = {
    fA: 1, fB: 0.3, blink: 1,
    breath: 0, hop: 0, hopSquash: 0, stepBob: 0, huff: 0, shakeX: 0,
    tilt: 0, tiltA: 0, tiltPhA: 0, tiltB: 0,
    armL: 0, armLA: 0, armLPh: 0, armLA2: 0, armLB: 0,
    armR: 0, armRA: 0, armRPh: 0, armRA2: 0, armRB: 0, shrug: 0,
    step: 0, stride: 0, tap: 0,
    browAngle: 0, browDy: 0, browRdy: 0, browTremble: 0, twitch: 0,
    lid: 0, lookX: 0, lookY: 0, lookAmp: 0, eyeRoll: 0,
    talk: 0, anger: 0, sweat: 0, cheeks: 0,
    mSmile: 0, mGrin: 0, mFrown: 0, mFocus: 0, mFlat: 0, mSmirk: 0, mYell: 0,
};
const T = (o) => ({ ...BASE, ...o });
// Руки, в которых что-то держится (доска, монета, ключ), не качаем — иначе
// предмет «отвалится» от лапы; такие эмоции живут наклоном корпуса.
export const TARGETS = {
    idle: T({ breath: 0.022, lookAmp: 1.2, mSmile: 1 }),
    plus: T({ breath: 0.022, mSmile: 1 }),
    spy: T({ breath: 0.02, browDy: -2, lookX: -2, lookAmp: 2.5, mSmirk: 1 }),
    // Бег по нижнему меню: шаги с выносом стоп, руки работают, корпус
    // наклонён вперёд и покачивается на каждом шаге.
    walk: T({ fA: 2.3, step: 7, stride: 8, stepBob: 3, tilt: 5, tiltA: 1.5,
        armLA: 28, armLPh: PI, armRA: 28, lookX: 3, mSmile: 1 }),
    // Привет: лапа высоко и машет, корпус качается в противовес и пружинит.
    wave: T({ fA: 2.2, fB: 0.4, armR: -115, armRA: 14, armL: 6, armLB: 3,
        tiltA: 3, tiltPhA: PI, hop: 2, hopSquash: 0.02, breath: 0.01,
        cheeks: 1, mGrin: 1, browDy: -3, lookY: -0.5 }),
    // Недовольный: руки в боки, полуприкрытые веки, взгляд искоса, стучит ногой;
    // раз в ~3 с — «хмф!» с закатыванием глаз, потом скептически вскидывает бровь.
    grumpy: T({ fA: 2.0, fB: 0.33, armL: 26, armR: -26, shrug: 6, huff: 0.06, tap: 5,
        tiltB: 1.2, breath: 0.012, browAngle: 18, browDy: 2, twitch: 1,
        lid: 0.42, lookX: 4.5, lookY: 1, eyeRoll: 5, mFrown: 1 }),
    // Ругается за перерасход: грозит лапой, другая в боку, весь трясётся в такт,
    // рот «говорит», брови дрожат, над головой пульсирует знак злости.
    scold: T({ fA: 2.4, fB: 0.5, armR: -118, armRA: 14, armL: 30, armLA2: 3,
        shakeX: 1.4, tiltA: 1.2, browAngle: 20, browDy: 3, browTremble: 1.5,
        lid: 0.22, lookY: 1.5, talk: 1, anger: 1, mYell: 1 }),
    overspend: T({ fA: 1.9, fB: 0.8, tiltA: 3, armR: -52, armRA: 4, sweat: 1, lid: 0.1,
        browAngle: 14, browRdy: -4, lookX: -2, lookAmp: 2, mFrown: 1 }),
    income: T({ fA: 1.16, hop: 9, hopSquash: 0.04, armR: -34, cheeks: 1, mGrin: 1, browDy: -3 }),
    goal: T({ fA: 1.39, hop: 18, hopSquash: 0.05, armL: 100, armR: -100, armLA: 10, armRA: 10, // «ура!» — руки вверх
        armRPh: PI, cheeks: 1, mGrin: 1, browDy: -4 }),
    record: T({ breath: 0.02, armR: -30, lookX: 3, lookY: -2, mFocus: 1 }),
    thinking: T({ fA: 0.45, tilt: 0.5, tiltA: 2.5, armR: -72, browRdy: -4, lookX: 3, lookY: -4, mFlat: 1 }),
    fix: T({ fA: 1.0, tilt: 0.5, tiltA: 2.5, armR: -26, lookX: 3, lookY: 2, mFocus: 1 }),
    inspect: T({ fA: 0.2, fB: 0.25, tilt: 1.5, tiltA: 1.5, armR: -40, browRdy: -4, lookX: 4, lookAmp: 2, mFlat: 1 }),
};
// Предметы в лапах/вокруг — дискретно по эмоции (пот и знак злости — плавно в риге).
export const PROPS = {
    idle: [], plus: [], walk: [], wave: [], grumpy: [], scold: [], overspend: [],
    record: ['board'], income: ['coin', 'sparkle'], goal: ['confetti', 'sparkle'],
    thinking: ['think'], spy: ['shades'], fix: ['wrench'], inspect: ['coin', 'magnifier'],
};
// ─── Аффинные матрицы [a, b, c, d, e, f] (формат нативного пропа matrix) ──────
export function mMul(m, n) {
    'worklet';
    return [
        m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
}
export function mT(x, y) {
    'worklet';
    return [1, 0, 0, 1, x, y];
}
export function mR(deg, cx, cy) {
    'worklet';
    const r = (deg * PI) / 180, c = Math.cos(r), s = Math.sin(r);
    return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
}
export function mS(sx, sy, cx, cy) {
    'worklet';
    return [sx, 0, 0, sy, cx - sx * cx, cy - sy * cy];
}
export function initState(rig) {
    'worklet';
    const cur = {};
    const vel = {};
    for (const k in rig) {
        cur[k] = rig[k];
        vel[k] = 0;
    }
    return { cur: cur, vel: vel, A: 0, B: 0, blinkIn: 2 + Math.random() * 2, blinkT: -1 };
}
// Фазы заворачиваем по 200π: все множители фаз в computePose кратны 0.01,
// поэтому и sin(k·A) остаются непрерывными на переходе.
const WRAP = 200 * PI;
export function stepRig(st, tgt, dtRaw) {
    'worklet';
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    // Критически задемпфированная пружина (точное решение — устойчиво при любом
    // dt): плавный разгон и торможение без перелёта. Корпус/руки/лицо ~0.4 с,
    // рот быстрее, чтобы два рта не «двоились».
    const eBody = Math.exp(-11 * dt), eMouth = Math.exp(-24 * dt);
    const cur = {};
    const vel = {};
    const c = st.cur;
    const v = st.vel;
    const t = tgt;
    for (const k in t) {
        const isMouth = k.length > 1 && k[0] === 'm' && k[1] >= 'A' && k[1] <= 'Z';
        const w = isMouth ? 24 : 11, e = isMouth ? eMouth : eBody;
        const x0 = c[k] === undefined ? t[k] : c[k];
        const v0 = v[k] === undefined ? 0 : v[k];
        const y0 = x0 - t[k];
        const q = v0 + w * y0;
        cur[k] = t[k] + (y0 + q * dt) * e;
        vel[k] = (v0 - w * q * dt) * e;
    }
    let A = st.A + 2 * PI * cur.fA * dt;
    let B = st.B + 2 * PI * cur.fB * dt;
    if (A > WRAP)
        A -= WRAP;
    if (B > WRAP)
        B -= WRAP;
    let blinkIn = st.blinkIn - dt;
    let blinkT = st.blinkT >= 0 ? st.blinkT + dt : -1;
    if (blinkT > 0.2)
        blinkT = -1;
    if (blinkIn <= 0) {
        if (cur.blink > 0.5)
            blinkT = 0;
        blinkIn = 2.6 + Math.random() * 3.2;
    }
    return { cur: cur, vel: vel, A, B, blinkIn, blinkT };
}
export function computePose(st) {
    'worklet';
    const p = st.cur, A = st.A, B = st.B;
    const sA = Math.sin(A), cA = Math.cos(A);
    const huffS = Math.pow(Math.max(0, Math.sin(B)), 8); // короткий пик раз в цикл B
    const twitchS = Math.pow(Math.max(0, Math.sin(B + 2.2)), 10); // ещё один, со сдвигом
    // Корпус. Прыжок уносит и стопы; покачивание при шаге — только корпус.
    const hopY = -p.hop * (0.5 - 0.5 * cA);
    const bobY = -p.stepBob * (0.5 - 0.5 * Math.cos(2 * A));
    const tx = p.shakeX * sA;
    const rot = p.tilt + p.tiltA * Math.sin(A + p.tiltPhA) + p.tiltB * Math.sin(B);
    const sy = 1 + p.breath * Math.sin(B) - p.hopSquash * cA - p.huff * huffS;
    const sx = 1 - p.breath * 0.5 * Math.sin(B) + p.hopSquash * 0.6 * cA + p.huff * 0.6 * huffS;
    const bodyM = mMul(mT(tx, hopY + bobY), mMul(mR(rot, 100, 192), mS(sx, sy, 100, 192)));
    // Тень сжимается, когда Финик в воздухе.
    const k = 1 - Math.min(0.4, -hopY / 40);
    const shadowM = mMul(mT(tx * 0.5, 0), mS(k, k, 100, 196));
    // Руки вращаются от плеч.
    const armL = p.armL + p.armLA * Math.sin(A + p.armLPh) + p.armLA2 * Math.sin(2 * A)
        + p.armLB * Math.sin(B) + p.shrug * huffS;
    const armR = p.armR + p.armRA * Math.sin(A + p.armRPh) + p.armRA2 * Math.sin(2 * A)
        + p.armRB * Math.sin(B) - p.shrug * huffS;
    // Стопы: при шаге поднимаются и выносятся вперёд; правая может стучать
    // (затихает на время «хмф»).
    const tapEnv = 1 - Math.min(1, huffS * 3);
    // Степень >1 — нулевая скорость в момент касания: стопа мягко встаёт на пол.
    const liftL = p.step * Math.pow(Math.max(0, sA), 1.6);
    const liftR = p.step * Math.pow(Math.max(0, -sA), 1.6) + p.tap * tapEnv * Math.pow(Math.max(0, sA), 1.5);
    // Брови: дрожь от злости и скептический подъём правой.
    const tremble = p.browTremble * Math.sin(2 * A + 0.5);
    const tw = p.twitch * twitchS;
    const browLM = mMul(mT(0, p.browDy), mR(p.browAngle + tremble, 76, 75));
    const browRM = mMul(mT(0, p.browDy + p.browRdy - 7 * tw), mR(-p.browAngle - tremble + tw * (p.browAngle + 8), 124, 75));
    // Зрачки: взгляд + медленное блуждание + закатывание глаз на «хмф».
    let dx = p.lookX + p.lookAmp * Math.sin(B * 0.7) - p.eyeRoll * 0.4 * huffS;
    let dy = p.lookY + p.lookAmp * 0.5 * Math.sin(B * 1.3 + 1) - p.eyeRoll * huffS;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 6) {
        dx = (dx / len) * 6;
        dy = (dy / len) * 6;
    }
    // Веки: базовое прикрытие + моргание.
    let blinkAmt = 0;
    if (st.blinkT >= 0)
        blinkAmt = st.blinkT < 0.08 ? st.blinkT / 0.08 : Math.max(0, 1 - (st.blinkT - 0.08) / 0.11);
    const lid = Math.min(1, Math.max(p.lid, blinkAmt));
    // Рот «говорит» с неровным ритмом, как реальная речь.
    const open = p.talk * (0.5 + 0.5 * Math.sin(A * 1.8)) * (0.6 + 0.4 * Math.sin(A * 0.55 + 1));
    const yellM = mS(1 - 0.12 * open, 0.3 + 0.7 * open, 100, 129);
    // Знак злости пульсирует; капля пота стекает.
    const pulse = 1 + 0.18 * Math.sin(2 * A);
    const s = (B / (2 * PI)) % 1;
    const sweatO = p.sweat * (s < 0.2 ? s / 0.2 : 1 - (s - 0.2) / 0.8);
    return {
        bodyM, shadowM,
        // Плечи — на боках кошелька; руки-«шланги» свисают наружу от них.
        armLM: mR(armL, SHOULDER_L[0], SHOULDER_L[1]), armRM: mR(armR, SHOULDER_R[0], SHOULDER_R[1]),
        footLM: mT(-p.stride * cA, hopY - liftL), footRM: mT(p.stride * cA, hopY - liftR),
        browLM, browRM,
        pupilsM: mT(dx, dy),
        lidM: mT(0, lid * 39),
        yellM,
        angerM: mMul(mT(166, 44), mS(pulse, pulse, 0, 0)), // над застёжкой справа
        sweatM: mT(0, 16 * s),
        angerO: p.anger * (0.75 + 0.25 * Math.sin(2 * A)),
        sweatO,
        cheeksO: p.cheeks,
        mSmile: p.mSmile, mGrin: p.mGrin, mFrown: p.mFrown, mFocus: p.mFocus,
        mFlat: p.mFlat, mSmirk: p.mSmirk, mYell: p.mYell,
    };
}
