import type { BrainGraphQuery } from '@maquina/contratos';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** GET /brain/graph (brain-3d-v1 §1). offerId malformado = 400 VALIDATION_ERROR; de outro workspace/arquivada = 404. */
export class BrainGraphQueryDto implements BrainGraphQuery {
  @IsOptional() @IsString() @MaxLength(64) @Matches(/^[A-Za-z0-9_-]+$/) offerId?: string;
  /** '1' pula o cache (no máx. 1 por 10 s por workspace) */
  @IsOptional() @IsIn(['1']) fresh?: '1';
}
