// render-lambda-v1 L2 (backend) contra a infra LOCAL (maquina_test), SEM AWS: a porta `lambda` é um adaptador falso em
// memória (o render em si é o FakeRenderService/ffmpeg no finalize). Prova o despachante (submit sem esperar, throttling →
// QUEUED com notBefore, teto RENDER_LAMBDA_MAX_INFLIGHT), o poller (progresso, done → settle, timeout → 1 tentativa nova,
// 2º timeout → RENDER_TIMEOUT), o settle (finalize → storage.put → READY → release; CostEntry AWS_LAMBDA/RENDER com
// externalRef = externalId), o webhook (assinatura inválida 401; duplicado/atrasado = 200 sem efeito) e o boot (lambda
// com externalId não volta pra fila).
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.RENDER_LAMBDA_POLL_MS = '250';
process.env.RENDER_LAMBDA_WEBHOOK = 'on';
process.env.RENDER_LAMBDA_MAX_INFLIGHT = '2';
process.env.RENDER_LAMBDA_MAX_INFLIGHT_PER_WORKSPACE = '2';
const PORT = 3197;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, type AutoVariationType, type VariationAxis } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { StorageService } from '../arquivos/storage.service';
import { hashPassword } from '../common/util/crypto';
import { JobsService } from '../jobs/jobs.service';
import { configureApp } from '../main';
import { PrismaService } from '../prisma/prisma.service';
import { RecuperacaoService } from '../recuperacao/recuperacao.service';
import {
  RENDER_PORTS, RenderError, RenderPorts, RenderThrottledError, RenderValidationError, ServicoComoPorta,
  type RenderInput, type RenderPort, type RenderSnapshot, type RenderSubmission, type RenderWebhookEvent,
} from '../render';
import { FakeRenderService } from './fake-render.service';
import { PecasAutoService } from './pecas.service';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

type Mode = 'ok' | 'throttle' | 'timeout-once' | 'timeout' | 'slow';
/** F8: como o finalize falha (por tipo de peça). mismatch = determinístico; flaky = 1 falha de rede; broken = sempre. */
type FinalizeMode = 'mismatch' | 'flaky' | 'broken';
/** Modo por tipo de peça (o input auto-edit traz `type`). */
const MODE: Record<string, Mode> = { CUT: 'throttle', HOOK_TEXT: 'timeout-once', STORY: 'timeout', COLD_OPEN: 'slow', NATIVE_SEARCH: 'ok' };

