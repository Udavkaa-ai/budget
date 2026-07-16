import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { useBlocks } from '../blocks';
import { useTourActive, endTour } from '../tour';
import { goToTab } from '../navigation';
import { haptics } from '../haptics';

const TAB_BAR_H = 60;

type Step = {
  tab?: string;          // на какую вкладку перейти
  target: 'tab' | 'fab' | 'center';
  tabName?: string;      // для target='tab' — какую вкладку подсветить
  icon: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    target: 'center', icon: 'sparkles',
    title: 'Добро пожаловать!',
    body: 'Семейный бюджет — общий учёт расходов для всей семьи в реальном времени. Покажу за минуту, что где находится.',
  },
  {
    tab: 'Home', target: 'tab', tabName: 'Home', icon: 'wallet',
    title: 'Бюджет',
    body: 'Лента расходов за день. Свайп влево/вправо — соседние дни. Долгое нажатие на расход — редактировать или удалить. Сверху — фильтр «Все / вы / партнёр».',
  },
  {
    tab: 'Home', target: 'fab', icon: 'add-circle',
    title: 'Добавить расход',
    body: 'Кнопка «+». По умолчанию — свободный текст с распознаванием ИИ («молоко 80, такси 300»). Есть и обычная форма, и скан чека камерой.',
  },
  {
    tab: 'Summary', target: 'tab', tabName: 'Summary', icon: 'pie-chart',
    title: 'Месяц',
    body: 'Итоги месяца: баблометр «факт/план», расходы по категориям с лимитами, тепловая карта по дням и сравнение с прошлым месяцем.',
  },
  {
    tab: 'Chart', target: 'tab', tabName: 'Chart', icon: 'trending-up',
    title: 'График',
    body: 'Динамика трат по дням, линия баланса и доходов. Ниже — кэшфлоу и поступления по дням. Ненужные линии можно отключать в легенде.',
  },
  {
    tab: 'Goals', target: 'tab', tabName: 'Goals', icon: 'flag',
    title: 'Цели',
    body: 'Копите на общие цели семьёй: задайте сумму, пополняйте и следите за прогрессом. Здесь же — лимиты по категориям.',
  },
  {
    tab: 'Settings', target: 'tab', tabName: 'Settings', icon: 'settings',
    title: 'Настройки',
    body: 'Название семьи и приглашения, тема (светлая/тёмная/авто), конструктор блоков аналитики, замок по отпечатку или PIN, шифрованные резервные копии.',
  },
  {
    tab: 'Settings', target: 'center', icon: 'diamond',
    title: 'Премиум',
    body: 'ИИ-разбор текста и голоса, сканирование чеков и ИИ-анализ месяца. Сейчас доступен бесплатно в тестовом режиме — включается в Настройках.',
  },
  {
    target: 'center', icon: 'checkmark-circle',
    title: 'Готово!',
    body: 'Это всё основное. Повторить тур можно в любой момент: Настройки → «Гид по интерфейсу».',
  },
];

