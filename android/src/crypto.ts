import { gcm } from '@noble/ciphers/aes';
import * as ExpoCrypto from 'expo-crypto';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as SecureStore from 'expo-secure-store';

// E2E-шифрование: AES-256-GCM, ключ семьи живёт только на устройствах.
// Сервер видит base64-шифроблобы и отпечаток ключа (sha256-префикс).

const KEY_STORE = 'family_e2e_key';

let _key: Uint8Array | null = null;

export async function loadKey(): Promise<Uint8Array | null> {
  if (_key) return _key;
  const hex = await SecureStore.getItemAsync(KEY_STORE);
  if (hex) _key = hexToBytes(hex);
  return _key;
}

function randomBytes(n: number): Uint8Array {
  return ExpoCrypto.getRandomBytes(n);
}

export async function generateKey(): Promise<Uint8Array> {
  const k = randomBytes(32);
  _key = k;
  await SecureStore.setItemAsync(KEY_STORE, bytesToHex(k));
  return k;
}

// Импорт ключа с другого устройства (QR/фраза = hex-строка)
export async function importKey(hex: string): Promise<boolean> {
  const clean = hex.trim().toLowerCase().replace(/[^0-9a-f]/g, '');
  if (clean.length !== 64) return false;
  _key = hexToBytes(clean);
  await SecureStore.setItemAsync(KEY_STORE, clean);
  return true;
}

export async function exportKeyHex(): Promise<string | null> {
  const k = await loadKey();
  return k ? bytesToHex(k) : null;
}

export async function clearKey() {
  _key = null;
  await SecureStore.deleteItemAsync(KEY_STORE);
}

// Отпечаток для сверки ключей между устройствами (сервер хранит его же)
export async function keyFingerprint(): Promise<string | null> {
  const k = await loadKey();
  if (!k) return null;
  return bytesToHex(sha256(k)).slice(0, 16);
}

// Pure-JS UTF-8 ↔ bytes. Hermes (движок RN) поставляет TextEncoder, но НЕ
// TextDecoder — из-за чего расшифровка/восстановление падали
// «ReferenceError: Property 'TextDecoder' doesn't exist», а pull чужих блобов
// молча пропускался (ошибка decrypt глотается по-записи). @noble/*/utils тоже
// внутри зовёт TextDecoder, поэтому кодируем сами. Байты — стандартный UTF-8,
// совместимы со старыми блобами и с вебом (кириллица включительно).
function utf8Encode(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {                 // старший суррогат
      const c2 = str.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++];
    if (b0 < 0x80) out += String.fromCharCode(b0);
    else if (b0 < 0xe0) out += String.fromCharCode(((b0 & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (b0 < 0xf0) out += String.fromCharCode(((b0 & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = (((b0 & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)) - 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    }
  }
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Шифроблоб: base64(iv(12) + ciphertext+tag)
export async function encryptJson(obj: unknown): Promise<string> {
  const k = await loadKey();
  if (!k) throw new Error('Нет ключа шифрования');
  const iv = randomBytes(12);
  const plain = utf8Encode(JSON.stringify(obj));
  const ct = gcm(k, iv).encrypt(plain);
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv); packed.set(ct, iv.length);
  return b64encode(packed);
}

export async function decryptJson<T>(blob: string): Promise<T> {
  const k = await loadKey();
  if (!k) throw new Error('Нет ключа шифрования');
  const packed = b64decode(blob);
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const plain = gcm(k, iv).decrypt(ct);
  return JSON.parse(utf8Decode(plain)) as T;
}
