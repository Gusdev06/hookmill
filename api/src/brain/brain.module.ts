import { Module } from '@nestjs/common';
import { BrainCache } from './brain.cache';
import { BrainController } from './brain.controller';
import { BrainService } from './brain.service';

/**
 * Brain 3D v1 (B5). Prisma, AppConfig e StorageService vêm de módulos globais.
 * brain-preenchido-v1: exporta o BrainCache pro kit, ofertas e workspaces derrubarem o cache na escrita (não importa ninguém: sem ciclo).
 */
@Module({
  controllers: [BrainController],
  providers: [BrainService, BrainCache],
  exports: [BrainService, BrainCache],
})
export class BrainModule {}
