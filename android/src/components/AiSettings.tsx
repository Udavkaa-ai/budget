import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Card } from './Card';
import { SectionTitle, Field, PrimaryButton } from './UI';
import { showAlert } from '../dialog';
import { haptics } from '../haptics';
import { setPremium } from '../premium';
import { getAiSettings, setAiSettings, aiPing, DEFAULT_MODELS } from '../ai/openrouter';

// ИИ без сервера: ключ OpenRouter владельца хранится только на этом телефоне
export function AiSettings() {
  const t = useTheme();
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [main, setMain] = useState(DEFAULT_MODELS.main);
  const [fallback, setFallback] = useState(DEFAULT_MODELS.fallback);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAiSettings().then(s => { setSaved(!!s.key); setMain(s.main); setFallback(s.fallback); });
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await setAiSettings({ ...(key.trim() ? { key } : {}), main, fallback });
      const model = await aiPing();
      await setPremium(true);          // фото, голос и анализ открываются с ключом
      setSaved(true); setKey('');
      haptics.success();
      showAlert('ИИ подключён', `Отвечает ${model}. Текст, фото чеков, голос и анализ месяца работают напрямую с телефона.`);
    } catch (e) {
      showAlert('Не получилось', String((e as Error)?.message || e));
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <SectionTitle>ИИ (OpenRouter)</SectionTitle>
      <Text style={{ color: t.textMuted, fontSize: 13, lineHeight: 19 }}>
        Разбор текста, фото чеков, голоса и анализ месяца — напрямую с телефона через ваш ключ OpenRouter. Ключ хранится только на этом телефоне. Основная модель понимает текст, фото и голос; запасная — текст и фото.
      </Text>
      <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
        {saved && <Text style={{ color: t.success, fontSize: 13 }}>Ключ сохранён. Чтобы заменить — введите новый.</Text>}
        <Field value={key} onChangeText={setKey} placeholder={saved ? 'Новый ключ (sk-or-…)' : 'Ключ OpenRouter (sk-or-…)'} secureTextEntry autoCapitalize="none" autoCorrect={false} />
        {advanced && (
          <>
            <Field value={main} onChangeText={setMain} placeholder="Основная модель" autoCapitalize="none" autoCorrect={false} />
            <Field value={fallback} onChangeText={setFallback} placeholder="Запасная модель" autoCapitalize="none" autoCorrect={false} />
          </>
        )}
        <PrimaryButton title={saved && !key.trim() ? 'Проверить' : 'Сохранить и проверить'} loading={busy} onPress={save} disabled={!saved && !key.trim()} />
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <Pressable onPress={() => Linking.openURL('https://openrouter.ai/keys')}>
            <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm }}>Ключи OpenRouter ›</Text>
          </Pressable>
          <Pressable onPress={() => setAdvanced(a => !a)}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>{advanced ? 'Скрыть модели' : 'Сменить модели'}</Text>
          </Pressable>
        </View>
        {saved && (
          <Pressable onPress={() => showAlert('Удалить ключ?', 'ИИ-функции перестанут работать на этом телефоне.', [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Удалить', style: 'destructive', onPress: async () => { await setAiSettings({ key: '' }); setSaved(false); } },
          ])}>
            <Text style={{ color: t.textMuted, fontSize: font.sm }}>Удалить ключ</Text>
          </Pressable>
        )}
      </View>
    </Card>
  );
}
