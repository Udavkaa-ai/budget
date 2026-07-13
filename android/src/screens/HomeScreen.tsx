import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  SafeAreaView, RefreshControl, Alert,
} from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { useTheme, spacing, font, radius } from '../theme';
import { expenses as expApi, type Expense } from '../api/client';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../hooks/useAuth';

const ICONS: Record<string, string> = {
  Продукты: '🛒', Кафе: '🍽', Транспорт: '🚇', Одежда: '👗', Красота: '💄',
  Медицина: '💊', Развлечения: '🎮', Дети: '👶', Дом: '🏠', Связь: '📱', Прочее: '❓',
};

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
  const addSheetRef = useRef<BottomSheet>(null);

  const [date, setDate] = useState(todayStr());
  const [list, setList] = useState<Expense[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (d = date) => {
    try {
      const res = await expApi.forDay(d);
      setList(res.expenses ?? []);
    } catch { /* ignore */ }
  }, [date]);

  // Real-time sync
  useSocket(useCallback(() => { load(); }, [load]));

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
    load(nd);
  };

  const nextDay = () => {
    const [d, m, y] = date.split('.').map(Number);
    const today = new Date(); today.setHours(0,0,0,0);
    const dt = new Date(y, m - 1, d + 1);
    if (dt > today) return;
    const nd = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
    setDate(nd);
    load(nd);
  };

  const deleteExpense = (id: string) => {
    Alert.alert('Удалить расход?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить', style: 'destructive',
        onPress: async () => {
          await expApi.delete(id);
          setList(prev => prev.filter(e => e.id !== id));
        },
      },
    ]);
  };

  const total = list.reduce((s, e) => s + e.amount, 0);
  const isToday = date === todayStr();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.bg }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <TouchableOpacity onPress={prevDay} style={styles.navBtn}>
            <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
          </TouchableOpacity>
          <Text style={[styles.dateText, { color: t.text }]}>{date}</Text>
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
        <FlatList
          data={list}
          keyExtractor={e => e.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: t.textMuted }]}>Нет расходов за этот день</Text>
          }
          renderItem={({ item: e }) => (
            <TouchableOpacity
              style={[styles.item, { backgroundColor: t.surface, borderColor: t.border }]}
              onLongPress={() => e.user === user?.name && deleteExpense(e.id)}
            >
              <Text style={{ fontSize: 24 }}>{ICONS[e.category] ?? '❓'}</Text>
              <View style={styles.itemMid}>
                <Text style={[styles.itemDesc, { color: t.text }]}>{e.description}</Text>
                <Text style={[styles.itemMeta, { color: t.textMuted }]}>{e.category} · {e.user}</Text>
              </View>
              <Text style={[styles.itemAmt, { color: t.text }]}>{fmt(e.amount)}</Text>
            </TouchableOpacity>
          )}
        />

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
});
