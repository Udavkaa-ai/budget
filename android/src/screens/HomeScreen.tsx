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

export default function HomeScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const { cats, icon: catIcon2 } = useCategories();
  const addSheetRef = useRef<BottomSheet>(null);

  const [date, setDate] = useState(todayStr());
  const [list, setList] = useState<Expense[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
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
  const isToday = date === todayStr();

  // Свайп влево/вправо листает дни
  const flingLeft = Gesture.Fling().direction(Directions.LEFT).runOnJS(true).onEnd(() => nextDay());
  const flingRight = Gesture.Fling().direction(Directions.RIGHT).runOnJS(true).onEnd(() => prevDay());
  const dayFling = Gesture.Exclusive(flingLeft, flingRight);

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <TouchableOpacity onPress={prevDay} style={styles.navBtn}>
            <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPickerVisible(true)}>
            <Text style={[styles.dateText, { color: t.text }]}>{date} ▾</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={nextDay} style={styles.navBtn} disabled={isToday}>
            <Text style={{ color: isToday ? t.textMuted : t.primary, fontSize: font.xl }}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Total */}
        {total > 0 && (
          <View style={[styles.totalRow, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
            <Text style={[styles.totalLabel, { color: t.textMuted }]}>Итого</Text>
            <Text style={[styles.totalAmt, { color: t.text }]}>{fmt(total)}</Text>
          </View>
        )}

        {/* Expense list */}
        <GestureDetector gesture={dayFling}>
        <Animated.View style={{ flex: 1, transform: [{ translateX: slide }] }}>
        <FlatList
          data={list}
          keyExtractor={e => e.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: t.textMuted }]}>Нет расходов за этот день</Text>
          }
          renderItem={({ item: e }) => {
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
