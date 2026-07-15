import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Modal, TextInput, ScrollView, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, Directions } from 'react-native-gesture-handler';
import BottomSheet from '@gorhom/bottom-sheet';
import { useTheme, spacing, font, radius } from '../theme';
import { expenses as expApi, type Expense } from '../api/client';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { useCategories } from '../categories';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../hooks/useAuth';
import { getOutbox, removeFromOutbox, flushOutbox, onOutboxChange } from '../offline';
import { DayPickerModal } from '../components/Pickers';

function todayStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function dayTitle(date: string): string {
  const [d, m, y] = date.split('.').map(Number);
  const dt = new Date(y, m - 1, d); dt.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - dt.getTime()) / 86400000);
  if (diff === 0) return `Сегодня, ${date}`;
  if (diff === 1) return `Вчера, ${date}`;
  return date;
}

export default function HomeScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const { cats, icon: catIcon2 } = useCategories();
  const addSheetRef = useRef<BottomSheet>(null);

  const [date, setDate] = useState(todayStr());
  const [list, setList] = useState<Expense[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [userFilter, setUserFilter] = useState<'all' | 'me' | 'partner'>('all');
  const slide = useRef(new Animated.Value(0)).current;

  // Эффект пролистывания: контент вылетает со стороны свайпа с оттяжкой
  const animateSwitch = (dir: 1 | -1) => {
    slide.setValue(dir * 90);
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, friction: 7, tension: 60 }).start();
  };

  const load = useCallback(async (d = date) => {
    // Сначала пробуем дослать офлайн-очередь
    flushOutbox().catch(() => {});
    let server: Expense[] = [];
    try {
      const res = await expApi.forDay(d);
      server = res.expenses ?? [];
    } catch { /* офлайн — покажем хотя бы очередь */ }
    // Офлайн-записи этого дня с меткой pending
    try {
      const pending = (await getOutbox())
        .filter(o => o.date === d)
        .map(o => ({
          id: `off_${o.outboxId}`,
          date: o.date, category: o.category, amount: o.amount,
          description: o.description, user: user?.name ?? '', createdAt: o.createdAt,
          pending: true,
        } as Expense & { pending: boolean }));
      setList([...pending, ...server]);
    } catch {
      setList(server);
    }
  }, [date, user?.name]);

  // Real-time sync + обновление при изменении офлайн-очереди
  useSocket(useCallback(() => { load(); }, [load]));
  React.useEffect(() => onOutboxChange(() => { load(); }), [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const prevDay = () => {
    const [d, m, y] = date.split('.').map(Number);
    const dt = new Date(y, m - 1, d - 1);
    const nd = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
    setDate(nd);
    animateSwitch(-1);
    load(nd);
  };

  const nextDay = () => {
    const [d, m, y] = date.split('.').map(Number);
    const today = new Date(); today.setHours(0,0,0,0);
    const dt = new Date(y, m - 1, d + 1);
    if (dt > today) return;
    const nd = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
    setDate(nd);
    animateSwitch(1);
    load(nd);
  };

  const deleteExpense = (id: string) => {
    Alert.alert('Удалить расход?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить', style: 'destructive',
        onPress: async () => {
          if (id.startsWith('off_')) {
            await removeFromOutbox(parseInt(id.slice(4)));
          } else {
            await expApi.delete(id);
          }
          setEditing(null);
          setList(prev => prev.filter(e => e.id !== id));
        },
      },
    ]);
  };

  // Edit expense
  const [editing, setEditing] = useState<Expense | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmt, setEditAmt] = useState('');
  const [editCat, setEditCat] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = (e: Expense) => {
    setEditing(e);
    setEditDesc(e.description);
    setEditAmt(String(e.amount));
    setEditCat(e.category);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const amt = parseFloat(editAmt.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) { Alert.alert('Некорректная сумма'); return; }
    setSavingEdit(true);
    try {
      await expApi.update(editing.id, {
        description: editDesc.trim(),
        amount: amt,
        category: editCat,
        date: editing.date,
      });
      setEditing(null);
      load();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const total = list.reduce((s, e) => s + e.amount, 0);
  const myTotal = list.filter(e => e.user === user?.name).reduce((s, e) => s + e.amount, 0);
  const partnerTotal = total - myTotal;
  const filtered = userFilter === 'all' ? list
    : userFilter === 'me' ? list.filter(e => e.user === user?.name)
    : list.filter(e => e.user !== user?.name);
  // Группировка по участнику с подытогами — как в вебе
  type Row = (Expense & { pending?: boolean }) | { hdr: true; id: string; user: string; sum: number };
  const rows: Row[] = [];
  if (userFilter === 'all') {
    const byUser = new Map<string, (Expense & { pending?: boolean })[]>();
    for (const e of filtered) {
      const k = e.user || '—';
      if (!byUser.has(k)) byUser.set(k, []);
      byUser.get(k)!.push(e as Expense & { pending?: boolean });
    }
    for (const [u, items] of byUser) {
      if (byUser.size > 1) rows.push({ hdr: true, id: `hdr_${u}`, user: u, sum: items.reduce((s2, e) => s2 + e.amount, 0) });
      rows.push(...items);
    }
  } else {
    rows.push(...(filtered as (Expense & { pending?: boolean })[]));
  }
  const isToday = date === todayStr();

  // Свайп влево/вправо листает дни
  const flingLeft = Gesture.Fling().direction(Directions.LEFT).runOnJS(true).onEnd(() => nextDay());
  const flingRight = Gesture.Fling().direction(Directions.RIGHT).runOnJS(true).onEnd(() => prevDay());
  const dayFling = Gesture.Exclusive(flingLeft, flingRight);

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
        {/* Header — как в вебе: титул, дата, фильтр участников, итого */}
        <View style={styles.titleRow}>
          <Text style={[styles.screenTitle, { color: t.titleColor }]}>Бюджет</Text>
          <View style={[styles.userChipTop, { backgroundColor: t.surface }]}>
            <Text style={{ color: t.primary, fontWeight: '600', fontSize: font.sm }}>{user?.name ?? ''}</Text>
          </View>
        </View>
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <TouchableOpacity onPress={prevDay} style={styles.navBtn}>
            <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPickerVisible(true)}>
            <Text style={[styles.dateText, { color: t.text }]}>{dayTitle(date)} ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={nextDay} style={styles.navBtn} disabled={isToday}>
            <Text style={{ color: isToday ? t.textMuted : t.primary, fontSize: font.xl }}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Фильтр Все / Я / Партнёр с суммами */}
        <View style={styles.filterRow}>
          {([['all', 'Все', total], ['me', 'Я', myTotal], ['partner', 'Партнёр', partnerTotal]] as const).map(([k, lbl, sum]) => (
            <TouchableOpacity
              key={k}
              style={[styles.filterChip, {
                backgroundColor: userFilter === k ? t.surface : 'transparent',
                borderColor: userFilter === k ? t.primary : t.border,
              }]}
              onPress={() => setUserFilter(k)}
            >
              <Text style={{ color: userFilter === k ? t.primary : t.textMuted, fontSize: font.sm, fontWeight: userFilter === k ? '700' : '400' }}>
                {lbl}{sum > 0 ? ` ${fmt(sum)}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Итого за день */}
        <View style={[styles.totalCard, { backgroundColor: t.surface }]}>
          <Text style={[styles.totalLabel, { color: t.textMuted }]}>Итого за день</Text>
          <Text style={[styles.totalAmt, { color: t.primary }]}>
            {fmt(userFilter === 'all' ? total : userFilter === 'me' ? myTotal : partnerTotal)}
          </Text>
        </View>

        {/* Expense list */}
        <GestureDetector gesture={dayFling}>
        <Animated.View style={{ flex: 1, transform: [{ translateX: slide }] }}>
        <FlatList
          data={rows}
          keyExtractor={e => e.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: t.textMuted }]}>Нет расходов за этот день</Text>
          }
          renderItem={({ item }) => {
            if ('hdr' in item) {
              return (
                <View style={styles.groupHdr}>
                  <Text style={{ color: t.textMuted, fontSize: font.xs, letterSpacing: 1, fontWeight: '700' }}>
                    {item.user.toUpperCase()}
                  </Text>
                  <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm }}>{fmt(item.sum)}</Text>
                </View>
              );
            }
            const e = item;
            const pending = (e as Expense & { pending?: boolean }).pending;
            return (
            <TouchableOpacity
              style={[styles.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pending ? 0.75 : 1 }]}
              onPress={() => !pending && e.user === user?.name && openEdit(e)}
              onLongPress={() => (pending || e.user === user?.name) && deleteExpense(e.id)}
            >
              <Text style={{ fontSize: 24 }}>{catIcon2(e.category)}</Text>
              <View style={styles.itemMid}>
                <Text style={[styles.itemDesc, { color: t.text }]}>{e.description}</Text>
                <Text style={[styles.itemMeta, { color: t.textMuted }]}>
                  {pending ? '⏳ ожидает синхронизации · ' : ''}{e.category} · {e.user}
                </Text>
              </View>
              <Text style={[styles.itemAmt, { color: t.text }]}>{fmt(e.amount)}</Text>
            </TouchableOpacity>
            );
          }}
        />
        </Animated.View>
        </GestureDetector>

        <DayPickerModal
          visible={pickerVisible}
          date={date}
          onClose={() => setPickerVisible(false)}
          onPick={d => { setDate(d); load(d); }}
        />

        {/* Edit expense modal */}
        <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalBox, { backgroundColor: t.surface }]}>
              <Text style={[styles.modalTitle, { color: t.text }]}>Редактировать</Text>
              <TextInput
                style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="Описание"
                placeholderTextColor={t.textMuted}
              />
              <TextInput
                style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                value={editAmt}
                onChangeText={setEditAmt}
                placeholder="Сумма, ₽"
                placeholderTextColor={t.textMuted}
                keyboardType="decimal-pad"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
                {cats.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, { backgroundColor: editCat === cat ? t.primary : t.surface2 }]}
                    onPress={() => setEditCat(cat)}
                  >
                    <Text style={{ color: editCat === cat ? '#fff' : t.text, fontSize: font.sm }}>
                      {catIcon2(cat)} {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.surface2 }]} onPress={() => setEditing(null)}>
                  <Text style={{ color: t.text }}>Отмена</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalBtn, { backgroundColor: t.primary }]} onPress={saveEdit} disabled={savingEdit}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Сохранить</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity
                style={{ alignItems: 'center', marginTop: spacing.md }}
                onPress={() => editing && deleteExpense(editing.id)}
              >
                <Text style={{ color: t.danger }}>Удалить расход</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* FAB */}
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: t.primary }]}
          onPress={() => addSheetRef.current?.expand()}
        >
          <Text style={{ color: '#fff', fontSize: font.xxl, lineHeight: 32 }}>+</Text>
        </TouchableOpacity>

        {user && (
          <AddExpenseSheet
            ref={addSheetRef}
            user={user}
            onAdded={() => load()}
          />
        )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1 },
  titleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  screenTitle:{ fontSize: font.xxl, fontWeight: '800' },
  userChipTop:{ borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  filterRow:  { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  filterChip: { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1.5 },
  totalCard:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: spacing.md, marginBottom: 0, padding: spacing.lg, borderRadius: radius.lg },
  groupHdr:   { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.xs },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  navBtn:     { padding: spacing.md },
  dateText:   { fontSize: font.lg, fontWeight: '600' },
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  totalLabel: { fontSize: font.sm },
  totalAmt:   { fontSize: font.lg, fontWeight: '700' },
  empty:      { textAlign: 'center', marginTop: 60, fontSize: font.md },
  item:       { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.sm },
  itemMid:    { flex: 1 },
  itemDesc:   { fontSize: font.md, fontWeight: '500' },
  itemMeta:   { fontSize: font.sm, marginTop: 2 },
  itemAmt:    { fontSize: font.md, fontWeight: '700' },
  fab:        { position: 'absolute', bottom: 24, right: 24, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', elevation: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalBox:   { borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: font.lg, fontWeight: '700', marginBottom: spacing.md },
  input:      { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
  catChip:    { borderRadius: radius.xl, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginRight: spacing.sm },
  modalBtn:   { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
});
