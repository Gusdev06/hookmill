// MetaService do modo mock (META_MODE=mock, padrão; meta-v1.md §8): sem rede, determinístico, instantâneo
// (stepMs 0 nos testes; 500 ms por passo no app pra tela mostrar progresso). Gatilhos listados em PORTA.md.
import type {
  MetaAdAccountOption, MetaCustomAudiencesResponse, MetaInstagramAccount, MetaInstagramAccountsResponse, MetaLocalesResponse, MetaMetrics, MetaOptions,
} from '@maquina/contratos';
import type {
  MetaAdsetSnapshotDraft, MetaCampaignSnapshotDraft, MetaLiveObject, MetaObjectLevelPort, MetaUsage,
  MetaAdAccountInfo, MetaAdSnapshotDraft, MetaAuth, MetaHealthInput, MetaHealthResult, MetaOAuthState, MetaPublishIds, MetaPublishInput,
  MetaReturnTo, MetaService, MetaServiceStatus, MetaSyncInput, MetaSyncResult, MetaSyncStage, MetaTokenGrant, MetaTokenInfo, MetaWinnerRule,
  MetaTemplateSourceRead, MetaKnownCreativeLink,
} from '../contrato';
import type { Raw } from './cliente';
import { adSetBody, budgetTooLowDetails, campaignBody, creativeBody, graphTime, lifetimeDays, v2Of } from './publicacao';
import { audienceOf, mergeIgAccounts, sortAudiences } from './listas';
import type { MetaCustomAudienceOption } from '@maquina/contratos';
import { randomBytes } from 'node:crypto';
import { mockMediaUrl, seedOf } from '../mock/midia';
import { MetaError, accountStatusLabel } from './erros';
import { REQUIRED_SCOPES, missingScopes } from './escopos';
import { signState, verifyState } from './estado';
import { buildHealth } from './saude';
import { objectUrl as liveObjectUrl } from './campanhas';
import { scoreAllAds } from './vencedor';
import { resultActionTypes } from './leitura';

export const MOCK_GRAPH_VERSION = 'v25.0';
export const MOCK_MIN_DAILY_BUDGET_MINOR = 500;
export const MOCK_TOKEN = 'mock';
/** `mock` (conexões antigas, testes) ou `mock.<hex>` (um por OAuth mock: identifica a conexão pro escopo das escritas). */
export const isMockToken = (t: string) => t === MOCK_TOKEN || /^mock\.[0-9a-f]+$/.test(t);
export const MOCK_USER = { id: 'mock_user', name: 'Mock User' };
const DAY = 86_400_000;

export interface FakeMetaOptions {
  publicApiUrl: string;
  jwtSecret: string;
  rule: MetaWinnerRule;
  /** atraso por passo (sync: 4 passos; publicação: 1 por etapa). 0 nos testes */
  stepMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

type MockAccount = MetaAdAccountInfo & { pixels: { id: string; name: string; lastFiredDaysAgo: number }[] };

function account(id: string, name: string, currency: string, accountStatus: number, canManage: boolean, pixels: MockAccount['pixels']): MockAccount {
  return {
    id, name, currency, timezoneName: currency === 'BRL' ? 'America/Sao_Paulo' : 'America/New_York',
    accountStatus, accountStatusLabel: accountStatusLabel(accountStatus),
    business: { id: 'biz_mock', name: 'Mock Business' },
    canManage, hasFunding: true, minimumDailyBudgetMinor: MOCK_MIN_DAILY_BUDGET_MINOR, pixels,
  };
}
export const MOCK_ACCOUNTS: MockAccount[] = [
  account('act_mock_1', 'Mock Store (USD)', 'USD', 1, true, [{ id: 'pix_mock', name: 'Mock Pixel', lastFiredDaysAgo: 1 }]),
  account('act_mock_2', 'Mock Disabled (BRL)', 'BRL', 2, true, [{ id: 'pix_mock', name: 'Mock Pixel', lastFiredDaysAgo: 1 }]),
  account('act_mock_3', 'Mock Read-only (USD)', 'USD', 1, false, [{ id: 'pix_mock', name: 'Mock Pixel', lastFiredDaysAgo: 1 }]),
];
export const MOCK_PAGE = { id: 'page_mock', name: 'Mock Page' };

/** MetaMetrics a partir dos números básicos (o resto é derivado como no live). `plays2s` = o que o live lê de
 *  `video_continuous_2_sec_watched_actions` (2-Second Continuous Video Plays; a Graph não tem campo de 3 s). */
export function metricsOf(i: { spend: number; impressions: number; clicks: number; results: number; resultType: string | null; plays2s?: number | null; thruplays?: number | null; reach?: number | null; roas?: number | null }): MetaMetrics {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    spend: r2(i.spend), impressions: i.impressions, clicks: i.clicks,
    ctr: i.impressions ? r2((i.clicks / i.impressions) * 100) : 0,
    results: i.results, resultType: i.resultType,
    cpa: i.results > 0 ? r2(i.spend / i.results) : null,
    roas: i.roas ?? null,
    plays2s: i.plays2s ?? null,
    hookRate: i.plays2s != null && i.impressions ? r2((i.plays2s / i.impressions) * 100) : null,
    thruplays: i.thruplays ?? null,
    frequency: i.reach ? r2(i.impressions / i.reach) : null,
  };
}

interface Seed { id: string; name: string; status: string; createdDaysAgo: number; m30: [number, number, number, number, number]; m7: [number, number, number, number, number, number]; prev: [number, number, number, number, number, number]; video: boolean; adset: string; /** publicação HookMill: id do vídeo enviado e hora real da criação */ videoId?: string; createdAt?: string }
// [spend, impressions, clicks, results, plays2s (= 2-s continuous plays)] e nas janelas de 7 d [+ reach]
const SEEDS: Seed[] = [
  { id: 'mock_ad_1', name: 'Hook A — the pain', status: 'ACTIVE', createdDaysAgo: 40, m30: [420, 60000, 1500, 21, 24000], m7: [112, 15000, 390, 7, 6300, 7500], prev: [110, 14500, 360, 5, 5800, 7400], video: true, adset: 'mock_adset_cbo_1' },
  { id: 'mock_ad_2', name: 'Hook B — the proof', status: 'ACTIVE', createdDaysAgo: 33, m30: [380, 54000, 1240, 16, 20500], m7: [96, 13500, 300, 4, 5100, 6900], prev: [92, 13000, 290, 4, 4900, 6700], video: true, adset: 'mock_adset_cbo_1' },
  { id: 'mock_ad_3', name: 'Hook C — the demo', status: 'ACTIVE', createdDaysAgo: 28, m30: [310, 50000, 900, 10, 16000], m7: [120, 20000, 330, 3, 6000, 5200], prev: [84, 12000, 290, 3, 4300, 5900], video: true, adset: 'mock_adset_cbo_2' },
  { id: 'mock_ad_4', name: 'Hook D — the testimonial', status: 'ACTIVE', createdDaysAgo: 25, m30: [260, 41000, 760, 7, 12300], m7: [70, 11000, 200, 3, 3300, 6000], prev: [66, 10500, 195, 3, 3200, 5900], video: true, adset: 'mock_adset_abo_1' },
  { id: 'mock_ad_5', name: 'Hook E — new this week', status: 'ACTIVE', createdDaysAgo: 3, m30: [40, 7000, 150, 1, 2600], m7: [40, 7000, 150, 1, 2600, 5000], prev: [0, 0, 0, 0, 0, 0], video: true, adset: 'mock_adset_abo_paused' },
  { id: 'mock_ad_6', name: 'Hook F — new this week', status: 'PAUSED', createdDaysAgo: 2, m30: [22, 3500, 70, 0, 1200], m7: [22, 3500, 70, 0, 1200, 2800], prev: [0, 0, 0, 0, 0, 0], video: true, adset: 'mock_adset_abo_stale' },
  { id: 'mock_ad_7', name: 'Hook G — disapproved', status: 'DISAPPROVED', createdDaysAgo: 20, m30: [48, 9000, 180, 6, 3300], m7: [24, 4500, 90, 3, 1650, 3000], prev: [24, 4400, 92, 3, 1600, 2950], video: true, adset: 'mock_adset_abo_1' },
  // campanhas-v1 D2: anúncios de imagem (videoId null); veredito contra a régua dos vídeos. Os nomes carregam os gatilhos de escrita do §6.
  { id: 'mock_ad_img_1', name: 'Image — static offer [mock:meta-rate]', status: 'ACTIVE', createdDaysAgo: 30, m30: [210, 38000, 720, 9, 0], m7: [55, 9800, 180, 3, 0, 5100], prev: [52, 9500, 175, 3, 0, 5000], video: false, adset: 'mock_adset_cbo_1' },
  { id: 'mock_ad_img_2', name: 'Image — carousel [mock:meta-token]', status: 'ACTIVE', createdDaysAgo: 12, m30: [35, 7000, 120, 1, 0], m7: [20, 4000, 70, 1, 0, 3000], prev: [15, 3000, 50, 0, 0, 2400], video: false, adset: 'mock_adset_life_1' },
  { id: 'mock_ad_novideo', name: 'Hook H — video not downloadable', status: 'ACTIVE', createdDaysAgo: 18, m30: [30, 6000, 110, 6, 2100], m7: [14, 2800, 50, 3, 980, 2000], prev: [14, 2700, 52, 3, 950, 1950], video: true, adset: 'mock_adset_life_1' },
];

