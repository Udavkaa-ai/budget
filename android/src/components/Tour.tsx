import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { useBlocks } from '../blocks';
import { useTourActive, endTour } from '../tour';
import { goToTab } from '../navigation';
import { measureTarget, type Rect } from '../tourTargets';
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
    tab: 'Summary', icon: 'pie-chart',
    title: 'Шаг 2. Итоги месяца',
    body: 'Все траты за месяц собираются здесь — по категориям и общей суммой. Так видно, на что уходят деньги.',
  },
  {
    tab: 'Summary', targetId: 'summary.gauge', needBlock: 'gauge', icon: 'speedometer',
    title: 'Что за «баблометр»',
    body: 'Это спидометр бюджета. Он показывает, сколько вы уже потратили относительно плана к этому дню месяца. Стрелка в зелёной зоне — идёте по плану, в красной — перерасход.',
  },
  {
    tab: 'Summary', icon: 'options',
    title: 'Настройте лимиты',
    body: 'Задайте лимиты по категориям (кнопка «Лимиты» у списка категорий). Тогда под каждой категорией видно «осталось» или «перерасход» — сразу понятно, укладываетесь ли в план.',
  },
  {
    tab: 'Chart', needBlock: 'chartTab', icon: 'trending-up',
    title: 'Динамика и доходы',
    body: 'Вкладка «График» показывает, в какие дни тратили больше, линию баланса и доходы. Удобно ловить моменты, когда деньги уходят быстрее плана.',
  },
  {
    tab: 'Goals', needBlock: 'goalsTab', icon: 'flag',
    title: 'Копите на общее',
    body: '«Цели» — копилка на отпуск, технику, что угодно. Задайте сумму и пополняйте, приложение покажет прогресс.',
  },
  {
    tab: 'Settings', icon: 'people-circle',
    title: 'Шаг 3. Позовите семью',
    body: 'Откройте Настройки и нажмите «Пригласить в семью». Близкие вводят код у себя — и все вносят расходы со своих телефонов, видя общую картину в реальном времени. Так бюджет становится действительно семейным.',
  },
  {
    tab: 'Settings', icon: 'construct',
    title: 'Соберите аналитику под себя',
    body: 'Баблометр, тепловую карту, графики и другие блоки можно включать и выключать в «Конструкторе». Оставьте те, что нравятся, остальное скройте.',
  },
  {
    tab: 'Settings', icon: 'lock-closed',
    title: 'Приватность',
    body: 'Вход по отпечатку или PIN-коду, а резервные копии шифруются прямо на телефоне: на сервер данные уходят уже зашифрованными, читать их можете только вы.',
  },
  {
    tab: 'Settings', icon: 'diamond',
    title: 'Премиум',
    body: 'ИИ разбирает текст и чеки и делает разбор месяца с советами. Сейчас доступен бесплатно в тестовом режиме — включается в Настройках.',
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
      for (let attempt = 0; attempt < 14 && !cancelled; attempt++) {
        await new Promise(r => setTimeout(r, 130));
        const r = await measureTarget(step.targetId!);
        if (cancelled) return;
        if (r) {
          // Цель должна быть в пределах экрана — иначе показываем без рамки
          if (r.y > -20 && r.y + r.h < dim.height + 20) setSpot(r);
          return;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [active, i, step?.tab, step?.targetId]);

  if (!active || !step) return null;

  const W = dim.width, H = dim.height;
  const isLast = i === steps.length - 1;
  const next = () => { haptics.select(); if (isLast) finish(); else setI(n => n + 1); };
  const back = () => { haptics.select(); setI(n => Math.max(0, n - 1)); };
  const finish = () => { haptics.success(); endTour(); };
  const openHelpFromTour = () => { endTour(); openHelp(); };

  const PAD = 8;
  const overlay = 'rgba(10,8,25,0.74)';
  // Карточку ставим на противоположную от подсветки половину экрана
  const cardAtBottom = !spot || (spot.y + spot.h / 2) < H * 0.5;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
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
          <TouchableOpacity onPress={finish} hitSlop={8}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>Пропустить</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {i > 0 && (
              <TouchableOpacity onPress={back} style={[styles.navBtn, { backgroundColor: t.surface2 }]}>
                <Text numberOfLines={1} style={{ color: t.text, fontWeight: '600' }}>Назад</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={next} style={[styles.navBtn, { backgroundColor: t.primary }]}>
              <Text numberOfLines={1} style={{ color: '#fff', fontWeight: '700' }}>{isLast ? 'Готово' : 'Далее'}</Text>
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
  navBtn: { borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, minWidth: 88, alignItems: 'center' },
});
