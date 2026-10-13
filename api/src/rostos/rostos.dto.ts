import type { FaceCount, FaceDescriptionBody, GenerateFacesBody } from '@maquina/contratos';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** §13.13: 1-4 rostos por geração; fora disso = 400. O padrão depende da rota (v1: 4; elenco: 1). */
export const FACE_COUNTS: FaceCount[] = [1, 2, 3, 4];

export class GenerateFacesDto implements GenerateFacesBody {
  @IsString() @MinLength(10) @MaxLength(600) description: string;
  @IsOptional() @IsIn(FACE_COUNTS) count?: FaceCount;
}

/** Autosave do campo: aceita rascunho curto; o mínimo de 10 vale só pra gerar. */
export class FaceDescriptionDto implements FaceDescriptionBody {
  @IsString() @MaxLength(600) description: string;
}