// ---------- campanhas-v1 §6: 3 campanhas (CBO diário, ABO, CBO vitalício) e 6 conjuntos ----------
interface CampaignSeed { id: string; name: string; objective: string; status: 'ACTIVE' | 'PAUSED'; daily: number | null; lifetime: number | null; bidStrategy: string }
interface AdsetSeed {
  id: string; campaignId: string; name: string; status: 'ACTIVE' | 'PAUSED'; daily: number | null; learning: 'LEARNING' | 'SUCCESS' | 'FAIL' | null;
  // meta-templates-v2 §9 (opcionais; ausente = como antes): total do conjunto (ABO), meta, agendamento (dias relativos a "agora", ou ISO nos publicados)
  lifetime?: number | null; optimizationGoal?: string;
  startDaysAgo?: number; endInDays?: number; startTime?: string | null; endTime?: string | null;
}
export const MOCK_CAMPAIGNS: CampaignSeed[] = [
  { id: 'mock_cmp_cbo', name: 'Mock — Prospecting (CBO)', objective: 'OUTCOME_SALES', status: 'ACTIVE', daily: 5000, lifetime: null, bidStrategy: 'LOWEST_COST_WITHOUT_CAP' },
  { id: 'mock_cmp_abo', name: 'Mock — Testing (ABO)', objective: 'OUTCOME_SALES', status: 'ACTIVE', daily: null, lifetime: null, bidStrategy: 'LOWEST_COST_WITHOUT_CAP' },
  { id: 'mock_cmp_life', name: 'Mock — Launch (lifetime)', objective: 'OUTCOME_TRAFFIC', status: 'ACTIVE', daily: null, lifetime: 30000, bidStrategy: 'LOWEST_COST_WITHOUT_CAP' },
];
export const MOCK_ADSETS: AdsetSeed[] = [
  { id: 'mock_adset_cbo_1', campaignId: 'mock_cmp_cbo', name: 'Mock — Broad US', status: 'ACTIVE', daily: null, learning: 'SUCCESS' },
  { id: 'mock_adset_cbo_2', campaignId: 'mock_cmp_cbo', name: 'Mock — Lookalike 1%', status: 'ACTIVE', daily: null, learning: 'LEARNING' },
  { id: 'mock_adset_abo_1', campaignId: 'mock_cmp_abo', name: 'Mock — Interests', status: 'ACTIVE', daily: 2000, learning: 'SUCCESS' },
  { id: 'mock_adset_abo_paused', campaignId: 'mock_cmp_abo', name: 'Mock — Paused test', status: 'PAUSED', daily: 1500, learning: null },
  { id: 'mock_adset_abo_stale', campaignId: 'mock_cmp_abo', name: 'Mock — Retargeting [mock:stale]', status: 'ACTIVE', daily: 1000, learning: 'FAIL' },
  // v2: o conjunto da campanha vitalícia tem início e fim (a Meta exige fim com orçamento total) → importa como LIFETIME + AFTER_DAYS
  { id: 'mock_adset_life_1', campaignId: 'mock_cmp_life', name: 'Mock — Launch audience', status: 'ACTIVE', daily: null, learning: 'SUCCESS', optimizationGoal: 'LINK_CLICKS', startDaysAgo: 10, endInDays: 20 },
];
/** meta-templates-v2 §9: campanha de Awareness (CBO US$ 30/dia, REACH, ig_mock_1 no criativo) SÓ PRA IMPORTAR
 *  (`POST /meta/templates/import { level, id: 'mock_cmp_awareness' }`). Fica FORA do sync/leitura ao vivo de propósito: as
 *  contagens do sync (3 campanhas, 6 conjuntos, 10 anúncios) que os specs do backend e do QA conferem não mudam. */
export const MOCK_IMPORT_ONLY: Catalog = {
  campaigns: [{ id: 'mock_cmp_awareness', name: 'Mock — Brand awareness', objective: 'OUTCOME_AWARENESS', status: 'ACTIVE', daily: 3000, lifetime: null, bidStrategy: 'LOWEST_COST_WITHOUT_CAP' }],
  adsets: [{ id: 'mock_adset_awareness_1', campaignId: 'mock_cmp_awareness', name: 'Mock — Reach US', status: 'ACTIVE', daily: null, learning: 'SUCCESS', optimizationGoal: 'REACH' }],
  seeds: [{ id: 'mock_ad_awareness', name: 'Brand — reach test', status: 'ACTIVE', createdDaysAgo: 15, m30: [0, 0, 0, 0, 0], m7: [0, 0, 0, 0, 0, 0], prev: [0, 0, 0, 0, 0, 0], video: true, adset: 'mock_adset_awareness_1' }],
};

