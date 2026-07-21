import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { useBlocks } from '../blocks';
import { useTourActive, endTour } from '../tour';
import { unlock } from '../achievements';
import { goToTab } from '../navigation';
import { measureTarget, measureNode, scrollTargetIntoView, type Rect } from '../tourTargets';
import { openHelp } from '../help';
import { haptics } from '../haptics';

type Step = {
  tab?: string;          // на какую вкладку перейти перед показом
  targetId?: string;     // что подсветить (замеряется реально); нет — карточка без рамки
  needBlock?: 'chartTab' | 'goalsTab' | 'gauge'; // пропустить шаг, если блок выключен
  icon: string;
  title: string;
  body: string;
};

// Сценарный тур: ведём нового человека по реальному пути, объясняя термины.
const STEPS: Step[] = [
  {
    icon: 'sparkles',
    title: 'Привет!',
    body: 'Это ваш семейный бюджет — общий учёт трат для всей семьи. Покажу за минуту, как им пользоваться. По шагам.',
  },
  {
    tab: 'Home', targetId: 'home.fab', icon: 'add-circle',
    title: 'Шаг 1. Внесите расход',
    body: 'Нажмите «+» и впишите, например, «кофе 200» — приложение само подберёт категорию. Так каждый день фиксируются траты. Позже: свайп по дням, долгое нажатие на расход — правка.',
  },
  {
    tab: 'Home', targetId: 'home.filter', icon: 'people',
    title: 'Кто потратил',
    body: '«Партнёр» — это второй член семьи. Пока вы один, но когда пригласите близких, здесь можно смотреть траты каждого по отдельности или вместе.',
  },
  {
    tab: 'Summary', targetId: 'summary.total', icon: 'pie-chart',
    title: 'Шаг 2. Итоги месяца',
    body: 'Все траты за месяц собираются здесь: сколько потрачено, сколько осталось от плана. Ниже — разбивка по категориям.',
  },
  {
    tab: 'Summary', targetId: 'summary.gauge', needBlock: 'gauge', icon: 'speedometer',
    title: 'Барометр бюджета',
    body: 'Шкала со стрелкой показывает, сколько вы уже потратили относительно плана к этому дню месяца. Стрелка в зелёной зоне — идёте по плану, в жёлтой — на грани, в красной — перерасход.',
  },
  {
    tab: 'Chart', targetId: 'chart.main', needBlock: 'chartTab', icon: 'trending-up',
    title: 'Динамика и доходы',
    body: 'Вкладка «График» показывает, в какие дни тратили больше, линию баланса и доходы. Удобно ловить моменты, когда деньги уходят быстрее плана.',
  },
  {
    tab: 'Goals', targetId: 'goals.add', needBlock: 'goalsTab', icon: 'flag',
    title: 'Копите на общее',
    body: '«Цели» — копилка на отпуск, технику, что угодно. Задайте сумму и пополняйте, приложение покажет прогресс.',
  },
  {
    tab: 'Settings', targetId: 'settings.invite', icon: 'people-circle',
    title: 'Шаг 3. Позовите семью',
    body: 'Нажмите «Пригласить в семью» и отправьте код близким. Они вводят его у себя — и все вносят расходы со своих телефонов, видя общую картину в реальном времени.',
  },
  {
    tab: 'Settings', targetId: 'settings.blocks', icon: 'construct',
    title: 'Соберите аналитику под себя',
    body: 'Барометр бюджета, тепловую карту, графики и другие блоки можно включать и выключать. Оставьте те, что нравятся, остальное скройте.',
  },
  {
    tab: 'Settings', targetId: 'settings.security', icon: 'lock-closed',
    title: 'Приватность',
    body: 'Вход по отпечатку или PIN-коду, а резервные копии шифруются прямо на телефоне: на сервер данные уходят уже зашифрованными, читать их можете только вы.',
  },
  {
    tab: 'Settings', targetId: 'settings.premium', icon: 'diamond',
    title: 'Премиум',
    body: 'ИИ разбирает текст и чеки и делает разбор месяца с советами. Сейчас доступен бесплатно в тестовом режиме — включается здесь же.',
  },
  {
    icon: 'checkmark-circle',
    title: 'Готово!',
    body: 'Это всё основное. Открыть подробную «Помощь» или пройти тур заново можно в Настройках. Удачного планирования!',
    targetId: '__help',
  },
];

