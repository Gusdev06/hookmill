import type { AccountMode, AcceptInviteBody, LoginBody, RefreshBody, SignupBody, SwitchWorkspaceBody, UpdateMeBody } from '@maquina/contratos';
import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

export const ACCOUNT_MODES: readonly AccountMode[] = ['AGENCY', 'OWN'];

export class LoginDto implements LoginBody {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(1) @MaxLength(200) password: string;
}

export class RefreshDto implements RefreshBody {
  @IsString() @MinLength(1) @MaxLength(200) refreshToken: string;
}

export class SwitchWorkspaceDto implements SwitchWorkspaceBody {
  @IsString() @MinLength(1) @MaxLength(64) workspaceId: string;
}

export class AcceptInviteDto implements AcceptInviteBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(200) password?: string;
}

export class PasswordChangeDto {
  @IsString() @MinLength(1) @MaxLength(200) current: string;
  @IsString() @MinLength(10) @MaxLength(200) next: string;
}

export class UpdateMeDto implements UpdateMeBody {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(['EN', 'PT_BR']) uiLocale?: 'EN' | 'PT_BR';
  @IsOptional() @ValidateNested() @Type(() => PasswordChangeDto) password?: PasswordChangeDto;
  /** onboarding-v2 §3.1: AGENCY | OWN. AGENCY → OWN com > 1 membership é permitido (D9, nunca 409). */
  @IsOptional() @IsIn(ACCOUNT_MODES) accountMode?: AccountMode;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** POST /auth/signup (fase2-cadastro.md §2). Senha 10-200: a mesma regra do convite e da troca de senha. */
export class SignupDto implements SignupBody {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name: string;
  @Transform(trim) @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(10) @MaxLength(200) password: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) agencyName?: string;
  @IsOptional() @IsIn(['EN', 'PT_BR']) uiLocale?: 'EN' | 'PT_BR';
  /** onboarding-v2 D8: opcional (a pergunta é a tela /start); se vier, grava. */
  @IsOptional() @IsIn(ACCOUNT_MODES) accountMode?: AccountMode;
}
