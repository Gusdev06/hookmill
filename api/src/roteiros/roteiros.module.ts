import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { RoteirosController } from './roteiros.controller';
import { RoteirosService } from './roteiros.service';

@Module({ imports: [JobsModule], controllers: [RoteirosController], providers: [RoteirosService], exports: [RoteirosService] })
export class RoteirosModule {}
