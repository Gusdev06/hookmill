// `state` do OAuth (meta-v1.md §3.1/§7): JWT HS256 compacto de 10 min assinado com JWT_ACCESS_SECRET, payload
// { wid, sub, returnTo, nonce, iat, exp }. Nada no banco. Implementado com node:crypto (sem depender do módulo auth).
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { MetaOAuthState, MetaReturnTo } from '../contrato';
import { MetaError } from './erros';

export const STATE_TTL_SEC = 600;
// `/settings/connections` = Settings › Connections, onde o MetaConnect lê `?meta=` (ajuste 21/10); `/settings` fica como alias.
export const RETURN_TO: readonly MetaReturnTo[] = ['/onboarding/meta', '/settings/connections', '/settings', '/meta/done'];

export function returnToOf(v: unknown): MetaReturnTo {
  return (RETURN_TO as readonly string[]).includes(String(v)) ? (v as MetaReturnTo) : '/onboarding/meta';
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const sign = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function signState(i: { workspaceId: string; userId: string; returnTo: MetaReturnTo }, secret: string, now = Date.now()): { state: string; expiresAt: string } {
  if (!secret) throw new Error('JWT_ACCESS_SECRET is empty');
  const iat = Math.floor(now / 1000);
  const exp = iat + STATE_TTL_SEC;
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(JSON.stringify({ wid: i.workspaceId, sub: i.userId, returnTo: returnToOf(i.returnTo), nonce: randomBytes(12).toString('base64url'), iat, exp, purpose: 'meta_oauth' }));
  const data = `${header}.${payload}`;
  return { state: `${data}.${sign(data, secret)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyState(state: string | undefined | null, secret: string, expect: { workspaceId?: string; userId?: string } = {}, now = Date.now()): MetaOAuthState {
  const invalid = (why: string) => new MetaError('META_STATE_INVALID', null, { details: { why }, action: null });
  if (!state || typeof state !== 'string') throw invalid('missing');
  const parts = state.split('.');
  if (parts.length !== 3) throw invalid('malformed');
  const [h, p, s] = parts;
  const expected = sign(`${h}.${p}`, secret);
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw invalid('signature');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    throw invalid('payload');
  }
  if (payload.purpose !== 'meta_oauth') throw invalid('purpose');
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp * 1000 < now) throw invalid('expired');
  const wid = String(payload.wid ?? '');
  const sub = String(payload.sub ?? '');
  if (!wid || !sub) throw invalid('payload');
  if (expect.workspaceId && expect.workspaceId !== wid) throw invalid('workspace');
  if (expect.userId && expect.userId !== sub) throw invalid('user');
  return { workspaceId: wid, userId: sub, returnTo: returnToOf(payload.returnTo), nonce: String(payload.nonce ?? ''), expiresAt: new Date(exp * 1000).toISOString() };
}
