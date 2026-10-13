import type { CreateCreativeBody, CreativeFilter, ListCreativesQuery, UpdateCreativeBody } from '@maquina/contratos';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PageQueryDto } from '../common/http/pagination';

export class CreateCreativeDto implements CreateCreativeBody {
  @IsString() @MinLength(1) @MaxLength(64) offerId: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsInt() @Min(3) @Max(5) scriptCount?: number;
}

/** Só o nome: offerId (ou qualquer outro campo) = 400 VALIDATION_ERROR (forbidNonWhitelisted). */
export class UpdateCreativeDto implements UpdateCreativeBody {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
}

export class ListCreativesDto extends PageQueryDto implements ListCreativesQuery {
  @IsOptional() @IsIn(['all', 'progress', 'needs_you', 'approved']) filter?: CreativeFilter;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsString() @MaxLength(64) offerId?: string;
  @IsOptional() @IsString() @MaxLength(64) championId?: string;
  @IsOptional() @IsIn(['scratch', 'variation']) origin?: 'scratch' | 'variation';
}
