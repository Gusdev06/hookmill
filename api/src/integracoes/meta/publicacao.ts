// Publicação (meta-v1.md §3.3): as 6 chamadas da Marketing API, cada uma devolvendo só o id da etapa (o backend grava
// antes de chamar a próxima; retry não repete etapa com id). Upload do vídeo por file_url (prod) ou resumable
// (start/transfer/finish em pedaços de 8 MB) quando o render não é público.
import type { MetaBudgetType, MetaObjective, MetaPixelEvent, MetaTemplateOptimizationGoal } from '@maquina/contratos';
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

// ---------- meta-templates-v2 §2.1/§6 (03/11, I2) ----------
/** Metas aceitas por objetivo (ODAX v25) e o padrão quando `optimizationGoal` é null. */
export const OBJECTIVE_GOALS: Partial<Record<MetaObjective, { goals: readonly MetaTemplateOptimizationGoal[]; fallback: MetaTemplateOptimizationGoal }>> = {
  OUTCOME_AWARENESS: { goals: ['REACH', 'IMPRESSIONS', 'AD_RECALL_LIFT', 'THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS'], fallback: 'REACH' },
  OUTCOME_ENGAGEMENT: { goals: ['THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS', 'POST_ENGAGEMENT'], fallback: 'THRUPLAY' },
};
/** Otimização dos 2 objetivos novos (§2.1). Awareness: `promoted_object { page_id }`, sem destination_type. Engagement:
 *  ThruPlay/2 s = ON_VIDEO, POST_ENGAGEMENT = ON_POST, sem promoted_object. Pixel nunca vai. Meta fora da tabela = META_ERROR
 *  (o backend já barra no §3; aqui é só a última trava antes da Graph). */
export function optimizationForV2(objective: MetaObjective, goal: MetaTemplateOptimizationGoal | null | undefined, pageId: string): { optimization_goal: string; promoted_object?: Raw; destination_type?: string } | null {
  const t = OBJECTIVE_GOALS[objective];
  if (!t) return null;
  const g = goal ?? t.fallback;
  if (!t.goals.includes(g)) throw new MetaError('META_ERROR', `optimization goal ${g} is not valid for ${objective}`, { stage: 'creating_adset', action: null });
  if (objective === 'OUTCOME_AWARENESS') return { optimization_goal: g, promoted_object: { page_id: pageId } };
  return { optimization_goal: g, destination_type: g === 'POST_ENGAGEMENT' ? 'ON_POST' : 'ON_VIDEO' };
}

