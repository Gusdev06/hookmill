// Publicação (meta-v1.md §3.3): as 6 chamadas da Marketing API, cada uma devolvendo só o id da etapa (o backend grava
// antes de chamar a próxima; retry não repete etapa com id). Upload do vídeo por file_url (prod) ou resumable
// (start/transfer/finish em pedaços de 8 MB) quando o render não é público.
import type { MetaObjective, MetaPixelEvent } from '@maquina/contratos';
import type { MetaPublishIds, MetaPublishInput, MetaPublishStructure } from '../contrato';
import { GraphClient, type Raw } from './cliente';
import { MetaError, isMetaError } from './erros';

export const CHUNK_BYTES = 8 * 1024 * 1024;
export const VIDEO_POLL_MS = 3000;
export const VIDEO_TIMEOUT_MS = 10 * 60_000;

/** resultado-v1 (28/10): `pixelEvent` (settings, do resultType) troca o custom_event_type; ausente = PURCHASE/LEAD como antes. */
export function optimizationFor(objective: MetaObjective, pixelId: string | null, pixelEvent?: MetaPixelEvent | null): { optimization_goal: string; promoted_object?: Raw } {
  if (objective === 'OUTCOME_SALES' && pixelId) return { optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: pixelId, custom_event_type: pixelEvent ?? 'PURCHASE' } };
  if (objective === 'OUTCOME_LEADS' && pixelId) return { optimization_goal: 'OFFSITE_CONVERSIONS', promoted_object: { pixel_id: pixelId, custom_event_type: pixelEvent ?? 'LEAD' } };
  // APP exige application_id + object_store_url: v1 só com app registrado; sem isso o backend já trocou pra TRAFFIC (§3.3 passo 4)
  return { optimization_goal: 'LINK_CLICKS' };
}

/** meta-templates-v1: estratégia do template → `bid_strategy` da Graph. */
export const GRAPH_BID_STRATEGY: Record<MetaPublishStructure['bidStrategy'], string> = {
  LOWEST_COST: 'LOWEST_COST_WITHOUT_CAP', COST_CAP: 'COST_CAP', BID_CAP: 'LOWEST_COST_WITH_BID_CAP',
};
const PLATFORM_POSITION_KEY: Record<string, string> = {
  facebook: 'facebook_positions', instagram: 'instagram_positions', audience_network: 'audience_network_positions', messenger: 'messenger_positions',
};
/** Posicionamentos manuais: `publisher_platforms` + `<plataforma>_positions` (posição `<plataforma>_<posição>`, ex. `instagram_story`). */
export function placementsOf(p: MetaPublishStructure['placements']): Raw {
  if (p === 'AUTO') return {};
  const out: Raw = { publisher_platforms: [...p.platforms] };
  for (const pos of p.positions) {
    const platform = Object.keys(PLATFORM_POSITION_KEY).sort((a, b) => b.length - a.length).find((k) => pos.startsWith(`${k}_`));
    if (!platform || !p.platforms.includes(platform)) continue;
    const key = PLATFORM_POSITION_KEY[platform];
    (out[key] ??= []).push(pos.slice(platform.length + 1));
  }
  return out;
}

