// Campaigns v1 (docs/contratos/campanhas-v1.md, APROVADO pelo Gusta em 22/10, D1-D12). Dono: maquina-arquiteto. SÓ TIPOS.
// Exportado no index.ts. Aditivos em tipos existentes (MetaMetrics.reach, MetaAdRow.*, MetaAdsQuery.*, Action 'refresh',
// ErrorCode) estão aplicados em meta.ts/index.ts como OPCIONAIS até a B4 entregar; o backend devolve sempre.
import type { PageMeta, UserRef } from './index';
import type { MetaAdRow, MetaMetrics, MetaPeriod, MetaSyncState } from './meta';

// ───────────────────────── enums ─────────────────────────
export type MetaLevel = 'campaign' | 'adset' | 'ad';
/** active = effective_status ACTIVE · paused = PAUSED/CAMPAIGN_PAUSED/ADSET_PAUSED · issues = DISAPPROVED/WITH_ISSUES/PENDING_REVIEW/IN_PROCESS */
export type MetaStatusFilter = 'active' | 'paused' | 'issues' | 'all';
export type MetaOrigin = 'all' | 'hookmill';
export type MetaAdFormat = 'video' | 'all';
export type MetaSort = 'spend' | 'cpa' | 'results' | 'ctr' | 'hookRate' | 'budget' | 'name';
export type MetaToggleStatus = 'ACTIVE' | 'PAUSED';
export type MetaLearningStage = 'LEARNING' | 'SUCCESS' | 'FAIL';
export type MetaChangeField = 'STATUS' | 'DAILY_BUDGET';
/** APPLIED = a Meta aceitou · FAILED = a Meta recusou ou falhou (houve chamada) · BLOCKED = trava do HookMill recusou ANTES
 *  de escrever, sem escrita na Meta (§11, 23/10; hoje só META_POLICY). O History mostra BLOCKED como "Failed" (design §2.12). */
export type MetaChangeResult = 'APPLIED' | 'FAILED' | 'BLOCKED';
export type MetaChangeSource = 'CAMPAIGNS' | 'PUBLISH';

// ───────────────────────── §3 linhas ─────────────────────────
export interface MetaBudget {
  /** onde o orçamento mora (CBO = campaign; ABO = adset); null só em campanha ABO (sem orçamento próprio) */
  level: 'campaign' | 'adset' | null;
  kind: 'daily' | 'lifetime' | null;
  /** centavos da moeda da conta */
  amountMinor: number | null; remainingMinor: number | null; currency: string;
  /** daily + mora neste objeto + OWNER/ADMIN + conta usável */
  editable: boolean;
  /** minimum_budgets da conta (centavos) */
  minimumMinor: number | null;
}
export interface MetaObjectBase {
  id: string; name: string;
  /** configurado (o toggle) */
  status: MetaToggleStatus;
  /** por que entrega ou não (ex.: ADSET_PAUSED, DISAPPROVED) */
  effectiveStatus: string;
  /** 30 d / 7 d / 7 d anteriores; em campanha e conjunto vêm com `reach` e `frequency` */
  metrics: MetaMetrics; metrics7d: MetaMetrics; metricsPrev7d: MetaMetrics;
  /** campanha/conjunto: criado por um MetaPublication; anúncio: MetaAdRow.creative != null */
  fromHookMill: boolean;
  /** link do Ads Manager no nível certo (campanhas-v1 §5.4) */
  adsManagerUrl: string;
  /** OWNER/ADMIN, conta usável, objeto não DISAPPROVED/DELETED */
  canToggle: boolean;
}
export interface MetaCampaignRow extends MetaObjectBase {
  objective: string; buyingType: string | null; bidStrategy: string | null;
  /** orçamento na campanha (Advantage campaign budget) */
  isCbo: boolean;
  budget: MetaBudget;
  counts: { adsets: number; ads: number; activeAds: number; winners: number; tiring: number };
  startTime: string | null; stopTime: string | null;
  // §10 (22/10, pedidos do design): opcionais no pacote até a B4b entregar; o backend devolve sempre
  /** algum conjunto desta campanha com learningStage = LEARNING (aviso de aprendizado no orçamento CBO sem expandir) */
  anyAdsetLearning: boolean;
  /** só com `q`: em que níveis abaixo da campanha algo bateu (o web abre a campanha sozinho). [] = só o nome da campanha bateu; ausente sem `q` */
  matchedIn?: ('adset' | 'ad')[];
}
export interface MetaAdsetRow extends MetaObjectBase {
  campaignId: string;
  optimizationGoal: string | null; billingEvent: string | null; bidStrategy: string | null;
  learningStage: MetaLearningStage | null;
  /** em CBO: level 'campaign', editable false (a tela diz "budget set on the campaign") */
  budget: MetaBudget;
  counts: { ads: number; activeAds: number; winners: number };
  startTime: string | null; endTime: string | null;
}
/** Anúncio = MetaAdRow (meta.ts) com os campos de campanhas-v1 preenchidos (status, fromHookMill, adsManagerUrl, canToggle, canIterate). */
export type MetaCampaignAdRow = MetaAdRow & Required<Pick<MetaAdRow, 'status' | 'fromHookMill' | 'adsManagerUrl' | 'canToggle' | 'canIterate'>>;

