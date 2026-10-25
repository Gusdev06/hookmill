import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth, AuthContext, ClientAllowed, Public, Roles } from '../common/auth/auth-context';
import { Paginated } from '../common/http/envelope.interceptor';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { MetaConexaoService } from './conexao.service';
import { MetaModeGuard } from './meta-mode.guard';
import {
  MetaActivateDto, MetaAdsQueryDto, MetaConnectDto, MetaEmptyDto, MetaOptionsQueryDto, MetaPublicationsQueryDto, MetaPublishDto, MetaSelectionDto, MetaSummaryQueryDto,
} from './meta.dto';
import { MetaPublicacaoService } from './publicacao.service';
import { MetaSyncService } from './sync.service';

/**
 * meta-v1.md §3: conexão (OWNER/ADMIN), leitura (todos; sync também MEMBER), publicações. Papéis do api.md 21/10:
 * CLIENT só GET (nenhuma rota de escrita leva @ClientAllowed; health não escreve na Meta e é "todos"); ativar/pausar =
 * OWNER/ADMIN (D11). META_MODE=off: MetaModeGuard responde 503 em toda rota do módulo (§3.4/§8).
 */
@ApiTags('meta')
@ApiBearerAuth()
@UseGuards(MetaModeGuard)
@Controller('meta')
export class MetaController {
  constructor(
    private readonly conexao: MetaConexaoService,
    private readonly sync: MetaSyncService,
    private readonly publicacao: MetaPublicacaoService,
  ) {}

  @Roles('OWNER', 'ADMIN') @HttpCode(201) @Post('connect')
  connect(@Auth() auth: AuthContext, @Body() dto: MetaConnectDto) {
    return this.conexao.connect(auth, dto);
  }

  /** Pública (volta do Facebook Login): só navegação, nunca JSON. */
  @Public() @Get('callback')
  async callback(@Query() q: Record<string, string | undefined>, @Res() res: Response) {
    res.redirect(302, await this.conexao.callback(q));
  }

  @Get('connection')
  connection(@Auth() auth: AuthContext) {
    return this.conexao.get(auth);
  }

  /** §3.1 (22/10) "Connect from another browser": a aba de origem faz polling aqui (3 s) enquanto `pending`. Todos os papéis. */
  @Get('oauth/status')
  oauthStatus(@Auth() auth: AuthContext) {
    return this.conexao.oauthStatus(auth.workspaceId);
  }

  @Roles('OWNER', 'ADMIN') @Get('options')
  options(@Auth() auth: AuthContext, @Query() q: MetaOptionsQueryDto) {
    return this.conexao.options(auth, q.adAccountId);
  }

  /** Grava a escolha, roda o health e dispara o 1º sync (§3.1). */
  @Roles('OWNER', 'ADMIN') @Put('selection')
  async selection(@Auth() auth: AuthContext, @Body() dto: MetaSelectionDto) {
    const r = await this.conexao.select(auth, dto);
    if (r.firstSync && r.connection.adAccountId && r.connection.pageId) await this.sync.startIfIdle(r.connection, auth.userId);
    return this.conexao.present((await this.conexao.row(auth.workspaceId))!);
  }

  /** §3.1 "todos": inclusive CLIENT (@ClientAllowed; só lê a Meta e grava o lastHealth do próprio workspace). */
  @ClientAllowed() @HttpCode(200) @Post('health')
  health(@Auth() auth: AuthContext, @Body() _dto: MetaEmptyDto) {
    return this.conexao.health(auth);
  }

  @Roles('OWNER', 'ADMIN') @Delete('connection')
  disconnect(@Auth() auth: AuthContext) {
    return this.conexao.disconnect(auth);
  }

  /** 202 com job novo; 200 com o job em andamento se já há sync rodando. */
  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @Post('sync')
  async startSync(@Auth() auth: AuthContext, @Body() _dto: MetaEmptyDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.sync.start(auth);
    res.status(r.created ? 202 : 200);
    return { job: r.job };
  }

  @Get('ads')
  async ads(@Auth() auth: AuthContext, @Query() q: MetaAdsQueryDto) {
    const r = await this.sync.ads(auth, q);
    return new Paginated(r.items, r.meta);
  }

  @Get('summary')
  summary(@Auth() auth: AuthContext, @Query() q: MetaSummaryQueryDto) {
    return this.sync.summary(auth, q.period ?? '30d');
  }

  @Get('publications')
  async publications(@Auth() auth: AuthContext, @Query() q: MetaPublicationsQueryDto) {
    const r = await this.publicacao.list(auth, q);
    return new Paginated(r.items, { nextCursor: r.nextCursor });
  }
}

/** meta-v1.md §3.3: publicação de um criativo (prefixo /creatives/:id/meta). */
@ApiTags('meta')
@ApiBearerAuth()
@UseGuards(MetaModeGuard)
@Controller('creatives/:id/meta')
export class CreativeMetaController {
  constructor(private readonly publicacao: MetaPublicacaoService) {}

  @Get()
  get(@Auth() auth: AuthContext, @Param('id') id: string) {
    return this.publicacao.creativeMeta(auth, id);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @HttpCode(202) @Post('publish')
  publish(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: MetaPublishDto) {
    return this.publicacao.publish(auth, id, dto);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @HttpCode(202) @Post('retry')
  retry(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: MetaEmptyDto) {
    return this.publicacao.retry(auth, id);
  }

  /** D11: ativar é o que gasta dinheiro do cliente. */
  @Roles('OWNER', 'ADMIN') @HttpCode(200) @Post('activate')
  activate(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: MetaActivateDto) {
    return this.publicacao.activate(auth, id);
  }

  @Roles('OWNER', 'ADMIN') @HttpCode(200) @Post('pause')
  pause(@Auth() auth: AuthContext, @Param('id') id: string, @Body() _dto: MetaEmptyDto) {
    return this.publicacao.pause(auth, id);
  }
}
