import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, font } from '../theme';
import { useCategories } from '../categories';
import { whoLabel, currentUserName, type Expense } from '../api/client';
import { listComments, addComment, deleteComment, type ExpenseComment } from '../comments';
import { onLocalChange } from '../e2e/store';
import { showAlert } from '../dialog';
import { haptics } from '../haptics';

const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n)) + ' ₽';
const when = (ts: number) => {
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? hm : `${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })}, ${hm}`;
};

// Комментарии к расходу — свои и партнёра; видны обоим после синхронизации
export function CommentsModal({ expense, onClose }: { expense: Expense | null; onClose: () => void }) {
  const t = useTheme();
  const { icon } = useCategories();
  const [list, setList] = useState<ExpenseComment[]>([]);
  const [text, setText] = useState('');
  const me = currentUserName();

  const load = useCallback(() => { if (expense) listComments(expense.id).then(setList).catch(() => {}); }, [expense]);
  useEffect(() => { setText(''); load(); }, [load]);
  useEffect(() => onLocalChange(load), [load]);      // пришёл комментарий партнёра — обновляем

  const send = async () => {
    if (!expense || !text.trim()) return;
    await addComment(expense.id, text);
    setText('');
    haptics.light();
    load();
  };

  return (
    <Modal visible={!!expense} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={[styles.header, { borderBottomColor: t.border, backgroundColor: t.surface }]}>
            <Text style={{ fontSize: 26 }}>{expense ? icon(expense.category) : ''}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{expense?.description || expense?.category}</Text>
              <Text style={{ color: t.textMuted, fontSize: 12 }}>
                {expense ? `${fmt(expense.amount)} · ${expense.category} · ${whoLabel(expense)} · ${expense.date}` : ''}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Закрыть" style={[styles.x, { backgroundColor: t.surface2 }]}>
              <Ionicons name="close" size={20} color={t.textMuted} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: 8 }}>
            {list.length === 0 && (
              <Text style={{ color: t.textFaint, textAlign: 'center', marginTop: 40 }}>
                Комментариев пока нет. Напишите, на что потрачено или о чём договориться — партнёр увидит после синхронизации.
              </Text>
            )}
            {list.map(c => {
              const mine = c.by === me;
              return (
                <Pressable key={c.id}
                  onLongPress={() => mine && showAlert('Удалить комментарий?', c.text, [
                    { text: 'Отмена', style: 'cancel' },
                    { text: 'Удалить', style: 'destructive', onPress: async () => { await deleteComment(c); load(); } },
                  ])}
                  style={[styles.bubble, mine
                    ? { alignSelf: 'flex-end', backgroundColor: t.primary, borderBottomRightRadius: 6 }
                    : { alignSelf: 'flex-start', backgroundColor: t.surface2, borderColor: t.border, borderWidth: 1, borderBottomLeftRadius: 6 }]}>
                  <Text style={{ color: mine ? '#fff' : t.text, fontSize: font.sm, lineHeight: 20 }}>{c.text}</Text>
                  <Text style={{ color: mine ? 'rgba(255,255,255,0.75)' : t.textMuted, fontSize: 11, marginTop: 3, alignSelf: mine ? 'flex-end' : 'flex-start' }}>
                    {mine ? 'Вы' : c.by} · {when(c.at)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={[styles.inputRow, { borderTopColor: t.border, backgroundColor: t.surface }]}>
            <TextInput
              style={[styles.input, { color: t.text, backgroundColor: t.surface2, borderColor: t.border }]}
              value={text}
              onChangeText={setText}
              placeholder="Комментарий…"
              placeholderTextColor={t.textFaint}
              multiline
              maxLength={1000}
            />
            <Pressable onPress={send} disabled={!text.trim()} accessibilityLabel="Отправить"
              style={[styles.send, { backgroundColor: text.trim() ? t.primary : t.surface2 }]}>
              <Ionicons name="send" size={18} color={text.trim() ? '#fff' : t.textFaint} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  x: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '82%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: font.md },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