export function campaignBody(i: MetaPublishInput): Raw {
  const st = i.structure;
  const base: Raw = { name: st?.campaignName ?? i.adName, objective: i.settings.objective, status: 'PAUSED', special_ad_categories: i.settings.specialAdCategories ?? [], buying_type: 'AUCTION' };
  // CBO (Advantage campaign budget): orçamento e estratégia de lance na campanha
  if (st?.budgetMode === 'CBO') return { ...base, daily_budget: i.settings.dailyBudgetMinor, bid_strategy: GRAPH_BID_STRATEGY[st.bidStrategy] };
  return base;
}
export function adSetBody(i: MetaPublishInput, campaignId: string): Raw {
  const s = i.settings;
  const st = i.structure;
  const targeting: Raw = {
    geo_locations: { countries: s.countries }, age_min: s.ageMin, age_max: s.ageMax,
    targeting_automation: { advantage_audience: st && !st.advantageAudience ? 0 : 1 },
  };
  if (st && st.genders !== 'ALL') targeting.genders = [st.genders === 'MALE' ? 1 : 2];
  if (st) Object.assign(targeting, placementsOf(st.placements));
  const cbo = st?.budgetMode === 'CBO';
  const capped = !!st && st.bidStrategy !== 'LOWEST_COST' && st.bidAmountMinor != null;
  return {
    name: st?.adsetName ?? i.adName, campaign_id: campaignId,
    // ABO: orçamento e estratégia no conjunto; CBO: herda da campanha (só o bid_amount do cap mora aqui)
    ...(cbo ? {} : { daily_budget: s.dailyBudgetMinor, bid_strategy: st ? GRAPH_BID_STRATEGY[st.bidStrategy] : 'LOWEST_COST_WITHOUT_CAP' }),
    ...(capped ? { bid_amount: st!.bidAmountMinor } : {}),
    billing_event: 'IMPRESSIONS', status: 'PAUSED',
    targeting,
    ...optimizationFor(s.objective, i.pixelId, s.pixelEvent),
  };
}
export function creativeBody(i: MetaPublishInput, videoId: string): Raw {
  const s = i.settings;
  return {
    name: i.adName,
    object_story_spec: {
      page_id: i.pageId,
      video_data: {
        video_id: videoId, ...(i.thumbnailUrl ? { image_url: i.thumbnailUrl } : {}), message: s.primaryText,
        ...(s.headline ? { title: s.headline } : {}), ...(s.description ? { link_description: s.description } : {}),
        call_to_action: { type: s.callToAction, value: { link: s.link } },
      },
    },
    ...(i.structure?.urlTags ? { url_tags: i.structure.urlTags } : {}),
  };
}
export function adBody(i: MetaPublishInput, adsetId: string, creativeId: string): Raw {
  return { name: i.adName, adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED' };
}

export async function uploadVideo(g: GraphClient, token: string, i: MetaPublishInput): Promise<{ videoId: string }> {
  const stage = 'uploading_video';
  if (i.video.fileUrl) {
    const r = await g.post<Raw>(`${i.adAccountId}/advideos`, { file_url: i.video.fileUrl, name: i.adName }, token, { stage });
    if (!r.id) throw new MetaError('META_VIDEO_REJECTED', 'Meta did not return a video id', { stage });
    return { videoId: String(r.id) };
  }
  if (!i.video.read || !i.video.sizeBytes) throw new MetaError('META_VIDEO_REJECTED', 'no public URL and no file reader for the render', { stage, action: 'render_again' });
  const size = i.video.sizeBytes;
  const start = await g.post<Raw>(`${i.adAccountId}/advideos`, { upload_phase: 'start', file_size: size }, token, { stage });
  const session = String(start.upload_session_id ?? '');
  const videoId = String(start.video_id ?? '');
  if (!session || !videoId) throw new MetaError('META_VIDEO_REJECTED', 'resumable upload did not start', { stage });
  let offset = Number(start.start_offset ?? 0);
  let end = Number(start.end_offset ?? 0);
  while (offset < end || (offset < size && end > offset)) {
    const len = Math.min(end - offset, CHUNK_BYTES, size - offset);
    const chunk = await i.video.read(offset, len);
    const form = new FormData();
    form.set('upload_phase', 'transfer');
    form.set('upload_session_id', session);
    form.set('start_offset', String(offset));
    form.set('video_file_chunk', new Blob([new Uint8Array(chunk)], { type: 'video/mp4' }), 'chunk.mp4');
    const r = await g.postForm<Raw>(`${i.adAccountId}/advideos`, form, token, { stage });
    const nextStart = Number(r.start_offset);
    const nextEnd = Number(r.end_offset);
    if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) throw new MetaError('META_VIDEO_REJECTED', 'resumable upload lost its offsets', { stage });
    if (nextStart === offset && nextEnd === end) throw new MetaError('META_VIDEO_REJECTED', 'resumable upload did not advance', { stage });
    offset = nextStart;
    end = nextEnd;
    if (offset >= size || offset === end) break;
  }
  const fin = await g.post<Raw>(`${i.adAccountId}/advideos`, { upload_phase: 'finish', upload_session_id: session, title: i.adName }, token, { stage });
  if (fin.success === false) throw new MetaError('META_VIDEO_REJECTED', 'resumable upload finish failed', { stage });
  return { videoId };
}

