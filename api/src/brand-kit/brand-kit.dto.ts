import type { BrandAssetKind, CreateBrandAssetBody, UpdateBrandAssetBody } from '@maquina/contratos';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { BRAND_LABEL_MAX } from './limites';

/** string ou null (null limpa); ausente = não muda */
const Nullable = (max: number) => (target: object, key: string) => {
  IsOptional()(target, key);
  ValidateIf((_, v) => v !== null)(target, key);
  IsString()(target, key);
  MaxLength(max)(target, key);
};

export class CreateBrandAssetDto implements CreateBrandAssetBody {
  @IsIn(['LOGO', 'FILE', 'DEMO_VIDEO']) kind: BrandAssetKind;
  @IsString() @MinLength(1) @MaxLength(64) uploadId: string;
  @Nullable(BRAND_LABEL_MAX) label?: string | null;
  @Nullable(64) offerId?: string | null;
}

export class UpdateBrandAssetDto implements UpdateBrandAssetBody {
  @Nullable(BRAND_LABEL_MAX) label?: string | null;
  @Nullable(64) offerId?: string | null;
}
