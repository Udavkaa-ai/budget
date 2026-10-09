import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput, AppState, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, font } from '../theme';
import { Card } from './Card';
import { SectionTitle, Toggle, OutlineButton, SecondaryButton } from './UI';
import { openBankInbox, useBankInboxCount } from './BankInbox';
import {
  isPersonalBuild, getBankStatus, requestSmsPermission, bankNative, getJournal, drainNative,
  getAutoIncome, setAutoIncome, getSkippedCount,
  type BankStatus, type JournalEntry,
} from '../bank/inbox';
import { haptics } from '../haptics';

// Раздел «Покупки из банка» — только в личной сборке (в публичной не рендерится:
// там нет нативного модуля FinikBank).
const KIND_LABEL: Record<string, string> = {
  purchase: 'покупка', transfer: 'перевод', income: 'доход', ignore: 'пропущено', unknown: 'не распознано',
};

// «Приложения: 5 · получено 12, последнее сегодня 14:05» + не отключён ли сервис
function pushHint(st: BankStatus) {
  const ago = (ts?: number) => {
    if (!ts) return 'ещё не было';
    const d = new Date(ts), now = new Date();
    const hm = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? `сегодня ${hm}` : `${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })} ${hm}`;
  };
  const parts = [`Приложения: ${st.packages.length}`];
  if (st.pushSeen != null) parts.push(`получено ${st.pushSeen}, последнее ${ago(st.pushLast)}`);
  if (st.listenerOff && st.listenerOff > (st.listenerOn || 0)) parts.push('сервис отключён системой — выключите и включите доступ к уведомлениям');
  return parts.join(' · ');
}

