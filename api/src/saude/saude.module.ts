import { Controller, Get, Module, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/auth/auth-context';
import { SkipThrottle } from '@nestjs/throttler';
import { StorageService } from '../arquivos/storage.service';
import { PrismaService } from '../prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const VERSION: string = require('../../package.json').version;

@ApiTags('health')
@Controller('health')
export class SaudeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Healthcheck do EasyPanel: 200 se banco e storage respondem, 503 se não. */
  @Public() @SkipThrottle() @Get()
  async health(@Res({ passthrough: true }) res: Response) {
    const [db, storage] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      this.storage.ping(),
    ]);
    const ok = db && storage;
    if (!ok) res.status(503);
    return { ok, db, storage, version: VERSION };
  }
}

@Module({ controllers: [SaudeController] })
export class SaudeModule {}
