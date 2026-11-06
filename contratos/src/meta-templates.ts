// meta-templates-v1 (docs/contratos/meta-templates-v1.md, aprovado pelo Gusta em 29/10 com as recomendações):
// P1 = REUSE_CAMPAIGN de fábrica; P2 = orçamento pedido no 1º template, sem padrão escondido; P3 = publish-batch na v1.
// meta-templates-v2 (docs/contratos/meta-templates-v2.md, 02/11): campos novos OPCIONAIS e retrocompatíveis (template v1 salvo
// continua válido e publica igual). Ausente = comportamento v1. Objetivos novos já estão no `MetaObjective` (A0, 03/11).
import type {
  MetaBudgetType, MetaCallToAction, MetaObjective, MetaObjectiveV2Extra, MetaPixelEvent, MetaPublication, MetaSpecialAdCategory,
  MetaTemplateOptimizationGoal,
} from './meta';

export type MetaTemplateDestination = 'NEW_CAMPAIGN' | 'REUSE_CAMPAIGN';
export type MetaBudgetMode = 'CBO' | 'ABO';
export type MetaBidStrategy = 'LOWEST_COST' | 'COST_CAP' | 'BID_CAP';

/** v2 §2.1: desde o A0 (03/11) é igual a `MetaObjective` (6 valores); mantido como alias. */
export type MetaTemplateObjective = MetaObjective | MetaObjectiveV2Extra;
/** v2 §2.3: data/hora LOCAL no fuso da conta (`MetaConnection.adAccount.timezoneName`), sem offset: `YYYY-MM-DDTHH:mm`. */
export type MetaLocalDateTime = string;
/** v2 §2.3: fim fixo (`AT`) ou relativo ao início (`AFTER_DAYS`, 1–365) — o relativo é o que serve a template reaproveitado. */
export type MetaScheduleEnd = { kind: 'AT'; at: MetaLocalDateTime } | { kind: 'AFTER_DAYS'; days: number };
export interface MetaTemplateSchedule {
  /** null = começa ao publicar */
  start: MetaLocalDateTime | null;
  /** null = sem fim (proibido com LIFETIME) */
  end: MetaScheduleEnd | null;
}
/** v2 §2.4: chave de idioma da Meta (`targeting.locales`) + nome só pra exibir. */
export interface MetaLocaleRef { key: number; name: string }
/** v2 §2.6: público personalizado da conta; o nome é só pra exibir (a Graph recebe o id). */
export interface MetaAudienceRef { id: string; name: string }
/** v2 §2.5: conta do Instagram do anúncio (`instagram_user_id`); username só pra exibir. */
export interface MetaInstagramAccountRef { id: string; username: string }

export interface MetaTemplateCampaign {
  destination: MetaTemplateDestination;
  /** v2: inclui OUTCOME_AWARENESS / OUTCOME_ENGAGEMENT (A0, 03/11) */
  objective: MetaObjective;
  budgetMode: MetaBudgetMode;
  /** centavos na moeda da conta: CBO = da campanha; ABO = de cada ad set. v2: com budgetType LIFETIME vai 0 */
  dailyBudgetMinor: number;
  /** v2 §2.2: ausente = DAILY. LIFETIME exige `adset.schedule.end` e, com CBO, destination NEW_CAMPAIGN */
  budgetType?: MetaBudgetType;
  /** v2 §2.2: LIFETIME = total em centavos (CBO: da campanha; ABO: de cada ad set); DAILY = ausente ou null */
  lifetimeBudgetMinor?: number | null;
  bidStrategy: MetaBidStrategy;
  /** COST_CAP / BID_CAP: obrigatório */
  bidAmountMinor: number | null;
  specialAdCategories: MetaSpecialAdCategory[];
  /** variáveis {offer} {code} {date} {n}; ≤ 120 */
  namePattern: string;
}
export interface MetaTemplateAdset {
  /** com pixel: o evento; sem: tráfego (LINK_CLICKS) */
  pixelId: string | null;
  pixelEvent: MetaPixelEvent | null;
  countries: string[];
  ageMin: number; ageMax: number;
  genders: 'ALL' | 'MALE' | 'FEMALE';
  advantageAudience: boolean;
  /** AUTO = Advantage+ placements; senão as plataformas/posições do Gerenciador */
  placements: 'AUTO' | { platforms: ('facebook' | 'instagram' | 'audience_network' | 'messenger')[]; positions: string[] };
  /** padrão 4–8 (Tordan); 1 ≤ min ≤ max ≤ 50 */
  adsPerAdset: { min: number; max: number };
  namePattern: string;
  // ── v2 (todos opcionais; ausente = v1) ──
  /** §2.1: só AWARENESS/ENGAGEMENT (null = padrão: REACH / THRUPLAY); nos outros objetivos ausente ou null */
  optimizationGoal?: MetaTemplateOptimizationGoal | null;
  /** §2.3: ausente ou null = começa ao publicar e não termina */
  schedule?: MetaTemplateSchedule | null;
  /** §2.4: 0–50; vazio = todos os idiomas */
  locales?: MetaLocaleRef[];
  /** §2.6: 0–20 cada; o mesmo id não pode estar nas duas */
  customAudiences?: MetaAudienceRef[];
  excludedCustomAudiences?: MetaAudienceRef[];
}
export interface MetaTemplateAd {
  /** null = herda do criativo/oferta como hoje */
  primaryText: string | null; headline: string | null; description: string | null;
  callToAction: MetaCallToAction;
  link: string;
  /** query string sem "?" (UTM) */
  urlTags: string | null;
  namePattern: string;
  /** v2 §2.5: ausente ou null = a Página como identidade no Instagram (v1) */
  instagramAccount?: MetaInstagramAccountRef | null;
}
export interface MetaTemplateImportedFrom { level: 'campaign' | 'adset' | 'ad'; id: string; name: string }

