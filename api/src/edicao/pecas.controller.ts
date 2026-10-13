// Rotas da peça do lote AUTO (variacao-auto-v1 §5.1). Workspace sempre do token; peça de outro workspace = 404.
import { Body, Controller, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { RetryPieceBody, UpdatePieceBody } from '@maquina/contratos';
import { IsBoolean, IsOptional } from 'class-validator';
import { Auth, AuthContext, ClientAllowed } from '../common/auth/auth-context';
import { EmptyDto } from './edicao.dto';
import { PecasAutoService } from './pecas.service';

export class RetryPieceDto implements RetryPieceBody {
  @IsOptional() @IsBoolean() useProductPhoto?: boolean;
}
export class UpdatePieceDto implements UpdatePieceBody {
  @IsBoolean() inZip: boolean;
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

  /** "In zip" / "Leave out of zip" · todos */
  @ClientAllowed() @Patch(':pieceId')
  update(@Auth() auth: AuthContext, @Param('pieceId') id: string, @Body() dto: UpdatePieceDto) {
    return this.pecas.setInZip(auth, id, dto.inZip);
  }
}