// ───────────────────────── §4 leitura ─────────────────────────
/** GET /meta/campaigns */
export interface MetaCampaignsQuery {
  period?: MetaPeriod;               // padrão 30d; delta só em 7d (contra metricsPrev7d)
  status?: MetaStatusFilter;         // padrão all
  origin?: MetaOrigin;               // padrão all
  q?: string;                        // nome de campanha, conjunto ou anúncio (o pai aparece quando um filho bate)
  sort?: MetaSort; dir?: 'asc' | 'desc';   // padrão spend desc
  limit?: number; cursor?: string;
}
/** Totais do conjunto FILTRADO inteiro (não da página), no período pedido. Usado na linha Total das duas visões. */
export interface MetaCampaignsTotals {
  spend: number; results: number; resultType: string | null;
  cpa: number | null; ctr: number | null; hookRate: number | null;
  /** §11 (23/10): quantas linhas o filtro tem ao todo (campanhas em GET /meta/campaigns, anúncios em GET /meta/ads).
   *  O backend manda sempre; opcional só pra não quebrar o web antes da F4c. */
  count?: number;
}
export interface MetaCampaignsMeta extends PageMeta {
  period: MetaPeriod; currency: string | null;
  /** do conjunto filtrado, no período */
  totals: MetaCampaignsTotals;
  /** passou de 500 em algum nível: a tela avisa "showing the 500 most recent" */
  truncated: boolean;
  sync: MetaSyncState;
  /** §10: contagem por filtro de status com os OUTROS filtros aplicados (origin, q), no nível da lista (campanhas). Opcional até a B4b */
  counts: MetaStatusCounts;
}
/** §10: chips de status (All · Active · Paused · Issues) com número. all = active + paused + issues */
export interface MetaStatusCounts { all: number; active: number; paused: number; issues: number }
/** GET /meta/campaigns/:campaignId?period */
export interface MetaCampaignDetail {
  campaign: MetaCampaignRow;
  adsets: (MetaAdsetRow & { ads: MetaCampaignAdRow[] })[];
}
export interface MetaCampaignDetailQuery { period?: MetaPeriod }

// ───────────────────────── §4 escrita (OWNER/ADMIN) ─────────────────────────
/** POST /meta/{campaigns|adsets|ads}/:id/status */
export interface MetaStatusBody {
  status: MetaToggleStatus;
  /** o status que a tela mostrava; ≠ do lido ao vivo = 409 META_OBJECT_CHANGED (D8) */
  expected: MetaToggleStatus;
  confirm: true;
  /** ativar com pai pausado: true = ativa os pais junto (D6). Sem = 409 META_PARENT_PAUSED. Ignorado ao pausar */
  includeParents?: boolean;
}
/** PATCH /meta/{campaigns|adsets}/:id/budget */
export interface MetaBudgetBody {
  /** centavos da moeda da conta; ≥ mínimo da conta; ≤ META_BUDGET_MAX_STEP × atual (D7) */
  dailyBudgetMinor: number;
  /** o valor que a tela mostrava; ≠ do lido ao vivo = 409 META_OBJECT_CHANGED */
  expectedDailyBudgetMinor: number;
  confirm: true;
}
export interface MetaObjectRef { level: MetaLevel; id: string; name: string }
export interface MetaChangeRow {
  id: string; level: MetaLevel; objectId: string; objectName: string;
  field: MetaChangeField;
  /** lido ao vivo antes de escrever ("PAUSED" / "2000" em centavos) */
  from: string | null; to: string;
  /** pais ativados junto (includeParents): ids, como gravado */
  alsoChanged: string[];
  /** §10: os mesmos pais com nível e nome, resolvidos no snapshot atual na leitura (sumiu do snapshot = name = id). Opcional até a B4b */
  alsoChangedRefs: MetaObjectRef[];
  result: MetaChangeResult; errorCode: string | null;
  source: MetaChangeSource;
  by: UserRef; at: string;
}
export interface MetaWriteResult {
  level: MetaLevel;
  /** snapshot do objeto já atualizado (status/orçamento); métricas esperam o próximo sync */
  object: MetaCampaignRow | MetaAdsetRow | MetaCampaignAdRow;
  change: MetaChangeRow;
  alsoActivated: MetaObjectRef[];
}
/** GET /meta/changes (gaveta History; todos, inclusive CLIENT) */
export interface MetaChangesQuery { level?: MetaLevel; objectId?: string; limit?: number; cursor?: string }

// ───────────────────────── §4.1 erros novos (síncronos) ─────────────────────────
export type MetaWriteErrorCode =
  | 'META_OBJECT_CHANGED'          // 409: mudou no Ads Manager depois do sync (action refresh)
  | 'META_OBJECT_GONE'             // 404: o objeto não existe mais na Meta (sai do snapshot)
  | 'META_PARENT_PAUSED'           // 409: ativar com pai pausado sem includeParents
  | 'META_BUDGET_NOT_EDITABLE'     // 422: orçamento mora no outro nível, ou é vitalício
  | 'META_BUDGET_STEP_TOO_LARGE';  // 422: aumento acima de META_BUDGET_MAX_STEP × atual
// 422 META_POLICY síncrono (ativar DISAPPROVED/WITH_ISSUES) é código pré-existente: está no ApiErrorCode, não nesta lista de novos
export interface MetaObjectChangedDetails { current: { status: MetaToggleStatus; dailyBudgetMinor: number | null } }
export interface MetaParentPausedDetails { parents: MetaObjectRef[] }
export interface MetaBudgetNotEditableDetails { budgetLevel: 'campaign' | 'adset' | null; kind: 'daily' | 'lifetime' | null }
export interface MetaBudgetStepTooLargeDetails { maxMinor: number; currency: string }