/** Adaptador lambda falso: estado em memória, `finalize` gera o MP4 de verdade com o FakeRenderService. */
class FakeLambdaPort implements RenderPort {
  readonly impl = 'lambda' as const;
  private readonly fake: FakeRenderService;
  readonly runs = new Map<string, { input: RenderInput; polls: number; mode: Mode; attempt: number; over: boolean }>();
  readonly submits: { renderId: string; attempt: number; webhookUrl: string | null }[] = [];
  readonly released: string[] = [];
  readonly throttled = new Set<string>();
  /** modo do submit por tipo (o 2º teste zera) e falha do finalize por tipo (F8) */
  modes: Record<string, Mode> = MODE;
  finalizeModes: Record<string, FinalizeMode> = {};
  readonly finalizeCalls = new Map<string, number>();
  maxActive = 0;
  constructor(tmpDir: string) { this.fake = new FakeRenderService({ tmpDir, minMs: 150 }); }
  templates() { return this.fake.templates(); }
  private active() { return [...this.runs.values()].filter((r) => !r.over).length; }
  async submit(input: RenderInput, o: { attempt: number; webhookUrl: string | null }): Promise<RenderSubmission> {
    const mode = this.modes[(input as { type?: string }).type ?? ''] ?? 'ok';
    if (mode === 'throttle' && !this.throttled.has(input.renderId)) {
      this.throttled.add(input.renderId);
      throw new RenderThrottledError(300, 'Rate Exceeded');
    }
    const externalId = `ext-${input.renderId}-a${o.attempt}`;
    this.runs.set(externalId, { input, polls: 0, mode, attempt: o.attempt, over: false });
    this.submits.push({ renderId: input.renderId, attempt: o.attempt, webhookUrl: o.webhookUrl });
    this.maxActive = Math.max(this.maxActive, this.active());
    return { impl: 'lambda', externalId, bucket: 'remotionlambda-test', serveUrl: 'https://s3/sites/hookmill-test', attempt: o.attempt };
  }
  async snapshot(sub: RenderSubmission): Promise<RenderSnapshot> {
    const r = this.runs.get(sub.externalId)!;
    r.polls++;
    const progress = { stage: 'rendering' as const, progress: 50, frame: 10, totalFrames: 20 };
    if ((r.mode === 'timeout' || (r.mode === 'timeout-once' && r.attempt === 1)) && r.polls >= 2) {
      r.over = true;
      return { state: 'timeout', progress, costUsd: 0.002, error: { message: 'timeout', failedFrame: null, retryable: true } };
    }
    if (r.polls < (r.mode === 'slow' ? 12 : 2)) return { state: 'running', progress, costUsd: 0.001, error: null };
    r.over = true;
    return { state: 'done', progress: { ...progress, stage: 'encoding', progress: 99 }, costUsd: 0.011, error: null };
  }
  async finalize(input: RenderInput) {
    const n = (this.finalizeCalls.get(input.renderId) ?? 0) + 1;
    this.finalizeCalls.set(input.renderId, n);
    const fm = this.finalizeModes[(input as { type?: string }).type ?? ''];
    if (fm === 'mismatch') throw new RenderValidationError('RENDER_ERROR', null, 'nb_frames 60 != campeão 63');
    if (fm === 'broken' || (fm === 'flaky' && n === 1)) throw new RenderError('RENDER_ERROR', null, 'finalize: socket hang up');
    return { ...(await this.fake.render(input, () => undefined)), costUsd: 0.011 };
  }
  async release(_input: RenderInput, sub: RenderSubmission) { this.released.push(sub.externalId); }
  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): RenderWebhookEvent | null {
    if (headers['x-remotion-signature'] !== 'sha512=ok') return null;
    return JSON.parse(raw.toString('utf8')) as RenderWebhookEvent;
  }
}

const PLAN: { type: AutoVariationType; code: string; axis: VariationAxis; params: Record<string, unknown> }[] = [
  { type: 'CUT', code: 'CUT-15S', axis: 'ITERATION', params: { targetSec: 15, blockIndexes: [0, 2] } },
  { type: 'HOOK_TEXT', code: 'HOOK-TEXT-2', axis: 'ITERATION', params: { text: 'Hook 2', endSec: 2 } },
  { type: 'STORY', code: 'LAYOUT-STORY', axis: 'DIVERSITY', params: {} },
  { type: 'COLD_OPEN', code: 'COLD-OPEN', axis: 'ITERATION', params: { teaserStartSec: 5, teaserEndSec: 7, teaserSec: 2 } },
  { type: 'NATIVE_SEARCH', code: 'NATIVE-SEARCH', axis: 'DIVERSITY', params: { query: 'how to x' } },
];

