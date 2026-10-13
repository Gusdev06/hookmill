import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { ZipController } from './zip.controller';
import { ZipService } from './zip.service';

/** Zip do lote AUTO (variacao-auto-v1 §5.1). O módulo iteracao (B1) importa este pra montar `IterateBatch.zip` (ZipService.view). */
@Module({ imports: [JobsModule], controllers: [ZipController], providers: [ZipService], exports: [ZipService] })
export class ZipModule {}
