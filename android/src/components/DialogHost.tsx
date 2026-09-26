import React from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { useTheme, spacing, radius, shadow2 } from '../theme';
import { useDialog, closeDialog, type DialogButton } from '../dialog';
import { haptics } from '../haptics';

// Хост тематических диалогов (см. dialog.ts). Два вида раскладки:
// до двух коротких кнопок — в ряд (как «Отмена / Удалить»), иначе — список
// вариантов на всю ширину, «Отмена» отдельно внизу (как «Чей доход?»).
export function DialogHost() {
  const t = useTheme();
  const d = useDialog();
  if (!d) return null;

  const cancel = d.buttons.find(b => b.style === 'cancel');
  const actions = d.buttons.filter(b => b !== cancel);
  const inRow = d.buttons.length <= 2 && d.buttons.every(b => (b.text ?? '').length <= 16);
  const press = (b?: DialogButton) => { haptics.select(); closeDialog(b); };
  // тап мимо окна / «назад»: onDismiss, если задан, иначе — как «Отмена»
  const dismiss = () => { if (!d.cancelable) return; if (d.onDismiss) closeDialog({ onPress: d.onDismiss }); else press(cancel); };
  const colorOf = (b: DialogButton) => b.style === 'destructive' ? t.danger : b.style === 'cancel' ? t.textMuted : t.primary;

  const btn = (b: DialogButton, i: number, primary: boolean, full: boolean) => (
    <Pressable
      key={i}
      onPress={() => press(b)}
      style={({ pressed }) => [
        styles.btn, full && { alignSelf: 'stretch' }, !full && { flex: 1 },
        primary
          ? { backgroundColor: b.style === 'destructive' ? t.danger : t.primaryStrong }
          : { backgroundColor: t.surface2, borderWidth: 1, borderColor: t.border },
        pressed && { opacity: 0.75, transform: [{ scale: 0.98 }] },
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.btnText, { color: primary ? '#fff' : colorOf(b) }]} numberOfLines={1}>{b.text ?? 'OK'}</Text>
    </Pressable>
  );

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View entering={FadeIn.duration(160)} style={[styles.overlay, { backgroundColor: t.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        <Animated.View entering={ZoomIn.springify().damping(18).stiffness(260)} style={[styles.box, shadow2, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.clasp}>
            <View style={[styles.dot, { backgroundColor: t.gold }]} />
            <View style={[styles.dot, { backgroundColor: t.gold }]} />
          </View>
          <Text style={[styles.title, { color: t.text }]}>{d.title}</Text>
          {!!d.message && (
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ paddingBottom: 2 }}>
              <Text style={[styles.msg, { color: t.textMuted }]} selectable>{d.message}</Text>
            </ScrollView>
          )}
          {inRow ? (
            <View style={styles.row}>
              {cancel && btn(cancel, 99, false, false)}
              {actions.map((b, i) => btn(b, i, i === actions.length - 1, false))}
            </View>
          ) : (
            <View style={styles.list}>
              {actions.map((b, i) => (
                <Pressable
                  key={i}
                  onPress={() => press(b)}
                  style={({ pressed }) => [styles.option, { backgroundColor: pressed ? t.primarySoft : t.surface2, borderColor: t.border }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.optionText, { color: b.style === 'destructive' ? t.danger : t.text }]}>{b.text}</Text>
                </Pressable>
              ))}
              {cancel && (
                <Pressable onPress={() => press(cancel)} style={styles.cancelLink} accessibilityRole="button">
                  <Text style={{ color: t.textMuted, fontWeight: '700', fontSize: 15 }}>{cancel.text ?? 'Отмена'}</Text>
                </Pressable>
              )}
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  box: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, paddingTop: spacing.md },
  clasp: { flexDirection: 'row', gap: 2, alignSelf: 'center', marginBottom: spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: -0.2 },
  msg: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  btn: { borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '700' },
  list: { gap: spacing.sm, marginTop: spacing.lg },
  option: { borderRadius: radius.md, borderWidth: 1, paddingVertical: 14, paddingHorizontal: spacing.lg, alignItems: 'center' },
  optionText: { fontSize: 16, fontWeight: '700' },
  cancelLink: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
});
