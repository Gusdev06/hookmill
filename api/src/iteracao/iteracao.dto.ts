import type { AutoVariationType, CreateIterateBody, ForceCaptionBlockedBody, FrameTemplateId, StartIterateBody } from '@maquina/contratos';
import { IsBoolean, IsObject, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Exatamente um de uploadId/creativeId/metaAdId (conferido no service: 400 exactlyOneOf). metaAdId = Pick from Meta (meta-v1 D13). */
export class CreateIterateDto implements CreateIterateBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) uploadId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) creativeId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) metaAdId?: string;
  /** 26/10 "Novo lote": campeão já analisado (READY), sem subir o vídeo de novo */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) championId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) offerId?: string;
  /** legenda-protegida-v1 D-LP5: versão sem legenda presa na criação (conferida antes do plano) */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) cleanUploadId?: string;
}

export class StartIterateDto implements StartIterateBody {
  @IsInt() @Min(1) @Max(50) expectedPieces: number;
  /** rev. 23/10 §14.4: `cost.generateEstimateUsd` mostrado no botão. TRANSIÇÃO: opcional no tipo; ausente conta como 0
   *  (lote sem STATIC passa; com STATIC = 409 ESTIMATE_CHANGED até o web mandar). */
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) expectedCostUsd?: number;
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

/** 29/10 (legenda-protegida-v1 §8): "Gerar mesmo assim" / desfazer. O par (type, template) tem que estar em `insight.captionBlocked`. */
export class ForceCaptionBlockedDto implements ForceCaptionBlockedBody {
  @IsString() @MinLength(1) @MaxLength(32) type: AutoVariationType;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(32) template: FrameTemplateId | null;
}
