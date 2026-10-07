import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, Pressable, TextInput, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius } from '../theme';
import { useCategories } from '../categories';
import { getInbox, accept, dismiss, onInboxChange, type InboxItem } from '../bank/inbox';
import { familyUsers, nameAcc } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { PrimaryButton, SecondaryButton, SectionTitle } from './UI';
import { showAlert } from '../dialog';
import { haptics } from '../haptics';

// Открытие окна «Входящие из банка» откуда угодно (плашка на главной, «Поделиться»)
let _open = false;
const openers = new Set<() => void>();
export function openBankInbox() { _open = true; openers.forEach(l => l()); }

// Сколько ждёт подтверждения — для плашки на главной
export function useBankInboxCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => { getInbox('pending').then(l => setN(l.length)).catch(() => {}); };
    load();
    return onInboxChange(load);
  }, []);
  return n;
}

const fmt = (n?: number) => new Intl.NumberFormat('ru-RU').format(n || 0) + ' ₽';
const when = (ts: number) => {
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? `сегодня, ${hm}` : `${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })}, ${hm}`;
};
// Члены семьи — чтобы записать трату на того, кто платил моей картой
let _members: string[] = [];
function useMembers() {
  const [m, setM] = useState(_members);
  useEffect(() => { familyUsers().then(l => { _members = l; setM(l); }).catch(() => {}); }, []);
  return m;
}

const SOURCE: Record<InboxItem['source'], string> = { sms: 'СМС', push: 'уведомление', share: '«Поделиться»' };

