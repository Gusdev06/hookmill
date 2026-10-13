import { Module } from '@nestjs/common';
import { EdicaoModule } from '../edicao/edicao.module';
import { GeracaoModule } from '../geracao/geracao.module';
import { JobsModule } from '../jobs/jobs.module';
import { RoteirosModule } from '../roteiros/roteiros.module';
import { RostosModule } from '../rostos/rostos.module';
import { CampeoesModule } from '../campeoes/campeoes.module';
import { VariacoesModule } from '../variacoes/variacoes.module';
import { IteracaoModule } from '../iteracao/iteracao.module';
import { RecuperacaoService } from './recuperacao.service';

@Module({ imports: [JobsModule, RoteirosModule, RostosModule, GeracaoModule, EdicaoModule, CampeoesModule, VariacoesModule, IteracaoModule], providers: [RecuperacaoService], exports: [RecuperacaoService] })
export class RecuperacaoModule {}
