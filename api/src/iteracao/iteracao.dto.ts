import type { CreateIterateBody, StartIterateBody } from '@maquina/contratos';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Exatamente um de uploadId/creativeId (conferido no service: 400 exactlyOneOf). */
export class CreateIterateDto implements CreateIterateBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) uploadId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) creativeId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) offerId?: string;
}

export class StartIterateDto implements StartIterateBody {
  @IsInt() @Min(1) @Max(50) expectedPieces: number;
}

/** `POST /iterate/:id/retry` recebe `{}`. */
export class EmptyBodyDto {}
