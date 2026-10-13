import type { Engine, EstimateQuery, GenerateBody, RegenerateSceneBody, RegenerateTakeBody, UpdateEngineBody, VideoFormat } from '@maquina/contratos';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

const ENGINES = ['SCENES', 'LIPSYNC'];
const FORMATS = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'];

export class EstimateQueryDto implements EstimateQuery {
  @IsIn(ENGINES) engine: Engine;
  @IsString() @MinLength(1) @MaxLength(80) model: string;
  @IsIn(FORMATS) format: VideoFormat;
  @IsOptional() @IsString() @MaxLength(80) voiceId?: string;
}

export class VoicesQueryDto {
  @IsOptional() @IsString() @MaxLength(35) language?: string;
}

export class UpdateEngineDto implements UpdateEngineBody {
  @IsOptional() @IsIn(ENGINES) engine?: Engine;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) engineModel?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(80) voiceId?: string | null;
  @IsOptional() @IsIn(FORMATS) format?: VideoFormat;
}

export class GenerateDto implements GenerateBody {
  @IsIn(ENGINES) engine: Engine;
  @IsString() @MinLength(1) @MaxLength(80) engineModel: string;
  /** obrigatório com LIPSYNC no criativo do zero (conferido no service); variação com áudio original vai sem voz */
  @ValidateIf((o) => o.voiceId !== undefined) @IsString() @IsNotEmpty() @MaxLength(80) voiceId?: string;
  @IsIn(FORMATS) format: VideoFormat;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) expectedCostUsd: number;
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export class RegenerateSceneDto implements RegenerateSceneBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) visualPrompt?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) speech?: string;
  /** §13.5: fatia de take → refazer o take inteiro exige confirm + expectedCostUsd */
  @IsOptional() @IsBoolean() confirm?: boolean;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) expectedCostUsd?: number;
}

export class RegenerateTakeDto implements RegenerateTakeBody {
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) expectedCostUsd: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
