// QA 22/10: "com DATABASE_URL=…/maquina_test no env do processo a API continuou no maquina". Prova de que, no boot real
// (AppConfigModule = ConfigModule.forRoot com envFilePath '.env'), o env do PROCESSO vence o .env — pro DATABASE_URL
// (que o Prisma lê de process.env) e pra qualquer chave lida pelo AppConfig. Chave só no .env continua carregando.
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppConfig } from './app-config';

describe('precedência do env (processo > .env)', () => {
  const cwd = process.cwd();
  const saved = { ...process.env };
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'env-prec-'));
    writeFileSync(join(dir, '.env'), [
      'DATABASE_URL=postgresql://u:p@localhost:5433/maquina?schema=public',
      'META_MODE=live',
      'ONLY_IN_FILE_X=from-file',
    ].join('\n'));
    process.chdir(dir);
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5433/maquina_test?schema=public';
    process.env.META_MODE = 'mock';
    delete process.env.ONLY_IN_FILE_X;
  });
  afterAll(() => {
    process.chdir(cwd);
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('DATABASE_URL e META_MODE do processo vencem o .env; o .env só preenche o que falta', async () => {
    // o forRoot lê o .env quando o módulo é importado: importa DEPOIS do chdir, isolado (como o boot do dist/main.js)
    let AppConfigModule!: typeof import('./config.module').AppConfigModule;
    let Cfg!: typeof ConfigService;
    let App!: typeof AppConfig;
    let T!: typeof Test;
    jest.isolateModules(() => {
      ({ AppConfigModule } = require('./config.module'));
      ({ ConfigService: Cfg } = require('@nestjs/config'));
      ({ AppConfig: App } = require('./app-config'));
      ({ Test: T } = require('@nestjs/testing'));
    });
    const mod = await T.createTestingModule({ imports: [AppConfigModule] }).compile();
    const env = mod.get(Cfg);
    expect(process.env.DATABASE_URL).toContain('/maquina_test?');
    expect(env.get('DATABASE_URL')).toContain('/maquina_test?');
    expect(mod.get(App).metaMode).toBe('mock');
    expect(mod.get(App).metaCronEnabled).toBe(false);
    expect(env.get('ONLY_IN_FILE_X')).toBe('from-file');
    await mod.close();
  });
});
