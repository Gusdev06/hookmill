import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, Roles } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { AppException } from '../common/errors/app-exception';
import { Paginated } from '../common/http/envelope.interceptor';
import { CreateIterateDto, EmptyBodyDto, StartIterateDto, UpdateAnswersDto, SelectItemDto, UpdateItemTextsDto, UpdateListOptionsDto } from './iteracao.dto';
import { IteracaoService } from './iteracao.service';
import { IteracaoListaService, ListIterateQueryDto } from './lista.service';

/**
 * Variação automática de campeão (variacao-auto-v1.md §5.1): o lote. Workspace sempre do token; CLIENT só lê (o config
 * é de quem gera: todos menos CLIENT). Peças (`/iterate/pieces/*`) e zip (`/iterate/:id/zip`) são do B2 (edicao, zip*).
 */
@ApiTags('iterate')
@ApiBearerAuth()
@Controller('iterate')
export class IteracaoController {
  constructor(
    private readonly iteracao: IteracaoService,
    private readonly lista: IteracaoListaService,
  ) {}

  /** lacunas-home-eddy-v1 §5: lista de lotes (updatedAt desc). Todos os papéis (só leitura). */
  @Get()
  async list(@Auth() auth: AuthContext, @Query() q: ListIterateQueryDto) {
    const r = await this.lista.list(auth, q);
    return new Paginated(r.data, r.meta); // envelope { success, data: IterateBatchRow[], meta: { nextCursor } }
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Get('config')
  config(@Auth() auth: AuthContext) {
    return this.iteracao.config(auth);
  }

  @ExpensiveAction() @HttpCode(202) @Post()
  create(@Auth() auth: AuthContext, @Body() dto: CreateIterateDto) {
    return this.iteracao.create(auth, dto);
  }

  @Roles('OWNER', 'ADMIN') @Get('preferences')
  preferences(@Auth() auth: AuthContext) { return this.iteracao.preferences(auth); }

  @Roles('OWNER', 'ADMIN') @HttpCode(204) @Delete('preferences')
  forgetPreferences(@Auth() auth: AuthContext) { return this.iteracao.forgetPreferences(auth); }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Put(':id/answers')
  answers(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: UpdateAnswersDto) {
    return this.iteracao.answers(auth, id, dto.answers, dto.save !== false);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @Patch(':id/items/:itemId')
  select(@Auth() auth: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: SelectItemDto) {
    return this.iteracao.select(auth, id, itemId, dto.included);
  }

  /** templates-creditos-v1 A7: editar o texto de uma peça no Plan (FRAME/HEADLINE), grátis. Só PLAN_READY. */
  @Roles('OWNER', 'ADMIN', 'MEMBER') @Patch(':id/items/:itemId/texts')
  updateTexts(@Auth() auth: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: UpdateItemTextsDto) {
    return this.iteracao.updateTexts(auth, id, itemId, dto.texts);
  }

  /** templates-lista-v1 §5: look, colunas e "Fill from Brain" de uma peça LIST_OVERLAY no Plan, grátis. Só PLAN_READY. */
  @Roles('OWNER', 'ADMIN', 'MEMBER') @Patch(':id/items/:itemId/list')
  updateList(@Auth() auth: AuthContext, @Param('id') id: string, @Param('itemId') itemId: string, @Body() dto: UpdateListOptionsDto) {
    return this.iteracao.updateListOptions(auth, id, itemId, dto);
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

  /** troca-texto-queimado-v1 §15.3: "Gerar mesmo assim" saiu. 410 por uma versão, com qualquer corpo; depois as rotas somem. */
  @Post(':id/caption-blocked/force')
  forceCaption(): never {
    throw new AppException('CAPTION_FORCE_RETIRED');
  }

  @Delete(':id/caption-blocked/force')
  unforceCaption(): never {
    throw new AppException('CAPTION_FORCE_RETIRED');
  }

  @HttpCode(202) @Post(':id/start')
  start(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: StartIterateDto) {
    return this.iteracao.start(auth, id, dto.expectedPieces, dto.expectedCostUsd, dto.expectedCredits);
  }

}
