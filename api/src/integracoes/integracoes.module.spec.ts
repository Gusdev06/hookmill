import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CATALOG_SERVICE, CLAUDE_SERVICE, GENERATION_SERVICE, IntegracoesModule } from './integracoes.module';
import type { CatalogService, ClaudeService, GenerationService } from './contrato';
import { FakeGenerationService } from './mock/fake-generation.service';

// Prisma falso: o módulo só precisa resolver a dependência (nenhuma query roda neste teste).
@Global()
@Module({ providers: [{ provide: PrismaService, useValue: { providerTask: { findMany: async () => [], findUnique: async () => null }, costEntry: {}, scene: {}, face: {}, variationCasting: {} } }], exports: [PrismaService] })
class FakePrismaModule {}

async function build(mode: 'mock' | 'live') {
  const mod = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EventEmitterModule.forRoot(), FakePrismaModule, IntegracoesModule.register(mode)],
  }).compile();
  await mod.init();
  return mod;
}

it('mock: injeta os fakes e o catálogo pelos tokens', async () => {
  const mod = await build('mock');
  expect(mod.get<GenerationService>(GENERATION_SERVICE)).toBeInstanceOf(FakeGenerationService);
  expect(mod.get<CatalogService>(CATALOG_SERVICE).engines()).toHaveLength(2);
  expect(mod.get<CatalogService>(CATALOG_SERVICE).voices('en')[0].sampleUrl).toMatch(/\/api\/v1\/mock-media\/voice\//);
  await mod.close();
});

/** Isola as chaves do processo (o api/.env real já tem chave e o ConfigService lê process.env). */
const LIVE_KEYS = ['ANTHROPIC_API_KEY', 'WAVESPEED_API_KEY', 'WAVESPEED_WEBHOOK_SECRET', 'WAVESPEED_WEBHOOKS'];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(LIVE_KEYS.map((k) => [k, process.env[k]]));
  for (const k of LIVE_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of LIVE_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

it('live sem chave no .env: falha explícita (NOT_CONFIGURED), nunca cai no mock', async () => {
  const mod = await build('live');
  await expect(mod.get<ClaudeService>(CLAUDE_SERVICE).suggestFaceDescription({} as never)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  await expect(mod.get<GenerationService>(GENERATION_SERVICE).submitFace({} as never)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  expect(mod.get<CatalogService>(CATALOG_SERVICE).voices('en')[0].sampleUrl).toBe('');
  await mod.close();
});

it('live com chaves: serviços reais injetados e webhook exige assinatura (401 sem ela)', async () => {
  const request = (await import('supertest')).default;
  const { ClaudeLiveService } = await import('./claude/claude.service');
  const { WaveSpeedGenerationService } = await import('./wavespeed/generation.service');
  const env = { ANTHROPIC_API_KEY: 'sk-test', WAVESPEED_API_KEY: 'ws-test', WAVESPEED_WEBHOOK_SECRET: 'whsec_abc', WAVESPEED_WEBHOOKS: 'on' };
  Object.assign(process.env, env);
  {
    const mod = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), EventEmitterModule.forRoot(), FakePrismaModule, IntegracoesModule.register('live')],
    }).compile();
    expect(mod.get(CLAUDE_SERVICE)).toBeInstanceOf(ClaudeLiveService);
    expect(mod.get(GENERATION_SERVICE)).toBeInstanceOf(WaveSpeedGenerationService);
    const app = mod.createNestApplication({ rawBody: true, logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init(); // não chama a rede: o reconciliador só lê o banco (falso, vazio)
    const res = await request(app.getHttpServer()).post('/api/v1/webhooks/wavespeed').send({ id: 'x', status: 'completed' });
    expect(res.status).toBe(401);
    // assinado sobre o corpo CRU (rawBody): passa e responde rápido, mesmo sem a task no banco
    const { signWebhook } = await import('./wavespeed/assinatura');
    const raw = '{"id":"pred_x","status":"completed","outputs":[]}';
    const ts = String(Math.floor(Date.now() / 1000));
    const ok = await request(app.getHttpServer())
      .post('/api/v1/webhooks/wavespeed')
      .set('content-type', 'application/json')
      .set('webhook-id', 'evt_1')
      .set('webhook-timestamp', ts)
      .set('webhook-signature', `v3,${signWebhook('whsec_abc', 'evt_1', ts, raw)}`)
      .send(raw);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ received: true });
    await app.close();
  }
});

it('mock: a rota de mídia sintética responde o MP4 por HTTP (o que o ingestFromUrl baixa)', async () => {
  const request = (await import('supertest')).default;
  const mod = await build('mock');
  const app = mod.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  const url = new URL('http://x/api/v1/mock-media/video/0123456789abcdef.mp4?format=SQUARE_1_1&sec=2');
  const res = await request(app.getHttpServer()).get(url.pathname + url.search);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('video/mp4');
  expect(Number(res.headers['content-length'])).toBeGreaterThan(1000);
  expect((await request(app.getHttpServer()).get('/api/v1/mock-media/video/..%2Fx.mp4')).status).toBe(400);
  await app.close();
}, 60_000);
