import type { ChangeType } from '@maquina/contratos';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * ChangeRequestBody é uma união discriminada por `type` (não dá pra `implements`):
 * SCENE { sceneIndex } · LINE { sceneIndex, newSpeech } · TEXT {} · FACE {}, todos com note opcional.
 */
export class ChangeRequestDto {
  @IsIn(['SCENE', 'TEXT', 'LINE', 'FACE']) type: ChangeType;
  @ValidateIf((o) => o.type === 'SCENE' || o.type === 'LINE' || o.sceneIndex !== undefined) @IsInt() @Min(0) @Max(99) sceneIndex?: number;
  @ValidateIf((o) => o.type === 'LINE' || o.newSpeech !== undefined) @IsString() @MinLength(1) @MaxLength(2000) newSpeech?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class ApproveDto {}
