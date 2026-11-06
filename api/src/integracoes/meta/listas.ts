// meta-templates-v2 §4 (03/11, I2): listas da conta pro editor de template. Só leitura.
// - contas do Instagram: act/instagram_accounts (token do usuário) + {page}/instagram_accounts (token da Página), sem cache;
// - públicos personalizados: act/customaudiences (até 500, time_updated desc), cache de 5 min por conta no processo;
// - idiomas: search?type=adlocale (lista inteira), cache de 24 h por versão da Graph, igual pra todo workspace.
// NUNCA validado contra a Graph de verdade (P3 adiada pelo Gusta em 03/11): só fetch falso nos testes.
import { createHash } from 'node:crypto';
import type { MetaCustomAudienceOption, MetaCustomAudiencesResponse, MetaInstagramAccount, MetaInstagramAccountsResponse, MetaLocalesResponse } from '@maquina/contratos';
import type { GraphClient, Raw } from './cliente';
import { isMetaError } from './erros';

export const IG_FIELDS = 'id,username,profile_pic';
export const AUDIENCE_FIELDS = 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_updated';
export const AUDIENCES_MAX = 500;
export const AUDIENCES_TTL_MS = 5 * 60_000;
export const LOCALES_TTL_MS = 24 * 60 * 60_000;
/** delivery_status.code ≥ 300 = não entrega (público pequeno, expirado…); operation_status 471 = sinalizado pela Meta */
export const AUDIENCE_OPERATION_FLAGGED = 471;

// ---------- Instagram ----------
export function igAccountOf(o: Raw, source: MetaInstagramAccount['source']): MetaInstagramAccount | null {
  const id = o?.id != null ? String(o.id) : '';
  if (!id) return null;
  const username = o.username != null && String(o.username) ? String(o.username) : id;
  const pic = typeof o.profile_pic === 'string' && o.profile_pic ? o.profile_pic : null;
  return { id, username, profilePicUrl: pic, source };
}
/** PAGE primeiro, depois username asc; sem repetir id (a de PAGE ganha: é a que a Meta exige casar com o page_id). */
export function mergeIgAccounts(page: MetaInstagramAccount[], account: MetaInstagramAccount[]): MetaInstagramAccount[] {
  const seen = new Set<string>();
  const out: MetaInstagramAccount[] = [];
  const byName = (a: MetaInstagramAccount, b: MetaInstagramAccount) => a.username.localeCompare(b.username, 'en', { sensitivity: 'base' });
  for (const a of [...page].sort(byName)) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  for (const a of [...account].sort(byName)) if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  return out;
}

export async function listInstagramAccounts(g: GraphClient, token: string, i: { adAccountId: string; pageId: string | null }): Promise<MetaInstagramAccountsResponse> {
  const stage = 'list_instagram_accounts';
  const fromAccount = (await g.paginate<Raw>(`${i.adAccountId}/instagram_accounts`, { fields: IG_FIELDS, limit: 100 }, token, 500, { stage }))
    .map((o) => igAccountOf(o, 'AD_ACCOUNT')).filter((x): x is MetaInstagramAccount => !!x);
  if (!i.pageId) return { accounts: mergeIgAccounts([], fromAccount), pageLookup: 'no_page' };

  // token da Página: com o token do usuário (190 aqui = conexão inválida de verdade → sobe pro backend marcar)
  let pageToken: string | null = null;
  try {
    const p = await g.get<Raw>(i.pageId, { fields: 'access_token' }, token, { stage });
    pageToken = typeof p.access_token === 'string' && p.access_token ? p.access_token : null;
  } catch (e) {
    if (!deniedPage(e, false)) throw e;
  }
  if (!pageToken) return { accounts: mergeIgAccounts([], fromAccount), pageLookup: 'unavailable' };
  try {
    const fromPage = (await g.paginate<Raw>(`${i.pageId}/instagram_accounts`, { fields: IG_FIELDS, limit: 100 }, pageToken, 100, { stage }))
      .map((o) => igAccountOf(o, 'PAGE')).filter((x): x is MetaInstagramAccount => !!x);
    return { accounts: mergeIgAccounts(fromPage, fromAccount), pageLookup: 'ok' };
  } catch (e) {
    // com o token DA PÁGINA, até um 190 só quer dizer "não deu pra ler a Página": não derruba a conexão do usuário
    if (!deniedPage(e, true)) throw e;
    return { accounts: mergeIgAccounts([], fromAccount), pageLookup: 'unavailable' };
  }
}
/** "A Meta negou ler a Página" (vira pageLookup unavailable). Indisponibilidade/limite continua subindo (o backend devolve 503). */
function deniedPage(e: unknown, withPageToken: boolean): boolean {
  if (!isMetaError(e)) return false;
  if (e.code === 'META_PERMISSION' || e.code === 'META_ERROR') return true;
  return withPageToken && e.code === 'META_TOKEN_INVALID';
}

