import React, { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Modal, TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import BottomSheet from '@gorhom/bottom-sheet';
import { useTheme, spacing, font, radius } from '../theme';
import { expenses as expApi, type Expense } from '../api/client';
import { AddExpenseSheet } from '../components/AddExpenseSheet';
import { useCategories } from '../categories';
import { useSocket } from '../hooks/useSocket';
import { useAuth } from '../hooks/useAuth';
import { getOutbox, removeFromOutbox, flushOutbox, onOutboxChange } from '../offline';
import { DayPickerModal } from '../components/Pickers';
import { ScreenGradient } from '../components/ScreenGradient';
import { SwipePager } from '../components/Motion';
import { SuccessFlash } from '../components/SuccessFlash';
import { haptics } from '../haptics';
import { useTourTarget } from '../tourTargets';
import { openHelp } from '../help';

function todayStr() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function shiftDay(date: string, delta: number): string {
  const [d, m, y] = date.split('.').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`;
}

function isFutureDay(date: string): boolean {
  const [d, m, y] = date.split('.').map(Number);
  const dt = new Date(y, m - 1, d); dt.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return dt > today;
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

// Строка ленты: расход или заголовок-подытог участника (группировка «Все»).
type Row = (Expense & { pending?: boolean }) | { hdr: true; id: string; user: string; sum: number };

// Готовит строки ленты за день (фильтр по участнику + группировка с подытогами,
// как в вебе). Вынесено, чтобы карусель могла строить и соседние дни.
function buildRows(expenses: (Expense & { pending?: boolean })[], userFilter: 'all' | 'me' | 'partner', userName?: string): Row[] {
  const filtered = userFilter === 'all' ? expenses
    : userFilter === 'me' ? expenses.filter(e => e.user === userName)
    : expenses.filter(e => e.user !== userName);
  const rows: Row[] = [];
  if (userFilter === 'all') {
    const byUser = new Map<string, (Expense & { pending?: boolean })[]>();
    for (const e of filtered) {
      const k = e.user || '—';
      if (!byUser.has(k)) byUser.set(k, []);
      byUser.get(k)!.push(e);
    }
    for (const [u, items] of byUser) {
      if (byUser.size > 1) rows.push({ hdr: true, id: `hdr_${u}`, user: u, sum: items.reduce((s, e) => s + e.amount, 0) });
      rows.push(...items);
    }
  } else {
    rows.push(...filtered);
  }
  return rows;
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
  const [addedFlash, setAddedFlash] = useState(0);
  const fabTarget = useTourTarget('home.fab');
  const filterTarget = useTourTarget('home.filter');

  // Кэш дней: чтобы при свайпе новый день показывался МГНОВЕННО, без мелькания
  // старого. Соседние дни подгружаются заранее; смена дня берёт данные из кэша
  // синхронно, а фоновый load() затем обновляет их.
  const cacheRef = useRef<Map<string, Expense[]>>(new Map());

  const fetchDay = useCallback(async (d: string): Promise<Expense[]> => {
    flushOutbox().catch(() => {});
    let server: Expense[] = [];
    try {
      const res = await expApi.forDay(d);
      server = res.expenses ?? [];
    } catch { /* офлайн — покажем хотя бы очередь */ }
    let pending: Expense[] = [];
    try {
      pending = (await getOutbox())
        .filter(o => o.date === d)
        .map(o => ({
          id: `off_${o.outboxId}`,
          date: o.date, category: o.category, amount: o.amount,
          description: o.description, user: user?.name ?? '', createdAt: o.createdAt,
          pending: true,
        } as Expense & { pending: boolean }));
    } catch { /* ignore */ }
    const combined = [...pending, ...server];
    cacheRef.current.set(d, combined);
    return combined;
  }, [user?.name]);

  // Тихо подгружаем вчера/завтра в кэш (не блокируя экран)
  const preloadNeighbors = useCallback((d: string) => {
    for (const nd of [shiftDay(d, -1), shiftDay(d, 1)]) {
      if (!isFutureDay(nd) && !cacheRef.current.has(nd)) fetchDay(nd).catch(() => {});
    }
  }, [fetchDay]);

  const load = useCallback(async (d = date) => {
    setList(await fetchDay(d));
    preloadNeighbors(d);
  }, [date, fetchDay, preloadNeighbors]);

  // Загружаем день при входе на вкладку и при возврате на неё. Это же
  // покрывает первый показ «Сегодня»: раньше начальной загрузки не было —
  // список оставался пустым, пока не перелистнёшь день или не обновишь вручную.
  // Смена даты пересоздаёт load → эффект перезапускается с новой датой.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Real-time sync + обновление при изменении офлайн-очереди. Чужие/локальные
  // изменения могли затронуть любой день — сбрасываем кэш, чтобы соседи
  // перечитались свежими.
  useSocket(useCallback(() => { cacheRef.current.clear(); load(); }, [load]));
  React.useEffect(() => onOutboxChange(() => { cacheRef.current.clear(); load(); }), [load]);

  const onRefresh = async () => {
    haptics.light();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Переход на другой день: сразу показываем его из кэша (если есть) —
  // так в момент свайпа виден УЖЕ нужный день, без мелькания предыдущего.
  // Затем смена date триггерит load() (useFocusEffect) и обновляет данные.
  const goToDay = (nd: string) => {
    setDate(nd);
    const cached = cacheRef.current.get(nd);
    if (cached) setList(cached);
    haptics.light();
  };

  const prevDay = () => goToDay(shiftDay(date, -1));
  const nextDay = () => { if (!isFutureDay(shiftDay(date, 1))) goToDay(shiftDay(date, 1)); };

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
          haptics.warning();
          setEditing(null);
          cacheRef.current.delete(date);
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
  const rows = buildRows(list as (Expense & { pending?: boolean })[], userFilter, user?.name);
  const isToday = date === todayStr();

  // Одна строка ленты (расход или заголовок группы) — используется и центральным
  // списком, и статичными соседними страницами карусели (без каскад-анимации,
  // чтобы при листании не «перемигивало»).
  const renderRowContent = (item: Row) => {
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
        activeOpacity={0.7}
        style={[styles.item, { backgroundColor: t.surface, borderColor: t.border, opacity: pending ? 0.75 : 1 }]}
        onLongPress={() => {
          if (pending) { deleteExpense(e.id); }
          else if (e.user === user?.name) { haptics.select(); openEdit(e); }
        }}
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
  };

  // Статичная страница соседнего дня для карусели (данные из кэша предзагрузки).
  const renderNeighborPage = (d: string) => {
    const nrows = buildRows((cacheRef.current.get(d) ?? []) as (Expense & { pending?: boolean })[], userFilter, user?.name);
    return (
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
      >
        {nrows.length === 0
          ? <Text style={[styles.empty, { color: t.textMuted }]}>Нет расходов за этот день</Text>
          : nrows.map(item => <React.Fragment key={item.id}>{renderRowContent(item)}</React.Fragment>)}
      </ScrollView>
    );
  };

  // Горизонтальный свайп листает дни. Pan с активацией только по X и провалом
  // по Y — вертикальный скролл ленты не перехватывается, а тап по строке не
  // конфликтует со свайпом (редактирование теперь по долгому нажатию).
  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
        <ScreenGradient tint="home" />
        {/* Header — как в вебе: титул, дата, фильтр участников, итого */}
        <View style={styles.titleRow}>
          <Text style={[styles.screenTitle, { color: t.titleColor }]}>Бюджет</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <TouchableOpacity onPress={openHelp} hitSlop={8}>
              <Ionicons name="help-circle-outline" size={26} color={t.primary} />
            </TouchableOpacity>
            <View style={[styles.userChipTop, { backgroundColor: t.surface }]}>
              <Text style={{ color: t.primary, fontWeight: '600', fontSize: font.sm }}>{user?.name ?? ''}</Text>
            </View>
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

        {/* Фильтр Все / Я / Партнёр с суммами — стиль веб-чипов, скролл вместо обрезки */}
        <View ref={filterTarget} collapsable={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.filterRow}>
          {([['all', 'Все', total], ['me', 'Я', myTotal], ['partner', 'Партнёр', partnerTotal]] as const).map(([k, lbl, sum]) => (
            <TouchableOpacity
              key={k}
              style={[styles.filterChip, {
                backgroundColor: userFilter === k ? t.surface2 : t.surface,
                borderColor: userFilter === k ? t.primary : t.border,
              }]}
              onPress={() => { haptics.select(); setUserFilter(k); }}
            >
              <Text numberOfLines={1} style={{ color: userFilter === k ? t.primary : t.textMuted, fontSize: font.sm, fontWeight: '600' }}>
                {lbl}{sum > 0 ? ` · ${fmt(sum)}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        </View>

        {/* Итого за день */}
        <View style={[styles.totalCard, { backgroundColor: t.surface }]}>
          <Text style={[styles.totalLabel, { color: t.textMuted }]}>Итого за день</Text>
          <Text style={[styles.totalAmt, { color: t.primary }]}>
            {fmt(userFilter === 'all' ? total : userFilter === 'me' ? myTotal : partnerTotal)}
          </Text>
        </View>

        {/* Expense list — свайп влево/вправо меняет день (1:1, инерция, резинка) */}
        <SwipePager
          canNext={!isToday}
          onPrev={prevDay}
          onNext={nextDay}
          onCommit={() => haptics.light()}
          prev={renderNeighborPage(shiftDay(date, -1))}
          next={isToday ? null : renderNeighborPage(shiftDay(date, 1))}
        >
        <FlatList
          data={rows}
          keyExtractor={e => e.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: t.textMuted }]}>Нет расходов за этот день</Text>
          }
          renderItem={({ item }) => renderRowContent(item)}
        />
        </SwipePager>

        <DayPickerModal
          visible={pickerVisible}
          date={date}
          onClose={() => setPickerVisible(false)}
          onPick={d => { setDate(d); }}
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
                    style={[styles.catChip, {
                      backgroundColor: editCat === cat ? t.primary : t.surface2,
                      borderWidth: 2, borderColor: editCat === cat ? t.primary : 'transparent',
                    }]}
                    onPress={() => setEditCat(cat)}
                  >
                    <Text style={{ fontSize: 24 }}>{catIcon2(cat)}</Text>
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

        {/* FAB — градиент как у веб-кнопок */}
        <TouchableOpacity
          ref={fabTarget}
          activeOpacity={0.85}
          style={styles.fab}
          onPress={() => { haptics.medium(); addSheetRef.current?.expand(); }}
        >
          <LinearGradient
            colors={t.gradient}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={styles.fabInner}
          >
            <Ionicons name="add" size={30} color="#fff" />
          </LinearGradient>
        </TouchableOpacity>

        <SuccessFlash token={addedFlash} label="Расход добавлен" />

        {user && (
          <AddExpenseSheet
            ref={addSheetRef}
            user={user}
            onAdded={() => { setAddedFlash(n => n + 1); load(); }}
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
  totalCard:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', margin: spacing.md, marginBottom: spacing.xs, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: 'rgba(89,71,224,0.16)', shadowColor: '#5947E0', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  groupHdr:   { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.xs, paddingTop: spacing.md, paddingBottom: spacing.xs },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  navBtn:     { padding: spacing.md },
  dateText:   { fontSize: font.lg, fontWeight: '600' },
  totalRow:   { flexDirection: 'row', justifyContent: 'space-between', padding: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  totalLabel: { fontSize: font.sm },
  totalAmt:   { fontSize: font.lg, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  empty:      { textAlign: 'center', marginTop: 60, fontSize: font.md },
  item:       { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.sm },
  itemMid:    { flex: 1 },
  itemDesc:   { fontSize: font.md, fontWeight: '500' },
  itemMeta:   { fontSize: font.sm, marginTop: 2 },
  itemAmt:    { fontSize: font.md, fontWeight: '700' },
  fab:        { position: 'absolute', bottom: 24, right: 24, width: 60, height: 60, borderRadius: 30, elevation: 8, shadowColor: '#5947E0', shadowOpacity: 0.4, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  fabInner:   { flex: 1, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  modalBox:   { borderRadius: radius.lg, padding: spacing.lg },
  modalTitle: { fontSize: font.lg, fontWeight: '700', marginBottom: spacing.md },
  input:      { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
  catChip:    { borderRadius: radius.md, width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  modalBtn:   { flex: 1, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
});
