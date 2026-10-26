import type {
  AnalyzeChampionBody, AttachChampionVideoBody, ChampionRights, SetCleanVersionBody, CreateChampionBody, ListChampionsQuery, UpdateChampionBody, UpdateTeardownBody,
} from '@maquina/contratos';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PageQueryDto } from '../common/http/pagination';

const RIGHTS = ['OWN', 'THIRD_PARTY'];

export class ListChampionsQueryDto extends PageQueryDto implements ListChampionsQuery {
  @IsOptional() @IsString() @MaxLength(64) offerId?: string;
}

export class CreateChampionDto implements CreateChampionBody {
  @IsString() @MinLength(1) @MaxLength(64) offerId: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(64) uploadId?: string;
  @IsOptional() @IsString() @MaxLength(2000) adLibraryUrl?: string;
  @IsIn(RIGHTS) rights: ChampionRights;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class UpdateChampionDto implements UpdateChampionBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(RIGHTS) rights?: ChampionRights;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}

export class AttachVideoDto implements AttachChampionVideoBody {
  @IsString() @MinLength(1) @MaxLength(64) uploadId: string;
}

/** legenda-protegida-v1 §2.3: POST /champions/:id/clean-version (SetCleanVersionBody). */
export class CleanVersionDto implements SetCleanVersionBody {
  @IsString() @MinLength(1) @MaxLength(64) uploadId: string;
}

export class AnalyzeChampionDto implements AnalyzeChampionBody {
  @IsOptional() @IsBoolean() confirm?: boolean;
}

export class TranscriptWordEditDto {
  @IsInt() @Min(0) index: number;
  @IsString() @MinLength(1) @MaxLength(100) word: string;
}

export class UpdateTeardownDto implements UpdateTeardownBody {
  /** Seções parciais: chaves e forma conferidas no service (cada uma { status, naReason, data }). */
  @IsOptional() @IsObject() sections?: UpdateTeardownBody['sections'];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TranscriptWordEditDto) transcriptWords?: TranscriptWordEditDto[];
}