describe(isLocal ? 'Render no Lambda: despachante, poller, webhook, settle (integração local, porta falsa)' : 'Render Lambda [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let ws: { id: string; userId: string };
  let dir: string;
  let batchId: string;
  let lambda: FakeLambdaPort;
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 180_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const pieces = () => app.get(PecasAutoService).pieces({ id: batchId, workspaceId: ws.id, status: 'LAUNCHED' });
  const hook = (body: unknown, sig = 'sha512=ok') =>
    fetch(`${base}/webhooks/render`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-remotion-signature': sig }, body: JSON.stringify(body) });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-lambda-'));
    lambda = new FakeLambdaPort(join(dir, 'out'));
    const fakeLocal = new FakeRenderService({ tmpDir: join(dir, 'local'), minMs: 150 });
    const ports = new RenderPorts('lambda', new Set(['scratch', 'auto-edit', 'frame', 'remix-keep']), {
      local: new ServicoComoPorta('local', fakeLocal), fake: new ServicoComoPorta('fake', fakeLocal), lambda,
    });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RENDER_PORTS).useValue(ports).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');

    const user = await prisma.user.create({ data: { email: `lambda-${RUN}@teste.local`, name: 'Lambda', passwordHash: await hashPassword(PASSWORD) } });
    const w = await prisma.workspace.create({ data: { name: `lambda-${RUN}`, shortCode: 'LB', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    ws = { id: w.id, userId: user.id };
    const offer = await prisma.offer.create({ data: { workspaceId: ws.id, name: 'Oferta lambda', language: 'en', what: 'App', promise: 'Save time', cta: 'Download', createdById: ws.userId } });
    const path = join(dir, 'champ.mp4');
    await run(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=8',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const video = await app.get(StorageService).put(path, { workspaceId: ws.id, kind: 'CHAMPION_VIDEO', mimeType: 'video/mp4', meta: { durationSec: 8, width: 360, height: 640 } });
    const championId = (await prisma.champion.create({
      data: { workspaceId: ws.id, offerId: offer.id, name: 'Champ lambda', status: 'READY', rights: 'OWN', videoFileId: video.id, durationSec: 8, hasSpeech: true, language: 'en', createdById: ws.userId },
    })).id;
    const words = Array.from({ length: 16 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
    await prisma.teardown.create({
      data: {
        workspaceId: ws.id, championId,
        transcript: { language: 'en', text: words.map((x) => x.word).join(' '), words, wpm: 120, wordsSource: 'whisper' },
        measurements: { silences: words.slice(1).map((x, i) => ({ startSec: words[i].endSec, endSec: x.startSec })), palette: ['#112233'] },
        sections: { structure: { status: 'ok', naReason: null, data: { blocks: [
          { label: 'hook', function: 'hook', startSec: 0, endSec: 2, onScreen: '', speech: '' },
          { label: 'body', function: 'body', startSec: 2, endSec: 6, onScreen: '', speech: '' },
          { label: 'cta', function: 'cta', startSec: 6, endSec: 8, onScreen: '', speech: '' },
        ] } } },
      },
    });
    const b = await prisma.variationBatch.create({
      data: {
        workspaceId: ws.id, championId, offerId: offer.id, status: 'PLAN_READY', mode: 'AUTO', language: 'en', requests: [], createdById: ws.userId,
        items: { create: PLAN.map((p, index) => ({ workspaceId: ws.id, kind: 'AUTO_EDIT' as const, index, status: 'READY' as const, autoType: p.type, code: p.code, axis: p.axis, change: 'c', rationale: 'r', payload: { params: { type: p.type, ...p.params } } })) },
      },
    });
    batchId = b.id;
  });

  afterAll(async () => {
    if (ws?.id) {
      await until(() => prisma.render.count({ where: { workspaceId: ws.id, status: { in: ['QUEUED', 'RENDERING'] } } }), (n) => n === 0, 60_000);
      await app.get(JobsService).idle();
      await prisma.creative.updateMany({ where: { workspaceId: ws.id }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.render.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.creative.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.champion.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.job.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.offer.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.deleteMany({ where: { id: ws.id } });
      await prisma.user.deleteMany({ where: { email: `lambda-${RUN}@teste.local` } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('lote no lambda: teto de 2 no ar, throttling volta pra fila, timeout refaz 1x, 2º timeout = RENDER_TIMEOUT, custo por tentativa', async () => {
    const svc = app.get(PecasAutoService);
    const launchedAt = new Date();
    const launched = await app.get(PrismaService).$transaction(async (tx) => {
      await tx.variationBatch.update({ where: { id: batchId }, data: { status: 'LAUNCHED', launchedAt } });
      return svc.createPieces(tx, { batchId, userId: ws.userId, launchedAt });
    });
    svc.launched(launched);

    // boot no meio: o COLD-OPEN (lento) está no ar com externalId → a recuperação NÃO devolve pra fila
    const slow = await until(
      () => prisma.render.findFirst({ where: { workspaceId: ws.id, impl: 'lambda', externalId: { not: null }, status: 'RENDERING', creative: { variationCode: 'COLD-OPEN' } } }),
      (r) => !!r,
    );
    expect(slow).toBeTruthy();
    await app.get(RecuperacaoService).recover({ workspaceId: ws.id });
    expect(await prisma.render.findUniqueOrThrow({ where: { id: slow!.id } })).toMatchObject({ status: 'RENDERING', impl: 'lambda', externalId: slow!.externalId });

    // webhook: assinatura errada = 401; atrasado (outra tentativa) = 200 sem efeito
    expect((await hook({ externalId: slow!.externalId, renderId: slow!.id, attempt: 1, status: 'success', costUsd: 0.01 }, 'sha512=errada')).status).toBe(401);
    expect((await hook({ externalId: 'ext-velho', renderId: slow!.id, attempt: 9, status: 'success', costUsd: 0.01 })).status).toBe(200);
    expect((await prisma.render.findUniqueOrThrow({ where: { id: slow!.id } })).status).toBe('RENDERING');

    const done = await until(pieces, (ps) => ps.every((p) => ['ready', 'failed'].includes(p.status)));
    const by = Object.fromEntries(done.map((p) => [p.code, p]));
    expect(by['CUT-15S'].status).toBe('ready'); // throttling no 1º submit: voltou pra fila e passou
    expect(by['HOOK-TEXT-2'].status).toBe('ready'); // 1º timeout → tentativa 2 → ok
    expect(by['LAYOUT-STORY']).toMatchObject({ status: 'failed', errorCode: 'RENDER_TIMEOUT' });
    expect(by['COLD-OPEN'].status).toBe('ready');
    expect(by['NATIVE-SEARCH'].status).toBe('ready');
    expect(lambda.maxActive).toBeLessThanOrEqual(2); // RENDER_LAMBDA_MAX_INFLIGHT
    expect(lambda.throttled.size).toBe(1);
    expect(lambda.submits.every((s) => s.webhookUrl === `${process.env.PUBLIC_API_URL}/api/v1/webhooks/render`)).toBe(true);

    const renders = await prisma.render.findMany({ where: { workspaceId: ws.id, format: 'VERTICAL_9_16', stale: false }, include: { creative: { select: { variationCode: true } } } });
    const hookR = renders.find((r) => r.creative.variationCode === 'HOOK-TEXT-2')!;
    expect(hookR).toMatchObject({ status: 'READY', impl: 'lambda', attempt: 2, externalId: `ext-${hookR.id}-a2`, externalBucket: 'remotionlambda-test', serveUrl: 'https://s3/sites/hookmill-test' });
    expect(Number(hookR.costUsd)).toBeCloseTo(0.011, 4);
    expect(lambda.released).toEqual(expect.arrayContaining([`ext-${hookR.id}-a2`]));
    // custo: 1 CostEntry por tentativa (externalRef = externalId): 4 prontos + 1º timeout do hook + 2 timeouts do story
    const costs = await prisma.costEntry.findMany({ where: { workspaceId: ws.id, provider: 'AWS_LAMBDA', kind: 'RENDER' } });
    expect(costs).toHaveLength(7);
    expect(new Set(costs.map((c) => c.externalRef)).size).toBe(7);
    expect(costs.find((c) => c.externalRef === `ext-${hookR.id}-a2`)).toMatchObject({ unit: 'render', creativeId: hookR.creativeId });

    // webhook duplicado depois do READY = 200 sem efeito (nem custo novo)
    expect((await hook({ externalId: hookR.externalId, renderId: hookR.id, attempt: 2, status: 'success', costUsd: 0.011 })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 500));
    expect(await prisma.costEntry.count({ where: { workspaceId: ws.id, provider: 'AWS_LAMBDA' } })).toBe(7);
    expect((await prisma.render.findUniqueOrThrow({ where: { id: hookR.id } })).status).toBe('READY');
  });
  it('F8: finalize que falha grava o custo do Lambda e apaga a saída; nº de quadros errado falha na 1ª, rede tenta até 3x', async () => {
    lambda.modes = {};
    lambda.finalizeModes = { CUT: 'mismatch', NATIVE_SEARCH: 'flaky', HOOK_TEXT: 'broken' };
    const champ = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId } });
    const items = PLAN.filter((p) => ['CUT', 'NATIVE_SEARCH', 'HOOK_TEXT'].includes(p.type));
    const b2 = await prisma.variationBatch.create({
      data: {
        workspaceId: ws.id, championId: champ.championId, offerId: champ.offerId, status: 'PLAN_READY', mode: 'AUTO', language: 'en', requests: [], createdById: ws.userId,
        items: { create: items.map((p, index) => ({ workspaceId: ws.id, kind: 'AUTO_EDIT' as const, index, status: 'READY' as const, autoType: p.type, code: `F8-${p.code}`, axis: p.axis, change: 'c', rationale: 'r', payload: { params: { type: p.type, ...p.params } } })) },
      },
    });
    const svc = app.get(PecasAutoService);
    const launchedAt = new Date();
    const launched = await app.get(PrismaService).$transaction(async (tx) => {
      await tx.variationBatch.update({ where: { id: b2.id }, data: { status: 'LAUNCHED', launchedAt } });
      return svc.createPieces(tx, { batchId: b2.id, userId: ws.userId, launchedAt });
    });
    svc.launched(launched);
    const done = await until(() => svc.pieces({ id: b2.id, workspaceId: ws.id, status: 'LAUNCHED' }), (ps) => ps.every((p) => ['ready', 'failed'].includes(p.status)));
    const by = Object.fromEntries(done.map((p) => [p.code, p]));
    expect(by['F8-CUT-15S']).toMatchObject({ status: 'failed', errorCode: 'RENDER_ERROR' });
    expect(by['F8-NATIVE-SEARCH'].status).toBe('ready');
    expect(by['F8-HOOK-TEXT-2']).toMatchObject({ status: 'failed', errorCode: 'RENDER_ERROR' });

    const renders = await prisma.render.findMany({ where: { workspaceId: ws.id, format: 'VERTICAL_9_16', stale: false, creative: { variationBatchId: b2.id } }, include: { creative: { select: { variationCode: true } } } });
    const of = (code: string) => renders.find((r) => r.creative.variationCode === code)!;
    const [mis, flaky, broken] = [of('F8-CUT-15S'), of('F8-NATIVE-SEARCH'), of('F8-HOOK-TEXT-2')];
    expect(lambda.finalizeCalls.get(mis.id)).toBe(1);      // determinístico: sem as outras 2 tentativas
    expect(lambda.finalizeCalls.get(flaky.id)).toBe(2);    // 1 falha de rede, 2ª passa
    expect(lambda.finalizeCalls.get(broken.id)).toBe(3);   // FINALIZE_MAX_TRIES
    // saída apagada do bucket também na falha (1 vez por render) e custo de cada um no registro (o teto vê)
    for (const r of [mis, flaky, broken]) expect(lambda.released.filter((x) => x === r.externalId)).toHaveLength(1);
    const costs = await prisma.costEntry.findMany({ where: { workspaceId: ws.id, provider: 'AWS_LAMBDA', kind: 'RENDER', externalRef: { in: [mis, flaky, broken].map((r) => r.externalId!) } } });
    expect(costs).toHaveLength(3);
    expect(costs.every((c) => Math.abs(Number(c.amountUsd) - 0.011) < 1e-6)).toBe(true);
    expect(costs.find((c) => c.externalRef === mis.externalId)).toMatchObject({ creativeId: mis.creativeId, variationBatchId: b2.id });
    expect(Number((await prisma.render.findUniqueOrThrow({ where: { id: mis.id } })).costUsd)).toBeCloseTo(0.011, 4);
  });
});
