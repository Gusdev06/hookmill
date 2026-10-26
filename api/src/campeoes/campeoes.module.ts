import { VersaoSemLegendaService } from './versao-sem-legenda';
import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { MedicaoModule } from '../medicao';
import { UploadsModule } from '../uploads/uploads.module';
import { AnaliseService } from './analise.service';
import { CampeoesController } from './campeoes.controller';
import { CampeoesService } from './campeoes.service';
import { ChampionStateMachine } from './champion-state-machine';
import { ChampionViews } from './champion-views';
import { AD_LIBRARY_SERVICE } from '../integracoes';
import { AD_LIBRARY } from './portas';

@Module({
  imports: [JobsModule, UploadsModule, MedicaoModule],
  controllers: [CampeoesController],
  providers: [
    CampeoesService, AnaliseService, ChampionStateMachine, ChampionViews, VersaoSemLegendaService,
    // AdLibraryService da integracoes (mock | live | off por AD_LIBRARY_MODE); testes trocam pelo token do backend
    { provide: AD_LIBRARY, useExisting: AD_LIBRARY_SERVICE },
  ],
  exports: [CampeoesService, AnaliseService, ChampionStateMachine, ChampionViews, VersaoSemLegendaService, AD_LIBRARY, MedicaoModule],
})
export class CampeoesModule {}
