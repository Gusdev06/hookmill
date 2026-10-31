// meta-templates-v1 §3 (29/10): leitura de campanha/conjunto/anúncio pra importar como template. Só leitura; o
// mapeamento pro MetaTemplateBody (e o `unsupported`) é do backend (api/src/meta/templates.ts).
import type { MetaObjectLevelPort, MetaTemplateSourceRead } from '../contrato';
import { isGone } from './campanhas';
import { GraphClient, type Raw } from './cliente';
import { MetaError, isMetaError } from './erros';

export const TEMPLATE_FIELDS = {
  campaign: 'id,name,objective,bid_strategy,daily_budget,lifetime_budget,special_ad_categories,start_time,stop_time,effective_status',
  adset: 'id,name,campaign_id,bid_strategy,bid_amount,daily_budget,lifetime_budget,optimization_goal,promoted_object,targeting,start_time,end_time,effective_status',
  ad: 'id,name,adset_id,campaign_id,effective_status,creative{id,url_tags,object_story_spec,asset_feed_spec}',
} as const;

const minor = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};
const str = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));

export function campaignOf(o: Raw): MetaTemplateSourceRead['campaign'] {
  return {
    id: String(o.id), name: String(o.name ?? ''), objective: String(o.objective ?? ''), bidStrategy: str(o.bid_strategy),
    dailyBudgetMinor: minor(o.daily_budget), lifetimeBudgetMinor: minor(o.lifetime_budget),
    specialAdCategories: Array.isArray(o.special_ad_categories) ? o.special_ad_categories.map(String).filter((x: string) => x !== 'NONE') : [],
    startTime: str(o.start_time), stopTime: str(o.stop_time),
  };
}
export function adsetOf(o: Raw): NonNullable<MetaTemplateSourceRead['adset']> {
  const po = o.promoted_object as Raw | undefined;
  return {
    id: String(o.id), name: String(o.name ?? ''), bidStrategy: str(o.bid_strategy), bidAmountMinor: minor(o.bid_amount),
    dailyBudgetMinor: minor(o.daily_budget), lifetimeBudgetMinor: minor(o.lifetime_budget), optimizationGoal: str(o.optimization_goal),
    promotedObject: po ? { pixelId: str(po.pixel_id), customEventType: str(po.custom_event_type), applicationId: str(po.application_id) } : null,
    targeting: o.targeting && typeof o.targeting === 'object' ? (o.targeting as Record<string, unknown>) : null,
    startTime: str(o.start_time), endTime: str(o.end_time),
  };
}
export function adOf(o: Raw): NonNullable<MetaTemplateSourceRead['ad']> {
  const cr = o.creative as Raw | undefined;
  const oss = (cr?.object_story_spec ?? {}) as Raw;
  const d = (oss.video_data ?? oss.link_data ?? null) as Raw | null;
  const cta = (d?.call_to_action ?? null) as Raw | null;
  return {
    id: String(o.id), name: String(o.name ?? ''),
    creative: cr ? {
      message: str(d?.message), title: str(d?.title ?? d?.name), description: str(d?.link_description ?? d?.description),
      callToAction: str(cta?.type), link: str(cta?.value?.link ?? d?.link), urlTags: str(cr.url_tags),
    } : null,
  };
}

async function read(g: GraphClient, token: string, level: MetaObjectLevelPort, id: string): Promise<Raw> {
  try {
    return await g.get<Raw>(id, { fields: TEMPLATE_FIELDS[level] }, token, { stage: 'read_template' });
  } catch (e) {
    if (isGone(e)) throw new MetaError('META_OBJECT_GONE', null, { failDetail: isMetaError(e) ? e.failDetail : null, details: { level, id }, action: 'refresh' });
    throw e;
  }
}
/** 1º filho ativo (senão o 1º) de `edge`; null sem filhos. */
async function firstChild(g: GraphClient, token: string, parentId: string, edge: 'adsets' | 'ads'): Promise<string | null> {
  const r = await g.get<Raw>(`${parentId}/${edge}`, { fields: 'id,effective_status', limit: 25 }, token, { stage: 'read_template' });
  const rows: Raw[] = Array.isArray(r.data) ? r.data : [];
  const pick = rows.find((x) => String(x.effective_status ?? '').toUpperCase() === 'ACTIVE') ?? rows[0];
  return pick ? String(pick.id) : null;
}

export async function readTemplateSource(
  g: GraphClient, token: string, i: { level: MetaObjectLevelPort; id: string; hint?: { adsetId?: string | null; adId?: string | null } },
): Promise<MetaTemplateSourceRead> {
  let adRaw: Raw | null = null;
  let adsetRaw: Raw | null = null;
  let campaignRaw: Raw;
  if (i.level === 'ad') {
    adRaw = await read(g, token, 'ad', i.id);
    adsetRaw = await read(g, token, 'adset', String(adRaw.adset_id));
    campaignRaw = await read(g, token, 'campaign', String(adRaw.campaign_id ?? adsetRaw.campaign_id));
  } else if (i.level === 'adset') {
    adsetRaw = await read(g, token, 'adset', i.id);
    campaignRaw = await read(g, token, 'campaign', String(adsetRaw.campaign_id));
    const adId = i.hint?.adId ?? (await firstChild(g, token, i.id, 'ads'));
    adRaw = adId ? await read(g, token, 'ad', adId) : null;
  } else {
    campaignRaw = await read(g, token, 'campaign', i.id);
    const adsetId = i.hint?.adsetId ?? (await firstChild(g, token, i.id, 'adsets'));
    adsetRaw = adsetId ? await read(g, token, 'adset', adsetId) : null;
    const adId = adsetId ? i.hint?.adId ?? (await firstChild(g, token, adsetId, 'ads')) : null;
    adRaw = adId ? await read(g, token, 'ad', adId) : null;
  }
  return { campaign: campaignOf(campaignRaw), adset: adsetRaw ? adsetOf(adsetRaw) : null, ad: adRaw ? adOf(adRaw) : null };
}
