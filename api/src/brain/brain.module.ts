import { Module } from '@nestjs/common';
import { BrainCache } from './brain.cache';
import { BrainController } from './brain.controller';
import { BrainService } from './brain.service';

/** Brain 3D v1 (B5). Prisma, AppConfig e StorageService vêm de módulos globais. */
@Module({
  controllers: [BrainController],
  providers: [BrainService, BrainCache],
  exports: [BrainService],
})
export class BrainModule {}
