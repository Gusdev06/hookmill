import type { TemplateFitsBody, TemplateSourceRef, TemplateStatus, UpdateTemplateBody, UseTemplateBody, UseTemplatesBody } from '@maquina/contratos';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { AiPreviewsRequestDto } from '../templates-ai/previews.dto';
import { SELECTION_LIMITS } from './catalogo';

export class TemplateSourceDto implements TemplateSourceRef {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) championId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) metaAdId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) creativeId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) uploadId?: string;
  /** ads-research-v1 §6.1: anúncio do Ad Radar (LibraryAd.id) */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) researchAdId?: string;
}

/** Exatamente 1 fonte (conferido no IteracaoService.create: 400 exactlyOneOf). */
export class TemplateGenerationDto {
  @IsUUID('4') requestId: string;
  @IsInt() @Min(0) @Max(1000) expectedCredits: number;
}
export class UseTemplateDto extends TemplateSourceDto implements UseTemplateBody {
  @IsOptional() @ValidateNested() @Type(() => TemplateGenerationDto) generation?: TemplateGenerationDto;
  /** templates-ia-previas-v1 §5.1 (AI_PREVIEWS=on, template AI_VIDEO): só a chave; `generation` passa a ser recusado */
  @IsOptional() @ValidateNested() @Type(() => AiPreviewsRequestDto) previews?: AiPreviewsRequestDto;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) offerId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) cleanUploadId?: string;
}

/** templates-multi-v1 §3.1: `slugs` 2-12, distintos, cada um 1-64 caracteres (a fonte única é conferida no service). */
export class UseTemplatesDto extends UseTemplateDto implements UseTemplatesBody {
  @IsArray() @ArrayMinSize(SELECTION_LIMITS.minTemplates) @ArrayMaxSize(SELECTION_LIMITS.maxTemplates) @ArrayUnique()
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(64, { each: true }) slugs: string[];
}

/** Exatamente 1 de `slug` ou `slugs` (templates-multi-v1 §3.2; os dois ou nenhum = 400 no service). */
export class TemplateFitsDto implements TemplateFitsBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) slug?: string;
  @IsOptional() @IsArray() @ArrayMinSize(SELECTION_LIMITS.minTemplates) @ArrayMaxSize(SELECTION_LIMITS.maxTemplates) @ArrayUnique()
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(64, { each: true }) slugs?: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => TemplateSourceDto) sources: TemplateSourceDto[];
}

export class UpdateTemplateDto implements UpdateTemplateBody {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(1) @Max(1000) credits?: number | null;
  @IsOptional() @IsIn(['DRAFT', 'LIVE', 'HIDDEN']) status?: TemplateStatus;
  @ValidateIf((_, v) => v !== undefined) @IsInt() @Min(0) @Max(100000) order?: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) nameEn?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) namePt?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(240) descEn?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(240) descPt?: string;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() beta?: boolean;
}

export class TemplateExampleUploadDto {
  @IsIn(['video/mp4']) mimeType: 'video/mp4';
  @IsInt() @Min(1) sizeBytes: number;
}

export class TemplateExampleCompleteDto {
  @IsString() @MinLength(1) @MaxLength(200) key: string;
}
