import type { AutoVariationType, CreateIterateBody, FrameTemplateId, ListLook, ListTemplateId, StartIterateBody, UpdateListOptionsBody } from '@maquina/contratos';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsIn, IsObject, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { UpdateItemTextsBody } from '@maquina/contratos';

/** Exatamente um de uploadId/creativeId/metaAdId/championId/researchAdId (conferido no service: 400 exactlyOneOf). metaAdId = Pick from Meta (meta-v1 D13). */
export class CreateIterateDto implements CreateIterateBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) uploadId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) creativeId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) metaAdId?: string;
  /** 26/10 "Novo lote": campeão já analisado (READY), sem subir o vídeo de novo */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) championId?: string;
  /** ads-research-v1 §6.1: anúncio do Ad Radar (LibraryAd.id); acha ou cria o campeão THIRD_PARTY do workspace */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) researchAdId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) offerId?: string;
  /** legenda-protegida-v1 D-LP5: versão sem legenda presa na criação (conferida antes do plano) */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) cleanUploadId?: string;
}

export class StartIterateDto implements StartIterateBody {
  @IsInt() @Min(1) @Max(50) expectedPieces: number;
  /** rev. 23/10 §14.4: `cost.generateEstimateUsd` mostrado no botão. TRANSIÇÃO: opcional no tipo; ausente conta como 0
   *  (lote sem STATIC passa; com STATIC = 409 ESTIMATE_CHANGED até o web mandar). */
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) expectedCostUsd?: number;
  /** templates-creditos-v1 §7: `template.quote` mostrado no botão; obrigatório em lote de template */
  @IsOptional() @IsInt() @Min(0) @Max(10000) expectedCredits?: number;
}

export class ItemTextDto {
  @IsString() @MinLength(1) @MaxLength(40) @Matches(/^[A-Za-z]+(\.[A-Za-z0-9]+)*$/) path: string;
  @IsString() @MinLength(1) @MaxLength(600) value: string;
}
/** templates-creditos-v1 A7: `PATCH /iterate/:id/items/:itemId/texts`. */
export class UpdateItemTextsDto implements UpdateItemTextsBody {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ItemTextDto) texts: ItemTextDto[];
}

/** `POST /iterate/:id/retry` recebe `{}`. */
export class EmptyBodyDto {}

export class UpdateAnswersDto {
  @IsObject() answers: import('@maquina/contratos').IterateAnswers;
  @IsOptional() @IsBoolean() save?: boolean;
}
export class SelectItemDto {
  @IsBoolean() included: boolean;
}

/** templates-lista-v1 §5: `PATCH /iterate/:id/items/:itemId/list` (≥ 1 campo; conferido no service). */
export class UpdateListOptionsDto implements UpdateListOptionsBody {
  @IsOptional() @IsIn(['ink', 'paper', 'brand']) look?: ListLook;
  @IsOptional() @IsIn([1, 2]) columns?: 1 | 2;
  @IsOptional() @Equals(true) acceptFill?: true;
}
