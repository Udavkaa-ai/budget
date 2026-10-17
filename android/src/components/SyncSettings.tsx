import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Linking } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Card } from './Card';
import { SectionTitle, Field, PrimaryButton, SecondaryButton } from './UI';
import { showAlert } from '../dialog';
import { haptics } from '../haptics';
import { useAuth, loginLocal } from '../hooks/useAuth';
import { isLocal, localMe } from '../local/mode';
import { getDavConfig, setDavConfig, DEFAULT_DAV, type DavConfig } from '../local/dav';
import { connectFolder, localSync, syncStatus, onSyncStatus, type SyncStatus } from '../local/sync';
import { flushOutbox } from '../offline';

const when = (ts: number) => {
  if (!ts) return '—';
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === now.toDateString() ? `сегодня ${hm}` : `${d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })} ${hm}`;
};

// Раздел «Синхронизация»: переход на работу без сервера и общая папка в облаке
export function SyncSettings() {
  const t = useTheme();
  const { user } = useAuth();
  const [cfg, setCfg] = useState<DavConfig>(DEFAULT_DAV);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [st, setSt] = useState<SyncStatus | null>(syncStatus());

  useEffect(() => {
    getDavConfig().then(c => { if (c) { setCfg(c); setConnected(true); } });
    return onSyncStatus(() => setSt(syncStatus()));
  }, []);

  // ── Ещё на сервере: предлагаем перейти ─────────────────────────────────────
  if (!isLocal()) {
    return (
      <Card>
        <SectionTitle>Работа без сервера</SectionTitle>
        <Text style={{ color: t.textMuted, fontSize: 13, lineHeight: 19 }}>
          Все расходы, планы, цели и кэшфлоу хранятся на этом телефоне. Без сервера ФИНИК работает с ними напрямую, а с телефоном партнёра обменивается через общую папку на Яндекс Диске.
        </Text>
        <PrimaryButton title={`Перейти — я ${user?.name || '…'}`} style={{ marginTop: spacing.md }} loading={busy} onPress={async () => {
          setBusy(true);
          try {
            await loginLocal(user?.name || 'Я');
            await flushOutbox().catch(() => {});   // расходы из офлайн-очереди — в локальную базу
            haptics.success();
          } finally { setBusy(false); }
        }} />
      </Card>
    );
  }

  const connect = async () => {
    if (!cfg.user.trim() || !cfg.pass.trim()) { showAlert('Нужны логин и пароль приложения', 'Пароль приложения создаётся в Яндекс ID — см. подсказку ниже.'); return; }
    setBusy(true);
    try {
      const c = { ...cfg, user: cfg.user.trim(), pass: cfg.pass.trim(), folder: cfg.folder.trim() || 'Finik' };
      await setDavConfig(c);
      await connectFolder();
      const s = syncStatus();
      if (s && !s.ok) { showAlert('Не получилось', s.error || ''); return; }
      setConnected(true);
      haptics.success();
      showAlert('Готово', 'Этот телефон выгрузил свои данные в папку. Подключите ту же папку на телефоне партнёра — данные сойдутся.');
    } finally { setBusy(false); }
  };

  const ok = st?.ok;
  return (
    <Card>
      <SectionTitle>Синхронизация между телефонами</SectionTitle>
      <Text style={{ color: t.textMuted, fontSize: 13, lineHeight: 19 }}>
        Вы — <Text style={{ color: t.text, fontWeight: '700' }}>{localMe()}</Text>. Данные хранятся на телефоне; партнёру они уходят через общую папку на Яндекс Диске (работает без VPN). Обмен — при открытии приложения, после каждой правки и раз в минуту.
      </Text>

      {connected && (
        <View style={{ marginTop: spacing.md }}>
          <Text style={{ color: st && !ok ? t.warning : t.textMuted, fontSize: 13 }} selectable>
            {!st ? 'Ещё не синхронизировались' : ok
              ? `Синхронизировано ${when(st.at)} · отправлено ${st.sent}, получено ${st.got}`
              : `Ошибка ${when(st.at)}: ${st.error}`}
          </Text>
          {!!st?.devices.length && (
            <Text style={{ color: t.textFaint, fontSize: 12, marginTop: 4 }}>
              Другие телефоны в папке: {st.devices.map(d => `${d.who || 'без имени'}${d.at ? ` (изменения ${when(d.at)})` : ''}`).join(', ')}
            </Text>
          )}
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <PrimaryButton title="Синхронизировать" style={{ flex: 1 }} loading={busy} onPress={async () => { setBusy(true); await localSync(); setBusy(false); }} />
            <SecondaryButton title="Отключить" style={{ flex: 0.7 }} onPress={() => showAlert('Отключить облако?', 'Данные на телефоне останутся, просто перестанут уходить партнёру.', [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Отключить', style: 'destructive', onPress: async () => { await setDavConfig(null); setConnected(false); } },
            ])} />
          </View>
        </View>
      )}

      {!connected && (
        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
          <Field value={cfg.user} onChangeText={v => setCfg(c => ({ ...c, user: v }))} placeholder="Логин Яндекса (без @yandex.ru)" autoCapitalize="none" autoCorrect={false} />
          <Field value={cfg.pass} onChangeText={v => setCfg(c => ({ ...c, pass: v }))} placeholder="Пароль приложения" secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Field value={cfg.folder} onChangeText={v => setCfg(c => ({ ...c, folder: v }))} placeholder="Папка на Диске" autoCapitalize="none" autoCorrect={false} />
          {advanced && (
            <Field value={cfg.url} onChangeText={v => setCfg(c => ({ ...c, url: v }))} placeholder="Адрес WebDAV" autoCapitalize="none" autoCorrect={false} />
          )}
          <PrimaryButton title="Подключить" loading={busy} onPress={connect} />
          <Text style={{ color: t.textMuted, fontSize: 12, lineHeight: 18 }}>
            Пароль приложения: Яндекс ID › Безопасность › Пароли приложений › «Файлы (WebDAV)». Обычный пароль от Яндекса не подойдёт.{'\n'}
            Оба телефона подключают одну и ту же папку: либо под одним аккаунтом Яндекса, либо папкой с общим доступом на редактирование.
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.lg }}>
            <Pressable onPress={() => Linking.openURL('https://id.yandex.ru/security/app-passwords')}>
              <Text style={{ color: t.primary, fontWeight: '700', fontSize: font.sm }}>Создать пароль ›</Text>
            </Pressable>
            <Pressable onPress={() => setAdvanced(a => !a)}>
              <Text style={{ color: t.textMuted, fontSize: font.sm }}>{advanced ? 'Скрыть адрес' : 'Другое облако (WebDAV)'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </Card>
  );
}
