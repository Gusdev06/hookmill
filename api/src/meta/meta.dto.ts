// DTOs do módulo meta (meta-v1.md §2/§3), `implements` dos tipos do @maquina/contratos.
import type {
  MetaActivateBody, MetaAdTrend, MetaAdVerdict, MetaAdsQuery, MetaCallToAction, MetaConnectBody, MetaObjective, MetaOptionsQuery, MetaPeriod,
  MetaPublicationStatus, MetaPublicationsQuery, MetaPublishBody, MetaSelectionBody, MetaSpecialAdCategory, MetaSummaryQuery,
} from '@maquina/contratos';
import { Type } from 'class-transformer';
import {
  Allow, ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength,
  ValidateIf,
} from 'class-validator';
import type {
  MetaPublishBatchBody, MetaTemplateAd, MetaTemplateAdset, MetaTemplateBody, MetaTemplateCampaign, MetaTemplateImportBody, MetaTemplateImportedFrom,
  UpdateMetaTemplateBody,
} from '@maquina/contratos';
import type {
  MetaAdFormat, MetaBudgetBody, MetaCampaignDetailQuery, MetaCampaignsQuery, MetaChangesQuery, MetaLevel, MetaOrigin, MetaSort, MetaStatusBody,
  MetaStatusFilter, MetaToggleStatus,
} from '@maquina/contratos';

/** meta-v1.md §3.1: `/settings/connections` = Settings › Connections (ajuste 21/10); `/settings` fica como alias. Única lista do backend; a da porta é `integracoes/meta/estado.ts`. */
export const RETURN_TOS = ['/onboarding/meta', '/settings/connections', '/settings', '/meta/done'] as const;
export const OBJECTIVES: readonly MetaObjective[] = ['OUTCOME_SALES', 'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_TRAFFIC'];
export const CTAS: readonly MetaCallToAction[] = ['SHOP_NOW', 'LEARN_MORE', 'SIGN_UP', 'GET_OFFER', 'BOOK_NOW', 'CONTACT_US', 'DOWNLOAD', 'SUBSCRIBE', 'APPLY_NOW', 'GET_QUOTE', 'ORDER_NOW'];
export const SPECIAL_CATEGORIES: readonly MetaSpecialAdCategory[] = ['HOUSING', 'CREDIT', 'EMPLOYMENT', 'ISSUES_ELECTIONS_POLITICS', 'FINANCIAL_PRODUCTS_SERVICES'];
const VERDICTS: readonly MetaAdVerdict[] = ['WINNER', 'OK', 'LOW_DATA'];
const TRENDS: readonly MetaAdTrend[] = ['WORKING', 'STEADY', 'TIRING'];
const PUB_STATUSES: readonly MetaPublicationStatus[] = ['PUBLISHING', 'PAUSED', 'ACTIVE', 'FAILED', 'DELETED'];
// campanhas-v1 §3/§4
const STATUS_FILTERS: readonly MetaStatusFilter[] = ['active', 'paused', 'issues', 'all'];
const SORTS: readonly MetaSort[] = ['spend', 'cpa', 'results', 'ctr', 'hookRate', 'budget', 'name'];
const LEVELS: readonly MetaLevel[] = ['campaign', 'adset', 'ad'];

export class MetaConnectDto implements MetaConnectBody {
  @IsOptional() @IsIn(RETURN_TOS) returnTo?: (typeof RETURN_TOS)[number];
}

export class MetaOptionsQueryDto implements MetaOptionsQuery {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) adAccountId?: string;
}

export class MetaSelectionDto implements MetaSelectionBody {
  @IsString() @MinLength(1) @MaxLength(64) adAccountId: string;
  @IsString() @MinLength(1) @MaxLength(64) pageId: string;
  @IsOptional() @IsString() @MaxLength(64) pixelId?: string | null;
}

export class MetaAdsQueryDto implements MetaAdsQuery {
  @IsOptional() @IsIn(VERDICTS) verdict?: MetaAdVerdict;
  @IsOptional() @IsIn(TRENDS) trend?: MetaAdTrend;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(['spend', 'cpa', 'hookRate', 'ctr', 'results', 'name']) sort?: 'spend' | 'cpa' | 'hookRate' | 'ctr' | 'results' | 'name';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  // campanhas-v1 §3 (22/10)
  @IsOptional() @IsIn(STATUS_FILTERS) status?: MetaStatusFilter;
  @IsOptional() @IsIn(['all', 'hookmill']) origin?: MetaOrigin;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) campaignId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) adsetId?: string;
  /** padrão video (Pick from Meta e tour iguais) */
  @IsOptional() @IsIn(['video', 'all']) format?: MetaAdFormat;
  @IsOptional() @IsIn(['7d', '30d']) period?: MetaPeriod;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}

// ───────── campanhas-v1 §4 ─────────


