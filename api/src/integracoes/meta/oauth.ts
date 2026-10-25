// OAuth do Facebook Login for Business (meta-v1.md §3.1): URL do diálogo (config_id), troca do code por token
// curto → long-lived (fb_exchange_token) → debug_token (is_valid, scopes, expires_at) → /me. O app secret só entra
// aqui e no appsecret_proof. Erros do §3.4 (DENIED / SCOPES_MISSING / FAILED / UNAVAILABLE).
import type { MetaTokenGrant, MetaTokenInfo } from '../contrato';
import { GraphClient, type Raw } from './cliente';
import { MetaError, isMetaError, scrubToken } from './erros';
import { REQUIRED_SCOPES, missingScopes } from './escopos';

export interface OAuthConfig { appId: string; appSecret: string; configId: string; redirectUri: string }

export function dialogUrl(cfg: OAuthConfig, version: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  u.searchParams.set('client_id', cfg.appId);
  u.searchParams.set('config_id', cfg.configId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('override_default_response_type', 'true');
  return u.toString();
}

/** debug_token com o app token (`app_id|app_secret`), que é o jeito documentado de inspecionar um user token. */
export async function debugToken(g: GraphClient, cfg: OAuthConfig, token: string): Promise<MetaTokenInfo & { userId: string | null }> {
  const appToken = `${cfg.appId}|${cfg.appSecret}`;
  const r = await g.get<Raw>('debug_token', { input_token: token, access_token: appToken }, null);
  const d: Raw = r.data ?? {};
  const scopes: string[] = Array.isArray(d.scopes) ? d.scopes.map(String) : [];
  const exp = Number(d.expires_at);
  return {
    isValid: d.is_valid === true,
    expiresAt: Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null,
    scopes,
    missingScopes: missingScopes(scopes),
    userId: d.user_id ? String(d.user_id) : null,
  };
}

export async function exchangeCode(g: GraphClient, cfg: OAuthConfig, q: { code?: string | null; error?: string | null; errorReason?: string | null; errorDescription?: string | null }): Promise<MetaTokenGrant> {
  if (q.error === 'access_denied' || q.errorReason === 'user_denied') throw new MetaError('META_OAUTH_DENIED', null, { action: null, details: { reason: q.errorReason ?? 'user_denied' } });
  // failDetail nunca leva code/token/trecho de URL: scrub aqui e de novo no construtor do MetaError
  if (q.error) throw new MetaError('META_OAUTH_FAILED', null, { action: null, failDetail: scrubToken(`${q.error}: ${q.errorDescription ?? ''}`).slice(0, 200) });
  const code = (q.code ?? '').trim();
  if (!code) throw new MetaError('META_OAUTH_FAILED', null, { action: null, failDetail: 'no code' });

  const failed = (e: unknown, step: string): MetaError => {
    if (isMetaError(e) && (e.code === 'META_UNAVAILABLE' || e.code === 'META_RATE_LIMITED')) return new MetaError('META_UNAVAILABLE', e.message, { ...e.options, action: null });
    const detail = isMetaError(e) ? e.failDetail ?? e.message : String((e as Error)?.message ?? e);
    return new MetaError('META_OAUTH_FAILED', null, { action: null, failDetail: scrubToken(`${step}: ${detail}`).slice(0, 240) });
  };

  let shortToken: string;
  try {
    const r = await g.get<Raw>('oauth/access_token', { client_id: cfg.appId, client_secret: cfg.appSecret, redirect_uri: cfg.redirectUri, code }, null, { retries: 0 });
    shortToken = String(r.access_token ?? '');
    if (!shortToken) throw new Error('no access_token');
  } catch (e) {
    throw failed(e, 'code_exchange');
  }
  let longToken = shortToken;
  try {
    const r = await g.get<Raw>('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: cfg.appId, client_secret: cfg.appSecret, fb_exchange_token: shortToken }, null, { retries: 0 });
    if (r.access_token) longToken = String(r.access_token);
  } catch (e) {
    throw failed(e, 'long_lived');
  }
  let info: Awaited<ReturnType<typeof debugToken>>;
  try {
    info = await debugToken(g, cfg, longToken);
  } catch (e) {
    throw failed(e, 'debug_token');
  }
  if (!info.isValid) throw new MetaError('META_OAUTH_FAILED', null, { action: null, failDetail: 'debug_token: is_valid=false' });
  if (info.missingScopes.length) throw new MetaError('META_SCOPES_MISSING', `HookMill needs these permissions to work: ${info.missingScopes.join(', ')}. Try again and keep them checked.`, { action: null, details: { missing: info.missingScopes, required: [...REQUIRED_SCOPES] } });
  let me: Raw;
  try {
    me = await g.get<Raw>('me', { fields: 'id,name' }, longToken, { retries: 0 });
  } catch (e) {
    throw failed(e, 'me');
  }
  return {
    accessToken: longToken, tokenType: 'USER_LONG_LIVED',
    expiresAt: info.expiresAt, scopes: info.scopes,
    user: { id: String(me.id ?? info.userId ?? ''), name: String(me.name ?? '') },
  };
}
