import * as SecureStore from 'expo-secure-store';
import type { Expense } from '../api/client';
import {
  dirtyRecords, clearDirty, applyRemoteExpense, afterPull, dirtyDocs, clearDocDirty,
  getLocalDoc, setLocalDoc, getMeta, setMeta, markAllDirty, allRecords, allDocs,
} from '../e2e/store';
import { getDavConfig, list, ensureRoot, mkdir, getJson, putJson, remove, DavError, type DavConfig } from './dav';
import { localMe } from './mode';

// Синхронизация без сервера через общую папку в облаке (WebDAV).
//
// Папка семьи: <телефон>/b-000001.json, b-000002.json… — пачки изменений этого
// телефона (расходы и документы: план, цели, кэшфлоу, настройки) и snap.json —
// его полный снимок. Каждый телефон пишет только в свою подпапку и читает
// чужие; конфликт решает версия правки (кто правил позже, тот и прав).
// Снимок раз в SNAP_EVERY пачек позволяет удалить старые пачки.

const SNAP_EVERY = 100;
const PER_FILE = 1000;

export type Rec = { id: string; ver: number; deleted: boolean; payload: Expense | null };
export type Doc = { key: string; ver: number; value: unknown };
interface Batch { device: string; who: string; seq: number; at: number; records: Rec[]; docs: Doc[] }
interface Snap { device: string; who: string; upTo: number; at: number; records: Rec[]; docs: Doc[] }

// ── Состояние для экрана настроек ─────────────────────────────────────────────
export interface SyncStatus { at: number; ok: boolean; error?: string; sent: number; got: number; devices: Array<{ id: string; who: string; at: number }> }
let _status: SyncStatus | null = null;
const listeners = new Set<() => void>();
export const syncStatus = () => _status;
export function onSyncStatus(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
const setStatus = (s: SyncStatus) => { _status = s; listeners.forEach(l => l()); };

// Новые чужие расходы — для уведомления «💸 Марина · 3 новых расхода»
let onPartnerItems: ((by: string, items: Array<[number, string, string]>) => void) | null = null;
export function setPartnerNotifier(fn: typeof onPartnerItems) { onPartnerItems = fn; }
export function announce(fresh: Map<string, Array<[number, string, string]>>) { for (const [by, items] of fresh) onPartnerItems?.(by, items); }

export async function deviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync('device_id').catch(() => null);
  if (!id) {
    id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await SecureStore.setItemAsync('device_id', id).catch(() => {});
  }
  return id;
}

const fileOf = (seq: number) => `b-${String(seq).padStart(6, '0')}.json`;
const snapOf = (seq: number) => `snap-${String(seq).padStart(6, '0')}.json`;
const seqOf = (name: string) => { const m = /^b-(\d+)\.json$/.exec(name); return m ? parseInt(m[1], 10) : 0; };
const snapSeqOf = (name: string) => { const m = /^snap-(\d+)\.json$/.exec(name); return m ? parseInt(m[1], 10) : 0; };

// ── Отправка своих изменений ──────────────────────────────────────────────────
async function push(c: DavConfig, dev: string): Promise<number> {
  const recs = await dirtyRecords();
  const docsRaw = await dirtyDocs();
  if (!recs.length && !docsRaw.length) return 0;
  const docs: Doc[] = docsRaw.map(d => ({ key: d.key, ver: d.ver, value: JSON.parse(d.json) }));
  let seq = parseInt((await getMeta('dav_seq')) || '0', 10);
  let sent = 0;
  for (let i = 0; i < Math.max(recs.length, 1); i += PER_FILE) {
    const chunk = recs.slice(i, i + PER_FILE);
    seq++;
    const batch: Batch = { device: dev, who: localMe(), seq, at: Date.now(), records: chunk, docs: i === 0 ? docs : [] };
    await putJson(c, `${dev}/${fileOf(seq)}`, batch);
    await setMeta('dav_seq', String(seq));
    await clearDirty(chunk.map(r => r.id));
    if (i === 0) for (const d of docsRaw) await clearDocDirty(d.key);
    sent += chunk.length + (i === 0 ? docs.length : 0);
    if (seq % SNAP_EVERY === 0) await compact(c, dev, seq).catch(() => {});
  }
  return sent;
}

