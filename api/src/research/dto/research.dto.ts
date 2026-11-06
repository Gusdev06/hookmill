// ads-research-v1 §7: entradas das rotas /research/* (tipos em contratos/src/research.ts). Arrays do GET /research/ads vêm
// como parâmetro repetido (`?format=VIDEO&format=DCO`); um valor só também vira array.
import type {
  AddCompetitorBody, DismissCompetitorBody, DismissReason, LibraryAdFormat, LibraryAdPlatform, ListCompetitorsQuery, ListResearchAdsQuery,
  ResearchAdTier, ResearchSort, ResearchStatusFilter, SaveResearchAdBody, UpdateCompetitorBody,
} from '@maquina/contratos';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const toArray = ({ value }: { value: unknown }) => (value === undefined || value === null || value === '' ? undefined : Array.isArray(value) ? value : [value]);
const toBool = ({ value }: { value: unknown }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);

export const DISMISS_REASONS: readonly DismissReason[] = ['not_competitor', 'not_relevant', 'own_brand', 'other'];
export const AD_FORMATS: readonly LibraryAdFormat[] = ['VIDEO', 'IMAGE', 'CAROUSEL', 'DCO', 'DPA', 'OTHER'];
export const AD_PLATFORMS: readonly LibraryAdPlatform[] = ['FACEBOOK', 'INSTAGRAM', 'MESSENGER', 'AUDIENCE_NETWORK', 'THREADS', 'WHATSAPP'];
export const AD_TIERS: readonly ResearchAdTier[] = ['winner', 'testing', 'new', 'stopped'];
export const AD_SORTS: readonly ResearchSort[] = ['longest_running', 'newest', 'most_variations', 'eu_reach'];
export const ADS_PAGE_MAX = 60;
export const ADS_PAGE_DEFAULT = 30;

export class ListCompetitorsQueryDto implements ListCompetitorsQuery {
  @IsOptional() @IsIn(['active', 'dismissed', 'retired']) status?: 'active' | 'dismissed' | 'retired';
}

export class UpdateCompetitorDto implements UpdateCompetitorBody {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MinLength(1) @MaxLength(80) name: string;
}

export class DismissCompetitorDto implements DismissCompetitorBody {
  @IsIn(DISMISS_REASONS) reason: DismissReason;
}

/** R10 (só equipe): exatamente um de pageId/pageUrl (conferido no service: 400 research_source_invalid). */
export class AddCompetitorDto implements AddCompetitorBody {
  @IsOptional() @IsString() @MaxLength(40) pageId?: string;
  @IsOptional() @IsString() @MaxLength(2048) pageUrl?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
}

export class ListResearchAdsQueryDto implements ListResearchAdsQuery {
  @IsOptional() @Transform(toArray) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(64, { each: true }) competitorId?: string[];
  @IsOptional() @IsIn(['active', 'inactive', 'all']) status?: ResearchStatusFilter;
  @IsOptional() @Transform(toArray) @IsArray() @IsIn(AD_FORMATS, { each: true }) format?: LibraryAdFormat[];
  @IsOptional() @Transform(toBool) @IsBoolean() hasVideo?: boolean;
  @IsOptional() @Transform(toArray) @IsArray() @IsIn(AD_TIERS, { each: true }) tier?: ResearchAdTier[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) minDays?: number;
  @IsOptional() @IsISO8601({ strict: true }) startedAfter?: string;
  @IsOptional() @IsISO8601({ strict: true }) startedBefore?: string;
  @IsOptional() @Transform(toArray) @IsArray() @IsIn(AD_PLATFORMS, { each: true }) platform?: LibraryAdPlatform[];
  @IsOptional() @Transform(toArray) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @Matches(/^[a-z]{2}$/, { each: true }) language?: string[];
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() saved?: boolean;
  @IsOptional() @IsIn(AD_SORTS) sort?: ResearchSort;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(ADS_PAGE_MAX) limit?: number;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

export class SaveResearchAdDto implements SaveResearchAdBody {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(500) note?: string | null;
}
