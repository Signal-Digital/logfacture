/** Primitives cryptographiques (Web Crypto — disponible dans WebView2 et Node). */

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return toHex(await subtle().digest('SHA-256', bytes as BufferSource));
}

export function uuid(): string {
  return globalThis.crypto.randomUUID();
}

export function randomToken(bytes = 24): string {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return toHex(b);
}

export const PASSWORD_ITERATIONS = 310_000;

export interface PasswordHash {
  algo: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  hash: string;
}

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

/** Hache un mot de passe (jamais stocké en clair). */
export async function hashPassword(password: string, iterations = PASSWORD_ITERATIONS): Promise<PasswordHash> {
  const salt = randomToken(16);
  return { algo: 'PBKDF2-SHA256', iterations, salt, hash: await pbkdf2(password, salt, iterations) };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const h = await pbkdf2(password, stored.salt, stored.iterations);
  // comparaison à temps constant
  if (h.length !== stored.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