// Полный снимок + удаление своих старых пачек
async function compact(c: DavConfig, dev: string, upTo: number) {
  const docs = (await allDocs()).map(d => ({ key: d.key, ver: d.ver, value: JSON.parse(d.json) }));
  const snap: Snap = { device: dev, who: localMe(), upTo, at: Date.now(), records: await allRecords(), docs };
  await putJson(c, `${dev}/${snapOf(upTo)}`, snap);
  for (const name of await list(c, `${dev}/`)) {
    const n = seqOf(name) || snapSeqOf(name);
    if (n && (seqOf(name) ? n <= upTo : n < upTo)) await remove(c, `${dev}/${name}`).catch(() => {});
  }
}

// ── Приём чужих изменений ─────────────────────────────────────────────────────
export async function apply(records: Rec[], docs: Doc[], fresh: Map<string, Array<[number, string, string]>>) {
  const me = localMe();
  const recent = Date.now() - 24 * 3600_000;
  for (const r of records) {
    const res = await applyRemoteExpense(r.id, r.ver, r.deleted, r.payload);
    const p = r.payload;
    if (res === 'new' && p && p.user !== me && p.addedBy !== me && Date.parse(p.createdAt || '') > recent) {
      const by = p.addedBy || p.user;
      if (!fresh.has(by)) fresh.set(by, []);
      fresh.get(by)!.push([p.amount, p.date, p.category]);
    }
  }
  for (const d of docs) {
    const local = await getLocalDoc(d.key);
    if (local && local.ver >= d.ver) continue;
    await setLocalDoc(d.key, d.value, { dirty: false, ver: d.ver });
  }
}

async function pull(c: DavConfig, dev: string, devices: SyncStatus['devices']): Promise<number> {
  let got = 0;
  const fresh = new Map<string, Array<[number, string, string]>>();
  for (const other of await list(c, '')) {
    if (other === dev || !/^p[0-9a-z]+$/.test(other)) continue;
    const key = `dav_seen:${other}`;
    let seen = parseInt((await getMeta(key)) || '0', 10);
    const names = await list(c, `${other}/`);
    const batches = names.map(seqOf).filter(n => n > seen).sort((a, b) => a - b);
    // Пачки до снимка уже удалены, а мы их не читали — сначала берём снимок
    const snapUpTo = Math.max(0, ...names.map(snapSeqOf));
    if (snapUpTo > seen && (batches.length === 0 || batches[0] > seen + 1)) {
      const snap = await getJson<Snap>(c, `${other}/${snapOf(snapUpTo)}`);
      if (snap && snap.upTo > seen) {
        await apply(snap.records, snap.docs, seen === 0 ? new Map() : fresh);
        got += snap.records.length;
        seen = snap.upTo;
        await setMeta(key, String(seen));
      }
    }
    let who = '', at = 0;
    for (const n of batches) {
      if (n <= seen) continue;
      const b = await getJson<Batch>(c, `${other}/${fileOf(n)}`);
      if (!b) continue;
      await apply(b.records, b.docs, fresh);
      got += b.records.length + b.docs.length;
      who = b.who; at = b.at;
      seen = n;
      await setMeta(key, String(seen));
    }
    devices.push({ id: other, who: who || (await getMeta(`dav_who:${other}`)) || '', at });
    if (who) await setMeta(`dav_who:${other}`, who);
  }
  if (got) await afterPull();
  announce(fresh);
  return got;
}

let _running = false;
// Полная синхронизация: отправить своё, забрать чужое. Ошибку показываем в настройках.
export async function localSync(): Promise<void> {
  const c = await getDavConfig();
  if (!c || !c.user || !c.pass || _running) return;
  _running = true;
  const dev = await deviceId();
  const devices: SyncStatus['devices'] = [];
  try {
    await ensureRoot(c);
    await mkdir(c, `${dev}/`);
    const sent = await push(c, dev);
    const got = await pull(c, dev, devices);
    setStatus({ at: Date.now(), ok: true, sent, got, devices });
  } catch (e) {
    setStatus({ at: Date.now(), ok: false, error: e instanceof DavError ? e.message : String((e as Error)?.message || e), sent: 0, got: 0, devices });
  } finally { _running = false; }
}

// Подключение папки: всё своё — к отправке (первая выгрузка), чужое — с нуля
export async function connectFolder() {
  await markAllDirty();
  await localSync();
}
