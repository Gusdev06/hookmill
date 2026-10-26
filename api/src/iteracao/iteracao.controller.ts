import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, Roles } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { CreateIterateDto, EmptyBodyDto, StartIterateDto } from './iteracao.dto';
import { IteracaoService } from './iteracao.service';

/**
 * Variação automática de campeão (variacao-auto-v1.md §5.1): o lote. Workspace sempre do token; CLIENT só lê (o config
 * é de quem gera: todos menos CLIENT). Peças (`/iterate/pieces/*`) e zip (`/iterate/:id/zip`) são do B2 (edicao, zip*).
 */
@ApiTags('iterate')
@ApiBearerAuth()
@Controller('iterate')
export class IteracaoController {
  constructor(private readonly iteracao: IteracaoService) {}

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Get('config')
  config(@Auth() auth: AuthContext) {
    return this.iteracao.config(auth);
  }

  @ExpensiveAction() @HttpCode(202) @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateIterateDto) {
    return this.iteracao.create(auth, dto);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.iteracao.get(auth, id);
  }

  @ExpensiveAction() @HttpCode(202) @Post(':id/retry')
  retry(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: EmptyBodyDto) {
    return this.iteracao.retry(auth, id);
  }

  /** legenda-protegida-v1 D-LP5: "Replanejar" (ex.: depois da versão sem legenda). Só PLAN_READY. */
  @ExpensiveAction() @HttpCode(202) @Post(':id/replan')
  replan(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: EmptyBodyDto) {
    return this.iteracao.replan(auth, id);
  }

  @HttpCode(202) @Post(':id/start')
  start(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: StartIterateDto) {
    return this.iteracao.start(auth, id, dto.expectedPieces, dto.expectedCostUsd);
  }

}
