// PUT /creatives/:id/editor (editor-v1 §5, §5.4). O DTO confere FORMA e FAIXAS (whitelist + forbidNonWhitelisted no pipe
// global); a semântica (cena existe, cobre todas, cor hex, fonte do catálogo, limites de tamanho, palavra existe) é do
// validarDoc do @maquina/video/lib, com as regras do contrato em details.fields[].rule.
import type { CaptionWordFix, EditClip, EditDoc, EditDocLayer, LayerStyle, LayerTransform, PutEditorBody } from '@maquina/contratos';
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

export class EditDocLayerDto implements EditDocLayer {
  @IsString() @MaxLength(64) id: string;
  @IsOptional() @IsBoolean() visible?: boolean;
  @Opcional() @IsObject() @ValidateNested() @Type(() => LayerTransformDto) transform?: LayerTransformDto | null;
  @Opcional() @IsObject() @ValidateNested() @Type(() => LayerTimingDto) timing?: LayerTimingDto | null;
  /** ≤ 300 é regra do validarDoc (doc_too_large); aqui só o teto de segurança. */
  @IsOptional() @IsString() @MaxLength(5000) text?: string;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => LayerStyleDto) style?: LayerStyleDto;
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

export class EditDocDto implements EditDoc {
  @IsIn([1]) version: 1;
  @IsArray() @ValidateNested({ each: true }) @Type(() => EditClipDto) clips: EditClipDto[];
  @NullOk() @IsDefined() @IsObject() @ValidateNested() @Type(() => EditTrimDto) trim: EditTrimDto | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => EditDocLayerDto) layers: EditDocLayerDto[];
  @IsArray() @ValidateNested({ each: true }) @Type(() => CaptionWordFixDto) captionWords: CaptionWordFixDto[];
}

export class PutEditorDto implements PutEditorBody {
  @IsInt() @Min(0) baseRevision: number;
  /** null = voltar tudo ao padrão. Obrigatório (ausente = 400). */
  @NullOk() @IsDefined() @IsObject() @ValidateNested() @Type(() => EditDocDto) doc: EditDocDto | null;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => UpdateEditDto) settings?: UpdateEditDto;
}
