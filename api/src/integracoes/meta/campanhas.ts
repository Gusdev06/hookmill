// Campaigns v1 (campanhas-v1.md §4, I4, 22/10): leitura AO VIVO de um objeto antes de escrever, escrita de `daily_budget`
// e links do Ads Manager por nível. Status usa o `setStatus` da publicação (POST /{id} status). As regras de produto
// (expected, teto 2×, pais pausados, mínimo, throttle) são do backend (`api/src/meta/`); aqui só a chamada e o mapa de erro.
// NUNCA testado ao vivo em escrita (regra do Gusta): só leitura e fetch falso.
import type { MetaLiveObject, MetaObjectLevelPort } from '../contrato';
import { GraphClient, type Raw } from './cliente';
import { MetaError, isMetaError } from './erros';
import { HIDDEN_STATUSES } from './leitura';

const PARENT = 'id,name,status,daily_budget,lifetime_budget';
export const LIVE_FIELDS: Record<MetaObjectLevelPort, string> = {
  campaign: 'id,name,status,effective_status,daily_budget,lifetime_budget',
  adset: `id,name,status,effective_status,daily_budget,lifetime_budget,campaign{${PARENT}}`,
  ad: `id,name,status,effective_status,campaign{${PARENT}},adset{${PARENT}}`,
};

const minor = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const toggle = (s: unknown): 'ACTIVE' | 'PAUSED' => (String(s ?? '').toUpperCase() === 'ACTIVE' ? 'ACTIVE' : 'PAUSED');
const parent = (p: Raw | undefined | null) =>
  p && p.id ? { id: String(p.id), name: String(p.name ?? ''), status: toggle(p.status), dailyBudgetMinor: minor(p.daily_budget), lifetimeBudgetMinor: minor(p.lifetime_budget) } : null;

/** "Não existe mais": Graph 100/33 ("Object with ID … does not exist"), 803, ou texto "does not exist". Falta de permissão NÃO conta. */
export function isGone(e: unknown): boolean {
  if (!isMetaError(e)) return false;
  const d = e.failDetail ?? '';
  if (/^(100\/33|803)\//.test(d)) return true;
  return /does not exist/i.test(d) && !/permission/i.test(d);
}

export async function readObject(g: GraphClient, token: string, i: { level: MetaObjectLevelPort; id: string }): Promise<MetaLiveObject> {
  let o: Raw;
  try {
    o = await g.get<Raw>(i.id, { fields: LIVE_FIELDS[i.level] }, token, { stage: 'read_object' });
  } catch (e) {
    if (isGone(e)) throw new MetaError('META_OBJECT_GONE', null, { failDetail: isMetaError(e) ? e.failDetail : null, details: { level: i.level, id: i.id }, action: 'refresh' });
    throw e;
  }
  const eff = String(o.effective_status ?? o.status ?? 'UNKNOWN');
  if (HIDDEN_STATUSES.has(eff.toUpperCase()) || HIDDEN_STATUSES.has(String(o.status ?? '').toUpperCase()))
    throw new MetaError('META_OBJECT_GONE', null, { failDetail: `status ${eff}`, details: { level: i.level, id: i.id }, action: 'refresh' });
  return {
    level: i.level, id: String(o.id ?? i.id), name: String(o.name ?? ''),
    status: toggle(o.status), effectiveStatus: eff,
    dailyBudgetMinor: i.level === 'ad' ? null : minor(o.daily_budget),
    lifetimeBudgetMinor: i.level === 'ad' ? null : minor(o.lifetime_budget),
    campaign: i.level === 'campaign' ? null : parent(o.campaign),
    adset: i.level === 'ad' ? parent(o.adset) : null,
  };
}

/** POST /{id} daily_budget=<minor>. A Meta recusando por nível/tipo de orçamento vira META_BUDGET_NOT_EDITABLE (erros.ts). */
export async function setDailyBudget(g: GraphClient, token: string, i: { level: 'campaign' | 'adset'; id: string; dailyBudgetMinor: number }): Promise<void> {
  if (!Number.isInteger(i.dailyBudgetMinor) || i.dailyBudgetMinor <= 0) throw new MetaError('META_ERROR', `invalid daily budget ${i.dailyBudgetMinor}`);
  try {
    await g.post<Raw>(i.id, { daily_budget: String(i.dailyBudgetMinor) }, token, { stage: 'set_budget' });
  } catch (e) {
    if (isGone(e)) throw new MetaError('META_OBJECT_GONE', null, { failDetail: isMetaError(e) ? e.failDetail : null, details: { level: i.level, id: i.id }, action: 'refresh' });
    throw e;
  }
}

/** campanhas-v1 §5.4: link do Ads Manager por nível (`act` sem o prefixo `act_`). */
export function objectUrl(adAccountId: string, level: MetaObjectLevelPort, id: string): string {
  const act = encodeURIComponent(adAccountId.replace(/^act_/, ''));
  const tab = level === 'campaign' ? 'campaigns' : level === 'adset' ? 'adsets' : 'ads';
  const sel = level === 'campaign' ? 'selected_campaign_ids' : level === 'adset' ? 'selected_adset_ids' : 'selected_ad_ids';
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?act=${act}&${sel}=${encodeURIComponent(id)}`;
}