export interface MetaPublishTemplate {
  id: string; adAccountId: string; name: string; isDefault: boolean;
  source: 'MANUAL' | 'IMPORTED'; importedFrom: MetaTemplateImportedFrom | null;
  campaign: MetaTemplateCampaign; adset: MetaTemplateAdset; ad: MetaTemplateAd;
  /** REUSE_CAMPAIGN: a campanha já criada pelo HookMill (null antes da 1ª publicação) */
  reuseCampaignId: string | null;
  createdAt: string; updatedAt: string;
}
export interface MetaTemplateBody {
  name: string; isDefault?: boolean;
  campaign: MetaTemplateCampaign; adset: MetaTemplateAdset; ad: MetaTemplateAd;
  importedFrom?: MetaTemplateImportedFrom | null;
}
export type UpdateMetaTemplateBody = Partial<MetaTemplateBody>;

/** POST /meta/templates/import: NÃO salva; devolve o corpo pra revisar + o que não deu pra copiar. */
export interface MetaTemplateImportBody { level: 'campaign' | 'adset' | 'ad'; id: string }
export interface MetaTemplateImportResult {
  template: MetaTemplateBody; unsupported: { field: string; value: string }[];
  /** v2 §7: copiado com ajuste (ex.: agendamento fixo virou "N dias a partir da publicação"). A faixa mostra "Adjusted: …" */
  adjusted?: { field: string; value: string }[];
}

/**
 * meta-templates-v2 §14 (04/11): ajustes do envio, revisados no editor completo. Vale SÓ pra esse envio (o template fica
 * intacto). Cada nível é opcional; o nível que vem é INTEIRO (mesmo formato e mesma validação do `MetaTemplateBody`) e
 * substitui o nível do template. Erros em `fields` com `campaign.*`, `adset.*`, `ad.*`.
 */
export interface MetaTemplateOverride { campaign?: MetaTemplateCampaign; adset?: MetaTemplateAdset; ad?: MetaTemplateAd }

/** Publicar com template (alternativa ao MetaPublishBody). §14: `override` opcional. */
export interface MetaPublishWithTemplateBody { templateId: string; override?: MetaTemplateOverride }

/** POST /meta/publish-batch. §14: `override` opcional (o mesmo pra todo o lote). */
export interface MetaPublishBatchBody { creativeIds: string[]; templateId: string; override?: MetaTemplateOverride }
export interface MetaPublishBatchPlan { adsets: { name: string; creativeIds: string[]; belowMin: boolean }[] }
export interface MetaPublishBatchResponse { publications: MetaPublication[]; plan: MetaPublishBatchPlan }

// ───────────────────────── v2 §4: listas da conta pro editor ─────────────────────────
/** GET /meta/instagram-accounts */
export interface MetaInstagramAccount {
  id: string; username: string; profilePicUrl: string | null;
  /** AD_ACCOUNT = act_x/instagram_accounts; PAGE = ligado à Página da conexão ({page}/instagram_accounts) */
  source: 'AD_ACCOUNT' | 'PAGE';
}
export interface MetaInstagramAccountsResponse {
  accounts: MetaInstagramAccount[];
  /** ok = leu os da Página também; unavailable = a Meta negou ler a Página (lista só os da conta); no_page = conexão sem Página */
  pageLookup: 'ok' | 'unavailable' | 'no_page';
}
/** GET /meta/custom-audiences */
export interface MetaCustomAudienceOption {
  id: string; name: string;
  /** subtype da Graph (CUSTOM, WEBSITE, LOOKALIKE, ENGAGEMENT, IG_BUSINESS…) */
  subtype: string;
  /** approximate_count_lower_bound/upper_bound; null quando a Meta devolve -1 ou nada */
  sizeLower: number | null; sizeUpper: number | null;
  /** delivery_status.code < 300 e operation_status.code ≠ 471 */
  usable: boolean;
  /** delivery_status/operation_status.description quando !usable */
  unusableReason: string | null;
  /** time_updated em ISO; null sem dado */
  updatedAt: string | null;
}
export interface MetaCustomAudiencesResponse {
  /** mais recentes primeiro; até 500 */
  audiences: MetaCustomAudienceOption[];
  /** a conta tem mais de 500 */
  truncated: boolean;
}
/** GET /meta/locales (lista inteira da Graph `search?type=adlocale`, cache de 24 h; o web filtra local) */
export interface MetaLocaleOption { key: number; name: string }
export interface MetaLocalesResponse { locales: MetaLocaleOption[] }
