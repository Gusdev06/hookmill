import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { SemanticFocus, SemanticFormat, SemanticPlanRequest } from '@maquina/contratos';
import { FOCUSES, FORMAT_IDS } from './catalogo';

export class CreateSemanticPlanDto implements SemanticPlanRequest {
  @IsString() @MinLength(1) @MaxLength(80) championId: string;
  @IsUUID() requestId: string;
  @IsIn(FOCUSES) focus: SemanticFocus;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(1200) instructions: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique() @IsIn(FORMAT_IDS, { each: true }) formatIds: SemanticFormat[];
}
export class ListSemanticPlansDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) championId?: string;
}
