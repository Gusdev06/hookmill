// AES-256-GCM do access token da Meta (meta-v1.md §7). Formato: base64(iv(12) ‖ tag(16) ‖ ciphertext).
// Chave: META_TOKEN_KEY = `openssl rand -base64 32` (32 bytes). Perder/trocar a chave = todo mundo reconecta.
// Reutilizável pelo backend (B1) via `import { cifrar, decifrar } from '../integracoes'`.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

export class CifraError extends Error {
  constructor(public readonly reason: 'key_invalid' | 'ciphertext_invalid', message: string) {
    super(message);
    this.name = 'CifraError';
  }
}

/** Aceita base64 (32 bytes) ou hex (64 chars). Qualquer outra coisa = CifraError key_invalid. */
export function chaveDe(raw: string | undefined | null): Buffer {
  const s = (raw ?? '').trim();
  if (!s) throw new CifraError('key_invalid', 'META_TOKEN_KEY is empty');
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  const b = Buffer.from(s, 'base64');
  if (b.length !== 32) throw new CifraError('key_invalid', `META_TOKEN_KEY must decode to 32 bytes (got ${b.length})`);
  return b;
}

export function cifrar(plain: string, key: string | Buffer): string {
  const k = Buffer.isBuffer(key) ? key : chaveDe(key);
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decifrar(ciphertext: string, key: string | Buffer): string {
  const k = Buffer.isBuffer(key) ? key : chaveDe(key);
  const buf = Buffer.from((ciphertext ?? '').trim(), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new CifraError('ciphertext_invalid', 'ciphertext too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const d = createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  try {
    return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
  } catch {
    throw new CifraError('ciphertext_invalid', 'authentication failed (wrong key or tampered ciphertext)');
  }
}
