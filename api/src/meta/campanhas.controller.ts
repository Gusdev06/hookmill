import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, Roles } from '../common/auth/auth-context';
import { Paginated } from '../common/http/envelope.interceptor';
import { MetaCampanhasService } from './campanhas.service';
import { MetaEscritaService } from './escrita.service';
import { MetaBudgetDto, MetaCampaignDetailQueryDto, MetaCampaignsQueryDto, MetaChangesQueryDto, MetaStatusDto } from './meta.dto';
import { MetaModeGuard } from './meta-mode.guard';

/**
 * campanhas-v1 §4: leitura (todos, inclusive CLIENT: só GET) e escrita (OWNER/ADMIN, D5; nenhuma rota de escrita leva
 * @ClientAllowed). META_MODE=off = 503 em tudo (MetaModeGuard). As escritas passam pelo MetaEscritaService (§4 passos 1-6).
 */
@ApiTags('meta')
@ApiBearerAuth()
@UseGuards(MetaModeGuard)
@Controller('meta')
export class MetaCampanhasController {
  constructor(
    private readonly campanhas: MetaCampanhasService,
    private readonly escrita: MetaEscritaService,
  ) {}

  @Get('campaigns')
  async list(@Auth() auth: AuthContext, @Query() q: MetaCampaignsQueryDto) {
    const r = await this.campanhas.list(auth, q);
    return new Paginated(r.items, r.meta);
  }

  @Get('campaigns/:campaignId')
  detail(@Auth() auth: AuthContext, @Param('campaignId') id: string, @Query() q: MetaCampaignDetailQueryDto) {
    return this.campanhas.detail(auth, id, q.period ?? '30d');
  }

  @Get('changes')
  async changes(@Auth() auth: AuthContext, @Query() q: MetaChangesQueryDto) {
    const r = await this.campanhas.changes(auth, q);
    return new Paginated(r.items, { nextCursor: r.nextCursor });
  }

  @Roles('OWNER', 'ADMIN') @HttpCode(200) @Post('campaigns/:id/status')
  campaignStatus(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: MetaStatusDto) {
    return this.escrita.setStatus(auth, 'campaign', id, dto);
  }

  @Roles('OWNER', 'ADMIN') @HttpCode(200) @Post('adsets/:id/status')
  adsetStatus(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: MetaStatusDto) {
    return this.escrita.setStatus(auth, 'adset', id, dto);
  }

  @Roles('OWNER', 'ADMIN') @HttpCode(200) @Post('ads/:id/status')
  adStatus(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: MetaStatusDto) {
    return this.escrita.setStatus(auth, 'ad', id, dto);
  }

  @Roles('OWNER', 'ADMIN') @Patch('campaigns/:id/budget')
  campaignBudget(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: MetaBudgetDto) {
    return this.escrita.setBudget(auth, 'campaign', id, dto);
  }

  @Roles('OWNER', 'ADMIN') @Patch('adsets/:id/budget')
  adsetBudget(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: MetaBudgetDto) {
    return this.escrita.setBudget(auth, 'adset', id, dto);
  }
}
