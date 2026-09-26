import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../theme';
import { Finik } from '../components/Finik';
import {
  summary as summaryApi, cashflow as cfApi,
  type UnifiedChart, type Cashflow, type CashflowMember,
} from '../api/client';
import { Card } from '../components/Card';
import { useAuth } from '../hooks/useAuth';
import { useBlocks } from '../blocks';
import { useSocket } from '../hooks/useSocket';
import { MonthPickerModal } from '../components/Pickers';
import { ScreenGradient } from '../components/ScreenGradient';
import { haptics } from '../haptics';
import { useTourTarget } from '../tourTargets';
import { MonthCharts } from '../components/MonthCharts';
import { SectionTitle, PrimaryButton } from '../components/UI';
import { settings as settingsApi } from '../api/client';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

function fmtShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}м`;
  if (a >= 1000) return `${Math.round(n / 1000)}к`;
  return String(Math.round(n));
}

function getMonthName(m: number, y: number) {
  const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  return `${names[m - 1]} ${y}`;
}

async function fetchLast6Months() {
  const now = new Date();
  const results: Array<{ label: string; total: number }> = [];
  const short = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const y = d.getFullYear();
    try {
      const s = await summaryApi.get(m, y);
      results.push({ label: `${short[m - 1]} ${y}`, total: s.total });
    } catch {
      results.push({ label: `${short[m - 1]} ${y}`, total: 0 });
    }
  }
  return results;
}

export default function ChartScreen() {
  const t = useTheme();
  const { user } = useAuth();
  const blocks = useBlocks();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const ym = `${year}-${String(month).padStart(2, '0')}`;

  const [unified, setUnified] = useState<UnifiedChart | null>(null);
  const [plannedMonthly, setPlannedMonthly] = useState(0);
  const [months6, setMonths6] = useState<Array<{ label: string; total: number }>>([]);
  const [loading, setLoading] = useState(true);
  const chartTarget = useTourTarget('chart.main');

  // Кэшфлоу-редактор
  const [members, setMembers] = useState<Record<string, CashflowMember>>({});
  const [incomeDays, setIncomeDays] = useState<Array<{ day: string; amount: string; user: string }>>([]);
  const [savingCf, setSavingCf] = useState(false);
  const [monthPicker, setMonthPicker] = useState(false);

  const load = useCallback(async (m = month, y = year) => {
    setLoading(true);
    const key = `${y}-${String(m).padStart(2, '0')}`;
    try {
      const [u, cf, st] = await Promise.all([
        cfApi.unified(key).catch(() => null),
        cfApi.get(key).catch(() => ({} as Cashflow)),
        settingsApi.get().catch(() => ({} as { plannedMonthly?: number })),
      ]);
      setUnified(u);
      setPlannedMonthly(st.plannedMonthly ?? 0);
      const mem: Record<string, CashflowMember> = {};
      for (const [name, v] of Object.entries(cf.members ?? {})) {
        mem[name] = { debit: v.debit || 0, credit: v.credit || 0, savings: v.savings || 0 };
      }
      // Всегда показываем блок для текущего пользователя и участников графика
      const names = new Set<string>([
        ...Object.keys(mem),
        ...Object.keys(u?.userExpenses ?? {}),
        ...(user?.name ? [user.name] : []),
      ]);
      for (const n of names) if (!mem[n]) mem[n] = { debit: 0, credit: 0, savings: 0 };
      setMembers(mem);
      const inc = Array.isArray(cf.incomeDays) ? cf.incomeDays : [];
      setIncomeDays(inc.map(e => ({ day: String(e.day), amount: String(e.amount), user: e.user || '' })));
    } finally {
      setLoading(false);
    }
  }, [month, year, user?.name]);

  // Грузим при входе на вкладку и возврате на неё. Без этого экран оставался
  // на данных момента монтирования: кэшфлоу/доход, изменённые в вебе или на
  // другом устройстве, не появлялись, пока не перезапустишь приложение
  // (в таб-навигаторе экран не размонтируется). Ровно как в HomeScreen.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  // Real-time: чужое изменение (в т.ч. E2E-синк по 'sync:changed') → перезагрузка
  useSocket(useCallback(() => { load(); }, [load]));
  useEffect(() => { fetchLast6Months().then(setMonths6); }, []);

  const nav = (dir: -1 | 1) => {
    const d = new Date(year, month - 1 + dir, 1);
    const cur = new Date(); cur.setDate(1); cur.setHours(0, 0, 0, 0);
    if (dir === 1 && d > cur) return;
    haptics.light();
    setMonth(d.getMonth() + 1); setYear(d.getFullYear());
    load(d.getMonth() + 1, d.getFullYear());
  };

  const saveCf = async () => {
    setSavingCf(true);
    try {
      const body: Cashflow = {
        members,
        incomeDays: incomeDays
          .map(e => ({ day: parseInt(e.day) || 0, amount: parseInt(e.amount) || 0, user: e.user || '' }))
          .filter(e => e.day >= 1 && e.day <= 31 && e.amount > 0),
      };
      await cfApi.save(ym, body);
      haptics.success();
      Alert.alert('Кэшфлоу сохранён');
      load();
    } catch (e) {
      Alert.alert('Ошибка', String(e));
    } finally {
      setSavingCf(false);
    }
  };

  const setMemberField = (name: string, field: keyof CashflowMember, v: string) => {
    const n = parseInt(v.replace(/[^-\d]/g, '')) || 0;
    setMembers(m => ({ ...m, [name]: { ...m[name], [field]: n } }));
  };

  // Список участников семьи для выбора «чей доход» (как select в вебе)
  const memberNames = Object.keys(members);
  const pickIncomeUser = (i: number) => {
    if (memberNames.length <= 1) return;
    haptics.select();
    Alert.alert('Чей доход?', undefined, [
      ...memberNames.map(n => ({ text: n, onPress: () => setIncomeDays(d => d.map((x, xi) => xi === i ? { ...x, user: n } : x)) })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  };
  const addIncomeDay = () => {
    haptics.light();
    setIncomeDays(d => [...d, { day: '', amount: '', user: user?.name || memberNames[0] || '' }]);
  };

  // Живые итоги (пересчёт при вводе), как в вебе
  const cfStartTotal = Object.values(members).reduce((s, m) => s + (m.debit || 0) + (m.credit || 0) + (m.savings || 0), 0);
  const cfIncomeTotal = incomeDays.reduce((s, e) => s + (parseInt(e.amount) || 0), 0);

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <ScreenGradient tint="chart" />
      <View style={styles.header}>
        <Text style={[styles.title, { color: t.primary }]}>График</Text>
      </View>

      {/* Month nav */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => nav(-1)} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMonthPicker(true)}>
          <Text style={[styles.navLabel, { color: t.text }]}>{getMonthName(month, year)} ▾</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => nav(1)} style={styles.navBtn}>
          <Text style={{ color: t.primary, fontSize: font.xl }}>›</Text>
        </TouchableOpacity>
      </View>

      <MonthPickerModal
        visible={monthPicker}
        month={month}
        year={year}
        onClose={() => setMonthPicker(false)}
        onPick={(m, y) => { setMonth(m); setYear(y); load(m, y); }}
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 24 }}>

          {unified && (
            <View ref={chartTarget} collapsable={false}>
              <MonthCharts data={unified} plan={plannedMonthly} month={month} year={year} />
            </View>
          )}

          {/* Кэшфлоу редактор */}
          <Card>
            <SectionTitle>Кэшфлоу</SectionTitle>
            <View style={[styles.cfRow, { marginBottom: 2 }]}>
              <View style={{ flex: 1.1 }} />
              {['ДЕБЕТ', 'КРЕДИТ', 'СБЕРЕЖ.'].map(h => (
                <Text key={h} style={{ flex: 1, color: t.textMuted, fontSize: 9, textAlign: 'center' }}>{h}</Text>
              ))}
            </View>
            {Object.entries(members).map(([name, m]) => (
              <View key={name} style={[styles.cfRow, { marginBottom: spacing.xs }]}>
                <Text style={{ flex: 1.1, color: t.primary, fontWeight: '600', fontSize: font.sm }} numberOfLines={1}>{name}</Text>
                {(['debit', 'credit', 'savings'] as const).map(f => (
                  <TextInput
                    key={f}
                    style={[styles.cfInputSm, { flex: 1, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                    value={m[f] ? String(m[f]) : ''}
                    onChangeText={v => setMemberField(name, f, v)}
                    placeholder="0"
                    placeholderTextColor={t.textMuted}
                    keyboardType="numbers-and-punctuation"
                  />
                ))}
              </View>
            ))}

            {/* Итог стартового баланса на 1-е число (как в вебе) */}
            <View style={styles.cfStartRow}>
              <Text style={{ color: t.textMuted, fontSize: font.sm }}>Итого на 1-е число</Text>
              <Text style={{ color: t.primary, fontSize: font.lg, fontWeight: '800' }}>{fmt(cfStartTotal)}</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md }}>
              <Finik emotion="inspect" size={48} />
              <Text style={{ color: t.text, fontSize: font.md, fontWeight: '700', flex: 1 }}>
                Поступления по дням
              </Text>
            </View>
            <Text style={{ color: t.textMuted, fontSize: font.xs, marginBottom: spacing.sm }}>
              Кто, в какой день месяца и сколько зачислено
            </Text>
            {incomeDays.map((e, i) => (
              <View key={i} style={[styles.cfDayRow, { marginBottom: spacing.xs }]}>
                <TouchableOpacity
                  onPress={() => pickIncomeUser(i)}
                  style={[styles.cfUserPill, { backgroundColor: t.surface2, borderColor: t.border }]}
                >
                  <Text style={{ color: t.primary, fontWeight: '600', fontSize: font.xs }} numberOfLines={1}>
                    {e.user || memberNames[0] || '—'}
                  </Text>
                  {memberNames.length > 1 && <Text style={{ color: t.textMuted, fontSize: 9 }}> ▾</Text>}
                </TouchableOpacity>
                <Text style={{ color: t.textMuted, fontSize: font.xs }}>д.</Text>
                <TextInput
                  style={[styles.cfInputSm, { width: 42, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                  value={e.day}
                  onChangeText={v => setIncomeDays(d => d.map((x, xi) => xi === i ? { ...x, day: v } : x))}
                  placeholder="1"
                  placeholderTextColor={t.textMuted}
                  keyboardType="number-pad"
                />
                <TextInput
                  style={[styles.cfInputSm, { flex: 1, color: t.text, borderColor: t.border, backgroundColor: t.surface2 }]}
                  value={e.amount}
                  onChangeText={v => setIncomeDays(d => d.map((x, xi) => xi === i ? { ...x, amount: v } : x))}
                  placeholder="0"
                  placeholderTextColor={t.textMuted}
                  keyboardType="number-pad"
                />
                <Text style={{ color: t.textMuted, fontSize: font.sm }}>₽</Text>
                <TouchableOpacity onPress={() => setIncomeDays(d => d.filter((_, xi) => xi !== i))} style={{ paddingHorizontal: spacing.xs, paddingVertical: spacing.sm }} hitSlop={8} accessibilityLabel="Удалить день дохода" accessibilityRole="button">
                  <Text style={{ color: t.danger, fontSize: font.lg }}>×</Text>
                </TouchableOpacity>
              </View>
            ))}

            {/* Итог доходов за месяц — зелёная плашка (как в вебе) */}
            {cfIncomeTotal > 0 && (
              <View style={[styles.cfIncomeTotal, { backgroundColor: t.successSoft }]}>
                <Text style={{ color: t.textMuted, fontSize: font.sm }}>Итого доходов за месяц</Text>
                <Text style={{ color: t.success, fontSize: font.lg, fontWeight: '800' }}>{fmt(cfIncomeTotal)}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={addIncomeDay}
              style={[styles.cfAddBtn, { borderColor: t.primary }]}
            >
              <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.md }}>+ Добавить день дохода</Text>
            </TouchableOpacity>

            <PrimaryButton title="Сохранить кэшфлоу" onPress={saveCf} loading={savingCf} />
          </Card>

          {/* 6 месяцев */}
          {blocks.months6 !== false && months6.length > 0 && (
            <Card>
              <SectionTitle>Расходы за 6 месяцев</SectionTitle>
              <View style={styles.chart6}>
                {months6.map(({ label, total }) => {
                  const mx = Math.max(...months6.map(x => x.total), 1);
                  const pct = total / mx;
                  return (
                    <TouchableOpacity key={label} style={styles.barCol} onPress={() => Alert.alert(label, fmt(total))}>
                      <Text style={{ fontSize: 9, color: t.textMuted, marginBottom: 2 }}>
                        {total > 0 ? fmtShort(total) : ''}
                      </Text>
                      <View style={styles.barWrap}>
                        <View style={{
                          width: '100%',
                          height: Math.max(pct * 70, 3),
                          borderRadius: 4,
                          backgroundColor: t.primary,
                          opacity: pct > 0 ? 1 : 0.2,
                        }} />
                      </View>
                      <Text style={{ fontSize: 9, color: t.textMuted, marginTop: 4 }} numberOfLines={1}>
                        {label.split(' ')[0]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Card>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:         { flex: 1 },
  header:       { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title:        { fontSize: font.xxl, fontWeight: '800' },
  nav:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md },
  navBtn:       { padding: spacing.md },
  navLabel:     { fontSize: font.lg, fontWeight: '600' },
  sectionTitle: { fontSize: font.md, fontWeight: '700', marginBottom: spacing.md },
  legend:       { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  legendItem:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:    { width: 10, height: 10, borderRadius: 5 },
  dayCard:      { borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  dayChip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: 'rgba(89,71,224,0.06)' },
  dayChart:     { flexDirection: 'row', alignItems: 'flex-end', height: 130, gap: 1 },
  dayCol:       { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  dayBarWrap:   { width: '100%', justifyContent: 'flex-end' },
  balBar:       { width: '100%', borderRadius: 2, minHeight: 2 },
  cfRow:        { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  cfInput:      { borderRadius: radius.sm, borderWidth: 1, padding: spacing.sm, fontSize: font.sm, textAlign: 'center' },
  cfInputSm:    { borderRadius: radius.sm, borderWidth: 1, paddingVertical: 7, paddingHorizontal: 6, fontSize: font.sm, textAlign: 'center' },
  cfStartRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(128,128,128,0.25)' },
  cfDayRow:     { flexDirection: 'row', gap: 4, alignItems: 'center' },
  cfUserPill:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 8, maxWidth: 96, minWidth: 62 },
  cfIncomeTotal:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  cfAddBtn:     { borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, marginBottom: spacing.md },
  saveBtn:      { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  chart6:       { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, height: 110 },
  barCol:       { flex: 1, alignItems: 'center' },
  barWrap:      { flex: 1, justifyContent: 'flex-end', width: '100%' },
});