export async function waitVideoReady(g: GraphClient, token: string, ids: MetaPublishIds, opts: { timeoutMs?: number; pollMs?: number; onPoll?: (status: string) => void; now?: () => number; sleep?: (ms: number) => Promise<void> } = {}): Promise<void> {
  const stage = 'processing_video';
  if (!ids.videoId) throw new MetaError('META_ERROR', 'processing_video without videoId', { stage });
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const t0 = now();
  const deadline = t0 + (opts.timeoutMs ?? VIDEO_TIMEOUT_MS);
  for (;;) {
    const v = await g.get<Raw>(ids.videoId, { fields: 'status' }, token, { stage });
    const st = String(v.status?.video_status ?? 'processing');
    opts.onPoll?.(st);
    if (st === 'ready') return;
    if (st === 'error' || st === 'failed') throw new MetaError('META_VIDEO_REJECTED', v.status?.processing_phase?.errors?.[0]?.message ?? null, { stage, failDetail: JSON.stringify(v.status).slice(0, 200) });
    if (now() >= deadline) throw new MetaError('META_ERROR', 'Meta is still processing the video. Try again.', { stage, action: 'retry' });
    await sleep(opts.pollMs ?? VIDEO_POLL_MS);
  }
}

export async function createCampaign(g: GraphClient, token: string, i: MetaPublishInput): Promise<{ campaignId: string }> {
  const r = await g.post<Raw>(`${i.adAccountId}/campaigns`, campaignBody(i), token, { stage: 'creating_campaign' });
  return { campaignId: String(r.id) };
}
export async function createAdSet(g: GraphClient, token: string, i: MetaPublishInput, ids: MetaPublishIds, account: { currency: string | null; minimumDailyBudgetMinor: number | null }): Promise<{ adsetId: string }> {
  const stage = 'creating_adset';
  if (!ids.campaignId) throw new MetaError('META_ERROR', 'creating_adset without campaignId', { stage });
  try {
    const r = await g.post<Raw>(`${i.adAccountId}/adsets`, adSetBody(i, ids.campaignId), token, { stage });
    return { adsetId: String(r.id) };
  } catch (e) {
    if (isMetaError(e) && e.code === 'META_BUDGET_TOO_LOW') {
      throw new MetaError('META_BUDGET_TOO_LOW', e.message, { ...e.options, details: { minimumMinor: (e.details?.minimumMinor as number | undefined) ?? account.minimumDailyBudgetMinor ?? null, currency: account.currency } });
    }
    throw e;
  }
}
export async function createAdCreative(g: GraphClient, token: string, i: MetaPublishInput, ids: MetaPublishIds): Promise<{ creativeId: string }> {
  const stage = 'creating_creative';
  if (!ids.videoId) throw new MetaError('META_ERROR', 'creating_creative without videoId', { stage });
  const r = await g.post<Raw>(`${i.adAccountId}/adcreatives`, creativeBody(i, ids.videoId), token, { stage });
  return { creativeId: String(r.id) };
}
export async function createAd(g: GraphClient, token: string, i: MetaPublishInput, ids: MetaPublishIds): Promise<{ adId: string; previewUrl: string | null }> {
  const stage = 'creating_ad';
  if (!ids.adsetId || !ids.creativeId) throw new MetaError('META_ERROR', 'creating_ad without adsetId/creativeId', { stage });
  const r = await g.post<Raw>(`${i.adAccountId}/ads`, adBody(i, ids.adsetId, ids.creativeId), token, { stage });
  const adId = String(r.id);
  let previewUrl: string | null = null;
  try {
    const p = await g.get<Raw>(`${adId}/previews`, { ad_format: 'MOBILE_FEED_STANDARD' }, token, { stage, retries: 0 });
    const body: string | undefined = p.data?.[0]?.body;
    const m = body ? /src="([^"]+)"/.exec(body) : null;
    previewUrl = m ? m[1].replace(/&amp;/g, '&') : null;
  } catch {
    previewUrl = null; // opcional
  }
  return { adId, previewUrl };
}
export async function setStatus(g: GraphClient, token: string, i: { objectIds: string[]; status: 'ACTIVE' | 'PAUSED' }): Promise<void> {
  for (const id of i.objectIds) await g.post<Raw>(id, { status: i.status }, token, { stage: i.status === 'ACTIVE' ? 'activate' : 'pause' });
}
export function adsManagerUrl(adAccountId: string, adId: string): string {
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(adAccountId.replace(/^act_/, ''))}&selected_ad_ids=${encodeURIComponent(adId)}`;
}