export function BankSettings() {
  const t = useTheme();
  const pending = useBankInboxCount();
  const [st, setSt] = useState<BankStatus | null>(null);
  const [senders, setSenders] = useState('');
  const [packages, setPackages] = useState('');
  const [journalOpen, setJournalOpen] = useState(false);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [openRaw, setOpenRaw] = useState<number | null>(null);
  const [autoIncome, setAutoIncomeSt] = useState(true);
  const [skipped, setSkipped] = useState(0);

  const load = useCallback(async () => {
    const s = await getBankStatus().catch(() => null);
    setSt(s);
    if (s) { setSenders(s.senders.join(', ')); setPackages(s.packages.join(', ')); }
    setAutoIncomeSt(await getAutoIncome().catch(() => true));
  }, []);
  useEffect(() => {
    load();
    // вернулись из системных настроек доступа к уведомлениям — обновляем статус
    const sub = AppState.addEventListener('change', a => { if (a === 'active') load(); });
    return () => sub.remove();
  }, [load]);

  if (!isPersonalBuild || !st) return null;

  const list = (v: string) => v.split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  const openJournal = async () => { await drainNative(); setJournal(await getJournal()); setSkipped(await getSkippedCount()); setJournalOpen(true); };
  const discovering = st.discoverUntil > Date.now();

  const Line = ({ icon, title, hint, ok, right }: { icon: string; title: string; hint: string; ok?: boolean; right?: React.ReactNode }) => (
    <View style={[styles.line, { borderBottomColor: t.border }]}>
      <Ionicons name={icon as never} size={20} color={ok === false ? t.warning : t.primary} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: ok === false ? t.warning : t.textMuted, fontSize: 12, marginTop: 2 }}>{hint}</Text>
      </View>
      {right}
    </View>
  );

  return (
    <Card>
      <SectionTitle>Покупки из банка</SectionTitle>
      <Text style={{ color: t.textMuted, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm }}>
        Только в вашей личной сборке. Сообщения разбираются на телефоне; коды подтверждения выбрасываются сразу и нигде не сохраняются. Пропущено кодов: {st.dropped}.
      </Text>

      <Line icon="chatbubble-ellipses-outline" title="СМС от банка"
        ok={st.sms ? st.smsPermission : undefined}
        hint={!st.smsPermission ? 'Нужно разрешение на приём СМС'
          : st.smsSeen === 0 ? 'СМС пока не доходили до ФИНИКа — см. подсказку ниже'
          : `Получено СМС: ${st.smsSeen} · от: ${st.smsFrom.join(', ') || '—'}`}
        right={st.smsPermission
          ? <Toggle value={st.sms} onValueChange={v => { bankNative.setEnabled('sms', v); setSt({ ...st, sms: v }); }} />
          : <Pressable onPress={async () => { await requestSmsPermission(); load(); }}><Text style={{ color: t.primary, fontWeight: '700' }}>Разрешить</Text></Pressable>} />

      <Line icon="notifications-outline" title="Уведомления банков"
        ok={st.push ? st.notificationAccess : undefined}
        hint={!st.notificationAccess ? 'Включите ФИНИК в «Доступе к уведомлениям»' : pushHint(st)}
        right={st.notificationAccess
          ? <Toggle value={st.push} onValueChange={v => { bankNative.setEnabled('push', v); setSt({ ...st, push: v }); }} />
          : <Pressable onPress={() => bankNative.openNotificationAccess()}><Text style={{ color: t.primary, fontWeight: '700' }}>Открыть</Text></Pressable>} />

      <Line icon="trending-up-outline" title="Доходы — в кэшфлоу"
        hint="Зарплата, кешбэк, пополнения появятся в «Поступлениях» на графике остатка. Переводы между своими счетами не считаются"
        right={<Toggle value={autoIncome} onValueChange={v => { setAutoIncomeSt(v); setAutoIncome(v).catch(() => {}); }} />} />

      {st.smsPermission && !st.smsRead && (
        <Pressable onPress={async () => { await requestSmsPermission(); load(); }} style={{ marginTop: spacing.sm }}>
          <Text style={{ color: t.primary, fontWeight: '700', fontSize: 13 }}>Разрешить чтение входящих СМС — подберёт пропущенные ›</Text>
        </Pressable>
      )}
      {st.smsPermission && st.sms && st.smsSeen === 0 && (
        <View style={[styles.discover, { backgroundColor: t.warningSoft, borderColor: t.warning, marginTop: spacing.md }]}>
          <Text style={{ color: t.text, fontWeight: '700' }}>СМС не доходят?</Text>
          <Text style={{ color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
            Прошивки телефонов «усыпляют» приложения в фоне. Откройте настройки телефона › Приложения › «ФИНИК · Личный»:{'\n'}
            • Tecno/Infinix (HiOS): «Автозапуск» — вкл., «Батарея» › «Без ограничений», в Phone Master уберите ФИНИК из очистки;{'\n'}
            • Xiaomi/POCO: «Автозапуск» и разрешения «SMS» / «Сервисные SMS»;{'\n'}
            • Samsung: «Батарея» › «Без ограничений».{'\n'}
            Даже без этого ФИНИК дочитает свежие СМС от банков из входящих, когда вы его откроете — если разрешено «Чтение СМС».
          </Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
        <OutlineButton title={pending ? `Входящие · ${pending}` : 'Входящие'} style={{ flex: 1 }} onPress={() => openBankInbox()} />
        <SecondaryButton title="Журнал" style={{ flex: 1 }} onPress={openJournal} />
      </View>

      <Text style={[styles.label, { color: t.textMuted }]}>ОТПРАВИТЕЛИ СМС</Text>
      <TextInput value={senders} onChangeText={setSenders} autoCapitalize="characters"
        onEndEditing={() => { bankNative.setSenders(list(senders)); load(); }}
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]} />

      <Text style={[styles.label, { color: t.textMuted }]}>ПРИЛОЖЕНИЯ БАНКОВ (ПАКЕТЫ)</Text>
      <TextInput value={packages} onChangeText={setPackages} autoCapitalize="none" multiline
        onEndEditing={() => { bankNative.setPackages(list(packages)); load(); }}
        style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2, minHeight: 64 }]} />

      <View style={[styles.discover, { backgroundColor: t.surface2, borderColor: t.border }]}>
        <Text style={{ color: t.text, fontWeight: '700' }}>Не ловятся пуши какого-то банка?</Text>
        <Text style={{ color: t.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 }}>
          Включите поиск на 10 минут и сделайте покупку. ФИНИК запомнит только название приложения, которое прислало уведомление с суммой в рублях — сам текст не сохраняется.
        </Text>
        {st.discovered.length > 0 && st.discovered.map(p => (
          <View key={p} style={styles.found}>
            <Text style={{ color: t.text, flex: 1, fontSize: 13 }} numberOfLines={1}>{p}</Text>
            {!st.packages.includes(p) && (
              <Pressable onPress={() => { haptics.success(); bankNative.setPackages([...st.packages, p]); load(); }}>
                <Text style={{ color: t.primary, fontWeight: '700' }}>Добавить</Text>
              </Pressable>
            )}
          </View>
        ))}
        <Pressable onPress={() => { bankNative.startDiscover(10); haptics.select(); load(); }} style={{ marginTop: spacing.sm }}>
          <Text style={{ color: t.primary, fontWeight: '700' }}>
            {discovering ? `Ищу… до ${new Date(st.discoverUntil).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}` : 'Найти приложение банка'}
          </Text>
        </Pressable>
      </View>

      <Modal visible={journalOpen} animationType="slide" onRequestClose={() => setJournalOpen(false)}>
        <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={[styles.jHead, { borderBottomColor: t.border, backgroundColor: t.surface }]}>
            <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>Журнал банка</Text>
            <Pressable onPress={() => setJournalOpen(false)} hitSlop={10}><Ionicons name="close" size={24} color={t.textMuted} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            <Text style={{ color: t.textMuted, fontSize: 12, marginBottom: spacing.sm }}>
              Последние 150 сообщений и что с ними сделал ФИНИК. Хранится только на этом телефоне. Нажмите на запись, чтобы увидеть текст сообщения (коды подтверждения не сохраняются) — его можно выделить и прислать разработчику, чтобы дописать шаблон.
            </Text>
            {skipped > 0 && (
              <Text style={{ color: t.textFaint, fontSize: 12, marginBottom: spacing.sm }}>
                Служебных сообщений без суммы (входы в приложение, реклама) пропущено: {skipped}
              </Text>
            )}
            {journal.length === 0 && <Text style={{ color: t.textFaint, textAlign: 'center', marginTop: 40 }}>Пока пусто</Text>}
            {journal.map(j => (
              <Pressable key={j.id} onPress={() => j.raw && setOpenRaw(o => o === j.id ? null : j.id)} style={[styles.jRow, { borderBottomColor: t.border }]}>
                <Text style={{ color: t.textFaint, fontSize: 11 }}>
                  {new Date(j.ts).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {j.source === 'sms' ? 'СМС' : j.source === 'push' ? 'пуш' : 'поделиться'}{j.from ? ` · ${j.from}` : ''}
                </Text>
                <Text style={{ color: j.kind === 'purchase' ? t.text : j.kind === 'unknown' ? t.warning : t.textMuted, fontSize: 14, marginTop: 2 }}>
                  <Text style={{ fontWeight: '700' }}>{KIND_LABEL[j.kind] || j.kind}</Text> · {j.summary}
                  {j.raw ? <Text style={{ color: t.primary, fontSize: 12 }}>  {openRaw === j.id ? 'скрыть текст' : 'текст ›'}</Text> : null}
                </Text>
                {openRaw === j.id && j.raw && (
                  <Text selectable style={[styles.raw, { color: t.text, backgroundColor: t.surface2, borderColor: t.border }]}>{j.raw}</Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Card>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, fontSize: 14 },
  discover: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  found: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  jHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  jRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  raw: { marginTop: 6, padding: 10, borderRadius: radius.sm, borderWidth: 1, fontSize: 13, lineHeight: 18 },
});
