import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Auth, AuthContext, Roles } from '../common/auth/auth-context';
import { ExpensiveAction } from '../common/throttle/app-throttler.guard';
import { IteracaoService } from '../iteracao/iteracao.service';
import { ApproveAiPreviewsDto, RegenerateAiPreviewDto, RetryAiPreviewDto } from './previews.dto';
import { AiPreviewsService } from './previews.service';
import { TemplatesAiService } from './templates-ai.service';

/**
 * templates-ia-previas-v1 §5.3–§5.5: as 3 escritas das prévias. Workspace do token (outro workspace = 404); CLIENT só lê
 * (403). `AI_PREVIEWS=off` = 404. Status por polling de `GET /iterate/:id` (`IterateBatch.ai`).
 */
@ApiTags('iterate')
@ApiBearerAuth()
@Controller('iterate/:id/ai-previews')
export class AiPreviewsController {
  constructor(
    private readonly previews: AiPreviewsService,
    private readonly ai: TemplatesAiService,
    private readonly iteracao: IteracaoService,
  ) {}

  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @HttpCode(202) @Post('approve')
  async approve(@Auth() auth: AuthContext, @Param('id') id: string, @Body() dto: ApproveAiPreviewsDto) {
    const approved = await this.previews.approve(auth, id, dto);
    for (const itemId of approved) void this.ai.advanceProduction(itemId).catch(() => undefined); // o sweep retoma se cair
    return this.iteracao.get(auth, id);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @HttpCode(202) @Post(':previewId/regenerate')
  regenerate(@Auth() auth: AuthContext, @Param('id') id: string, @Param('previewId') previewId: string, @Body() dto: RegenerateAiPreviewDto) {
    return this.previews.regenerate(auth, id, previewId, dto);
  }

  @Roles('OWNER', 'ADMIN', 'MEMBER') @ExpensiveAction() @HttpCode(202) @Post(':previewId/retry')
  retry(@Auth() auth: AuthContext, @Param('id') id: string, @Param('previewId') previewId: string, @Body() dto: RetryAiPreviewDto) {
    return this.previews.retry(auth, id, previewId, dto);
  }
}
