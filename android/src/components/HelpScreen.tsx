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
        a: 'На вкладке «Бюджет» нажмите Финика с «+». Способы:\n\n• Текстом — пишите как в мессенджере: «кофе 180» или «продукты 2300, вчера такси 450». Суммы, категории и даты разберутся сами.\n• Голосом — надиктуйте то же самое.\n• Чеком — сфотографируйте чек, ИИ распознает позиции.\n• Вручную — сумма, категория, описание и дата.\n\nРасход сразу появляется в ленте дня. Без интернета он встанет в очередь (⏳) и отправится сам.',
      },
      {
        icon: 'calendar',
        q: 'Как посмотреть другой день или месяц?',
        a: 'Листайте экран свайпом влево/вправо или жмите стрелки ‹ › у даты. Тап по дате — выбор из календаря. На графиках палец не листает экран, а ведёт подсказку по дням.',
      },
      {
        icon: 'create',
        q: 'Как исправить или удалить расход?',
        a: 'Нажмите и удерживайте расход в ленте — откроется окно редактирования, где можно изменить сумму, категорию, описание или удалить его.',
      },
      {
        icon: 'happy',
        q: 'Кто такой Финик?',
        a: 'Семейный кошелёк-бухгалтер. Он реагирует на ваши деньги: радуется доходам и целям, волнуется, когда траты выше плана, ворчит за перерасход. Если мешает — Настройки › «Внешний вид и экраны».',
      },
    ],
  },
  {
    title: 'Семья',
    items: [
      {
        icon: 'people',
        q: 'Кто такой «Партнёр»?',
        a: '«Партнёр» — другой член вашей семьи в приложении. Фильтр «Все / Я / Партнёр» на вкладке «Бюджет» показывает траты каждого отдельно или вместе. Цвета участников одинаковые во всех графиках.',
      },
      {
        icon: 'people-circle',
        q: 'Как добавить членов семьи?',
        a: 'Настройки › «Семья и бюджет» › «Пригласить в семью» › отправьте ссылку близким. Открыть её можно где угодно: на Android — в приложении, на iPhone и компьютере — в браузере (веб-версию можно добавить на экран «Домой»). После входа все видят общие расходы в реальном времени.',
      },
      {
        icon: 'pricetag',
        q: 'Название семьи',
        a: 'Настройки › «Семья и бюджет»: можно задать название семьи (например, «Капырины») — оно показывается в профиле вместо служебного идентификатора.',
      },
    ],
  },
  {
    title: 'Барометр и графики',
    items: [
      {
        icon: 'speedometer',
        q: 'Что показывает барометр бюджета?',
        a: 'Сколько потрачено относительно нормы на сегодняшний день. Если план 90 000 ₽ и прошла треть месяца, норма — 30 000 ₽. Зоны:\n\n• до 85% — «Экономим» (зелёная),\n• 85–100% — «В графике»,\n• 100–110% — «Выше плана» (жёлтая, Финик волнуется),\n• больше 110% — «Перерасход» (красная, Финик ворчит).',
      },
      {
        icon: 'trending-up',
        q: 'Как читать графики?',
        a: 'Вкладка «График»: траты с начала месяца против плана (пунктир) и прогноз до конца месяца; траты по дням с дневной нормой; остаток на счетах и дни поступлений. Всё, что выше плана, отмечено красным — видно, с какого дня начался перерасход. Ведите пальцем по графику, чтобы смотреть отдельные дни.',
      },
      {
        icon: 'options',
        q: 'Что дают лимиты по категориям?',
        a: 'Задайте лимит на категорию (например, «Кафе» — 10 000 ₽/мес) в разделе «Лимиты». Тогда под категорией видно «осталось 4 000 ₽» или «перерасход 1 500 ₽».',
      },
      {
        icon: 'flag',
        q: 'Зачем нужны «Цели»?',
        a: 'Цель — копилка на что-то конкретное (отпуск, техника). Задаёте сумму и пополняете, приложение показывает прогресс. Удобно копить всей семьёй.',
      },
    ],
  },
  {
    title: 'Настройка и приватность',
    items: [
      {
        icon: 'construct',
        q: 'Конструктор аналитики',
        a: 'Настройки › «Внешний вид и экраны»: блоки сгруппированы по вкладкам (Месяц, График, Цели) — включайте нужные, скрывайте лишние, там же прячутся сами вкладки. Настройка своя на каждом устройстве.',
      },
      {
        icon: 'moon',
        q: 'Тема оформления',
        a: 'Светлая, тёмная или «авто» (по системным настройкам телефона) — Настройки › «Внешний вид и экраны».',
      },
      {
        icon: 'lock-closed',
        q: 'Замок: отпечаток и PIN',
        a: 'Настройки › «Безопасность и данные» › замок. Разблокировка — по отпечатку или по PIN-коду (можно задать оба).',
      },
      {
        icon: 'shield-checkmark',
        q: 'Что значит «шифруется»?',
        a: 'Резервные копии шифруются прямо на вашем телефоне вашим ключом и уходят на сервер уже зашифрованными — там их прочитать нельзя. Восстановить копию можно только с вашим ключом (его можно перенести на другое устройство фразой).',
      },
    ],
  },
  {
    title: 'Премиум и поддержка',
    items: [
      {
        icon: 'diamond',
        q: 'Что входит в Премиум?',
        a: 'ИИ-разбор свободного текста при вводе, распознавание чеков по фото и ИИ-анализ месяца с рекомендациями. Сейчас Премиум доступен бесплатно в тестовом режиме — Настройки › «Премиум».',
      },
      {
        icon: 'cloud-offline',
        q: 'Работает ли без интернета?',
        a: 'Да. Расходы, внесённые без сети, встают в очередь (значок ⏳ в ленте) и автоматически отправляются, когда связь появится. Категории определяются на самом устройстве.',
      },
      {
        icon: 'chatbubbles',
        q: 'Как написать разработчику?',
        a: 'Настройки › «Помощь и поддержка». Сообщение придёт напрямую разработчику, ответ появится там же — на вкладке «Настройки» загорится значок.',
      },
      {
        icon: 'star',
        q: 'Как оценить приложение?',
        a: 'Настройки › «Помощь и поддержка» › «Оценить приложение в RuStore». Отзыв очень помогает развивать ФИНИК.',
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
