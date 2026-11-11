// templates-ia-previas-v1 §5.1/§5.3–§5.5: corpos das rotas de prévia (whitelist global do ValidationPipe).
import type { ApproveAiPreviewsBody, RegenerateAiPreviewBody, RetryAiPreviewBody } from '@maquina/contratos';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

/** `previews` do /use: só a chave (prévias grátis, sem expectedCredits). */
export class AiPreviewsRequestDto {
  @IsUUID('4') requestId: string;
}
export class ApproveAiPreviewsDto implements ApproveAiPreviewsBody {
  @IsUUID('4') requestId: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(64, { each: true }) previewIds: string[];
  @IsInt() @Min(0) @Max(10000) expectedCredits: number;
}
export class RegenerateAiPreviewDto implements RegenerateAiPreviewBody {
  @IsUUID('4') requestId: string;
}
export class RetryAiPreviewDto implements RetryAiPreviewBody {
  @IsUUID('4') requestId: string;
}
