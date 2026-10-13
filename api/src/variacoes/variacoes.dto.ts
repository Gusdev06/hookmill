import type {
  BatchSettings, CastingStyle, CreateBatchBody, FaceCount, GenerateCastingFacesBody, EditSettings, HookMode, LaunchBatchBody, RegenerateVariationItemBody, ReplanBatchBody, UpdateCastingBody,
  UpdateVariationItemBody, SwapEngine, VariationKind, VideoFormat, VoiceSource,
} from '@maquina/contratos';
import { Type } from 'class-transformer';
import { UpdateEditDto } from '../edicao/edicao.dto';
import { FACE_COUNTS } from '../rostos/rostos.dto';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

const KINDS: VariationKind[] = ['SWAP_AVATAR', 'NEW_HOOKS', 'COPY_NEW', 'REMIX_EDIT'];
const FORMATS: VideoFormat[] = ['VERTICAL_9_16', 'PORTRAIT_4_5', 'SQUARE_1_1'];
const HOOK_MODES: HookMode[] = ['TEXT'];
const VOICE_SOURCES: VoiceSource[] = ['CATALOG', 'CHAMPION_AUDIO', 'ENGINE_VOICE'];
const SWAP_ENGINES: SwapEngine[] = ['LIPSYNC', 'KLING', 'SEEDANCE'];
const CASTING_STYLES: CastingStyle[] = ['DIVERSE', 'MATCH_ORIGINAL'];

export class BatchRequestDto {
  @IsIn(KINDS) kind: VariationKind;
  @IsInt() @Min(1) count: number;
}

export class BatchSettingsDto implements Partial<BatchSettings> {
  @IsOptional() @IsIn(FORMATS) format?: VideoFormat;
  @IsOptional() @IsString() @MaxLength(100) voiceId?: string | null;
  @IsOptional() @IsIn(VOICE_SOURCES) voiceSource?: VoiceSource;
  @IsOptional() @IsIn(['SCENES', 'LIPSYNC']) engine?: 'SCENES' | 'LIPSYNC' | null;
  @IsOptional() @IsString() @MaxLength(100) engineModel?: string | null;
  /** Parcial, mesmas regras do PATCH …/edit. */
  @IsOptional() @ValidateNested() @Type(() => UpdateEditDto) edit?: EditSettings;
  /** §13: manter a edição do campeão. true com bloqueio = 422 KEEP_EDIT_UNSUPPORTED (checado no service). */
  @IsOptional() @IsBoolean() keepEdit?: boolean;
  /** §13.4: só 'TEXT' até a D6. */
  @IsOptional() @IsIn(HOOK_MODES) hookMode?: HookMode;
  /** §13.15: motor do Trocar avatar. Combinação validada no service (tabela da §13.15.1). */
  @IsOptional() @IsIn(SWAP_ENGINES) swapEngine?: SwapEngine;
}

export class CreateBatchDto implements CreateBatchBody {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BatchRequestDto) requests: BatchRequestDto[];
  @IsOptional() @ValidateNested() @Type(() => BatchSettingsDto) settings?: BatchSettingsDto;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** §13.13: padrão DIVERSE. */
  @IsOptional() @IsIn(CASTING_STYLES) castingStyle?: CastingStyle;
}

export class ReplanBatchDto implements ReplanBatchBody {
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => BatchRequestDto) requests?: BatchRequestDto[];
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** §13.13: omitido = mantém o do lote. */
  @IsOptional() @IsIn(CASTING_STYLES) castingStyle?: CastingStyle;
}

export class HookEditDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(400) speech?: string;
  @IsOptional() @IsString() @MaxLength(200) onScreenText?: string | null;
}

export class BlockEditDto {
  @IsInt() @Min(0) index: number;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) speech?: string;
}

export class UpdateItemDto implements UpdateVariationItemBody {
  @IsOptional() @IsBoolean() included?: boolean;
  @IsOptional() @ValidateNested() @Type(() => HookEditDto) hook?: HookEditDto;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BlockEditDto) blocks?: BlockEditDto[];
}

export class RegenerateItemDto implements RegenerateVariationItemBody {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

export class UpdateCastingDto implements UpdateCastingBody {
  @IsString() @MinLength(10) @MaxLength(600) description: string;
}

/** §13.13: 1-4 rostos (padrão 1 no elenco). */
export class GenerateCastingFacesDto implements GenerateCastingFacesBody {
  @IsString() @MinLength(10) @MaxLength(600) description: string;
  @IsOptional() @IsIn(FACE_COUNTS) count?: FaceCount;
}

export class LaunchBatchDto implements LaunchBatchBody {
  @IsNumber() @Min(0) expectedCostUsd: number;
}
