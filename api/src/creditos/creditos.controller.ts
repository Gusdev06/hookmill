// templates-creditos-v1 §7: saldo e histórico (todos menos CLIENT) e o crédito manual do admin (só INTERNAL OWNER).
import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { GrantCreditsBody } from '@maquina/contratos';
import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import { Auth, AuthContext, Roles } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { CreditosService } from './creditos.service';

export class PageQueryDto {
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class GrantCreditsDto implements GrantCreditsBody {
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) userId?: string;
  @IsInt() @Min(-10000) @Max(10000) @NotEquals(0) credits: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsString() @MinLength(8) @MaxLength(80) @Matches(/^[A-Za-z0-9._:-]+$/) idempotencyKey: string;
}

@ApiTags('credits')
@ApiBearerAuth()
@Controller('credits')
export class CreditosController {
  constructor(private readonly creditos: CreditosService) {}

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Get()
  summary(@Auth() auth: AuthContext) {
    return this.creditos.summary(auth);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Get('ledger')
  ledger(@Auth() auth: AuthContext, @Query() q: PageQueryDto) {
    return this.creditos.ledger(auth, q.cursor, q.limit);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/credits')
export class AdminCreditosController {
  constructor(private readonly creditos: CreditosService) {}

  /** Exatamente 1 de email/userId (conferido aqui: 400). */
  @Roles('OWNER') @HttpCode(200) @Post('grant')
  grant(@Auth() auth: AuthContext, @Body() dto: GrantCreditsDto) {
    if (!!dto.email === !!dto.userId) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'email', rule: 'exactlyOneOf:email,userId' }] });
    }
    return this.creditos.grant(auth, dto);
  }
}