export function Tour() {
  const active = useTourActive();
  const t = useTheme();
  const blocks = useBlocks();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [dim] = useState(() => Dimensions.get('window'));
  const rootRef = useRef<View>(null);

  useEffect(() => { if (active) setI(0); }, [active]);

  // Отфильтрованные шаги (пропускаем про выключенные вкладки/блоки)
  const steps = STEPS.filter(s => {
    if (s.needBlock === 'chartTab') return blocks.chartTab;
    if (s.needBlock === 'goalsTab') return blocks.goalsTab;
    if (s.needBlock === 'gauge') return blocks.gauge;
    return true;
  });
  const step = steps[i];

  // При смене шага: перейти на вкладку и замерить цель (с ретраями на монтирование)
  useEffect(() => {
    if (!active || !step) return;
    let cancelled = false;
    setSpot(null);
    if (step.tab) goToTab(step.tab);
    (async () => {
      if (!step.targetId || step.targetId.startsWith('__')) return;
      await new Promise(r => setTimeout(r, 240));
      const onScreen = (r: Rect) => r.y > -20 && r.y + r.h < dim.height + 20;
      let last: Rect | null = null;
      for (let attempt = 0; attempt < 18 && !cancelled; attempt++) {
        // Прокручиваем цель в зону видимости (для длинных экранов вроде Настроек)
        scrollTargetIntoView(step.targetId);
        await new Promise(r => setTimeout(r, 130));
        const tgt = await measureTarget(step.targetId!);
        if (cancelled) return;
        if (!tgt) { last = null; continue; }
        // Оконные координаты цели → координаты оверлея (иначе сдвиг на статус-бар)
        const root = await measureNode(rootRef.current);
        if (cancelled) return;
        const rel: Rect = root
          ? { x: tgt.x - root.x, y: tgt.y - root.y, w: tgt.w, h: tgt.h }
          : tgt;
        // Ждём стабилизации (конца анимации прокрутки): два одинаковых замера
        if (last && Math.abs(last.y - rel.y) < 2 && Math.abs(last.x - rel.x) < 2) {
          if (onScreen(rel)) setSpot(rel);
          return;
        }
        last = rel;
      }
      if (!cancelled && last && onScreen(last)) setSpot(last);
    })();
    return () => { cancelled = true; };
  }, [active, i, step?.tab, step?.targetId]);

  if (!active || !step) return null;

  const W = dim.width, H = dim.height;
  const isLast = i === steps.length - 1;
  const next = () => { haptics.select(); if (isLast) finish(); else setI(n => n + 1); };
  const back = () => { haptics.select(); setI(n => Math.max(0, n - 1)); };
  // Дошёл до конца — ачивка «Экскурсовод». «Пропустить» — без ачивки.
  const finish = () => { haptics.success(); unlock('tour'); endTour(); };
  const skip = () => { haptics.select(); endTour(); };
  const openHelpFromTour = () => { unlock('tour'); endTour(); openHelp(); };

  const PAD = 8;
  const overlay = 'rgba(10,8,25,0.74)';
  // Карточку ставим на противоположную от подсветки половину экрана
  const cardAtBottom = !spot || (spot.y + spot.h / 2) < H * 0.5;

  return (
    <View ref={rootRef} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {spot ? (
        <>
          <View style={[styles.mask, { backgroundColor: overlay, top: 0, left: 0, right: 0, height: Math.max(0, spot.y - PAD) }]} />
          <View style={[styles.mask, { backgroundColor: overlay, top: spot.y + spot.h + PAD, left: 0, right: 0, bottom: 0 }]} />
          <View style={[styles.mask, { backgroundColor: overlay, top: spot.y - PAD, left: 0, width: Math.max(0, spot.x - PAD), height: spot.h + PAD * 2 }]} />
          <View style={[styles.mask, { backgroundColor: overlay, top: spot.y - PAD, left: spot.x + spot.w + PAD, right: 0, height: spot.h + PAD * 2 }]} />
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: spot.x - PAD, top: spot.y - PAD,
              width: spot.w + PAD * 2, height: spot.h + PAD * 2,
              borderRadius: 18, borderWidth: 2.5, borderColor: t.primary,
            }}
          />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay }]} />
      )}

      <Animated.View
        key={i}
        entering={FadeIn.duration(220)}
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.border },
          cardAtBottom
            ? { bottom: 64 + insets.bottom + 20 }
            : { top: insets.top + 20 },
        ]}
      >
        <View style={styles.cardHead}>
          <View style={[styles.iconBadge, { backgroundColor: t.surface2 }]}>
            <Ionicons name={step.icon as never} size={22} color={t.primary} />
          </View>
          <Text style={[styles.title, { color: t.text }]}>{step.title}</Text>
        </View>
        <Text style={{ color: t.textMuted, fontSize: font.md, lineHeight: 23 }}>{step.body}</Text>

        {step.targetId === '__help' && (
          <TouchableOpacity onPress={openHelpFromTour} style={{ marginTop: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="help-circle" size={18} color={t.primary} />
            <Text style={{ color: t.primary, fontWeight: '600', fontSize: font.sm }}>Открыть раздел «Помощь»</Text>
          </TouchableOpacity>
        )}

        <View style={styles.dots}>
          {steps.map((_, k) => (
            <View key={k} style={[styles.dot, { backgroundColor: k === i ? t.primary : t.border }]} />
          ))}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity onPress={skip} hitSlop={8}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>Пропустить</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {i > 0 && (
              <TouchableOpacity onPress={back} style={[styles.navBtn, styles.navArrow, { backgroundColor: t.surface2 }]}>
                <Text style={{ color: t.text, fontWeight: '700', fontSize: font.lg }}>‹</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={next} style={[styles.navBtn, isLast ? null : styles.navArrow, { backgroundColor: t.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: isLast ? font.md : font.lg }}>{isLast ? 'Готово' : '›'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  mask: { position: 'absolute' },
  card: {
    position: 'absolute', left: spacing.lg, right: spacing.lg,
    borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  iconBadge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.xl, fontWeight: '800', flex: 1 },
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: spacing.lg, flexWrap: 'wrap' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  navBtn: { borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, minWidth: 80, alignItems: 'center', justifyContent: 'center' },
  navArrow: { minWidth: 52, paddingHorizontal: spacing.md },
});