// ---------- meta-templates-v2 §9: listas da conta (mesmos fixtures do MSW do web) ----------
export const MOCK_IG_ACCOUNTS: MetaInstagramAccount[] = [
  { id: 'ig_mock_1', username: 'hookmill.demo', profilePicUrl: null, source: 'AD_ACCOUNT' },
  { id: 'ig_mock_page', username: 'mock.page', profilePicUrl: null, source: 'PAGE' },
];
/** Corpo cru como a Graph devolve (`act/customaudiences`), passado pelo mesmo `audienceOf` do live. time_updated em segundos. */
export const MOCK_CUSTOM_AUDIENCES_RAW: Record<string, unknown>[] = [
  { id: 'ca_mock_buyers', name: 'Website buyers 180d', subtype: 'WEBSITE', approximate_count_lower_bound: 12000, approximate_count_upper_bound: 15000, delivery_status: { code: 200, description: 'This audience is ready for use.' }, operation_status: { code: 200, description: 'Normal' }, time_updated: 1793491200 },
  { id: 'ca_mock_lal_1', name: 'Lookalike (US, 1%) - Website buyers 180d', subtype: 'LOOKALIKE', approximate_count_lower_bound: 1200000, approximate_count_upper_bound: 1400000, delivery_status: { code: 200, description: 'This audience is ready for use.' }, operation_status: { code: 200, description: 'Normal' }, time_updated: 1793404800 },
  { id: 'ca_mock_small', name: 'Newsletter list (small)', subtype: 'CUSTOM', approximate_count_lower_bound: -1, approximate_count_upper_bound: -1, delivery_status: { code: 300, description: 'Audience too small' }, operation_status: { code: 200, description: 'Normal' }, time_updated: 1793318400 },
  { id: 'ca_mock_flagged', name: 'Imported list (flagged)', subtype: 'CUSTOM', approximate_count_lower_bound: 5000, approximate_count_upper_bound: 6000, delivery_status: { code: 200, description: 'This audience is ready for use.' }, operation_status: { code: 471, description: 'This audience was flagged and cannot be used.' }, time_updated: 1793232000 },
];
export const MOCK_CUSTOM_AUDIENCES: MetaCustomAudienceOption[] = sortAudiences(MOCK_CUSTOM_AUDIENCES_RAW.map((o) => audienceOf(o)!));
/** 6 e 24 confirmados na doc da Meta; os outros são ilustrativos (sem colidir). O live vem da Graph (`search?type=adlocale`). */
export const MOCK_LOCALES: MetaLocalesResponse['locales'] = [
  { key: 1001, name: 'English (All)' }, { key: 24, name: 'English (UK)' }, { key: 6, name: 'English (US)' }, { key: 9, name: 'French (France)' },
  { key: 5, name: 'German' }, { key: 16, name: 'Portuguese (Brazil)' }, { key: 31, name: 'Portuguese (Portugal)' }, { key: 23, name: 'Spanish' },
];
/** Gatilhos do §9: ids gravados num template que NÃO aparecem nas listas (o backend responde 400 notAvailable no envio). */
export const MOCK_GONE_IDS = { instagram: 'ig_mock_gone', audience: 'ca_mock_gone' } as const;
const DAY_MS = 86_400_000;
/** Horário no formato da Graph (`2026-11-10T14:00:00+0000`). */
const graphAt = (ms: number) => graphTime(new Date(ms).toISOString());
/** Estrutura publicada pelo HookMill (createCampaign/AdSet/Ad do mock), PAUSED como no live; entra no sync com selo (§6). */
export interface MockPublished {
  campaigns: Map<string, { id: string; name: string; objective: string; createdAt: string; daily?: number | null; lifetime?: number | null }>;
  adsets: Map<string, { id: string; campaignId: string; name: string; daily: number | null; createdAt: string; lifetime?: number | null; optimizationGoal?: string; startTime?: string | null; endTime?: string | null }>;
  ads: Map<string, { id: string; adsetId: string; name: string; videoId: string; createdAt: string }>;
}
/** Estado mutável das escritas mock de UM escopo (conexão + conta, ver FakeMetaService.scope): status/orçamento por id e a
 *  estrutura publicada. A próxima leitura e o próximo sync do mesmo escopo refletem a escrita; outro escopo nunca vê. */
