import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Modal, ScrollView, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font, radius } from '../theme';
import { ai } from '../api/client';

type Msg = { role: 'user' | 'assistant'; content: string };

// Лёгкая чистка markdown — ответы короткие, разметку просто убираем
function clean(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .trim();
}

export function ChatModal({ visible, onClose, month, year, monthLabel }: {
  visible: boolean; onClose: () => void; month: number; year: number; monthLabel: string;
}) {
  const t = useTheme();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const contextRef = useRef<string>('');
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!visible) return;
    setMessages([{
      role: 'assistant',
      content: `Привет! Я вижу вашу сводку за ${monthLabel}. Спросите что угодно — где перерасход, как сэкономить, стоит ли поднять лимит по категории.`,
    }]);
    setInput('');
    contextRef.current = '';
    ai.chatContext(month, year).then(c => { contextRef.current = c; }).catch(() => {});
  }, [visible, month, year, monthLabel]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const res = await ai.chat(contextRef.current, next.slice(-16));
      setMessages([...next, { role: 'assistant', content: res.reply || 'Пустой ответ.' }]);
    } catch (e: any) {
      const msg = e?.message?.includes('503') ? 'ИИ-чат сейчас недоступен.' : 'Не удалось получить ответ. Попробуйте ещё раз.';
      setMessages([...next, { role: 'assistant', content: msg }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[styles.header, { borderBottomColor: t.border }]}>
          <TouchableOpacity onPress={onClose} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="chevron-back" size={22} color="#a855f7" />
            <Text style={{ color: '#a855f7' }}>Назад</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: t.text }]}>💬 Чат с ИИ</Text>
          <View style={{ width: 56 }} />
        </View>

        <View style={[styles.privacy, { backgroundColor: t.surface2 }]}>
          <Text style={{ color: t.textMuted, fontSize: font.xs }}>
            🔒 ИИ получает только обезличенную сводку (суммы по категориям и участникам), не отдельные покупки.
          </Text>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView ref={scrollRef} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            {messages.map((m, i) => (
              <View key={i} style={[
                styles.bubble,
                m.role === 'user'
                  ? { backgroundColor: t.primary, alignSelf: 'flex-end', borderBottomRightRadius: 4 }
                  : { backgroundColor: t.surface, alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
              ]}>
                <Text style={{ color: m.role === 'user' ? '#fff' : t.text, fontSize: font.md, lineHeight: 21 }}>
                  {m.role === 'assistant' ? clean(m.content) : m.content}
                </Text>
              </View>
            ))}
            {loading && (
              <View style={[styles.bubble, { backgroundColor: t.surface, alignSelf: 'flex-start' }]}>
                <ActivityIndicator color="#a855f7" />
              </View>
            )}
          </ScrollView>

          <View style={[styles.inputRow, { borderTopColor: t.border, backgroundColor: t.bg }]}>
            <TextInput
              style={[styles.input, { color: t.text, backgroundColor: t.surface2, borderColor: t.border }]}
              placeholder="Спросите про бюджет…"
              placeholderTextColor={t.textMuted}
              value={input}
              onChangeText={setInput}
              multiline
              onSubmitEditing={send}
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: input.trim() && !loading ? '#a855f7' : t.surface2 }]}
              onPress={send}
              disabled={!input.trim() || loading}
            >
              <Ionicons name="arrow-up" size={22} color={input.trim() && !loading ? '#fff' : t.textMuted} />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  title:   { fontSize: font.lg, fontWeight: '700' },
  privacy: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubble:  { maxWidth: '85%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  inputRow:{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, padding: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input:   { flex: 1, borderWidth: 1, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, maxHeight: 120, fontSize: font.md },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
