import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { useHelpOpen, closeHelp } from '../help';
import { startTour } from '../tour';
import { haptics } from '../haptics';

type QA = { icon: string; q: string; a: string };

// Подробные ответы: объясняем термины и функции простым языком.
const SECTIONS: { title: string; items: QA[] }[] = [
  {
    title: 'Начало работы',
    items: [
      {
        icon: 'add-circle',
        q: 'Как внести расход?',
        a: 'На вкладке «Бюджет» нажмите «+». Три способа:\n\n• Текстом — впишите «кофе 200» или «продукты 2300, такси 450», ИИ сам разложит по категориям и суммам.\n• Формой — введите сумму и выберите категорию вручную.\n• Чеком — сфотографируйте чек, ИИ распознает позиции.\n\nРасход сразу появляется в ленте дня.',
      },
      {
        icon: 'calendar',
        q: 'Как посмотреть другой день?',
        a: 'На вкладке «Бюджет» листайте свайпом влево/вправо или жмите стрелки ‹ › у даты. Тап по дате — выбор из календаря.',
      },
      {
        icon: 'create',
        q: 'Как исправить или удалить расход?',
        a: 'Нажмите и удерживайте расход в ленте (долгое нажатие) — откроется окно редактирования, где можно изменить сумму, категорию, описание или удалить его.',
      },
    ],
  },
  {
    title: 'Семья',
    items: [
      {
        icon: 'people',
        q: 'Кто такой «Партнёр»?',
        a: '«Партнёр» — это другой член вашей семьи в приложении. Фильтр «Все / Я / Партнёр» на вкладке «Бюджет» позволяет смотреть траты каждого отдельно или вместе. Пока вы одни, партнёра нет — он появится, когда кто-то присоединится.',
      },
      {
        icon: 'people-circle',
        q: 'Как добавить членов семьи?',
        a: 'Откройте Настройки, нажмите «Пригласить в семью» — получите код/ссылку и отправьте близким. Они вводят код у себя в приложении (Настройки, пункт «Ввести код приглашения») и попадают в вашу семью. После этого все видят общие расходы в реальном времени.',
      },
      {
        icon: 'pricetag',
        q: 'Название семьи',
        a: 'В Настройках можно задать название семьи (например, «Капырины») — оно показывается в профиле вместо служебного идентификатора.',
      },
    ],
  },
  {
    title: 'Аналитика и план',
    items: [
      {
        icon: 'speedometer',
        q: 'Что такое «Барометр бюджета»?',
        a: 'Это спидометр бюджета на вкладке «Месяц». Он показывает, сколько вы уже потратили относительно плана к текущему дню месяца. Если план 300 000 ₽ и прошла половина месяца, «по плану» — это ~150 000 ₽. Стрелка в зелёной зоне — укладываетесь, в красной — тратите быстрее плана.',
      },
      {
        icon: 'options',
        q: 'Что дают лимиты по категориям?',
        a: 'Задайте лимит на категорию (например, «Кафе» — 10 000 ₽/мес) в разделе «Лимиты». Тогда под категорией видно «осталось 4 000 ₽» или «перерасход 1 500 ₽». Это помогает держать траты под контролем по каждому направлению.',
      },
      {
        icon: 'trending-up',
        q: 'Скорость трат и график',
        a: 'Вкладка «График» показывает траты по дням, линию баланса и доходы. «Скорость трат» — это ваш темп в процентах от плана: помогает заметить, когда деньги уходят быстрее, чем задумано.',
      },
      {
        icon: 'flag',
        q: 'Зачем нужны «Цели»?',
        a: 'Цель — это копилка на что-то конкретное (отпуск, техника). Задаёте сумму и пополняете, приложение показывает прогресс. Удобно копить всей семьёй.',
      },
    ],
  },
  {
    title: 'Настройка и приватность',
    items: [
      {
        icon: 'construct',
        q: 'Конструктор аналитики',
        a: 'В Настройках можно включать и выключать блоки (барометр бюджета, тепловая карта, скорость трат, вкладки «График»/«Цели» и т.д.). Оставьте только то, чем пользуетесь — остальное не будет загромождать экран. Настройка своя на каждом устройстве.',
      },
      {
        icon: 'moon',
        q: 'Тема оформления',
        a: 'Светлая, тёмная или «авто» (по системным настройкам телефона) — переключается в Настройках.',
      },
      {
        icon: 'lock-closed',
        q: 'Замок: отпечаток и PIN',
        a: 'В Настройках, в разделе «Безопасность», включите замок. Разблокировка — по отпечатку/Face ID или по PIN-коду (можно задать оба). При каждом открытии приложение запросит разблокировку.',
      },
      {
        icon: 'shield-checkmark',
        q: 'Что значит «шифруется»?',
        a: 'Резервные копии шифруются прямо на вашем телефоне вашим ключом. На сервер они уходят уже зашифрованными — там их прочитать нельзя. Восстановить копию можно только с вашим ключом (его можно перенести на другое устройство фразой). Так данные семьи остаются приватными.',
      },
    ],
  },
  {
    title: 'Премиум',
    items: [
      {
        icon: 'diamond',
        q: 'Что входит в Премиум?',
        a: 'ИИ-разбор свободного текста при вводе, распознавание чеков по фото и ИИ-анализ месяца с рекомендациями. Сейчас Премиум доступен бесплатно в тестовом режиме — включается в Настройках.',
      },
      {
        icon: 'cloud-offline',
        q: 'Работает ли без интернета?',
        a: 'Да. Расходы, внесённые без сети, встают в очередь (значок ⏳ в ленте) и автоматически отправляются на сервер, когда связь появится. Категории определяются на самом устройстве.',
      },
    ],
  },
];

