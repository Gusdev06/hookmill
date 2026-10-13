import type { CreateUploadBody } from '@maquina/contratos';
import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';

/** `PRODUCT_IMAGE` (variacao-auto-v1 D4, api.md "Mudanças 13/10"): o CreateUploadBody do @maquina/contratos ainda só
 *  diz 'CHAMPION_VIDEO' (pendência do A0); o resto do corpo é o mesmo. */
export class CreateUploadDto implements Omit<CreateUploadBody, 'purpose'> {
  @IsIn(['CHAMPION_VIDEO', 'PRODUCT_IMAGE']) purpose: 'CHAMPION_VIDEO' | 'PRODUCT_IMAGE';
  @IsString() @MinLength(1) @MaxLength(255) filename: string;
  /** mime fora de mp4/mov (vídeo) ou jpeg/png/webp (foto) = 422 MEDIA_INVALID { reason: 'mime' } (no service, não 400). */
  @IsString() @MinLength(1) @MaxLength(100) mimeType: string;
  @IsInt() @Min(1) sizeBytes: number;
}
