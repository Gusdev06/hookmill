// Verificação do webhook da WaveSpeed (wavespeed.ai/docs/verify-webhooks, conferida em 05/10/2026):
//   assinado = "{webhook-id}.{webhook-timestamp}.{corpo cru}", HMAC-SHA256 em hex, chave = segredo SEM o "whsec_"
//   (sem base64). Header "webhook-signature" = "v3,<hex>" (aceitamos também hex puro e várias separadas por espaço).
//   Timestamp com mais de 300 s = rejeita.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_TOLERANCE_SEC = 300;

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing_headers' | 'no_secret' | 'stale' | 'bad_signature' };

export function stripSecretPrefix(secret: string): string {
  return secret.startsWith('whsec_') ? secret.slice(6) : secret;
}

export function signWebhook(secret: string, id: string, timestamp: string, rawBody: Buffer | string): string {
  return createHmac('sha256', stripSecretPrefix(secret)).update(`${id}.${timestamp}.`).update(rawBody).digest('hex');
}

export function verifyWebhook(
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer | string | undefined,
  secret: string | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!secret) return { ok: false, reason: 'no_secret' };
  const h = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const id = h('webhook-id');
  const ts = h('webhook-timestamp');
  const sig = h('webhook-signature');
  if (!id || !ts || !sig || rawBody === undefined) return { ok: false, reason: 'missing_headers' };
  // timestamp em segundos (a doc); tolera milissegundos
  let t = Number(ts);
  if (t > 1e12) t = Math.floor(t / 1000);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > WEBHOOK_TOLERANCE_SEC) return { ok: false, reason: 'stale' };

  const expected = Buffer.from(signWebhook(secret, id, ts, rawBody), 'hex');
  const candidates = sig
    .split(' ')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(',') ? s.slice(s.indexOf(',') + 1) : s));
  for (const c of candidates) {
    if (!/^[0-9a-f]+$/i.test(c)) continue;
    const got = Buffer.from(c, 'hex');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}