function Row({ item }: { item: InboxItem }) {
  const t = useTheme();
  const { cats, icon } = useCategories();
  const [cat, setCat] = useState(item.category);
  const [desc, setDesc] = useState(item.merchant || '');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const me = user?.name || '';
  const others = useMembers().filter(n => n !== me);
  const [who, setWho] = useState('');           // '' — мой расход
  const transfer = item.kind === 'transfer';
  const guessed = item.guess === 'balance';

  const add = async () => {
    setBusy(true);
    try { await accept(item, cat, desc, who || undefined); haptics.success(); }
    catch (e) { showAlert('Не удалось добавить', String(e)); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.row, { backgroundColor: t.surface, borderColor: transfer || guessed ? t.warning : t.border }]}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <TextInput value={desc} onChangeText={setDesc} placeholder={item.guess ? 'На что потрачено' : transfer ? 'Кому перевод' : 'Где покупка'}
            placeholderTextColor={t.textFaint} style={[styles.desc, { color: t.text }]} />
          <Text style={{ color: t.textFaint, fontSize: 12 }}>
            {item.bank}{item.card ? ` ·${item.card}` : ''} · {SOURCE[item.source]} · {when(item.ts)}
          </Text>
        </View>
        <Text style={[styles.amount, { color: t.text }]}>{fmt(item.amount)}</Text>
      </View>
      {transfer && (
        <Text style={{ color: t.warning, fontSize: 12, fontWeight: '700', marginTop: 6 }}>
          Перевод человеку — добавьте, только если это расход
        </Text>
      )}
      {item.guess === 'balance' && (
        <Text style={{ color: t.warning, fontSize: 12, fontWeight: '700', marginTop: 6 }}>
          Списание без уведомления — банк не прислал сообщение, но баланс уменьшился на эту сумму. Подпишите, на что потрачено
        </Text>
      )}
      <Pressable onPress={() => { haptics.select(); setPicking(p => !p); }}
        style={[styles.catChip, { backgroundColor: t.primarySoft, borderColor: t.primary }]}>
        <Text style={{ color: t.primary, fontWeight: '700' }}>{icon(cat)} {cat}</Text>
        <Ionicons name={picking ? 'chevron-up' : 'chevron-down'} size={14} color={t.primary} />
      </Pressable>
      {picking && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} keyboardShouldPersistTaps="handled">
          {cats.map(c => (
            <Pressable key={c} onPress={() => { setCat(c); setPicking(false); haptics.select(); }}
              style={[styles.catOpt, { backgroundColor: c === cat ? t.primarySoft : t.surface2, borderColor: c === cat ? t.primary : 'transparent' }]}>
              <Text style={{ fontSize: 20 }}>{icon(c)}</Text>
              <Text style={{ fontSize: 10, color: t.textMuted }} numberOfLines={1}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {others.length > 0 && (
        <View style={styles.whoRow}>
          <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '700' }}>Чей расход:</Text>
          {['', ...others].map(n => {
            const on = who === n;
            return (
              <Pressable key={n || '_me'} onPress={() => { haptics.select(); setWho(n); }}
                style={[styles.whoChip, { backgroundColor: on ? t.primarySoft : t.surface2, borderColor: on ? t.primary : 'transparent' }]}>
                <Text style={{ color: on ? t.primary : t.textMuted, fontWeight: '700', fontSize: 13 }}>{n || 'Мой'}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {!!who && (
        <Text style={{ color: t.textFaint, fontSize: 12, marginTop: 6 }}>
          Запишется на {nameAcc(who)} с пометкой «{me} за {nameAcc(who)}»
        </Text>
      )}
      <View style={styles.btns}>
        <SecondaryButton title="Скрыть" style={{ flex: 1 }} onPress={() => { haptics.light(); dismiss(item); }} />
        <PrimaryButton title={who ? `Добавить за ${nameAcc(who)}` : 'Добавить'} style={{ flex: 1.4 }} loading={busy} onPress={add} />
      </View>
    </View>
  );
}

export function BankInboxHost() {
  const t = useTheme();
  const [open, setOpen] = useState(_open);
  const [items, setItems] = useState<InboxItem[]>([]);
  const load = useCallback(() => { getInbox('pending').then(setItems).catch(() => {}); }, []);

  useEffect(() => {
    const l = () => { setOpen(true); load(); };
    openers.add(l);
    return () => { openers.delete(l); };
  }, [load]);
  useEffect(() => onInboxChange(load), [load]);
  useEffect(() => { if (open) load(); }, [open, load]);

  const close = () => { _open = false; setOpen(false); };
  // Всё разобрано — закрываемся сами
  useEffect(() => { if (open && items.length === 0) { const id = setTimeout(close, 600); return () => clearTimeout(id); } }, [open, items.length]);

  if (!open) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[styles.header, { borderBottomColor: t.border, backgroundColor: t.surface }]}>
          <Text style={[styles.title, { color: t.text }]}>Из банка</Text>
          <Pressable onPress={close} hitSlop={10} accessibilityLabel="Закрыть"
            style={[styles.x, { backgroundColor: t.surface2 }]}>
            <Ionicons name="close" size={20} color={t.textMuted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled">
          <SectionTitle>{items.length ? `Ждут подтверждения · ${items.length}` : 'Всё разобрано'}</SectionTitle>
          <Text style={{ color: t.textMuted, fontSize: 13, marginBottom: spacing.md, lineHeight: 19 }}>
            Проверьте категорию и нажмите «Добавить». Переводы и всё лишнее — «Скрыть».
          </Text>
          {items.map(it => <Row key={it.id} item={it} />)}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// Плашка на главном экране
export function BankInboxBanner() {
  const t = useTheme();
  const n = useBankInboxCount();
  if (!n) return null;
  return (
    <Pressable onPress={() => { haptics.select(); openBankInbox(); }}
      style={[styles.banner, { backgroundColor: t.primarySoft, borderColor: t.primary }]}>
      <Ionicons name="card-outline" size={20} color={t.primary} />
      <Text style={{ color: t.primary, fontWeight: '800', flex: 1 }}>
        Из банка: {n} {n === 1 ? 'трата ждёт' : n < 5 ? 'траты ждут' : 'трат ждут'} подтверждения
      </Text>
      <Ionicons name="chevron-forward" size={18} color={t.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '800' },
  x: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  row: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  desc: { fontSize: 16, fontWeight: '700', padding: 0, marginBottom: 2 },
  amount: { fontSize: 18, fontWeight: '800' },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12, marginTop: spacing.sm },
  catOpt: { width: 64, alignItems: 'center', paddingVertical: 6, borderRadius: radius.md, borderWidth: 1.5, marginRight: 6, gap: 2 },
  whoRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  whoChip: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 12 },
  btns: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1 },
});
