import { Module } from '@nestjs/common';
import { GeracaoModule } from '../geracao/geracao.module';
import { JobsModule } from '../jobs/jobs.module';
import { VariacaoIaModule } from '../variacao-ia/variacao-ia.module';
import { TEMPLATE_AI_RUNNER } from './contract';
import { TemplatesAiService } from './templates-ai.service';

@Module({
  imports: [GeracaoModule, JobsModule, VariacaoIaModule],
  providers: [TemplatesAiService, { provide: TEMPLATE_AI_RUNNER, useExisting: TemplatesAiService }],
  exports: [TemplatesAiService, TEMPLATE_AI_RUNNER],
})
export class TemplatesAiModule {}
