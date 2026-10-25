// Rotas da peça do lote AUTO (variacao-auto-v1 §5.1). Workspace sempre do token; peça de outro workspace = 404.
import { Body, Controller, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RequestPieceFormatBody, RetryPieceBody, UpdatePieceBody } from '@maquina/contratos';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { Auth, AuthContext, ClientAllowed } from '../common/auth/auth-context';
import { EmptyDto } from './edicao.dto';
import { PecasAutoService } from './pecas.service';

export class RetryPieceDto implements RetryPieceBody {
  @IsOptional() @IsBoolean() useProductPhoto?: boolean;
}
export class UpdatePieceDto implements UpdatePieceBody {
  @IsBoolean() inZip: boolean;
}
/** rev. 23/10 §14.2: só 4:5 e 1:1 (o 9:16 nasce no Gerar); `9x16` ou outro valor = 400 VALIDATION_ERROR. */
export class RequestPieceFormatDto implements RequestPieceFormatBody {
  @IsIn(['4x5', '1x1']) format: '4x5' | '1x1';
}

@ApiTags('iterate')
@ApiBearerAuth()
@Controller('iterate/pieces')
export class PecasController {
  constructor(private readonly pecas: PecasAutoService) {}

  /** "Retry" · OWNER, ADMIN, MEMBER */
  @HttpCode(202) @Post(':pieceId/retry')
  retry(@Auth() auth: AuthContext, @Param('pieceId') id: string, @Body() dto: RetryPieceDto) {
    return this.pecas.retry(auth, id, dto);
  }

  /** "Leave out" · OWNER, ADMIN, MEMBER */
  @HttpCode(200) @Post(':pieceId/leave-out')
  leaveOut(@Auth() auth: AuthContext, @Param('pieceId') id: string, @Body() _dto: EmptyDto) {
    return this.pecas.leaveOut(auth, id);
  }

  /** "Make 4:5" / "Make 1:1" e o "Try again" do formato · OWNER, ADMIN, MEMBER (CLIENT 403: o STATIC custa dinheiro). 202 enfileirou · 200 já existia */
  @Post(':pieceId/formats')
  async requestFormat(@Auth() auth: AuthContext, @Param('pieceId') id: string, @Body() dto: RequestPieceFormatDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.pecas.requestFormat(auth, id, dto.format);
    res.status(r.httpStatus);
    return r.piece;
  }

  /** "In zip" / "Leave out of zip" · todos */
  @ClientAllowed() @Patch(':pieceId')
  update(@Auth() auth: AuthContext, @Param('pieceId') id: string, @Body() dto: UpdatePieceDto) {
    return this.pecas.setInZip(auth, id, dto.inZip);
  }
}
