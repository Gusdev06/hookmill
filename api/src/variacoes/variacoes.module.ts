import { Module } from '@nestjs/common';
import { CampeoesModule } from '../campeoes/campeoes.module';
import { GeracaoModule } from '../geracao/geracao.module';
import { JobsModule } from '../jobs/jobs.module';
import { RostosModule } from '../rostos/rostos.module';
import { BatchStateMachine } from './batch-state-machine';
import { ChampionBatchesController, VariacoesController } from './variacoes.controller';
import { VariacoesService } from './variacoes.service';
import { VariacoesViews } from './variacoes.views';

@Module({
  imports: [JobsModule, CampeoesModule, GeracaoModule, RostosModule],
  controllers: [ChampionBatchesController, VariacoesController],
  providers: [VariacoesService, VariacoesViews, BatchStateMachine],
  exports: [VariacoesService],
})
export class VariacoesModule {}
