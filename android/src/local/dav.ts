import * as SecureStore from 'expo-secure-store';

// Минимальный WebDAV-клиент для общей папки семьи. По умолчанию — Яндекс Диск
// (webdav.yandex.ru, работает в РФ без VPN): логин Яндекса + «пароль
// приложения» (id.yandex.ru › Безопасность › Пароли приложений › Файлы WebDAV).
// Подойдёт и любой другой WebDAV (Nextcloud, роутер с диском).

export interface DavConfig { url: string; user: string; pass: string; folder: string }
const KEY = 'dav_config';
export const DEFAULT_DAV: DavConfig = { url: 'https://webdav.yandex.ru', user: '', pass: '', folder: 'Finik' };

let _cfg: DavConfig | null = null;
export async function getDavConfig(): Promise<DavConfig | null> {
  if (_cfg) return _cfg;
  try { const v = await SecureStore.getItemAsync(KEY); _cfg = v ? { ...DEFAULT_DAV, ...JSON.parse(v) } : null; } catch { _cfg = null; }
  return _cfg;
}
export async function setDavConfig(c: DavConfig | null) {
  _cfg = c;
  if (c) await SecureStore.setItemAsync(KEY, JSON.stringify(c)); else await SecureStore.deleteItemAsync(KEY).catch(() => {});
}

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class DavError extends Error { constructor(msg: string, public status = 0) { super(msg); } }

async function call(c: DavConfig, method: string, path: string, body?: string, headers: Record<string, string> = {}) {
  // путь внутри папки семьи; папки — со слэшем на конце
  const rel = [c.folder, path].map(x => x.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
  const isDir = path === '' || path.endsWith('/');
  const url = `${c.url.replace(/\/+$/, '')}/${enc(rel)}${isDir ? '/' : ''}`;
  let res: Response;
  try {
    res = await fetch(url, { method, body, headers: { Authorization: `Basic ${b64(`${c.user}:${c.pass}`)}`, ...headers } });
  } catch (e) { throw new DavError(`нет связи с облаком (${String((e as Error)?.message || e)})`); }
  if (res.status === 401) throw new DavError('облако не приняло логин или пароль приложения', 401);
  return res;
}

// Содержимое папки: имена файлов и подпапок (без самой папки)
export async function list(c: DavConfig, dir: string): Promise<string[]> {
  const res = await call(c, 'PROPFIND', dir.endsWith('/') ? dir : dir + '/', undefined, { Depth: '1', 'Content-Type': 'application/xml' });
  if (res.status === 404) return [];
  if (res.status !== 207 && !res.ok) throw new DavError(`облако ответило ${res.status}`, res.status);
  const xml = await res.text();
  const hrefs = [...xml.matchAll(/<(?:[\w-]+:)?href>([^<]+)<\/(?:[\w-]+:)?href>/gi)].map(m => decodeURIComponent(m[1]));
  const self = hrefs[0]?.replace(/\/+$/, '');
  return hrefs.slice(1)
    .map(h => h.replace(/\/+$/, ''))
    .filter(h => h !== self)
    .map(h => h.split('/').pop() || '')
    .filter(Boolean);
}

export async function mkdir(c: DavConfig, dir: string) {
  const res = await call(c, 'MKCOL', dir);
  // 405 — уже есть; 409 — нет родителя (создаём по очереди снаружи)
  if (!res.ok && res.status !== 405 && res.status !== 301) throw new DavError(`не удалось создать папку (${res.status})`, res.status);
}

export async function getJson<T>(c: DavConfig, path: string): Promise<T | null> {
  const res = await call(c, 'GET', path);
  if (res.status === 404) return null;
  if (!res.ok) throw new DavError(`облако ответило ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

export async function putJson(c: DavConfig, path: string, value: unknown) {
  const res = await call(c, 'PUT', path, JSON.stringify(value), { 'Content-Type': 'application/json' });
  if (!res.ok) throw new DavError(`не удалось записать в облако (${res.status})`, res.status);
}

export async function remove(c: DavConfig, path: string) {
  const res = await call(c, 'DELETE', path);
  if (!res.ok && res.status !== 404) throw new DavError(`не удалось удалить (${res.status})`, res.status);
}

// Корень папки семьи: создаём, если нет
export async function ensureRoot(c: DavConfig) {
  const res = await call(c, 'MKCOL', '');
  if (!res.ok && res.status !== 405 && res.status !== 301) throw new DavError(`не удалось создать папку «${c.folder}» (${res.status})`, res.status);
}
