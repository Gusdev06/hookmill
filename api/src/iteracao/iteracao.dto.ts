import type { CreateIterateBody, StartIterateBody } from '@maquina/contratos';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Exatamente um de uploadId/creativeId/metaAdId (conferido no service: 400 exactlyOneOf). metaAdId = Pick from Meta (meta-v1 D13). */
export class CreateIterateDto implements CreateIterateBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) uploadId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) creativeId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) metaAdId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) offerId?: string;
}

export class StartIterateDto implements StartIterateBody {
  @IsInt() @Min(1) @Max(50) expectedPieces: number;
  /** rev. 23/10 §14.4: `cost.generateEstimateUsd` mostrado no botão. TRANSIÇÃO: opcional no tipo; ausente conta como 0
   *  (lote sem STATIC passa; com STATIC = 409 ESTIMATE_CHANGED até o web mandar). */
  @IsOptional() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) expectedCostUsd?: number;
}

/** `POST /iterate/:id/retry` recebe `{}`. */
export class EmptyBodyDto {}
