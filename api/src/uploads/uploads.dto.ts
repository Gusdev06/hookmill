import type { CreateUploadBody } from '@maquina/contratos';
import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** `PRODUCT_IMAGE` (variacao-auto-v1 D4) e `BRAND_*` (kit-marca-v1 §2). */
export const UPLOAD_PURPOSES = ['CHAMPION_VIDEO', 'PRODUCT_IMAGE', 'BRAND_LOGO', 'BRAND_FILE', 'BRAND_VIDEO'] as const;
export class CreateUploadDto implements CreateUploadBody {
  @IsIn(UPLOAD_PURPOSES) purpose: (typeof UPLOAD_PURPOSES)[number];
  @IsString() @MinLength(1) @MaxLength(255) filename: string;
  /** mime fora de mp4/mov (vídeo) ou jpeg/png/webp (foto) = 422 MEDIA_INVALID { reason: 'mime' } (no service, não 400). */
  @IsString() @MinLength(1) @MaxLength(100) mimeType: string;
  @IsInt() @Min(1) sizeBytes: number;
}
