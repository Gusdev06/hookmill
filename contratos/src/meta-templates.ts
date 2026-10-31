// meta-templates-v1 (docs/contratos/meta-templates-v1.md, aprovado pelo Gusta em 29/10 com as recomendações):
// P1 = REUSE_CAMPAIGN de fábrica; P2 = orçamento pedido no 1º template, sem padrão escondido; P3 = publish-batch na v1.
import type { MetaCallToAction, MetaObjective, MetaPixelEvent, MetaPublication, MetaSpecialAdCategory } from './meta';

export type MetaTemplateDestination = 'NEW_CAMPAIGN' | 'REUSE_CAMPAIGN';
export type MetaBudgetMode = 'CBO' | 'ABO';
export type MetaBidStrategy = 'LOWEST_COST' | 'COST_CAP' | 'BID_CAP';

export interface MetaTemplateCampaign {
  destination: MetaTemplateDestination;
  objective: MetaObjective;
  budgetMode: MetaBudgetMode;
  /** centavos na moeda da conta: CBO = da campanha; ABO = de cada ad set */
  dailyBudgetMinor: number;
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
}
export interface MetaTemplateAd {
  /** null = herda do criativo/oferta como hoje */
  primaryText: string | null; headline: string | null; description: string | null;
  callToAction: MetaCallToAction;
  link: string;
  /** query string sem "?" (UTM) */
  urlTags: string | null;
  namePattern: string;
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
export interface MetaTemplateImportResult { template: MetaTemplateBody; unsupported: { field: string; value: string }[] }

/** Publicar com template (alternativa ao MetaPublishBody). */
export interface MetaPublishWithTemplateBody { templateId: string }

/** POST /meta/publish-batch */
export interface MetaPublishBatchBody { creativeIds: string[]; templateId: string }
export interface MetaPublishBatchPlan { adsets: { name: string; creativeIds: string[]; belowMin: boolean }[] }
export interface MetaPublishBatchResponse { publications: MetaPublication[]; plan: MetaPublishBatchPlan }
