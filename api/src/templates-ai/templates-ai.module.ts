import { Module } from '@nestjs/common';
import { GeracaoModule } from '../geracao/geracao.module';
import { IteracaoModule } from '../iteracao/iteracao.module';
import { JobsModule } from '../jobs/jobs.module';
import { VariacaoIaModule } from '../variacao-ia/variacao-ia.module';
import { TEMPLATE_AI_RUNNER } from './contract';
import { AiPreviewsController } from './previews.controller';
import { AiPreviewsService } from './previews.service';
import { TemplatesAiService } from './templates-ai.service';

@Module({
  imports: [GeracaoModule, JobsModule, VariacaoIaModule, IteracaoModule], // IteracaoModule: as rotas de prévia devolvem o IterateBatch
  controllers: [AiPreviewsController], // templates-ia-previas-v1 §5.3–§5.5: /iterate/:id/ai-previews/*
  providers: [TemplatesAiService, AiPreviewsService, { provide: TEMPLATE_AI_RUNNER, useExisting: TemplatesAiService }],
  exports: [TemplatesAiService, AiPreviewsService, TEMPLATE_AI_RUNNER],
})
export class TemplatesAiModule {}
