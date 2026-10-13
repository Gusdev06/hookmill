import { Module } from '@nestjs/common';
import { GeracaoModule } from '../geracao/geracao.module';
import { RevisaoController } from './revisao.controller';
import { RevisaoService } from './revisao.service';

@Module({ imports: [GeracaoModule], controllers: [RevisaoController], providers: [RevisaoService] })
export class RevisaoModule {}