// ---------- públicos personalizados ----------
const count = (v: unknown): number | null => {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isFinite(n) || n < 0 ? null : Math.round(n);
};
const statusCode = (s: unknown): number | null => {
  const c = Number((s as Raw | null | undefined)?.code);
  return Number.isFinite(c) ? c : null;
};
const statusText = (s: unknown): string | null => {
  const d = (s as Raw | null | undefined)?.description;
  return typeof d === 'string' && d.trim() ? d.trim() : null;
};
/** `time_updated` vem em segundos unix (às vezes string); devolve ISO ou null. */
function isoOfUnix(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function audienceOf(o: Raw): MetaCustomAudienceOption | null {
  const id = o?.id != null ? String(o.id) : '';
  if (!id) return null;
  const delivery = statusCode(o.delivery_status);
  const operation = statusCode(o.operation_status);
  const deliveryBad = delivery != null && delivery >= 300;
  const flagged = operation === AUDIENCE_OPERATION_FLAGGED;
  const usable = !deliveryBad && !flagged;
  return {
    id, name: o.name != null ? String(o.name) : id, subtype: o.subtype != null ? String(o.subtype) : 'CUSTOM',
    sizeLower: count(o.approximate_count_lower_bound), sizeUpper: count(o.approximate_count_upper_bound),
    usable,
    unusableReason: usable ? null : (deliveryBad ? statusText(o.delivery_status) : null) ?? (flagged ? statusText(o.operation_status) : null) ?? (deliveryBad ? `delivery status ${delivery}` : `operation status ${operation}`),
    updatedAt: isoOfUnix(o.time_updated),
  };
}
/** mais recentes primeiro; sem data vai pro fim; empate por nome. */
export function sortAudiences(list: MetaCustomAudienceOption[]): MetaCustomAudienceOption[] {
  return [...list].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name));
}

interface CacheEntry<T> { at: number; value: T }
/** Cache do processo (uma API só, D: sem Redis). Chave dos públicos = conta + hash curto do token (um workspace sem acesso
 *  à conta nunca lê o cache de outro). Chave dos idiomas = versão da Graph. */
export class ListasCache {
  readonly audiences = new Map<string, CacheEntry<MetaCustomAudiencesResponse>>();
  readonly locales = new Map<string, CacheEntry<MetaLocalesResponse>>();
  clear() {
    this.audiences.clear();
    this.locales.clear();
  }
}
const tokenTag = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);

export async function listCustomAudiences(g: GraphClient, token: string, i: { adAccountId: string }, cache?: ListasCache, nowMs: number = Date.now()): Promise<MetaCustomAudiencesResponse> {
  const key = `${i.adAccountId}|${tokenTag(token)}`;
  const hit = cache?.audiences.get(key);
  if (hit && nowMs - hit.at < AUDIENCES_TTL_MS) return hit.value;
  // pede 1 a mais que o teto pra saber se a conta tem mais de 500
  const rows = await g.paginate<Raw>(`${i.adAccountId}/customaudiences`, { fields: AUDIENCE_FIELDS, limit: 100 }, token, AUDIENCES_MAX + 1, { stage: 'list_custom_audiences' });
  const all = sortAudiences(rows.map(audienceOf).filter((x): x is MetaCustomAudienceOption => !!x));
  const value: MetaCustomAudiencesResponse = { audiences: all.slice(0, AUDIENCES_MAX), truncated: rows.length > AUDIENCES_MAX };
  cache?.audiences.set(key, { at: nowMs, value });
  return value;
}

// ---------- idiomas ----------
export function localesOf(rows: Raw[]): MetaLocalesResponse['locales'] {
  const seen = new Set<number>();
  const out: MetaLocalesResponse['locales'] = [];
  for (const r of rows) {
    const key = Number(r?.key);
    if (!Number.isInteger(key) || key < 1 || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name: r.name != null && String(r.name) ? String(r.name) : `Locale ${key}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.key - b.key);
}

export async function listLocales(g: GraphClient, token: string, cache?: ListasCache, nowMs: number = Date.now()): Promise<MetaLocalesResponse> {
  const key = g.version;
  const hit = cache?.locales.get(key);
  if (hit && nowMs - hit.at < LOCALES_TTL_MS) return hit.value;
  const rows = await g.paginate<Raw>('search', { type: 'adlocale', q: '', limit: 1000, locale: 'en_US' }, token, 5000, { stage: 'list_locales' });
  const value: MetaLocalesResponse = { locales: localesOf(rows) };
  // lista vazia não vai pro cache (resposta estranha da Meta não deve durar 24 h)
  if (value.locales.length) cache?.locales.set(key, { at: nowMs, value });
  return value;
}
