import { NativeModules, NativeEventEmitter } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { allRecords, allDocs, afterPull } from '../e2e/store';
import { apply, announce, deviceId, type Rec, type Doc } from './sync';
import { isLocal, localMe } from './mode';

// Обмен по домашнему Wi-Fi напрямую между телефонами (нативный FinikLan,
// плагин withLanSync — личная сборка). Пока ФИНИК открыт, телефон виден в
// сети; найдя соседа с тем же кодом пары, сравниваем сводку и, если данные
// различаются, меняемся полным состоянием (кто правил позже — тот и прав).
// Код пары не даёт чужим устройствам в той же сети забрать данные.

type Lan = {
  start(name: string): Promise<number>; stop(): void;
  respond(id: string, status: number, body: string): void;
  request(host: string, port: number, method: string, path: string, key: string, body: string): Promise<{ status: number; body: string }>;
};
const Native = NativeModules.FinikLan as Lan | undefined;
export const lanAvailable = !!Native;

// ── Код пары ──────────────────────────────────────────────────────────────────
const KEY = 'lan_key';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // без 0/O, 1/I
export async function getPairCode() { return (await SecureStore.getItemAsync(KEY).catch(() => null)) || ''; }
export async function setPairCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (c) await SecureStore.setItemAsync(KEY, c); else await SecureStore.deleteItemAsync(KEY).catch(() => {});
  await restartLan();
}
export function newPairCode() { let s = ''; for (let i = 0; i < 8; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; }

// ── Состояние для экрана настроек ─────────────────────────────────────────────
export interface LanStatus { running: boolean; peers: Array<{ who: string; at: number; ok: boolean; error?: string; got: number }> }
let _status: LanStatus = { running: false, peers: [] };
const listeners = new Set<() => void>();
export const lanStatus = () => _status;
export function onLanStatus(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
const setPeer = (p: LanStatus['peers'][number]) => {
  _status = { ..._status, peers: [p, ..._status.peers.filter(x => x.who !== p.who)].slice(0, 5) };
  listeners.forEach(l => l());
};

// Сводка данных: совпала — обмениваться нечем
async function digest() {
  const recs = await allRecords(), docs = await allDocs();
  let sum = 0;
  for (const r of recs) sum = (sum + (r.ver % 1_000_000_007)) % 1_000_000_007;
  for (const d of docs) sum = (sum + (d.ver % 1_000_000_007)) % 1_000_000_007;
  return `${recs.length}:${docs.length}:${sum}`;
}
async function fullState() {
  return {
    who: localMe(),
    records: await allRecords() as Rec[],
    docs: (await allDocs()).map(d => ({ key: d.key, ver: d.ver, value: JSON.parse(d.json) })) as Doc[],
  };
}
async function take(state: { records: Rec[]; docs: Doc[] }) {
  const fresh = new Map<string, Array<[number, string, string]>>();
  await apply(state.records || [], state.docs || [], fresh);
  await afterPull();
  announce(fresh);
  return (state.records || []).length;
}

// ── Входящие запросы соседа ───────────────────────────────────────────────────
async function onRequest(r: { id: string; method: string; path: string; key: string; body: string }) {
  const code = await getPairCode();
  const send = (status: number, body: unknown) => Native?.respond(r.id, status, JSON.stringify(body));
  if (!code || r.key !== code) return send(403, { error: 'код пары не совпал' });
  try {
    if (r.path === '/digest') return send(200, { who: localMe(), digest: await digest() });
    if (r.path === '/exchange' && r.method === 'POST') {
      const theirs = JSON.parse(r.body || '{}');
      const mine = await fullState();           // наше состояние — до применения чужого
      const got = await take(theirs);
      setPeer({ who: theirs.who || 'сосед', at: Date.now(), ok: true, got });
      return send(200, mine);
    }
    send(404, { error: 'нет такого' });
  } catch (e) { send(500, { error: String((e as Error)?.message || e) }); }
}

// ── Нашли соседа: сверяемся и, если надо, меняемся ────────────────────────────
const lastTry = new Map<string, number>();
async function onPeer(p: { name: string; host: string; port: number }) {
  const code = await getPairCode();
  if (!Native || !code) return;
  const key = `${p.host}:${p.port}`;
  if (Date.now() - (lastTry.get(key) || 0) < 20_000) return;
  lastTry.set(key, Date.now());
  try {
    const d = await Native.request(p.host, p.port, 'GET', '/digest', code, '');
    if (d.status === 403) { setPeer({ who: p.name, at: Date.now(), ok: false, error: 'на соседнем телефоне другой код пары', got: 0 }); return; }
    if (d.status !== 200) throw new Error(`сосед ответил ${d.status}`);
    const their = JSON.parse(d.body);
    if (their.digest === await digest()) { setPeer({ who: their.who, at: Date.now(), ok: true, got: 0 }); return; }
    const res = await Native.request(p.host, p.port, 'POST', '/exchange', code, JSON.stringify(await fullState()));
    if (res.status !== 200) throw new Error(`сосед ответил ${res.status}`);
    const got = await take(JSON.parse(res.body));
    setPeer({ who: their.who, at: Date.now(), ok: true, got });
  } catch (e) {
    setPeer({ who: p.name, at: Date.now(), ok: false, error: String((e as Error)?.message || e), got: 0 });
  }
}

// ── Запуск/остановка (пока приложение на экране) ──────────────────────────────
let subs: Array<{ remove(): void }> = [];
export async function startLan() {
  if (!Native || !isLocal() || !(await getPairCode())) return;
  if (!subs.length) {
    const em = new NativeEventEmitter(NativeModules.FinikLan);
    subs = [
      em.addListener('FinikLanRequest', e => { onRequest(e as any); }),
      em.addListener('FinikLanPeer', e => { onPeer(e as any); }),
    ];
  }
  try {
    await Native.start(`finik-${await deviceId()}`);
    _status = { ..._status, running: true }; listeners.forEach(l => l());
  } catch { /* сеть недоступна */ }
}
export function stopLan() {
  try { Native?.stop(); } catch { /* уже остановлен */ }
  _status = { ..._status, running: false }; listeners.forEach(l => l());
}
async function restartLan() { stopLan(); await startLan(); }