export class MetaCampaignsQueryDto implements MetaCampaignsQuery {
  @IsOptional() @IsIn(['7d', '30d']) period?: MetaPeriod;
  @IsOptional() @IsIn(STATUS_FILTERS) status?: MetaStatusFilter;
  @IsOptional() @IsIn(['all', 'hookmill']) origin?: MetaOrigin;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(SORTS) sort?: MetaSort;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

export class MetaCampaignDetailQueryDto implements MetaCampaignDetailQuery {
  @IsOptional() @IsIn(['7d', '30d']) period?: MetaPeriod;
}

export class MetaChangesQueryDto implements MetaChangesQuery {
  @IsOptional() @IsIn(LEVELS) level?: MetaLevel;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) objectId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

/** D6/D8: `expected` = o que a tela mostrava; `confirm: true` obrigatório. */
export class MetaStatusDto implements MetaStatusBody {
  @IsIn(['ACTIVE', 'PAUSED']) status: MetaToggleStatus;
  @IsIn(['ACTIVE', 'PAUSED']) expected: MetaToggleStatus;
  @Equals(true) confirm: true;
  @IsOptional() @IsBoolean() includeParents?: boolean;
}

/** D7/D8: centavos da moeda da conta. */
export class MetaBudgetDto implements MetaBudgetBody {
  @IsInt() @Min(1) @Max(100_000_000_00) dailyBudgetMinor: number;
  @IsInt() @Min(0) @Max(100_000_000_00) expectedDailyBudgetMinor: number;
  @Equals(true) confirm: true;
}

export class MetaSummaryQueryDto implements MetaSummaryQuery {
  @IsOptional() @IsIn(['7d', '30d']) period?: MetaPeriod;
}

export class MetaPublicationsQueryDto implements MetaPublicationsQuery {
  @IsOptional() @IsIn(PUB_STATUSES) status?: MetaPublicationStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

/** Sem `templateId` = o formulário de hoje (campos obrigatórios); com `templateId` = só ele (meta-templates-v1 §2). */
const noTemplate = (o: { templateId?: unknown }) => o.templateId === undefined;
export class MetaPublishDto implements MetaPublishBody {
  /** meta-templates-v1: publicar com um template (alternativa ao corpo inteiro); os demais campos ficam proibidos */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) templateId?: string;
  @ValidateIf(noTemplate) @IsInt() @Min(1) dailyBudgetMinor: number;
  @ValidateIf(noTemplate) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @Matches(/^[A-Z]{2}$/, { each: true }) countries: string[];
  @IsOptional() @IsIn(OBJECTIVES) objective?: MetaObjective;
  @ValidateIf(noTemplate) @IsString() @MinLength(1) @MaxLength(2000) primaryText: string;
  /** > 40 = aviso na tela, não erro (teto técnico 255) */
  @IsOptional() @IsString() @MaxLength(255) headline?: string;
  @IsOptional() @IsString() @MaxLength(125) description?: string;
  @ValidateIf(noTemplate) @IsIn(CTAS) callToAction: MetaCallToAction;
  @ValidateIf(noTemplate) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(2048) link: string;
  @IsOptional() @IsArray() @IsIn(SPECIAL_CATEGORIES, { each: true }) specialAdCategories?: MetaSpecialAdCategory[];
  @IsOptional() @IsInt() @Min(18) @Max(65) ageMin?: number;
  @IsOptional() @IsInt() @Min(18) @Max(65) ageMax?: number;
}

// ───────── meta-templates-v1 ─────────
// O formato fino das seções (união de placements, regras cruzadas, chaves desconhecidas) é validado por
// `templateBodyErrors` (meta/templates.ts) e devolvido no mesmo VALIDATION_ERROR { fields }.

export class MetaTemplateDto implements MetaTemplateBody {
  @IsDefined() @IsString() name: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsDefined() @IsObject() campaign: MetaTemplateCampaign;
  @IsDefined() @IsObject() adset: MetaTemplateAdset;
  @IsDefined() @IsObject() ad: MetaTemplateAd;
  @IsOptional() @Allow() importedFrom?: MetaTemplateImportedFrom | null;
}

export class MetaTemplatePatchDto implements UpdateMetaTemplateBody {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsObject() campaign?: MetaTemplateCampaign;
  @IsOptional() @IsObject() adset?: MetaTemplateAdset;
  @IsOptional() @IsObject() ad?: MetaTemplateAd;
  @IsOptional() @Allow() importedFrom?: MetaTemplateImportedFrom | null;
}

export class MetaTemplateImportDto implements MetaTemplateImportBody {
  @IsIn(LEVELS) level: MetaLevel;
  @IsString() @MinLength(1) @MaxLength(64) id: string;
}

export class MetaPublishBatchDto implements MetaPublishBatchBody {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ArrayUnique() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(64, { each: true }) creativeIds: string[];
  @IsString() @MinLength(1) @MaxLength(64) templateId: string;
}

export class MetaActivateDto implements MetaActivateBody {
  @Equals(true) confirm: true;
}

/** `{}` (health, sync, retry, pause, disconnect). */
export class MetaEmptyDto {}
