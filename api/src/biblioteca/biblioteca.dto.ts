import type { FormatCode, VariationKind, WinnerBody } from '@maquina/contratos';
import type { LibraryQueryAuto } from '../criativos/contrato-auto';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PageQueryDto } from '../common/http/pagination';

export class LibraryQueryDto extends PageQueryDto implements LibraryQueryAuto {
  @IsOptional() @IsString() @MaxLength(64) offerId?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() winners?: boolean;
  @IsOptional() @IsString() @MaxLength(64) championId?: string;
  @IsOptional() @IsIn(['SWAP_AVATAR', 'NEW_HOOKS', 'COPY_NEW', 'REMIX_EDIT', 'AUTO_EDIT']) variationKind?: VariationKind;
  /** variacao-auto-v1 §5.1: código da peça ("CUT-15S") */
  @IsOptional() @IsString() @MaxLength(40) variationCode?: string;
  /** só vídeo (exclui a peça STATIC): "Pick from your Library" */
  @IsOptional() @IsIn(['video']) media?: 'video';
}

/** GET /creatives/:id/download?format=9x16|4x5|1x1 (padrão 9x16; só a peça AUTO tem os 3). */
export class DownloadQueryDto {
  @IsOptional() @IsIn(['9x16', '4x5', '1x1']) format?: FormatCode;
}

export class WinnerDto implements WinnerBody {
  @IsBoolean() isWinner: boolean;
}
