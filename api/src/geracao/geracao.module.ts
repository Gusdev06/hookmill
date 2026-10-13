import { Module } from '@nestjs/common';
import { EdicaoModule } from '../edicao/edicao.module';
import { MedicaoModule } from '../medicao';
import { RostosModule } from '../rostos/rostos.module';
import { CatalogoController, GeracaoController } from './geracao.controller';
import { GeracaoService } from './geracao.service';
import { OrquestradorService } from './orquestrador.service';
import { TakeService } from './take.service';
import { TrocaService } from '../troca/troca.service';

@Module({
  imports: [EdicaoModule, RostosModule, MedicaoModule],
  controllers: [CatalogoController, GeracaoController],
  providers: [GeracaoService, OrquestradorService, TakeService, TrocaService],
  exports: [GeracaoService, OrquestradorService, TakeService, TrocaService],
})
export class GeracaoModule {}
