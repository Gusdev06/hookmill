import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { RoteirosModule } from '../roteiros/roteiros.module';
import { CriativosController } from './criativos.controller';
import { CriativosService } from './criativos.service';

@Module({ imports: [JobsModule, RoteirosModule], controllers: [CriativosController], providers: [CriativosService] })
export class CriativosModule {}
