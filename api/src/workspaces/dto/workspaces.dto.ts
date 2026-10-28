import type {
  BusinessType, CreateClientBody, ResultType, CreateInviteBody, OnboardingStep, Role, UpdateMemberBody, UpdateWorkspaceBody,
} from '@maquina/contratos';
import {
  IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { SHORT_CODE_RE } from '../cliente';
import { RESULT_OTHER_MAX, RESULT_TYPES } from '../resultado';

const BUSINESS_TYPES: BusinessType[] = ['ONLINE_STORE', 'LOCAL_BUSINESS', 'APP'];
const URL_OPTS = { protocols: ['http', 'https'], require_protocol: true };
export const BRAND_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
/** Campo que não aceita null: só valida quando veio (undefined = não mexe). */
const Present = () => ValidateIf((_, v) => v !== undefined);

export class UpdateWorkspaceDto implements UpdateWorkspaceBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['EN', 'PT_BR']) uiLocale?: 'EN' | 'PT_BR';
  /** null = sem teto */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1_000_000)
  monthlySpendCapUsd?: number | null;
  // fase2-agencia.md §3.3
  @Present() @IsString() @Matches(SHORT_CODE_RE) shortCode?: string;
  /** null limpa */
  @IsOptional() @IsString() @MaxLength(80) industry?: string | null;
  @IsOptional() @IsString() @MaxLength(80) market?: string | null;
  /** resultado-v1 (28/10): null limpa; OTHER exige resultTypeOther (conferido no service, no estado final) */
  @IsOptional() @IsIn(RESULT_TYPES) resultType?: ResultType | null;
  @IsOptional() @IsString() @MaxLength(RESULT_OTHER_MAX) resultTypeOther?: string | null;
  /** @deprecated: sem resultType no corpo, migra pelo RESULT_FROM_LEGACY */
  @IsOptional() @IsIn(BUSINESS_TYPES) businessType?: BusinessType | null;
  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(2048) websiteUrl?: string | null;
  /** 25/10 (estatico-montado-e-molduras-v1 D3): `#RGB`/`#RRGGBB` (o service normaliza pra 6 dígitos maiúsculos); null limpa */
  @IsOptional() @IsString() @Matches(BRAND_COLOR_RE, { message: 'brandColor must be #RGB or #RRGGBB' }) brandColor?: string | null;
  @Present() @IsInt() @Min(1) @Max(6) onboardingStep?: OnboardingStep;
  /** true grava pausedAt; false limpa */
  @Present() @IsBoolean() paused?: boolean;
}

export class CreateClientDto implements CreateClientBody {
  @IsString() @MinLength(1) @MaxLength(80) name: string;
  @IsOptional() @IsString() @Matches(SHORT_CODE_RE) shortCode?: string;
  @IsOptional() @IsIn(['EN', 'PT_BR']) uiLocale?: 'EN' | 'PT_BR';
  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(2048) websiteUrl?: string;
  @IsOptional() @IsString() @MaxLength(80) industry?: string;
  @IsOptional() @IsString() @MaxLength(80) market?: string;
  @IsOptional() @IsIn(RESULT_TYPES) resultType?: ResultType;
  @IsOptional() @IsString() @MaxLength(RESULT_OTHER_MAX) resultTypeOther?: string;
  /** @deprecated */
  @IsOptional() @IsIn(BUSINESS_TYPES) businessType?: BusinessType;
  @IsOptional() @IsString() @Matches(BRAND_COLOR_RE, { message: 'brandColor must be #RGB or #RRGGBB' }) brandColor?: string;
  /** padrão true (D3) */
  @IsOptional() @IsBoolean() copyTeam?: boolean;
}

export class CreateInviteDto implements CreateInviteBody {
  @IsEmail() @MaxLength(254) email: string;
  @IsIn(['ADMIN', 'MEMBER', 'CLIENT']) role: 'ADMIN' | 'MEMBER' | 'CLIENT';
}

export class UpdateMemberDto implements UpdateMemberBody {
  @IsIn(['OWNER', 'ADMIN', 'MEMBER', 'CLIENT']) role: Role;
}

export class SpendQueryDto {
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month?: string;
}