/** Campos v2 resolvidos (porta: `structure`; cai no `settings` se o backend só gravou lá). Tudo ausente = v1. */
export interface PublishV2 {
  budgetType: MetaBudgetType; lifetimeBudgetMinor: number | null; startTime: string | null; endTime: string | null;
  optimizationGoal: MetaTemplateOptimizationGoal | null; locales: number[]; customAudienceIds: string[]; excludedCustomAudienceIds: string[];
  instagramUserId: string | null;
}
export function v2Of(i: MetaPublishInput): PublishV2 {
  const st = i.structure ?? null;
  const s = i.settings;
  const pick = <K extends keyof PublishV2>(k: K): unknown => (st && (st as unknown as Record<string, unknown>)[k] !== undefined ? (st as unknown as Record<string, unknown>)[k] : (s as unknown as Record<string, unknown>)[k]);
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    budgetType: pick('budgetType') === 'LIFETIME' ? 'LIFETIME' : 'DAILY',
    lifetimeBudgetMinor: (pick('lifetimeBudgetMinor') as number | null | undefined) ?? null,
    startTime: (pick('startTime') as string | null | undefined) ?? null,
    endTime: (pick('endTime') as string | null | undefined) ?? null,
    optimizationGoal: (pick('optimizationGoal') as MetaTemplateOptimizationGoal | null | undefined) ?? null,
    locales: list<number>(pick('locales')),
    customAudienceIds: list<string>(pick('customAudienceIds')),
    excludedCustomAudienceIds: list<string>(pick('excludedCustomAudienceIds')),
    instagramUserId: (pick('instagramUserId') as string | null | undefined) ?? null,
  };
}
/** ISO UTC → formato da Graph com offset (`2026-11-10T14:00:00+0000`). Data inválida = META_ERROR (não manda lixo). */
export function graphTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new MetaError('META_ERROR', `invalid schedule time ${iso}`, { stage: 'creating_adset', action: null });
  return d.toISOString().replace(/\.\d{3}Z$/, '+0000');
}
/** Orçamento no nível onde ele mora: DAILY = `daily_budget`; LIFETIME = `lifetime_budget` (exige o total). */
function budgetOf(i: MetaPublishInput, v: PublishV2, stage: string): Raw {
  if (v.budgetType !== 'LIFETIME') return { daily_budget: i.settings.dailyBudgetMinor };
  if (!v.lifetimeBudgetMinor || v.lifetimeBudgetMinor < 1) throw new MetaError('META_ERROR', 'lifetime budget without an amount', { stage, action: null });
  return { lifetime_budget: v.lifetimeBudgetMinor };
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
  // CBO (Advantage campaign budget): orçamento (diário ou total, v2 §6) e estratégia de lance na campanha
  if (st?.budgetMode === 'CBO') return { ...base, ...budgetOf(i, v2Of(i), 'creating_campaign'), bid_strategy: GRAPH_BID_STRATEGY[st.bidStrategy] };
  // 04/11 (erro real na Graph): sem orçamento na campanha (ABO) a Meta exige `is_adset_budget_sharing_enabled` explícito.
  // false = cada conjunto gasta só o próprio orçamento (o que o template configura); true deixaria a Meta mover 20% entre eles.
  return { ...base, is_adset_budget_sharing_enabled: false };
}
/** `now` só decide se o `start_time` (v2) ainda é futuro: início que já passou não vai (a Meta começa ao publicar). */
export function adSetBody(i: MetaPublishInput, campaignId: string, now: Date = new Date()): Raw {
  const s = i.settings;
  const st = i.structure;
  const v = v2Of(i);
  const targeting: Raw = {
    geo_locations: { countries: s.countries }, age_min: s.ageMin, age_max: s.ageMax,
    targeting_automation: { advantage_audience: st && !st.advantageAudience ? 0 : 1 },
  };
  if (st && st.genders !== 'ALL') targeting.genders = [st.genders === 'MALE' ? 1 : 2];
  if (st) Object.assign(targeting, placementsOf(st.placements));
  // v2 §2.4/§2.6: lista vazia não vai
  if (v.locales.length) targeting.locales = [...v.locales];
  if (v.customAudienceIds.length) targeting.custom_audiences = v.customAudienceIds.map((id) => ({ id }));
  if (v.excludedCustomAudienceIds.length) targeting.excluded_custom_audiences = v.excludedCustomAudienceIds.map((id) => ({ id }));
  const cbo = st?.budgetMode === 'CBO';
  const capped = !!st && st.bidStrategy !== 'LOWEST_COST' && st.bidAmountMinor != null;
  // v2 §2.3/§6: start_time só se futuro; end_time quando há fim; LIFETIME sem fim a Meta recusa ("end_time required")
  const schedule: Raw = {};
  if (v.startTime && new Date(v.startTime).getTime() > now.getTime()) schedule.start_time = graphTime(v.startTime);
  if (v.endTime) schedule.end_time = graphTime(v.endTime);
  if (v.budgetType === 'LIFETIME' && !schedule.end_time) throw new MetaError('META_ERROR', 'lifetime budget needs an end time', { stage: 'creating_adset', action: null });
  return {
    name: st?.adsetName ?? i.adName, campaign_id: campaignId,
    // ABO: orçamento e estratégia no conjunto; CBO: herda da campanha (só o bid_amount do cap mora aqui)
    ...(cbo ? {} : { ...(st ? budgetOf(i, v, 'creating_adset') : { daily_budget: s.dailyBudgetMinor }), bid_strategy: st ? GRAPH_BID_STRATEGY[st.bidStrategy] : 'LOWEST_COST_WITHOUT_CAP' }),
    ...(capped ? { bid_amount: st!.bidAmountMinor } : {}),
    billing_event: 'IMPRESSIONS', status: 'PAUSED',
    ...schedule,
    targeting,
    ...(optimizationForV2(s.objective, v.optimizationGoal, i.pageId) ?? optimizationFor(s.objective, i.pixelId, s.pixelEvent)),
  };
}
export function creativeBody(i: MetaPublishInput, videoId: string): Raw {
  const s = i.settings;
  const ig = v2Of(i).instagramUserId;
  return {
    name: i.adName,
    object_story_spec: {
      page_id: i.pageId,
      // v2 §2.5: `instagram_user_id` (não `instagram_actor_id`, que saiu da referência); page_id continua o da conexão
      ...(ig ? { instagram_user_id: ig } : {}),
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
/** v2 §2.2: dias do total = teto((fim − início efetivo) / 24 h), início efetivo = max(startTime, agora). null sem fim. */
export function lifetimeDays(v: Pick<PublishV2, 'startTime' | 'endTime'>, now: Date): number | null {
  if (!v.endTime) return null;
  const start = Math.max(v.startTime ? new Date(v.startTime).getTime() : now.getTime(), now.getTime());
  const end = new Date(v.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}
/** Detalhes do 422 META_BUDGET_TOO_LOW: DAILY = { minimumMinor, currency } (v1); LIFETIME = o TOTAL (diário × dias) + budgetType/days. */
export function budgetTooLowDetails(i: MetaPublishInput, minimumDailyMinor: number | null, currency: string | null, now: Date = new Date()): Record<string, unknown> {
  const v = v2Of(i);
  if (v.budgetType !== 'LIFETIME') return { minimumMinor: minimumDailyMinor, currency };
  const days = lifetimeDays(v, now);
  return { minimumMinor: minimumDailyMinor != null && days != null ? minimumDailyMinor * days : null, currency, budgetType: 'LIFETIME', days };
}
export async function createAdSet(g: GraphClient, token: string, i: MetaPublishInput, ids: MetaPublishIds, account: { currency: string | null; minimumDailyBudgetMinor: number | null }, now: Date = new Date()): Promise<{ adsetId: string }> {
  const stage = 'creating_adset';
  if (!ids.campaignId) throw new MetaError('META_ERROR', 'creating_adset without campaignId', { stage });
  try {
    const r = await g.post<Raw>(`${i.adAccountId}/adsets`, adSetBody(i, ids.campaignId, now), token, { stage });
    return { adsetId: String(r.id) };
  } catch (e) {
    if (isMetaError(e) && e.code === 'META_BUDGET_TOO_LOW') {
      // a Graph fala do mínimo DIÁRIO (texto/subcódigo); com LIFETIME o detalhe vira o total do período
      const daily = (e.details?.minimumMinor as number | undefined) ?? account.minimumDailyBudgetMinor ?? null;
      throw new MetaError('META_BUDGET_TOO_LOW', e.message, { ...e.options, details: budgetTooLowDetails(i, daily, account.currency, now) });
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