function Item({ item }: { item: QA }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.item, { borderColor: t.border }]}>
      <TouchableOpacity
        style={styles.itemHead}
        onPress={() => { haptics.select(); setOpen(o => !o); }}
        activeOpacity={0.7}
      >
        <Ionicons name={item.icon as never} size={20} color={t.primary} style={{ marginRight: spacing.md }} />
        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '600', flex: 1 }}>{item.q}</Text>
        <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={18} color={t.textMuted} />
      </TouchableOpacity>
      {open && (
        <Text style={{ color: t.textMuted, fontSize: font.sm, lineHeight: 21, paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
          {item.a}
        </Text>
      )}
    </View>
  );
}

export function HelpScreen() {
  const open = useHelpOpen();
  const t = useTheme();
  if (!open) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={closeHelp}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <Text style={[styles.title, { color: t.primary }]}>Помощь</Text>
          <TouchableOpacity onPress={closeHelp} hitSlop={10}>
            <Ionicons name="close" size={26} color={t.text} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }}>
          <Text style={{ color: t.textMuted, fontSize: font.sm, marginBottom: spacing.md, lineHeight: 20 }}>
            Коротко о том, как всё устроено. Нажмите на вопрос, чтобы раскрыть ответ.
          </Text>

          <TouchableOpacity
            style={[styles.tourBtn, { backgroundColor: t.surface, borderColor: t.primary }]}
            onPress={() => { closeHelp(); startTour(); }}
          >
            <Ionicons name="navigate" size={20} color={t.primary} />
            <Text style={{ color: t.primary, fontWeight: '700' }}>Пройти вводный тур заново</Text>
          </TouchableOpacity>

          {SECTIONS.map(sec => (
            <View key={sec.title} style={{ marginTop: spacing.lg }}>
              <Text style={[styles.secTitle, { color: t.textMuted }]}>{sec.title.toUpperCase()}</Text>
              {sec.items.map(it => <Item key={it.q} item={it} />)}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  title:   { fontSize: font.xxl, fontWeight: '800' },
  secTitle:{ fontSize: font.xs, letterSpacing: 0.6, marginBottom: spacing.sm, marginLeft: spacing.xs },
  item:    { borderWidth: 1, borderRadius: radius.md, marginBottom: spacing.sm, overflow: 'hidden' },
  itemHead:{ flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  tourBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderWidth: 1.5, borderRadius: radius.md, padding: spacing.md },
});
