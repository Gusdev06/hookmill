// PUT /creatives/:id/editor (editor-v1 §5, §5.4). O DTO confere FORMA e FAIXAS (whitelist + forbidNonWhitelisted no pipe
// global); a semântica (cena existe, cobre todas, cor hex, fonte do catálogo, limites de tamanho, palavra existe) é do
// validarDoc do @maquina/video/lib, com as regras do contrato em details.fields[].rule.
import type { CaptionWordFix, EditClip, EditDocLayer, LayerStyle, LayerTransform, Rect } from '@maquina/contratos';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { UpdateEditDto } from './edicao.dto';

const NUM = { allowNaN: false, allowInfinity: false } as const;
/** null aceito; ausente não (campo obrigatório que pode ser nulo). */
const NullOk = () => ValidateIf((_: unknown, v: unknown) => v !== null);
/** null e ausente aceitos. */
const Opcional = () => ValidateIf((_: unknown, v: unknown) => v !== null && v !== undefined);

export class LayerTransformDto implements LayerTransform {
  @IsNumber(NUM) @Min(-0.25) @Max(1.25) x: number;
  @IsNumber(NUM) @Min(-0.25) @Max(1.25) y: number;
  @IsNumber(NUM) @Min(0.25) @Max(4) scale: number;
  @IsNumber(NUM) @Min(-180) @Max(180) rotationDeg: number;
  @IsNumber(NUM) @Min(0.1) @Max(1.5) boxWidth: number;
}

export class LayerTimingDto {
  @IsNumber(NUM) @Min(0) @Max(3600) fromSec: number;
  @IsNumber(NUM) @Min(0) @Max(3600) durationSec: number;
}

export class LayerBackgroundDto {
  @IsIn(['none', 'box', 'pill', 'word']) kind: LayerStyle['background']['kind'];
  @NullOk() @IsString() @MaxLength(16) color: string | null;
}

export class LayerStyleDto implements Partial<LayerStyle> {
  @IsOptional() @IsString() @MaxLength(64) fontId?: LayerStyle['fontId'];
  @IsOptional() @IsString() @MaxLength(16) color?: string;
  @Opcional() @IsString() @MaxLength(16) highlightColor?: string | null;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => LayerBackgroundDto) background?: LayerBackgroundDto;
  @Opcional() @IsString() @MaxLength(16) strokeColor?: string | null;
  @IsOptional() @IsNumber(NUM) @Min(0) @Max(60) strokeWidthPx?: number;
  @IsOptional() @IsBoolean() uppercase?: boolean;
  @IsOptional() @IsBoolean() shadow?: boolean;
  @IsOptional() @IsIn(['left', 'center', 'right']) align?: LayerStyle['align'];
}

/** editor-universal-v1 §4: caixa em fração do canvas (a faixa -0,25..1,25 é regra do validarDoc: rect_out_of_range). */
export class RectDto implements Rect {
  @IsNumber(NUM) @Min(-10) @Max(10) x: number;
  @IsNumber(NUM) @Min(-10) @Max(10) y: number;
  @IsNumber(NUM) @Min(0) @Max(10) w: number;
  @IsNumber(NUM) @Min(0) @Max(10) h: number;
}

export class EditDocLayerDto implements EditDocLayer {
  @IsString() @MaxLength(64) id: string;
  @IsOptional() @IsBoolean() visible?: boolean;
  @Opcional() @IsObject() @ValidateNested() @Type(() => LayerTransformDto) transform?: LayerTransformDto | null;
  @Opcional() @IsObject() @ValidateNested() @Type(() => LayerTimingDto) timing?: LayerTimingDto | null;
  /** ≤ 300 é regra do validarDoc (doc_too_large); aqui só o teto de segurança. */
  @IsOptional() @IsString() @MaxLength(5000) text?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => LayerStyleDto) style?: LayerStyleDto;
  /** v3 (editor-universal-v1 §4): caixa e fundo */
  @Opcional() @IsObject() @ValidateNested() @Type(() => RectDto) rect?: RectDto | null;
  @Opcional() @IsString() @MaxLength(16) fill?: string | null;
}

export class EditClipDto implements EditClip {
  @IsString() @MaxLength(64) sceneId: string;
  @IsBoolean() enabled: boolean;
  @IsInt() @Min(1) attempt: number;
  @IsNumber(NUM) @Min(0) @Max(3600) inSec: number;
  @IsNumber(NUM) @Min(0) @Max(3600) outSec: number;
}

export class EditTrimDto {
  @IsInt() @Min(0) inFrame: number;
  @IsInt() @Min(0) outFrame: number;
}

export class CaptionWordFixDto implements CaptionWordFix {
  @IsString() @MaxLength(200) key: string;
  @IsString() @MaxLength(5000) text: string;
}

/** "It's true, keep it" (D-E1-3). byUserId/at: o servidor carimba (quem confirmou e quando) se vierem vazios/novos. */
export class TextConfirmationDto {
  @IsString() @MaxLength(200) path: string;
  @IsArray() @IsString({ each: true }) @MaxLength(40, { each: true }) numbers: string[];
  @IsOptional() @IsString() @MaxLength(64) byUserId?: string;
  @IsOptional() @IsString() @MaxLength(40) at?: string;
}

/**
 * Doc do editor: v1 (criativo do zero, editor-v1) ou v3 (peça AUTO, editor-universal-v1 §4). Os campos v3 de forma livre
 * (templateOpts, video, items, clipSwaps, formatOverrides) chegam como objeto e quem confere é o validarDoc<Família> do
 * @maquina/video/lib (400 com EditDocRuleV3 em details.fields[].rule).
 */
export class EditDocDto {
  @IsIn([1, 3]) version: 1 | 3;
  @IsArray() @ValidateNested({ each: true }) @Type(() => EditClipDto) clips: EditClipDto[];
  @NullOk() @IsDefined() @IsObject() @ValidateNested() @Type(() => EditTrimDto) trim: EditTrimDto | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => EditDocLayerDto) layers: EditDocLayerDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => CaptionWordFixDto) captionWords: CaptionWordFixDto[];
  @IsOptional() @IsObject() templateOpts?: Record<string, string | boolean>;
  @Opcional() @IsObject() video?: Record<string, unknown> | null;
  @IsOptional() @IsObject() items?: Record<string, unknown[]>;
  @IsOptional() @IsArray() @IsObject({ each: true }) clipSwaps?: { clipId: string; fileId: string }[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TextConfirmationDto) confirmations?: TextConfirmationDto[];
  @IsOptional() @IsObject() formatOverrides?: Record<string, unknown>;
}

/** POST /creatives/:id/editor/export (editor-universal-v1 §7.1). */
export class ExportEditorDto {
  @IsInt() @Min(0) revision: number;
}

export class PutEditorDto {
  @IsInt() @Min(0) baseRevision: number;
  /** null = voltar tudo ao padrão. Obrigatório (ausente = 400). */
  @NullOk() @IsDefined() @IsObject() @ValidateNested() @Type(() => EditDocDto) doc: EditDocDto | null;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UpdateEditDto) settings?: UpdateEditDto;
}