export function Tour() {
  const active = useTourActive();
  const t = useTheme();
  const blocks = useBlocks();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const [dim, setDim] = useState(() => Dimensions.get('window'));

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => setDim(window));
    return () => sub.remove();
  }, []);

  // Сброс на первый шаг при каждом запуске
  useEffect(() => { if (active) setI(0); }, [active]);

  // Пропускаем шаги про отключённые вкладки (Chart/Goals в конструкторе)
  const steps = STEPS.filter(s => {
    const name = s.tabName ?? s.tab;
    if (name === 'Chart') return blocks.chartTab;
    if (name === 'Goals') return blocks.goalsTab;
    return true;
  });

  const step = steps[i];

  // Переход на нужную вкладку для текущего шага
  useEffect(() => {
    if (active && step?.tab) goToTab(step.tab);
  }, [active, i, step?.tab]);

  if (!active || !step) return null;

  // Список видимых вкладок в порядке таб-бара (совпадает с navigation)
  const tabs = ['Home', 'Summary', blocks.chartTab && 'Chart', 'Settings', blocks.goalsTab && 'Goals']
    .filter(Boolean) as string[];

  const W = dim.width, H = dim.height;
  const barTop = H - TAB_BAR_H - insets.bottom;

  // Прямоугольник подсветки
  let spot: { x: number; y: number; w: number; h: number } | null = null;
  if (step.target === 'tab' && step.tabName) {
    const idx = Math.max(0, tabs.indexOf(step.tabName));
    const tw = W / tabs.length;
    spot = { x: idx * tw, y: barTop, w: tw, h: TAB_BAR_H };
  } else if (step.target === 'fab') {
    const size = 60;
    spot = { x: W - 24 - size, y: barTop - 24 - size, w: size, h: size };
  }

  const isLast = i === steps.length - 1;
  const next = () => { haptics.select(); if (isLast) finish(); else setI(n => n + 1); };
  const back = () => { haptics.select(); setI(n => Math.max(0, n - 1)); };
  const finish = () => { haptics.success(); endTour(); };

  // Куда поставить карточку-подсказку: если подсветка снизу — карточку выше, иначе по центру
  const cardAtBottom = !spot || spot.y > H * 0.5;

  const PAD = 8;
  const overlay = 'rgba(10,8,25,0.72)';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Затемнение: либо 4 полосы вокруг подсветки, либо сплошное */}
      {spot ? (
        <>
          <View style={[styles.mask, { backgroundColor: overlay, top: 0, left: 0, right: 0, height: spot.y - PAD }]} />
          <View style={[styles.mask, { backgroundColor: overlay, top: spot.y + spot.h + PAD, left: 0, right: 0, bottom: 0 }]} />
          <View style={[styles.mask, { backgroundColor: overlay, top: spot.y - PAD, left: 0, width: spot.x - PAD, height: spot.h + PAD * 2 }]} />
          <View style={[styles.mask, { backgroundColor: overlay, top: spot.y - PAD, left: spot.x + spot.w + PAD, right: 0, height: spot.h + PAD * 2 }]} />
          {/* Рамка вокруг подсвеченного элемента */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: spot.x - PAD, top: spot.y - PAD,
              width: spot.w + PAD * 2, height: spot.h + PAD * 2,
              borderRadius: 16, borderWidth: 2.5, borderColor: t.primary,
            }}
          />
        </>
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay }]} />
      )}

      {/* Карточка-подсказка */}
      <Animated.View
        key={i}
        entering={FadeIn.duration(220)}
        style={[
          styles.card,
          { backgroundColor: t.surface, borderColor: t.border },
          cardAtBottom
            ? { bottom: TAB_BAR_H + insets.bottom + 24 }
            : { top: H * 0.5 - 40 },
        ]}
      >
        <View style={styles.cardHead}>
          <View style={[styles.iconBadge, { backgroundColor: t.surface2 }]}>
            <Ionicons name={step.icon as never} size={22} color={t.primary} />
          </View>
          <Text style={[styles.title, { color: t.text }]}>{step.title}</Text>
        </View>
        <Text style={{ color: t.textMuted, fontSize: font.md, lineHeight: 22 }}>{step.body}</Text>

        {/* Точки-прогресс */}
        <View style={styles.dots}>
          {steps.map((_, k) => (
            <View key={k} style={[styles.dot, { backgroundColor: k === i ? t.primary : t.border }]} />
          ))}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity onPress={finish}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>Пропустить</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {i > 0 && (
              <TouchableOpacity onPress={back} style={[styles.navBtn, { backgroundColor: t.surface2 }]}>
                <Text style={{ color: t.text, fontWeight: '600' }}>Назад</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={next} style={[styles.navBtn, { backgroundColor: t.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>{isLast ? 'Готово' : 'Далее'}</Text>
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
  dots: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: spacing.lg },
  dot: { width: 7, height: 7, borderRadius: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  navBtn: { borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
});