export interface MockWriteState { status: Map<string, 'ACTIVE' | 'PAUSED'>; daily: Map<string, number>; published: MockPublished }
export const newMockWriteState = (): MockWriteState => ({ status: new Map(), daily: new Map(), published: { campaigns: new Map(), adsets: new Map(), ads: new Map() } });
const seedStatus = (s: Seed): 'ACTIVE' | 'PAUSED' => (s.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE');

/** Estrutura vista por um escopo: a fixa do §6 + o que foi publicado nele (órfãos, sem pai publicado, ficam de fora). */
interface Catalog { campaigns: CampaignSeed[]; adsets: AdsetSeed[]; seeds: Seed[] }
const Z5: Seed['m30'] = [0, 0, 0, 0, 0];
const Z6: Seed['m7'] = [0, 0, 0, 0, 0, 0];
function catalogOf(st: MockWriteState, withImportOnly = false): Catalog {
  const p = st.published;
  if (withImportOnly) {
    const c = catalogOf(st);
    return { campaigns: [...c.campaigns, ...MOCK_IMPORT_ONLY.campaigns], adsets: [...c.adsets, ...MOCK_IMPORT_ONLY.adsets], seeds: [...c.seeds, ...MOCK_IMPORT_ONLY.seeds] };
  }
  return {
    campaigns: [...MOCK_CAMPAIGNS, ...[...p.campaigns.values()].map<CampaignSeed>((c) => ({ id: c.id, name: c.name, objective: c.objective, status: 'PAUSED', daily: c.daily ?? null, lifetime: c.lifetime ?? null, bidStrategy: 'LOWEST_COST_WITHOUT_CAP' }))],
    adsets: [...MOCK_ADSETS, ...[...p.adsets.values()].filter((a) => p.campaigns.has(a.campaignId)).map<AdsetSeed>((a) => ({ id: a.id, campaignId: a.campaignId, name: a.name, status: 'PAUSED', daily: a.daily, learning: null, lifetime: a.lifetime ?? null, optimizationGoal: a.optimizationGoal, startTime: a.startTime ?? null, endTime: a.endTime ?? null }))],
    seeds: [...SEEDS, ...[...p.ads.values()].filter((a) => { const s = p.adsets.get(a.adsetId); return !!s && p.campaigns.has(s.campaignId); })
      .map<Seed>((a) => ({ id: a.id, name: a.name, status: 'PAUSED', createdDaysAgo: 0, createdAt: a.createdAt, m30: Z5, m7: Z6, prev: Z6, video: true, videoId: a.videoId, adset: a.adsetId }))],
  };
}

/** effective_status como a Meta explica: o próprio status, ou o pai pausado (CAMPAIGN_PAUSED / ADSET_PAUSED). */
function effectiveOf(st: MockWriteState, cat: Catalog, level: MetaObjectLevelPort, id: string): string {
  if (level === 'campaign') {
    const c = cat.campaigns.find((x) => x.id === id)!;
    return st.status.get(id) ?? c.status;
  }
  if (level === 'adset') {
    const a = cat.adsets.find((x) => x.id === id)!;
    if ((st.status.get(a.campaignId) ?? cat.campaigns.find((c) => c.id === a.campaignId)!.status) === 'PAUSED') return 'CAMPAIGN_PAUSED';
    return st.status.get(id) ?? a.status;
  }
  const s = cat.seeds.find((x) => x.id === id)!;
  const own = st.status.get(id) ?? seedStatus(s);
  if (own === 'PAUSED') return 'PAUSED';
  if (s.status === 'DISAPPROVED') return 'DISAPPROVED';
  const parent = effectiveOf(st, cat, 'adset', s.adset);
  return parent === 'ACTIVE' ? 'ACTIVE' : parent === 'PAUSED' ? 'ADSET_PAUSED' : parent;
}

/**
 * meta-oferta-v1 §2/§9: link de destino fake por anúncio (os casos do §3.7 com X = "Spy Gram" spygram.app/quiz + Kiwify Ab12,
 * Y = "Zap Spy" zapspy.com.br): casa, prefixo, Kiwify da oferta, estrangeiro, post existente, formulário, Kiwify de outro,
 * site de Y, conversa e só o domínio. Publicado pelo HookMill (fora da tabela) = `none`: casa pela regra 3 (hookmill).
 */
export const MOCK_AD_LINKS: Record<string, MetaKnownCreativeLink> = {
  mock_ad_1: { destinationUrls: ['https://spygram.app/quiz?utm_source=fb&utm_campaign=cbo01'], destinationSource: 'video_cta', urlTags: 'utm_source=facebook&utm_medium=paid' },
  mock_ad_2: { destinationUrls: ['https://spygram.app/quiz/step-2'], destinationSource: 'video_cta', urlTags: null },
  mock_ad_3: { destinationUrls: ['https://pay.kiwify.com.br/Ab12?src=ad'], destinationSource: 'video_cta', urlTags: null },
  mock_ad_4: { destinationUrls: ['https://outroproduto.com/vsl'], destinationSource: 'video_cta', urlTags: null },
  mock_ad_5: { destinationUrls: [], destinationSource: 'existing_post', urlTags: null },
  mock_ad_6: { destinationUrls: [], destinationSource: 'lead_form', urlTags: null },
  mock_ad_7: { destinationUrls: ['https://pay.kiwify.com.br/Zz99'], destinationSource: 'video_cta', urlTags: null },
  mock_ad_img_1: { destinationUrls: ['https://zapspy.com.br/promo'], destinationSource: 'story_link', urlTags: null },
  mock_ad_img_2: { destinationUrls: [], destinationSource: 'messaging', urlTags: null },
  mock_ad_novideo: { destinationUrls: ['https://lp.spygram.app/outra'], destinationSource: 'video_cta', urlTags: null },
};
const NO_LINK: MetaKnownCreativeLink = { destinationUrls: [], destinationSource: 'none', urlTags: null };

export function mockAds(publicApiUrl: string, i: { resultType: string | null; now: Date; state?: MockWriteState }): Omit<MetaAdSnapshotDraft, 'verdict' | 'trend'>[] {
  const st = i.state ?? newMockWriteState();
  const cat = catalogOf(st);
  return cat.seeds.map((s) => {
    const seed = seedOf('meta', s.id);
    const videoId = s.videoId ?? (s.id === 'mock_ad_novideo' ? 'mock_video_novideo' : `mock_video_${s.id.replace('mock_ad_', '')}`);
    const m = (a: number[]): MetaMetrics => metricsOf({ spend: a[0], impressions: a[1], clicks: a[2], results: a[3], plays2s: s.video ? a[4] : null, thruplays: s.video ? Math.round(a[4] * 0.35) : null, reach: a[5] || null, resultType: i.resultType, roas: i.resultType === 'omni_purchase' && a[3] > 0 ? Math.round((a[3] * 47) / Math.max(a[0], 1) * 100) / 100 : null });
    const adset = cat.adsets.find((a) => a.id === s.adset)!;
    return {
      metaAdId: s.id, name: s.name, effectiveStatus: effectiveOf(st, cat, 'ad', s.id), status: st.status.get(s.id) ?? seedStatus(s),
      campaign: { id: adset.campaignId, name: cat.campaigns.find((c) => c.id === adset.campaignId)!.name },
      adset: { id: s.adset, name: adset.name },
      metaCreativeId: `mock_creative_${s.id}`, videoId: s.video ? videoId : null,
      thumbnailUrl: mockMediaUrl(publicApiUrl, { kind: 'face', seed }),
      resultType: i.resultType,
      metrics: m(s.m30), metrics7d: m(s.m7), metricsPrev7d: m(s.prev),
      adCreatedTime: s.createdAt ?? new Date(i.now.getTime() - s.createdDaysAgo * DAY).toISOString(),
      ...(MOCK_AD_LINKS[s.id] ?? NO_LINK),
    };
  });
}

/** Soma das métricas dos anúncios (no mock basta; o live lê por nível, D3). Frequência = impressões/alcance somados. */
function sumMetrics(list: MetaMetrics[], resultType: string | null): MetaMetrics {
  const t = list.reduce((a, m) => ({ spend: a.spend + m.spend, impressions: a.impressions + m.impressions, clicks: a.clicks + m.clicks, results: a.results + m.results, plays2s: a.plays2s + (m.plays2s ?? 0), thruplays: a.thruplays + (m.thruplays ?? 0), reach: a.reach + (m.frequency ? m.impressions / m.frequency : m.impressions / 2) }), { spend: 0, impressions: 0, clicks: 0, results: 0, plays2s: 0, thruplays: 0, reach: 0 });
  return metricsOf({ spend: t.spend, impressions: t.impressions, clicks: t.clicks, results: t.results, plays2s: t.plays2s || null, thruplays: t.thruplays || null, reach: t.reach ? Math.round(t.reach) : null, resultType });
}

export function mockStructure(ads: Omit<MetaAdSnapshotDraft, 'verdict' | 'trend'>[], i: { resultType: string | null; now: Date; state?: MockWriteState }): { campaigns: MetaCampaignSnapshotDraft[]; adsets: MetaAdsetSnapshotDraft[] } {
  const st = i.state ?? newMockWriteState();
  const cat = catalogOf(st);
  const of = (pick: (a: (typeof ads)[number]) => boolean) => {
    const mine = ads.filter(pick);
    return { metrics: sumMetrics(mine.map((a) => a.metrics), i.resultType), metrics7d: sumMetrics(mine.map((a) => a.metrics7d), i.resultType), metricsPrev7d: sumMetrics(mine.map((a) => a.metricsPrev7d), i.resultType) };
  };
  const created = new Date(i.now.getTime() - 45 * DAY).toISOString();
  const createdOf = (id: string) => st.published.campaigns.get(id)?.createdAt ?? st.published.adsets.get(id)?.createdAt ?? created;
  const campaigns = cat.campaigns.map<MetaCampaignSnapshotDraft>((c) => {
    const daily = c.daily != null ? st.daily.get(c.id) ?? c.daily : null;
    return {
      campaignId: c.id, name: c.name, objective: c.objective, status: st.status.get(c.id) ?? c.status, effectiveStatus: effectiveOf(st, cat, 'campaign', c.id),
      buyingType: 'AUCTION', bidStrategy: c.bidStrategy, dailyBudgetMinor: daily, lifetimeBudgetMinor: c.lifetime, budgetRemainingMinor: c.lifetime != null ? Math.round(c.lifetime * 0.6) : daily,
      specialAdCategories: [], startTime: createdOf(c.id), stopTime: c.lifetime != null ? new Date(i.now.getTime() + 20 * DAY).toISOString() : null, createdTime: createdOf(c.id),
      ...of((a) => a.campaign.id === c.id),
    };
  });
  const adsets = cat.adsets.map<MetaAdsetSnapshotDraft>((a) => {
    const daily = a.daily != null ? st.daily.get(a.id) ?? a.daily : null;
    const sched = adsetSchedule(a, i.now);
    return {
      adsetId: a.id, campaignId: a.campaignId, name: a.name, status: st.status.get(a.id) ?? a.status, effectiveStatus: effectiveOf(st, cat, 'adset', a.id),
      optimizationGoal: a.optimizationGoal ?? 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS', bidStrategy: null,
      dailyBudgetMinor: daily, lifetimeBudgetMinor: a.lifetime ?? null, budgetRemainingMinor: daily ?? (a.lifetime != null ? Math.round(a.lifetime * 0.6) : null), learningStage: a.learning,
      startTime: sched.startTime ?? createdOf(a.id), endTime: sched.endTime, createdTime: createdOf(a.id),
      ...of((x) => x.adset.id === a.id),
    };
  });
  return { campaigns, adsets };
}

/** Agendamento do conjunto (fixos: dias relativos a `now`; publicados: o ISO gravado). Formato da Graph. */
function adsetSchedule(a: AdsetSeed, now: Date): { startTime: string | null; endTime: string | null } {
  const t = now.getTime();
  return {
    startTime: a.startTime ?? (a.startDaysAgo != null ? graphAt(t - a.startDaysAgo * DAY_MS) : null),
    endTime: a.endTime ?? (a.endInDays != null ? graphAt(t + a.endInDays * DAY_MS) : null),
  };
}

export function resultTypeFor(businessType: MetaSyncInput['businessType'], hasPixel: boolean, resultType?: MetaSyncInput['resultType']): string {
  if (resultType) return resultActionTypes(businessType, hasPixel, resultType).primary;
  if (!hasPixel) return 'link_click';
  if (businessType === 'ONLINE_STORE') return 'omni_purchase';
  if (businessType === 'LOCAL_BUSINESS') return 'lead';
  if (businessType === 'APP') return 'omni_app_install';
  return 'link_click';
}

const trigger = (text: string | null | undefined, key: string) => !!text && text.includes(`[mock:${key}]`);

/** Objeto mock por id (estrutura do §6 + o que foi publicado no escopo); null = não existe nesse escopo. */
export function mockObject(id: string, st: MockWriteState = newMockWriteState(), withImportOnly = false): { level: MetaObjectLevelPort; name: string } | null {
  const cat = catalogOf(st, withImportOnly);
  const c = cat.campaigns.find((x) => x.id === id);
  if (c) return { level: 'campaign', name: c.name };
  const a = cat.adsets.find((x) => x.id === id);
  if (a) return { level: 'adset', name: a.name };
  const s = cat.seeds.find((x) => x.id === id);
  return s ? { level: 'ad', name: s.name } : null;
}

export class FakeMetaService implements MetaService {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  /** escritas mock (campanhas-v1 §6: "o QA vê o toggle mudar"), uma por escopo `token|conta`; vivem enquanto a API estiver
   *  de pé. Cada OAuth mock devolve um token próprio (`mock.<hex>`), então escopo = conexão + conta de anúncio: o que um
   *  workspace pausa/publica nunca aparece no snapshot nem na leitura ao vivo de outro (QA 23/10, bug B). */
  private readonly scopes = new Map<string, MockWriteState>();
  /** última conta vista por token (sync/publicação/leitura de conta): as escritas não recebem adAccountId na porta */
  private readonly accountOf = new Map<string, string>();
  /** meta-templates-v1: corpos Graph que a publicação montou (campaignBody/adSetBody/creativeBody reais), pros testes conferirem CBO/ABO etc. */
  readonly sent: { campaigns: Raw[]; adsets: Raw[]; creatives: Raw[] } = { campaigns: [], adsets: [], creatives: [] };
  constructor(private readonly opts: FakeMetaOptions) {
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  /** Estado do escopo conexão (token) + conta. Sem conta explícita = a última usada por essa conexão. */
  scope(auth: MetaAuth, adAccountId?: string | null): MockWriteState {
    if (adAccountId) this.accountOf.set(auth.accessToken, adAccountId);
    const acc = adAccountId ?? this.accountOf.get(auth.accessToken) ?? MOCK_ACCOUNTS[0].id;
    const key = `${auth.accessToken}|${acc}`;
    let st = this.scopes.get(key);
    if (!st) this.scopes.set(key, (st = newMockWriteState()));
    return st;
  }
  private step(times = 1) {
    const ms = (this.opts.stepMs ?? 500) * times;
    return ms > 0 ? this.sleep(ms) : Promise.resolve();
  }

  status(): MetaServiceStatus {
    return { mode: 'mock', configured: true, appIdMasked: 'mock', graphVersion: MOCK_GRAPH_VERSION };
  }

  buildAuthUrl(i: { workspaceId: string; userId: string; returnTo: MetaReturnTo }) {
    const { state, expiresAt } = signState(i, this.opts.jwtSecret, this.now().getTime());
    const url = `${this.opts.publicApiUrl.replace(/\/$/, '')}/api/v1/meta/callback?code=mock&state=${encodeURIComponent(state)}`;
    return { url, state, expiresAt };
  }
  verifyState(state: string | undefined | null, expect?: { workspaceId?: string; userId?: string }): MetaOAuthState {
    return verifyState(state, this.opts.jwtSecret, expect, this.now().getTime());
  }
  async exchangeCode(q: { code?: string | null; error?: string | null; errorReason?: string | null; errorDescription?: string | null }): Promise<MetaTokenGrant> {
    const code = (q.code ?? '').trim();
    if (q.error === 'access_denied' || code === 'mock-denied') throw new MetaError('META_OAUTH_DENIED', null, { action: null, details: { reason: q.errorReason ?? 'user_denied' } });
    if (q.error) throw new MetaError('META_OAUTH_FAILED', null, { action: null, failDetail: `${q.error}: ${q.errorDescription ?? ''}` });
    if (code === 'mock-scopes') throw new MetaError('META_SCOPES_MISSING', null, { action: null, details: { missing: ['ads_management'] } });
    if (code === 'mock-failed' || !code) throw new MetaError('META_OAUTH_FAILED', null, { action: null, failDetail: 'mock: code invalid' });
    return { accessToken: `${MOCK_TOKEN}.${randomBytes(6).toString('hex')}`, tokenType: 'USER_LONG_LIVED', expiresAt: new Date(this.now().getTime() + 60 * DAY).toISOString(), scopes: [...REQUIRED_SCOPES], user: { ...MOCK_USER } };
  }
  async inspectToken(auth: MetaAuth): Promise<MetaTokenInfo> {
    const ok = isMockToken(auth.accessToken);
    const scopes = ok ? [...REQUIRED_SCOPES] : [];
    return { isValid: ok, expiresAt: ok ? new Date(this.now().getTime() + 60 * DAY).toISOString() : null, scopes, missingScopes: missingScopes(scopes) };
  }
  async revoke(_auth: MetaAuth): Promise<void> {
    /* mock: nada a revogar */
  }

  private assertToken(auth: MetaAuth) {
    if (!isMockToken(auth.accessToken)) throw new MetaError('META_TOKEN_INVALID', 'mock: token is not "mock"');
  }
  private findAccount(id: string): MockAccount {
    const a = MOCK_ACCOUNTS.find((x) => x.id === id);
    if (!a) throw new MetaError('META_PERMISSION', `mock: ad account ${id} is not available to this user`, { details: { adAccountId: id, reason: 'no_advertise_task' } });
    return a;
  }

  async listOptions(auth: MetaAuth, q: { adAccountId?: string | null }): Promise<MetaOptions> {
    this.assertToken(auth);
    const adAccounts: MetaAdAccountOption[] = MOCK_ACCOUNTS.map((a) => ({
      id: a.id, name: a.name, currency: a.currency, accountStatus: a.accountStatus, business: a.business,
      canManage: a.canManage, permissionReason: !a.canManage ? 'no_advertise_task' : null,
    }));
    const sel = q.adAccountId ? MOCK_ACCOUNTS.find((a) => a.id === q.adAccountId) : null;
    const pixels = sel ? sel.pixels.map((p) => ({ id: p.id, name: p.name, adAccountId: sel.id, lastFiredAt: new Date(this.now().getTime() - p.lastFiredDaysAgo * DAY).toISOString() })) : [];
    return { adAccounts, pages: [{ ...MOCK_PAGE }], pixels };
  }
  async readAdAccount(auth: MetaAuth, adAccountId: string): Promise<MetaAdAccountInfo> {
    this.assertToken(auth);
    const { pixels: _p, ...info } = this.findAccount(adAccountId);
    this.accountOf.set(auth.accessToken, adAccountId);
    return info;
  }
  async health(auth: MetaAuth, i: MetaHealthInput): Promise<MetaHealthResult> {
    const token = await this.inspectToken(auth);
    if (!token.isValid) throw new MetaError('META_TOKEN_INVALID', 'mock: token is not "mock"');
    const acc = i.adAccountId ? MOCK_ACCOUNTS.find((a) => a.id === i.adAccountId) ?? null : null;
    const pixel = acc && i.pixelId ? acc.pixels.find((p) => p.id === i.pixelId) ?? null : null;
    const now = this.now();
    const health = buildHealth({
      token: { isValid: true, expiresAt: i.tokenExpiresAt ?? token.expiresAt, scopes: i.scopes.length ? i.scopes : token.scopes },
      account: { selected: !!i.adAccountId, accountStatus: acc?.accountStatus ?? null, hasFunding: acc ? acc.hasFunding : null, minimumDailyBudgetMinor: acc?.minimumDailyBudgetMinor ?? null, readFailed: !!i.adAccountId && !acc },
      page: { selected: !!i.pageId, reachable: i.pageId ? i.pageId === MOCK_PAGE.id : null },
      pixel: { selected: !!i.pixelId, lastFiredAt: pixel ? new Date(now.getTime() - pixel.lastFiredDaysAgo * DAY).toISOString() : null, readFailed: !!i.pixelId && !pixel },
      business: { present: !!acc?.business, verificationStatus: 'not_verified' },
      counts: i.counts, now,
    });
    const { pixels: _p, ...account } = acc ?? ({} as MockAccount);
    return { health, account: acc ? (account as MetaAdAccountInfo) : null, token };
  }

  rule(): MetaWinnerRule {
    return this.opts.rule;
  }
  async syncAds(auth: MetaAuth, i: MetaSyncInput, onProgress?: (p: { stage: MetaSyncStage; done: number; total: number }) => void): Promise<MetaSyncResult> {
    this.assertToken(auth);
    this.findAccount(i.adAccountId);
    const now = i.now ?? this.now();
    const resultType = resultTypeFor(i.businessType, i.hasPixel, i.resultType);
    const st = this.scope(auth, i.adAccountId);
    const raw = mockAds(this.opts.publicApiUrl, { resultType, now, state: st });
    const { campaigns, adsets } = mockStructure(raw, { resultType, now, state: st });
    const total = raw.length;
    onProgress?.({ stage: 'listing_campaigns', done: 0, total: campaigns.length });
    onProgress?.({ stage: 'listing_adsets', done: 0, total: adsets.length });
    onProgress?.({ stage: 'listing_ads', done: 0, total });
    await this.step();
    onProgress?.({ stage: 'reading_insights', done: Math.floor(total / 2), total });
    await this.step();
    onProgress?.({ stage: 'reading_insights', done: total, total });
    await this.step();
    // D2: todos os formatos; mediana só dos vídeos (os 8 de sempre → mesmos WINNER de antes)
    const { ads, medianCpa } = scoreAllAds(raw, this.opts.rule, i.currency);
    onProgress?.({ stage: 'scoring', done: total, total });
    await this.step();
    return { ads, medianCpa, rule: { minSpendUsd: this.opts.rule.minSpendUsd, minResults: this.opts.rule.minResults }, listed: total, syncedAt: now.toISOString(), campaigns, adsets, truncated: false };
  }
  async videoSource(auth: MetaAuth, videoId: string) {
    this.assertToken(auth);
    if (videoId === 'mock_video_novideo') throw new MetaError('META_VIDEO_UNAVAILABLE', 'mock: video has no source');
    const seed = seedOf('meta-video', videoId);
    return { sourceUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'video', seed, format: 'VERTICAL_9_16', sec: 20 }), permalinkUrl: null, lengthSec: 20 };
  }

  // ---------- publicação ----------
  private publishTrigger(i: MetaPublishInput, stage: string) {
    const t = i.settings.primaryText;
    if (stage === 'creating_campaign') {
      if (trigger(t, 'meta-payment')) throw new MetaError('META_PAYMENT_REQUIRED', null, { stage, failDetail: 'mock' });
      if (trigger(t, 'meta-token')) throw new MetaError('META_TOKEN_INVALID', null, { stage, failDetail: 'mock' });
      if (trigger(t, 'meta-rate')) throw new MetaError('META_RATE_LIMITED', null, { stage, failDetail: 'mock', retryAfterSec: 60, details: { reason: 'rate_limited', retryAfterSec: 60 } });
      if (trigger(t, 'meta-error')) throw new MetaError('META_ERROR', null, { stage, failDetail: 'mock' });
    }
    if (stage === 'creating_creative' && trigger(t, 'meta-policy')) throw new MetaError('META_POLICY', 'Your ad text does not comply with our Advertising Policies (mock).', { stage, failDetail: 'mock 1815xxx' });
  }
  private assertUsable(i: MetaPublishInput) {
    const a = this.findAccount(i.adAccountId);
    if (a.accountStatus !== 1 && a.accountStatus !== 7) throw new MetaError('META_ACCOUNT_UNUSABLE', null, { details: { accountStatus: a.accountStatus, label: a.accountStatusLabel } });
    if (!a.canManage) throw new MetaError('META_PERMISSION', null, { details: { adAccountId: a.id, reason: 'no_advertise_task' } });
    return a;
  }
  async uploadVideo(auth: MetaAuth, i: MetaPublishInput) {
    this.assertToken(auth);
    this.assertUsable(i);
    if (!i.video.fileUrl && !(i.video.read && i.video.sizeBytes)) throw new MetaError('META_VIDEO_REJECTED', 'mock: no fileUrl nor read()', { stage: 'uploading_video' });
    await this.step();
    return { videoId: `mock_video_${seedOf('pub', i.adName, i.video.fileUrl ?? String(i.video.sizeBytes)).slice(0, 8)}` };
  }
  async waitVideoReady(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds, opts: { timeoutMs?: number; onPoll?: (status: string) => void } = {}) {
    this.assertToken(auth);
    if (!ids.videoId) throw new MetaError('META_ERROR', 'mock: waitVideoReady without videoId', { stage: 'processing_video' });
    const slow = trigger(i.settings.headline, 'meta-slow');
    const polls = slow ? 10 : 1;
    for (let n = 0; n < polls; n++) {
      opts.onPoll?.('processing');
      await this.step(slow ? 6 : 1);
    }
    opts.onPoll?.('ready');
  }
  async createCampaign(auth: MetaAuth, i: MetaPublishInput) {
    this.assertToken(auth);
    this.assertUsable(i);
    this.publishTrigger(i, 'creating_campaign');
    await this.step();
    const pub = this.scope(auth, i.adAccountId).published.campaigns;
    const st = i.structure;
    // com template: nome do padrão + contador (dois lotes com o mesmo nome são campanhas diferentes, como na Meta)
    const campaignId = st ? `mock_campaign_${seedOf('camp', st.campaignName, String(pub.size)).slice(0, 8)}` : `mock_campaign_${seedOf('camp', i.adName).slice(0, 8)}`;
    this.sent.campaigns.push({ id: campaignId, ...campaignBody(i) });
    const v = v2Of(i);
    const cbo = st?.budgetMode === 'CBO';
    if (!pub.has(campaignId)) pub.set(campaignId, { id: campaignId, name: st?.campaignName ?? i.adName, objective: i.settings.objective, createdAt: this.now().toISOString(), daily: cbo && v.budgetType === 'DAILY' ? i.settings.dailyBudgetMinor : null, lifetime: cbo && v.budgetType === 'LIFETIME' ? v.lifetimeBudgetMinor : null });
    return { campaignId };
  }
  async createAdSet(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds) {
    this.assertToken(auth);
    const a = this.assertUsable(i);
    if (!ids.campaignId) throw new MetaError('META_ERROR', 'mock: createAdSet without campaignId', { stage: 'creating_adset' });
    const v = v2Of(i);
    const now = this.now();
    // v2 §2.2: com LIFETIME o mínimo é o total (diário × dias); DAILY igual v1. CBO + LIFETIME: o total mora na campanha
    if (v.budgetType === 'LIFETIME') {
      const days = lifetimeDays(v, now);
      if (days != null && (v.lifetimeBudgetMinor ?? 0) < MOCK_MIN_DAILY_BUDGET_MINOR * days)
        throw new MetaError('META_BUDGET_TOO_LOW', null, { stage: 'creating_adset', details: budgetTooLowDetails(i, MOCK_MIN_DAILY_BUDGET_MINOR, a.currency, now) });
    } else if (i.settings.dailyBudgetMinor < MOCK_MIN_DAILY_BUDGET_MINOR) {
      throw new MetaError('META_BUDGET_TOO_LOW', null, { stage: 'creating_adset', details: { minimumMinor: MOCK_MIN_DAILY_BUDGET_MINOR, currency: a.currency } });
    }
    // v2 §9: simula o beta do ON_VIDEO/ON_POST recusado pela conta
    if (trigger(i.settings.primaryText, 'meta-destination')) throw new MetaError('META_ERROR', 'destination_type not available for this account (mock)', { stage: 'creating_adset', failDetail: 'mock 100/2490408' });
    await this.step();
    const pub = this.scope(auth, i.adAccountId).published.adsets;
    const st = i.structure;
    const adsetId = st ? `mock_adset_${seedOf('adset', st.adsetName, ids.campaignId, String(pub.size)).slice(0, 8)}` : `mock_adset_${seedOf('adset', i.adName).slice(0, 8)}`;
    const body = adSetBody(i, ids.campaignId, now);
    this.sent.adsets.push({ id: adsetId, ...body });
    const abo = st?.budgetMode !== 'CBO';
    if (!pub.has(adsetId)) pub.set(adsetId, {
      id: adsetId, campaignId: ids.campaignId, name: st?.adsetName ?? i.adName, createdAt: now.toISOString(),
      daily: abo && v.budgetType === 'DAILY' ? i.settings.dailyBudgetMinor : null, lifetime: abo && v.budgetType === 'LIFETIME' ? v.lifetimeBudgetMinor : null,
      optimizationGoal: String(body.optimization_goal), startTime: (body.start_time as string | undefined) ?? null, endTime: (body.end_time as string | undefined) ?? null,
    });
    return { adsetId };
  }
  async createAdCreative(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds) {
    this.assertToken(auth);
    this.assertUsable(i);
    if (!ids.videoId) throw new MetaError('META_ERROR', 'mock: createAdCreative without videoId', { stage: 'creating_creative' });
    this.publishTrigger(i, 'creating_creative');
    await this.step();
    this.sent.creatives.push(creativeBody(i, ids.videoId));
    return { creativeId: `mock_creative_${seedOf('creative', i.adName).slice(0, 8)}` };
  }
  async createAd(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds) {
    this.assertToken(auth);
    this.assertUsable(i);
    if (!ids.adsetId || !ids.creativeId) throw new MetaError('META_ERROR', 'mock: createAd without adsetId/creativeId', { stage: 'creating_ad' });
    await this.step();
    const adId = `mock_ad_${seedOf('ad', i.adName).slice(0, 8)}`;
    const pub = this.scope(auth, i.adAccountId).published.ads;
    if (!pub.has(adId)) pub.set(adId, { id: adId, adsetId: ids.adsetId, name: i.adName, videoId: ids.videoId ?? `mock_video_${adId.slice(-8)}`, createdAt: this.now().toISOString() });
    return { adId, previewUrl: null };
  }
  async setStatus(auth: MetaAuth, i: { objectIds: string[]; status: 'ACTIVE' | 'PAUSED' }) {
    this.assertToken(auth);
    if (!i.objectIds.length) throw new MetaError('META_ERROR', 'mock: setStatus without ids');
    const st = this.scope(auth);
    for (const id of i.objectIds) {
      const o = mockObject(id, st);
      if (!o) continue; // id que este escopo não conhece (publicação de antes de reiniciar a API): só aceita, como antes
      this.writeTriggers(o.name);
      if (i.status === 'ACTIVE' && o.level === 'ad' && catalogOf(st).seeds.find((s) => s.id === id)?.status === 'DISAPPROVED')
        throw new MetaError('META_POLICY', 'This ad was disapproved (mock). Edit it in Ads Manager.', { failDetail: 'mock 1815xxx' });
    }
    await this.step();
    for (const id of i.objectIds) if (mockObject(id, st)) st.status.set(id, i.status);
  }
  adsManagerUrl(_adAccountId: string, _adId: string): string {
    return '#';
  }

  // ---------- campanhas-v1 §4/§6 ----------
  /** `[mock:meta-rate]` / `[mock:meta-token]` no nome do objeto (§6). */
  private writeTriggers(name: string) {
    if (trigger(name, 'meta-rate')) throw new MetaError('META_UNAVAILABLE', null, { failDetail: 'mock 17', retryAfterSec: 60, action: 'retry', details: { reason: 'rate_limited', retryAfterSec: 60 } });
    if (trigger(name, 'meta-token')) throw new MetaError('META_TOKEN_INVALID', null, { failDetail: 'mock 190' });
  }
  async readObject(auth: MetaAuth, i: { level: MetaObjectLevelPort; id: string }): Promise<MetaLiveObject> {
    this.assertToken(auth);
    const st = this.scope(auth);
    const o = mockObject(i.id, st);
    if (!o || o.level !== i.level) throw new MetaError('META_OBJECT_GONE', null, { details: { level: i.level, id: i.id }, action: 'refresh', failDetail: 'mock 100/33' });
    this.writeTriggers(o.name);
    const live = this.liveOf(st, i.level, i.id);
    // [mock:stale]: "alguém mexeu no Ads Manager": status invertido e orçamento diferente do snapshot → o backend responde META_OBJECT_CHANGED
    if (trigger(o.name, 'stale')) return { ...live, status: live.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE', dailyBudgetMinor: live.dailyBudgetMinor != null ? live.dailyBudgetMinor + 700 : null };
    return live;
  }
  private liveOf(st: MockWriteState, level: MetaObjectLevelPort, id: string): MetaLiveObject {
    const cat = catalogOf(st);
    const campaignRef = (cid: string) => {
      const c = cat.campaigns.find((x) => x.id === cid)!;
      return { id: c.id, name: c.name, status: st.status.get(c.id) ?? c.status, dailyBudgetMinor: c.daily != null ? st.daily.get(c.id) ?? c.daily : null, lifetimeBudgetMinor: c.lifetime };
    };
    const adsetRef = (aid: string) => {
      const a = cat.adsets.find((x) => x.id === aid)!;
      return { id: a.id, name: a.name, status: st.status.get(a.id) ?? a.status, dailyBudgetMinor: a.daily != null ? st.daily.get(a.id) ?? a.daily : null, lifetimeBudgetMinor: a.lifetime ?? null };
    };
    if (level === 'campaign') {
      const c = campaignRef(id);
      return { level, id, name: c.name, status: c.status, effectiveStatus: effectiveOf(st, cat, 'campaign', id), dailyBudgetMinor: c.dailyBudgetMinor, lifetimeBudgetMinor: c.lifetimeBudgetMinor, campaign: null, adset: null };
    }
    if (level === 'adset') {
      const a = adsetRef(id);
      return { level, id, name: a.name, status: a.status, effectiveStatus: effectiveOf(st, cat, 'adset', id), dailyBudgetMinor: a.dailyBudgetMinor, lifetimeBudgetMinor: a.lifetimeBudgetMinor, campaign: campaignRef(cat.adsets.find((x) => x.id === id)!.campaignId), adset: null };
    }
    const s = cat.seeds.find((x) => x.id === id)!;
    const as = adsetRef(s.adset);
    return { level, id, name: s.name, status: st.status.get(id) ?? seedStatus(s), effectiveStatus: effectiveOf(st, cat, 'ad', id), dailyBudgetMinor: null, lifetimeBudgetMinor: null, campaign: campaignRef(cat.adsets.find((x) => x.id === s.adset)!.campaignId), adset: as };
  }
  async setDailyBudget(auth: MetaAuth, i: { level: 'campaign' | 'adset'; id: string; dailyBudgetMinor: number }): Promise<void> {
    this.assertToken(auth);
    const st = this.scope(auth);
    const o = mockObject(i.id, st);
    if (!o || o.level !== i.level) throw new MetaError('META_OBJECT_GONE', null, { details: { level: i.level, id: i.id }, action: 'refresh', failDetail: 'mock 100/33' });
    this.writeTriggers(o.name);
    const live = this.liveOf(st, i.level, i.id);
    // orçamento mora no outro nível (conjunto de CBO, campanha ABO) ou é vitalício (§6)
    if (live.dailyBudgetMinor == null) {
      const cbo = i.level === 'adset' && live.campaign && (live.campaign.dailyBudgetMinor != null || live.campaign.lifetimeBudgetMinor != null);
      throw new MetaError('META_BUDGET_NOT_EDITABLE', null, { failDetail: 'mock', details: { budgetLevel: cbo ? 'campaign' : i.level === 'campaign' ? (live.lifetimeBudgetMinor != null ? 'campaign' : 'adset') : null, kind: live.lifetimeBudgetMinor != null || live.campaign?.lifetimeBudgetMinor != null ? 'lifetime' : cbo ? 'daily' : null } });
    }
    if (i.dailyBudgetMinor < MOCK_MIN_DAILY_BUDGET_MINOR) throw new MetaError('META_BUDGET_TOO_LOW', null, { details: { minimumMinor: MOCK_MIN_DAILY_BUDGET_MINOR, currency: 'USD' } });
    await this.step();
    st.daily.set(i.id, i.dailyBudgetMinor);
  }
  objectUrl(adAccountId: string, level: MetaObjectLevelPort, id: string): string {
    return mockObject(id) || id.startsWith('mock_') ? '#' : liveObjectUrl(adAccountId, level, id);
  }
  usage(): MetaUsage | null {
    return null;
  }

  // ---------- meta-templates-v2 §4/§9 ----------
  /** act_mock_2 = [] + unavailable (a Meta negou a Página); sem Página = só as da conta (no_page); o resto = as 2 (ok). */
  async listInstagramAccounts(auth: MetaAuth, i: { adAccountId: string; pageId: string | null }): Promise<MetaInstagramAccountsResponse> {
    this.assertToken(auth);
    this.findAccount(i.adAccountId);
    await this.step();
    if (i.adAccountId === 'act_mock_2') return { accounts: [], pageLookup: 'unavailable' };
    const account = MOCK_IG_ACCOUNTS.filter((a) => a.source === 'AD_ACCOUNT').map((a) => ({ ...a }));
    if (!i.pageId) return { accounts: mergeIgAccounts([], account), pageLookup: 'no_page' };
    return { accounts: mergeIgAccounts(MOCK_IG_ACCOUNTS.filter((a) => a.source === 'PAGE').map((a) => ({ ...a })), account), pageLookup: 'ok' };
  }
  async listCustomAudiences(auth: MetaAuth, i: { adAccountId: string }): Promise<MetaCustomAudiencesResponse> {
    this.assertToken(auth);
    this.findAccount(i.adAccountId);
    await this.step();
    return { audiences: MOCK_CUSTOM_AUDIENCES.map((a) => ({ ...a })), truncated: false };
  }
  async listLocales(auth: MetaAuth): Promise<MetaLocalesResponse> {
    this.assertToken(auth);
    await this.step();
    return { locales: MOCK_LOCALES.map((l) => ({ ...l })) };
  }

  // ---------- meta-templates-v1 §3 ----------
  /** Estrutura fixa do §6 (+ publicados no escopo). `mock_adset_cbo_1` tem público personalizado, exclusão e data de fim
   *  (vão pro `unsupported`); conjuntos de campanha OUTCOME_SALES otimizam pelo pix_mock/PURCHASE. */
  async readTemplateSource(auth: MetaAuth, i: { level: MetaObjectLevelPort; id: string; hint?: { adsetId?: string | null; adId?: string | null } }): Promise<MetaTemplateSourceRead> {
    this.assertToken(auth);
    const st = this.scope(auth);
    const o = mockObject(i.id, st, true);
    if (!o || o.level !== i.level) throw new MetaError('META_OBJECT_GONE', null, { details: { level: i.level, id: i.id }, action: 'refresh', failDetail: 'mock 100/33' });
    this.writeTriggers(o.name);
    await this.step();
    const cat = catalogOf(st, true);
    const active = (s: { status: string }) => s.status === 'ACTIVE';
    let adSeed = i.level === 'ad' ? cat.seeds.find((x) => x.id === i.id)! : null;
    let adset = i.level === 'adset' ? cat.adsets.find((x) => x.id === i.id)! : adSeed ? cat.adsets.find((x) => x.id === adSeed!.adset)! : null;
    const campaign = cat.campaigns.find((x) => x.id === (i.level === 'campaign' ? i.id : adset!.campaignId))!;
    if (!adset) {
      const kids = cat.adsets.filter((x) => x.campaignId === campaign.id);
      adset = (i.hint?.adsetId && kids.find((x) => x.id === i.hint!.adsetId)) || kids.find(active) || kids[0] || null;
    }
    if (!adSeed && adset) {
      const kids = cat.seeds.filter((x) => x.adset === adset!.id);
      adSeed = (i.hint?.adId && kids.find((x) => x.id === i.hint!.adId)) || kids.find(active) || kids[0] || null;
    }
    const sales = campaign.objective === 'OUTCOME_SALES';
    const awareness = campaign.objective === 'OUTCOME_AWARENESS';
    const custom = adset?.id === 'mock_adset_cbo_1';
    const now = this.now().getTime();
    // v2 §9: mock_adset_cbo_1 tem público (incluir + excluir, ids da lista), idioma e agendamento (início + fim → AFTER_DAYS),
    // que agora COPIAM; e ganha 1 interesse (flexible_spec) e 1 cidade pra o `unsupported` continuar exercitado
    const sched = adset ? adsetSchedule(adset, this.now()) : { startTime: null, endTime: null };
    const startTime = custom ? graphAt(now - 3 * DAY_MS) : sched.startTime;
    const endTime = custom ? graphAt(now + 4 * DAY_MS) : sched.endTime;
    const goal = adset?.optimizationGoal ?? (sales ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS');
    return {
      campaign: {
        id: campaign.id, name: campaign.name, objective: campaign.objective, bidStrategy: campaign.bidStrategy,
        dailyBudgetMinor: campaign.daily, lifetimeBudgetMinor: campaign.lifetime, specialAdCategories: [], startTime: null, stopTime: null,
        buyingType: 'AUCTION',
      },
      adset: adset ? {
        id: adset.id, name: adset.name, bidStrategy: adset.daily != null || adset.lifetime != null ? 'LOWEST_COST_WITHOUT_CAP' : null, bidAmountMinor: null,
        dailyBudgetMinor: adset.daily, lifetimeBudgetMinor: adset.lifetime ?? null, optimizationGoal: goal,
        // Awareness: promoted_object { page_id } (o live lê como objeto sem pixel)
        promotedObject: sales ? { pixelId: 'pix_mock', customEventType: 'PURCHASE', applicationId: null } : awareness ? { pixelId: null, customEventType: null, applicationId: null } : null,
        targeting: {
          geo_locations: { countries: ['US', 'CA'], ...(custom ? { cities: [{ key: '2420379', name: 'Los Angeles', region: 'California', country: 'US' }] } : {}) },
          age_min: 25, age_max: 54, genders: custom ? [2] : undefined,
          targeting_automation: { advantage_audience: custom ? 0 : 1 },
          ...(custom ? {
            custom_audiences: [{ id: 'ca_mock_lal_1', name: 'Lookalike (US, 1%) - Website buyers 180d' }],
            excluded_custom_audiences: [{ id: 'ca_mock_buyers', name: 'Website buyers 180d' }],
            locales: [6],
            flexible_spec: [{ interests: [{ id: '6003107902433', name: 'Sleep' }] }],
            publisher_platforms: ['facebook', 'instagram'], facebook_positions: ['feed'], instagram_positions: ['stream', 'story'],
          } : {}),
        },
        startTime, endTime,
        destinationType: awareness ? null : 'WEBSITE',
      } : null,
      ad: adSeed ? {
        id: adSeed.id, name: adSeed.name,
        creative: {
          message: `${adSeed.name}: sleep cooler tonight.`, title: 'Bamboo sheets', description: null, callToAction: sales ? 'SHOP_NOW' : 'LEARN_MORE', link: 'https://example.com/sheets', urlTags: 'utm_source=facebook&utm_medium=paid',
          instagramUserId: awareness ? 'ig_mock_1' : null, format: 'VIDEO',
        },
      } : null,
    };
  }
}
