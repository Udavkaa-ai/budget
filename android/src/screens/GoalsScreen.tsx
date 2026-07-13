import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, spacing, font, radius } from '../theme';
import { goals as goalsApi, type Goal } from '../api/client';
import { Card } from '../components/Card';

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
}

export default function GoalsScreen() {
  const t = useTheme();
  const [list, setList] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [addVisible, setAddVisible] = useState(false);
  const [contribGoal, setContribGoal] = useState<Goal | null>(null);

  // Add form
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [emoji, setEmoji] = useState('🎯');

  // Contribution
  const [contribAmt, setContribAmt] = useState('');

  const load = async () => {
    try {
      const g = await goalsApi.list();
      setList(g);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const addGoal = async () => {
    if (!name.trim() || !target.trim()) return;
    const t2 = parseFloat(target.replace(',', '.'));
    if (isNaN(t2) || t2 <= 0) { Alert.alert('Некорректная сумма'); return; }
    try {
      await goalsApi.add({ name: name.trim(), target: t2, emoji });
      setAddVisible(false); setName(''); setTarget(''); setEmoji('🎯');
      load();
    } catch (e) { Alert.alert('Ошибка', String(e)); }
  };

  const contribute = async () => {
    if (!contribGoal) return;
    const amt = parseFloat(contribAmt.replace(',', '.'));
    if (isNaN(amt) || amt <= 0) return;
    try {
      await goalsApi.contribute(contribGoal.id, amt);
      setContribGoal(null); setContribAmt('');
      load();
    } catch (e) { Alert.alert('Ошибка', String(e)); }
  };

  const deleteGoal = (id: string) => {
    Alert.alert('Удалить цель?', undefined, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => { await goalsApi.delete(id); load(); } },
    ]);
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Text style={[styles.title, { color: t.text }]}>🎯 Цели</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: t.primary }]}
          onPress={() => setAddVisible(true)}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>+ Новая</Text>
        </TouchableOpacity>
      </View>

      {loading
        ? <ActivityIndicator style={{ marginTop: 60 }} color={t.primary} />
        : (
          <ScrollView contentContainerStyle={{ padding: spacing.md }}>
            {list.length === 0 && (
              <Text style={[styles.empty, { color: t.textMuted }]}>Нет целей. Добавьте первую!</Text>
            )}
            {list.map(g => {
              const pct = Math.min(g.saved / g.target, 1);
              return (
                <Card key={g.id}>
                  <View style={styles.goalHeader}>
                    <Text style={{ fontSize: 28 }}>{g.emoji}</Text>
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={[styles.goalName, { color: t.text }]}>{g.name}</Text>
                      <Text style={{ color: t.textMuted, fontSize: font.sm }}>
                        {fmt(g.saved)} / {fmt(g.target)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteGoal(g.id)}>
                      <Text style={{ color: t.textMuted, fontSize: 18 }}>×</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Progress bar */}
                  <View style={[styles.progBg, { backgroundColor: t.surface2 }]}>
                    <View style={[styles.progFill, { width: `${pct * 100}%`, backgroundColor: pct >= 1 ? '#22c55e' : t.primary }]} />
                  </View>
                  <Text style={{ color: t.textMuted, fontSize: font.xs, marginTop: 4 }}>
                    {Math.round(pct * 100)}% · осталось {fmt(Math.max(g.target - g.saved, 0))}
                  </Text>

                  <TouchableOpacity
                    style={[styles.contribBtn, { backgroundColor: t.surface2 }]}
                    onPress={() => { setContribGoal(g); setContribAmt(''); }}
                  >
                    <Text style={{ color: t.primary, fontWeight: '600' }}>+ Пополнить</Text>
                  </TouchableOpacity>
                </Card>
              );
            })}
          </ScrollView>
        )}

      {/* Add goal modal */}
      <Modal visible={addVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: t.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setAddVisible(false)}>
              <Text style={{ color: t.primary }}>Отмена</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>Новая цель</Text>
            <TouchableOpacity onPress={addGoal}>
              <Text style={{ color: t.primary, fontWeight: '700' }}>Добавить</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: spacing.lg }}>
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={emoji} onChangeText={setEmoji} placeholder="Эмодзи" />
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={name} onChangeText={setName} placeholder="Название цели" />
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={target} onChangeText={setTarget} placeholder="Целевая сумма, ₽" keyboardType="decimal-pad" />
          </View>
        </SafeAreaView>
      </Modal>

      {/* Contribute modal */}
      <Modal visible={!!contribGoal} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: t.bg }]}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <TouchableOpacity onPress={() => setContribGoal(null)}>
              <Text style={{ color: t.primary }}>Отмена</Text>
            </TouchableOpacity>
            <Text style={[styles.modalTitle, { color: t.text }]}>Пополнить {contribGoal?.emoji}</Text>
            <TouchableOpacity onPress={contribute}>
              <Text style={{ color: t.primary, fontWeight: '700' }}>OK</Text>
            </TouchableOpacity>
          </View>
          <View style={{ padding: spacing.lg }}>
            <TextInput style={[styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.surface }]}
              value={contribAmt} onChangeText={setContribAmt} placeholder="Сумма, ₽" keyboardType="decimal-pad" autoFocus />
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:        { flex: 1 },
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  title:       { fontSize: font.xl, fontWeight: '700' },
  addBtn:      { borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  empty:       { textAlign: 'center', marginTop: 60, fontSize: font.md },
  goalHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  goalName:    { fontSize: font.lg, fontWeight: '700' },
  progBg:      { height: 10, borderRadius: 5, overflow: 'hidden' },
  progFill:    { height: '100%', borderRadius: 5 },
  contribBtn:  { marginTop: spacing.md, borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center' },
  modal:       { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle:  { fontSize: font.lg, fontWeight: '700' },
  input:       { borderRadius: radius.sm, borderWidth: 1, padding: spacing.md, fontSize: font.md, marginBottom: spacing.md },
});
