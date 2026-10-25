import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { exigirBancoDeTeste } from '../common/testing/ambiente-teste';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ log: ['warn', 'error'] });
  }
  private readonly log = new Logger('Prisma');

  async onModuleInit() {
    await this.$connect();
    // QA 22/10: dizer no boot em QUAL banco a API está (o env do processo vence o .env; isso deixa visível)
    if (!process.env.JEST_WORKER_ID) {
      const [{ db }] = await this.$queryRaw<{ db: string }[]>`select current_database() as db`;
      this.log.log(`banco: ${db}`);
    }
    // Dentro do Jest, a API só sobe no banco de teste: confere o banco DE VERDADE (não a URL) e falha alto se for outro.
    if (process.env.JEST_WORKER_ID) {
      const [{ db }] = await this.$queryRaw<{ db: string }[]>`select current_database() as db`;
      exigirBancoDeTeste(db, 'PrismaService');
    }
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
