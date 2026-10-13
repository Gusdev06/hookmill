import type {
  BusinessType, CreateClientBody, CreateInviteBody, OnboardingStep, Role, UpdateMemberBody, UpdateWorkspaceBody,
} from '@maquina/contratos';
import {
  IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';
import { SHORT_CODE_RE } from '../cliente';

const BUSINESS_TYPES: BusinessType[] = ['ONLINE_STORE', 'LOCAL_BUSINESS', 'APP'];
const URL_OPTS = { protocols: ['http', 'https'], require_protocol: true };
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
  @IsOptional() @IsIn(BUSINESS_TYPES) businessType?: BusinessType | null;
  @IsOptional() @IsUrl(URL_OPTS) @MaxLength(2048) websiteUrl?: string | null;
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
  @IsOptional() @IsIn(BUSINESS_TYPES) businessType?: BusinessType;
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
