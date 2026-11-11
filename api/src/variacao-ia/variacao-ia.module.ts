import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { JobsModule } from '../jobs/jobs.module';
import { integracoesMode } from '../integracoes';
import { LiveSemanticPlanner, SEMANTIC_PLANNER, type SemanticPlannerPort } from '../integracoes/claude/semantic-planner';
import { buildLlmTransport } from '../integracoes/claude/transporte-kie';
import { MockSemanticPlanner } from '../integracoes/mock/semantic-planner';
import { PrismaCostStore } from '../integracoes/store/prisma.store';
import { VariacaoIaController } from './variacao-ia.controller';
import { VariacaoIaService } from './variacao-ia.service';

@Module({
  exports: [SEMANTIC_PLANNER],
  imports: [JobsModule], controllers: [VariacaoIaController],
  providers: [VariacaoIaService, {
    provide: SEMANTIC_PLANNER,
    inject: [PrismaService, ConfigService],
    useFactory: (db: PrismaService, cfg: ConfigService): SemanticPlannerPort => {
      if (integracoesMode() === 'mock') return new MockSemanticPlanner();
      const model = cfg.get<string>('ANTHROPIC_MODEL') || 'claude-opus-5-5';
      // Chamada única, timeout do SDK, sem repetir gasto por retry/fallback silencioso. 11/11: CLAUDE_PROVIDER=kie → Kie.
      const transport = buildLlmTransport((k) => cfg.get<string>(k), { model, effort: 'medium', fallbacks: false, maxRetries: 0, timeoutMs: 120000 });
      return new LiveSemanticPlanner(transport, new PrismaCostStore(db), model);
    },
  }],
})
export class VariacaoIaModule {}
