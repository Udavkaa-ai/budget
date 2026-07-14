import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { useTheme, spacing, font, radius } from '../theme';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

// Быстрый переход к месяцу: сетка 12 месяцев + навигация по годам
export function MonthPickerModal({ visible, month, year, onClose, onPick }: {
  visible: boolean;
  month: number; // 1-12
  year: number;
  onClose: () => void;
  onPick: (m: number, y: number) => void;
}) {
  const t = useTheme();
  const [y, setY] = useState(year);
  const now = new Date();
  React.useEffect(() => { if (visible) setY(year); }, [visible, year]);

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[styles.box, { backgroundColor: t.surface }]} onStartShouldSetResponder={() => true}>
          <View style={styles.head}>
            <TouchableOpacity onPress={() => setY(v => v - 1)} style={styles.navBtn}>
              <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '700' }}>{y}</Text>
            <TouchableOpacity onPress={() => setY(v => v + 1)} style={styles.navBtn}>
              <Text style={{ color: t.primary, fontSize: font.xl }}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.grid}>
            {MONTHS.map((name, i) => {
              const m = i + 1;
              const future = y > now.getFullYear() || (y === now.getFullYear() && m > now.getMonth() + 1);
              const active = m === month && y === year;
              return (
                <TouchableOpacity
                  key={m}
                  disabled={future}
                  style={[styles.cell, { backgroundColor: active ? t.primary : t.surface2, opacity: future ? 0.35 : 1 }]}
                  onPress={() => { onPick(m, y); onClose(); }}
                >
                  <Text style={{ color: active ? '#fff' : t.text, fontSize: font.sm }}>{name.slice(0, 3)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

// Быстрый переход к дню: календарь месяца
export function DayPickerModal({ visible, date, onClose, onPick }: {
  visible: boolean;
  date: string; // DD.MM.YYYY
  onClose: () => void;
  onPick: (d: string) => void;
}) {
  const t = useTheme();
  const [dd, mm, yy] = date.split('.').map(Number);
  const [vm, setVm] = useState(mm);
  const [vy, setVy] = useState(yy);
  React.useEffect(() => { if (visible) { setVm(mm); setVy(yy); } }, [visible, date]);

  const now = new Date(); now.setHours(0, 0, 0, 0);
  const daysInMonth = new Date(vy, vm, 0).getDate();
  const firstWeekday = (new Date(vy, vm - 1, 1).getDay() + 6) % 7;

  const nav = (dir: -1 | 1) => {
    const d = new Date(vy, vm - 1 + dir, 1);
    setVm(d.getMonth() + 1); setVy(d.getFullYear());
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={[styles.box, { backgroundColor: t.surface }]} onStartShouldSetResponder={() => true}>
          <View style={styles.head}>
            <TouchableOpacity onPress={() => nav(-1)} style={styles.navBtn}>
              <Text style={{ color: t.primary, fontSize: font.xl }}>‹</Text>
            </TouchableOpacity>
            <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '700' }}>{MONTHS[vm - 1]} {vy}</Text>
            <TouchableOpacity onPress={() => nav(1)} style={styles.navBtn}>
              <Text style={{ color: t.primary, fontSize: font.xl }}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.grid7}>
            {['ПН','ВТ','СР','ЧТ','ПТ','СБ','ВС'].map(w => (
              <Text key={w} style={[styles.weekHead, { color: t.textMuted }]}>{w}</Text>
            ))}
            {Array.from({ length: firstWeekday }).map((_, i) => <View key={`p${i}`} style={styles.dayCell} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const d = i + 1;
              const dt = new Date(vy, vm - 1, d);
              const future = dt > now;
              const active = d === dd && vm === mm && vy === yy;
              return (
                <TouchableOpacity
                  key={d}
                  disabled={future}
                  style={[styles.dayCell, { backgroundColor: active ? t.primary : t.surface2, opacity: future ? 0.35 : 1 }]}
                  onPress={() => {
                    onPick(`${String(d).padStart(2, '0')}.${String(vm).padStart(2, '0')}.${vy}`);
                    onClose();
                  }}
                >
                  <Text style={{ color: active ? '#fff' : t.text, fontSize: font.sm }}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  box:      { borderRadius: radius.lg, padding: spacing.lg },
  head:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  navBtn:   { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  grid:     { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cell:     { width: '22.5%', paddingVertical: spacing.md, borderRadius: radius.sm, alignItems: 'center' },
  grid7:    { flexDirection: 'row', flexWrap: 'wrap' },
  weekHead: { width: `${100 / 7}%`, textAlign: 'center', fontSize: font.xs, marginBottom: 6 },
  dayCell:  { width: `${100 / 7 - 1.5}%`, aspectRatio: 1.15, margin: '0.75%', borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
