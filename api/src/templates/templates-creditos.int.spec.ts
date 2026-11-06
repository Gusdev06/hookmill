// templates-creditos-v1 de ponta a ponta contra a infra LOCAL (maquina_test), integrações em mock (custo zero), render fake:
// admin (403, preço, vídeo de exemplo, crédito idempotente) → galeria e fit → usar template → Gerar reserva (409 quote
// diferente) → render falha = crédito volta → Retry reserva de novo → pronto = cobrado; 4:5 grátis → pack: 402 sem saldo,
// desmarcar até caber → amostra: 4 usos de Edição, Estático 402, quiz 402, 5º uso 402, prévia travada → equipe ilimitada.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
process.env.ITERATE_TEMPLATES = 'off';
process.env.TEMPLATES = 'on';
const PORT = 3187;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { CreditosService } from '../creditos/creditos.service';
import { IteracaoService } from '../iteracao/iteracao.service';
import { PAGE_CAPTURE, type PageCapturePort } from '../iteracao/portas';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(900_000);
const RUN = `tc${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const TERMINAL = ['ready', 'failed', 'left_out'];

type Who = 'paid' | 'sample' | 'internal';
type Piece = { id: string; type: string; status: string; locked: boolean; creativeId: string; files: unknown[] };

describe(isLocal ? 'Templates com créditos (integração local)' : 'Templates com créditos [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let dir = '';
  const users = {} as Record<Who, { id: string; token: string; wsId: string }>;
  const base = `http://127.0.0.1:${PORT}/api/v1`;
  const call = async (who: Who, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${users[who].token}` }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 300_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const upload = async (who: Who) => {
    const bytes = await readFile(join(dir, 'v30.mp4'));
    const c = await call(who, 'POST', '/uploads', { purpose: 'CHAMPION_VIDEO', filename: 'champ.mp4', mimeType: 'video/mp4', sizeBytes: bytes.length });
    await fetch(c.data.url, { method: 'PUT', headers: { 'content-type': 'video/mp4', authorization: `Bearer ${users[who].token}` }, body: new Uint8Array(bytes) });
    await call(who, 'POST', `/uploads/${c.data.uploadId}/complete`, {});
    return c.data.uploadId as string;
  };
  const planReady = (who: Who, id: string) => until(() => call(who, 'GET', `/iterate/${id}`), (r) => ['PLAN_READY', 'ANALYSIS_FAILED'].includes(r.data?.status));
  const settled = (who: Who, id: string) => until(async () => {
    await app.get(CreditosService).settleAll(users[who].wsId);
    return call(who, 'GET', `/iterate/${id}`);
  }, (r) => r.data?.template?.status === 'SETTLED');
  const balance = async (who: Who) => (await call(who, 'GET', '/credits')).data;
  // vídeo de exemplo direto no banco (o fluxo do admin é testado à parte); restaurado no fim
  const EXAMPLE = ['meme-pov', 'static-ad', 'let-hookmill-pick', 'direct-offer'];
  let saved: { slug: string; exampleKey: string | null; posterKey: string | null; credits: number | null; status: 'DRAFT' | 'LIVE' | 'HIDDEN'; uses: number; pendingExampleKey: string | null }[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-templates-'));
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=30', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', join(dir, 'v30.mp4')], { timeout: 60_000 });
    await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', join(dir, 'ex.mp4')], { timeout: 60_000 });
    saved = await prisma.template.findMany({ select: { slug: true, exampleKey: true, posterKey: true, credits: true, status: true, uses: true, pendingExampleKey: true } });
    for (const slug of EXAMPLE) await prisma.template.update({ where: { slug }, data: { exampleKey: `templates/${slug}/test-${RUN}.mp4` } });
    const fakePage: PageCapturePort = {
      capture: async ({ workspaceId }) => {
        const f = await prisma.file.create({ data: { workspaceId, kind: 'PAGE_CAPTURE', storageKey: `ws/${workspaceId}/page_capture/${RUN}-${Date.now()}.png`, mimeType: 'image/png', sizeBytes: 10, width: 1080, height: 3240 } });
        return { fileId: f.id, widthPx: 1080, heightPx: 3240, text: 'Sleep better tonight. Try it free.' };
      },
    };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PAGE_CAPTURE).useValue(fakePage).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    const hash = await hashPassword(PASSWORD);
    const spec: Record<Who, { access: 'SAMPLE' | 'PAID' | 'INTERNAL'; accountMode: 'OWN' | 'AGENCY' }> = {
      paid: { access: 'PAID', accountMode: 'OWN' }, sample: { access: 'SAMPLE', accountMode: 'OWN' }, internal: { access: 'INTERNAL', accountMode: 'AGENCY' },
    };
    for (const k of Object.keys(spec) as Who[]) {
      const email = `tc-${RUN}-${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `Tc ${k}`, passwordHash: hash, ...spec[k] } });
      const w = await prisma.workspace.create({ data: { name: `Tc ${k} ${RUN}`, shortCode: 'TC', websiteUrl: 'https://example.com/lp', memberships: { create: [{ userId: u.id, role: 'OWNER' }] } } });
      await prisma.offer.create({
        data: {
          workspaceId: w.id, name: 'Sleep app', language: 'en', what: 'A sleep app', audience: 'Busy parents', pains: 'Waking up tired every day',
          promise: 'Sleep better', proof: '"I finally sleep through the night" - Ana\n4.8 average rating', cta: 'Download', createdById: u.id,
          // 1ª tentativa do 9:16 da moldura meme falha (o Retry passa): crédito volta e é reservado de novo
          notes: k === 'paid' ? '[mock:frame-fail:meme]' : null,
        },
      });
      const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      users[k] = { id: u.id, wsId: w.id, token: (await res.json()).data.accessToken };
    }
  });

  afterAll(async () => {
    const ids = Object.values(users).map((u) => u.wsId);
    if (ids.length) {
      for (const id of ids) await app.get(IteracaoService).recover(id).catch(() => undefined);
      await until(() => prisma.render.count({ where: { workspaceId: { in: ids }, status: 'RENDERING' } }), (n) => n === 0, 120_000);
      await prisma.render.updateMany({ where: { workspaceId: { in: ids }, status: 'QUEUED' }, data: { status: 'FAILED' } });
      await prisma.render.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.creative.updateMany({ where: { workspaceId: { in: ids } }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.creditEntry.deleteMany({ where: { userId: { in: Object.values(users).map((u) => u.id) } } });
      await prisma.templateRun.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.champion.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.upload.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `tc-${RUN}` } } });
    }
    for (const s of saved) await prisma.template.update({ where: { slug: s.slug }, data: { exampleKey: s.exampleKey, posterKey: s.posterKey, credits: s.credits, status: s.status, uses: s.uses, pendingExampleKey: s.pendingExampleKey } }).catch(() => undefined);
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  // ───────── admin ─────────

  it('admin: cliente = 403; equipe lista tudo, preço obrigatório pra LIVE, sobe vídeo de exemplo (pôster) e credita idempotente', async () => {
    expect((await call('paid', 'GET', '/admin/ad-templates')).status).toBe(403);
    expect((await call('paid', 'POST', '/admin/credits/grant', { userId: users.paid.id, credits: 5, idempotencyKey: `grant-${RUN}-x` })).status).toBe(403);
    const list = await call('internal', 'GET', '/admin/ad-templates');
    expect([list.status, list.error]).toEqual([200, undefined]);
    expect(list.data.items.length).toBeGreaterThanOrEqual(33);
    expect(list.data.items.find((t: { slug: string }) => t.slug === 'new-face')).toMatchObject({ tier: 'AI', credits: 8, status: 'DRAFT', available: false });
    expect((await call('internal', 'PATCH', '/admin/ad-templates/podcast-clip', { status: 'LIVE' })).error.code).toBe('TEMPLATE_UNPRICED');
    expect((await call('internal', 'PATCH', '/admin/ad-templates/breaking-news', { credits: 3 })).data).toMatchObject({ credits: 3 });
    await call('internal', 'PATCH', '/admin/ad-templates/breaking-news', { credits: 1 });
    // vídeo de exemplo: PUT pré-assinado + complete (vertical, ≤ 60 s, pôster por ffmpeg)
    const bytes = await readFile(join(dir, 'ex.mp4'));
    const up = await call('internal', 'POST', '/admin/ad-templates/breaking-news/example', { mimeType: 'video/mp4', sizeBytes: bytes.length });
    expect([up.status, up.error]).toEqual([200, undefined]);
    const put = await fetch(up.data.uploadUrl, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(bytes.length) }, body: new Uint8Array(bytes) });
    expect(put.ok).toBe(true);
    const done = await call('internal', 'POST', '/admin/ad-templates/breaking-news/example/complete', { key: up.data.key });
    expect([done.status, done.error]).toEqual([200, undefined]);
    expect(done.data).toMatchObject({ example: { url: expect.any(String) }, poster: { url: expect.any(String) }, needsExample: false });
    // crédito manual: mesma chave = mesmo lançamento (não credita 2 vezes); débito acima do saldo = 409
    const g1 = await call('internal', 'POST', '/admin/credits/grant', { email: `tc-${RUN}-paid@teste.local`, credits: 2, note: 'test', idempotencyKey: `grant-${RUN}-1` });
    expect([g1.status, g1.error]).toEqual([200, undefined]);
    expect(g1.data).toMatchObject({ balance: 2, entry: { kind: 'MANUAL', delta: 2 } });
    const g2 = await call('internal', 'POST', '/admin/credits/grant', { email: `tc-${RUN}-paid@teste.local`, credits: 2, note: 'test', idempotencyKey: `grant-${RUN}-1` });
    expect(g2.data.entry.id).toBe(g1.data.entry.id);
    expect(g2.data.balance).toBe(2);
    expect((await call('internal', 'POST', '/admin/credits/grant', { userId: users.paid.id, credits: -50, idempotencyKey: `grant-${RUN}-2` })).status).toBe(409);
  });

  // ───────── galeria, usar, reservar, estornar, Retry ─────────

  let paidBatch = '';
  let championId = '';
  it('galeria: só os templates com vídeo e disponíveis; saldo; IA e DRAFT fora', async () => {
    const g = await call('paid', 'GET', '/ad-templates');
    expect([g.status, g.error]).toEqual([200, undefined]);
    const slugs = g.data.items.map((t: { slug: string }) => t.slug);
    expect(slugs).toEqual(expect.arrayContaining(['breaking-news', 'meme-pov', 'static-ad']));
    expect(slugs).not.toContain('new-face');
    expect(slugs).not.toContain('chat-dm'); // ITERATE_TEMPLATES=off
    expect(g.data.pack).toMatchObject({ slug: 'let-hookmill-pick', pack: true, credits: 10 });
    expect(g.data.credits).toMatchObject({ unlimited: false, access: 'PAID', pool: 'CREDITS', balance: 2 });
    expect((await call('paid', 'GET', '/ad-templates/new-face')).status).toBe(404);
    expect((await call('internal', 'GET', '/ad-templates/new-face')).data.available).toBe(false);
    expect((await call('internal', 'POST', '/ad-templates/new-face/use', { uploadId: 'x' })).error).toMatchObject({ code: 'TEMPLATE_UNAVAILABLE', details: { reason: 'coming_soon' } });
  });

  it('usar: lote sem quiz, quote 1; Gerar com quote errado = 409; Gerar reserva (saldo 2 → 1)', async () => {
    const u = await call('paid', 'POST', '/ad-templates/meme-pov/use', { uploadId: await upload('paid') });
    expect([u.status, u.error]).toEqual([202, undefined]);
    paidBatch = u.data.id;
    expect(u.data.quizEnabled).toBe(false);
    const b = await planReady('paid', paidBatch);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    championId = b.data.source.championId;
    expect(b.data.pieces.length).toBe(1);
    expect(b.data.pieces[0]).toMatchObject({ type: 'FRAME', frame: { template: 'meme' } });
    expect(b.data.template).toMatchObject({ slug: 'meme-pov', status: 'DRAFT', quote: 1, balance: 2, after: 1, enough: true, fit: { level: 'ok' } });
    expect(b.data.template.texts[0].items.map((t: { path: string }) => t.path)).toEqual(['pov', 'cta']);
    // texto editável: número inventado = 422; texto bom = salvo, grátis
    const bad = await call('paid', 'PATCH', `/iterate/${paidBatch}/items/${b.data.pieces[0].id}/texts`, { texts: [{ path: 'pov', value: 'POV: you sleep 97% better' }] });
    expect(bad.status).toBe(422);
    expect(bad.error.code).toBe('TEXT_INVALID');
    const ok = await call('paid', 'PATCH', `/iterate/${paidBatch}/items/${b.data.pieces[0].id}/texts`, { texts: [{ path: 'pov', value: 'POV: you wake up tired again' }] });
    expect([ok.status, ok.error]).toEqual([200, undefined]);
    expect(ok.data.template.texts[0].items[0].value).toBe('POV: you wake up tired again');
    const wrong = await call('paid', 'POST', `/iterate/${paidBatch}/start`, { expectedPieces: 1, expectedCostUsd: 0, expectedCredits: 2 });
    expect(wrong.status).toBe(409);
    expect(wrong.error).toMatchObject({ code: 'CREDITS_CHANGED', details: { credits: 1 } });
    expect((await call('paid', 'POST', `/iterate/${paidBatch}/start`, { expectedPieces: 1, expectedCostUsd: 0 })).status).toBe(400); // expectedCredits obrigatório
    const s = await call('paid', 'POST', `/iterate/${paidBatch}/start`, { expectedPieces: 1, expectedCostUsd: 0, expectedCredits: 1 });
    expect([s.status, s.error]).toEqual([202, undefined]);
    expect(s.data.template).toMatchObject({ status: 'RESERVED', held: 1 });
    expect((await balance('paid')).balance).toBe(1);
  });

  let piece: Piece;
  it('render falhou = crédito volta; Retry reserva de novo; pronto = cobrado; 4:5 não cobra', async () => {
    const b = await settled('paid', paidBatch);
    piece = b.data.pieces[0];
    expect(piece.status).toBe('failed');
    expect(b.data.template).toMatchObject({ status: 'SETTLED', charged: 0, refunded: 1, held: 0 });
    expect((await balance('paid')).balance).toBe(2);
    const r = await call('paid', 'POST', `/iterate/pieces/${piece.id}/retry`, {});
    expect([r.status, r.error]).toEqual([202, undefined]);
    expect((await call('paid', 'GET', `/iterate/${paidBatch}`)).data.template.status).toBe('RESERVED');
    expect((await balance('paid')).balance).toBe(1);
    const done = await settled('paid', paidBatch);
    expect(done.data.pieces[0].status).toBe('ready');
    expect(done.data.template).toMatchObject({ status: 'SETTLED', charged: 1, refunded: 1, held: 0 });
    expect((await balance('paid')).balance).toBe(1);
    const fmt = await call('paid', 'POST', `/iterate/pieces/${piece.id}/formats`, { format: '4x5' });
    expect([200, 202]).toContain(fmt.status);
    expect((await balance('paid')).balance).toBe(1);
    const ledger = await call('paid', 'GET', '/credits/ledger');
    expect(ledger.data.items.map((e: { kind: string }) => e.kind)).toEqual(['CHARGE', 'RESERVE', 'REFUND', 'RESERVE', 'MANUAL']);
    expect(ledger.data.items[0]).toMatchObject({ amount: 1, delta: 0, run: { templateSlug: 'meme-pov' } });
    // assentar de novo não lança nada (idempotente)
    await app.get(CreditosService).settleAll(users.paid.wsId);
    expect((await call('paid', 'GET', '/credits/ledger')).data.items.length).toBe(5);
    expect((await call('paid', 'GET', '/ad-templates/runs')).data.items[0]).toMatchObject({ templateSlug: 'meme-pov', charged: 1, refunded: 1 });
  });

  it('fit: lido = regra do plano (sem preço no Brain = direct-offer hard, use 422); não lido = unknown', async () => {
    const f = await call('paid', 'POST', '/ad-templates/fits', { slug: 'direct-offer', sources: [{ championId }, { uploadId: await upload('paid') }] });
    expect([f.status, f.error]).toEqual([200, undefined]);
    expect(f.data.items[0]).toMatchObject({ read: true, championId, fit: { level: 'hard', reason: 'no_price' } });
    expect(f.data.items[1]).toMatchObject({ read: false, fit: { level: 'unknown', reason: 'not_read' } });
    const g = await call('paid', 'GET', `/ad-templates?championId=${championId}`);
    expect(g.data.items.find((t: { slug: string }) => t.slug === 'direct-offer').fit).toEqual({ level: 'hard', reason: 'no_price' });
    expect(g.data.items.find((t: { slug: string }) => t.slug === 'meme-pov').fit.level).toBe('ok');
    const use = await call('paid', 'POST', '/ad-templates/direct-offer/use', { championId });
    expect(use.status).toBe(422);
    expect(use.error).toMatchObject({ code: 'TEMPLATE_DOESNT_FIT', details: { reason: 'no_price' } });
  });

  it('pack: quote = min(10, linhas); sem saldo = 402 e nada lança; desmarcar até caber = Gerar passa', async () => {
    const u = await call('paid', 'POST', '/ad-templates/let-hookmill-pick/use', { championId });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const b = await planReady('paid', u.data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    const t = b.data.template;
    expect(t.pack).toBe(true);
    expect(t.cap).toBe(10);
    expect(t.quote).toBe(Math.min(10, t.lines.reduce((n: number, l: { credits: number }) => n + l.credits, 0)));
    expect(t.lines.every((l: { tier: string }) => l.tier === 'EDIT')).toBe(true);
    expect(t.quote).toBeGreaterThan(1);
    const pieces = b.data.pieces as Piece[];
    const no = await call('paid', 'POST', `/iterate/${u.data.id}/start`, { expectedPieces: pieces.length, expectedCostUsd: 0, expectedCredits: t.quote });
    expect(no.status).toBe(402);
    expect(no.error).toMatchObject({ code: 'INSUFFICIENT_CREDITS', details: { need: t.quote, balance: 1, pool: 'CREDITS' } });
    expect((await call('paid', 'GET', `/iterate/${u.data.id}`)).data.status).toBe('PLAN_READY');
    expect((await balance('paid')).balance).toBe(1);
    // desmarca tudo menos 1 peça
    for (const p of pieces.slice(1)) await call('paid', 'PATCH', `/iterate/${u.data.id}/items/${p.id}`, { included: false });
    const one = await call('paid', 'GET', `/iterate/${u.data.id}`);
    expect(one.data.template.quote).toBe(1);
    const s = await call('paid', 'POST', `/iterate/${u.data.id}/start`, { expectedPieces: 1, expectedCostUsd: one.data.cost?.generateEstimateUsd ?? 0, expectedCredits: 1 });
    expect([s.status, s.error]).toEqual([202, undefined]);
    expect((await balance('paid')).balance).toBe(0);
  });

  // ───────── vários templates num lote só (templates-multi-v1, 04/11) ─────────

  it('seleção: checagens na ordem (400, not_found, pack, ai_tier, too_many_videos); fits com slugs; lido com 1 hard = 422 com items', async () => {
    const use = (who: Who, body: unknown) => call(who, 'POST', '/ad-templates/use', body);
    expect((await use('paid', { slugs: ['meme-pov'], championId })).status).toBe(400); // 1 slug = use /:slug/use
    expect((await use('paid', { slugs: ['meme-pov', 'meme-pov'], championId })).status).toBe(400); // repetido
    expect((await use('paid', { slugs: ['meme-pov', 'top-5'] })).status).toBe(400); // sem fonte
    expect((await use('paid', { slugs: ['meme-pov', 'top-5'], championId, uploadId: 'x' })).status).toBe(400); // 2 fontes
    expect((await use('paid', { slugs: ['meme-pov', 'selection', 'new-face'], championId })).error).toMatchObject({ code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'not_found', slugs: ['selection', 'new-face'] } });
    expect((await use('paid', { slugs: ['meme-pov', 'let-hookmill-pick'], championId })).error).toMatchObject({ code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'pack', slugs: ['let-hookmill-pick'] } });
    expect((await use('internal', { slugs: ['meme-pov', 'new-face'], championId: 'x' })).error).toMatchObject({ code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'ai_tier', slugs: ['new-face'] } });
    const many = ['new-headline', 'short-cuts', 'breaking-news', 'meme-pov', 'post-card', 'question-box', 'top-5', 'live', 'call', 'cinema'];
    const tooMany = await use('paid', { slugs: many, championId });
    expect([tooMany.status, tooMany.error.code]).toEqual([422, 'TEMPLATE_SELECTION_INVALID']);
    expect(tooMany.error.details).toEqual({ reason: 'too_many_videos', slugs: [], videos: 13, maxVideos: 12 });
    // 04/11: ≤ 8 molduras por seleção (FRAME ≤ 8 do plano)
    const frames = ['breaking-news', 'meme-pov', 'post-card', 'question-box', 'top-5', 'live', 'call', 'cinema'];
    const nine = await prisma.template.findFirst({ where: { autoType: 'FRAME', status: 'LIVE', credits: { not: null }, slug: { notIn: frames } }, select: { slug: true } });
    if (nine) {
      const nf = await use('paid', { slugs: [...frames, nine.slug], championId });
      expect([nf.status, nf.error.details]).toEqual([422, { reason: 'too_many_frames', slugs: [...frames, nine.slug], frames: 9, max: 8 }]);
    }
    // a linha de sistema nunca aparece: galeria, detalhe, use e admin
    expect((await call('internal', 'GET', '/ad-templates/selection')).status).toBe(404);
    expect((await call('internal', 'POST', '/ad-templates/selection/use', { championId })).status).toBe(404);
    expect((await call('internal', 'PATCH', '/admin/ad-templates/selection', { order: 1 })).status).toBe(404);
    expect((await call('internal', 'GET', '/admin/ad-templates')).data.items.map((t: { slug: string }) => t.slug)).not.toContain('selection');
    const g = await call('paid', 'GET', '/ad-templates');
    expect(g.data.selection).toEqual({ minTemplates: 2, maxTemplates: 12, maxVideos: 12, maxFrames: 8 });
    expect(g.data.items.map((t: { slug: string }) => t.slug)).not.toContain('selection');
    // fits: exatamente 1 de slug/slugs; com slugs = bySlug na ordem + fit da seleção
    expect((await call('paid', 'POST', '/ad-templates/fits', { slug: 'meme-pov', slugs: ['meme-pov', 'top-5'], sources: [{ championId }] })).status).toBe(400);
    expect((await call('paid', 'POST', '/ad-templates/fits', { sources: [{ championId }] })).status).toBe(400);
    expect((await call('paid', 'POST', '/ad-templates/fits', { slugs: ['meme-pov', 'selection'], sources: [{ championId }] })).status).toBe(404);
    const f = await call('paid', 'POST', '/ad-templates/fits', { slugs: ['meme-pov', 'direct-offer'], sources: [{ championId }, { uploadId: await upload('paid') }] });
    expect([f.status, f.error]).toEqual([200, undefined]);
    expect(f.data.items[0]).toMatchObject({ read: true, fit: { level: 'hard', reason: 'no_price' }, bySlug: [{ slug: 'meme-pov', fit: { level: 'ok' } }, { slug: 'direct-offer', fit: { level: 'hard', reason: 'no_price' } }] });
    expect(f.data.items[1]).toMatchObject({ read: false, fit: { level: 'unknown', reason: 'not_read' } });
    // M5: anúncio já lido com 1 marcado hard = recusa a seleção inteira com a lista
    const no = await use('paid', { slugs: ['meme-pov', 'direct-offer', 'top-5'], championId });
    expect(no.status).toBe(422);
    expect(no.error).toMatchObject({ code: 'TEMPLATE_DOESNT_FIT', details: { reason: 'no_price', slug: 'direct-offer', items: [{ slug: 'direct-offer', reason: 'no_price' }] } });
  });

  it('seleção: 3 templates, quote = soma acima de 10 (sem teto); 1 linha falha = estorno só dela; uses; runs e livro', async () => {
    const prices: Record<string, number> = { 'meme-pov': 5, 'breaking-news': 4, 'top-5': 3 };
    for (const [slug, credits] of Object.entries(prices)) await prisma.template.update({ where: { slug }, data: { credits } });
    const before = new Map((await prisma.template.findMany({ where: { slug: { in: ['selection', ...Object.keys(prices)] } } })).map((t) => [t.slug, t.uses]));
    await call('internal', 'POST', '/admin/credits/grant', { userId: users.paid.id, credits: 20, idempotencyKey: `grant-${RUN}-sel` });
    try {
      const u = await call('paid', 'POST', '/ad-templates/use', { slugs: ['meme-pov', 'breaking-news', 'top-5'], championId });
      expect([u.status, u.error]).toEqual([202, undefined]);
      expect(u.data.quizEnabled).toBe(false);
      const b = await planReady('paid', u.data.id);
      expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
      const t = b.data.template;
      expect(t).toMatchObject({ slug: 'selection', name: 'Your selection', pack: false, cap: null, tier: 'EDIT', status: 'DRAFT', quote: 12, fit: { level: 'ok' } });
      expect(t.selection).toEqual({ slugs: ['meme-pov', 'breaking-news', 'top-5'], skipped: [] });
      expect(t.lines.map((l: { slug: string; credits: number }) => [l.slug, l.credits]).sort()).toEqual([['breaking-news', 4], ['meme-pov', 5], ['top-5', 3]]);
      expect(b.data.pieces.every((p: { included?: boolean }) => p.included !== false)).toBe(true); // todas nascem marcadas (M8)
      expect(t.texts.length).toBe(3); // textos editáveis das 3 molduras
      // 04/11: desmarcar a linha top-5 = ela continua em lines com pieces 0 e o crédito dela, fora do quote; remarca e segue
      const top5Key = (await prisma.template.findUniqueOrThrow({ where: { slug: 'top-5' } })).internalKey;
      const top5Items = (await prisma.variationItem.findMany({ where: { batchId: u.data.id, kind: 'AUTO_EDIT' }, select: { id: true, payload: true } }))
        .filter((i) => `FRAME:${(i.payload as { params?: { template?: string } }).params?.template}` === top5Key);
      expect(top5Items.length).toBeGreaterThan(0);
      for (const i of top5Items) await call('paid', 'PATCH', `/iterate/${u.data.id}/items/${i.id}`, { included: false });
      const off = (await call('paid', 'GET', `/iterate/${u.data.id}`)).data.template;
      expect(off.quote).toBe(9);
      expect(off.lines.find((l: { slug: string }) => l.slug === 'top-5')).toMatchObject({ name: 'Top 5', credits: 3, pieces: 0, state: 'planned' });
      expect(off.lines).toHaveLength(3);
      for (const i of top5Items) await call('paid', 'PATCH', `/iterate/${u.data.id}/items/${i.id}`, { included: true });
      expect((await call('paid', 'GET', `/iterate/${u.data.id}`)).data.template.quote).toBe(12);
      const s = await call('paid', 'POST', `/iterate/${u.data.id}/start`, { expectedPieces: b.data.pieces.length, expectedCostUsd: b.data.cost?.generateEstimateUsd ?? 0, expectedCredits: 12 });
      expect([s.status, s.error]).toEqual([202, undefined]);
      expect(s.data.template).toMatchObject({ status: 'RESERVED', held: 12 });
      expect((await balance('paid')).balance).toBe(8);
      // [mock:frame-fail:meme]: a 1ª tentativa da moldura meme falha → só a linha dela (5) volta
      const done = await settled('paid', u.data.id);
      expect(done.data.template).toMatchObject({ status: 'SETTLED', charged: 7, refunded: 5, held: 0 });
      expect(done.data.template.lines.find((l: { slug: string }) => l.slug === 'meme-pov')).toMatchObject({ state: 'refunded', delivered: 0 });
      expect((await balance('paid')).balance).toBe(13);
      const after = new Map((await prisma.template.findMany({ where: { slug: { in: ['selection', ...Object.keys(prices)] } } })).map((x) => [x.slug, x.uses]));
      for (const slug of ['selection', ...Object.keys(prices)]) expect(after.get(slug)).toBe((before.get(slug) ?? 0) + 1);
      const runs = await call('paid', 'GET', '/ad-templates/runs');
      expect(runs.data.items[0]).toMatchObject({ batchId: u.data.id, templateSlug: 'selection', templateName: 'Your selection', pack: false, selection: { slugs: ['meme-pov', 'breaking-news', 'top-5'] }, charged: 7, refunded: 5 });
      expect(runs.data.items.find((r: { templateSlug: string }) => r.templateSlug === 'meme-pov').selection).toBeNull();
      const ledger = await call('paid', 'GET', '/credits/ledger');
      expect(ledger.data.items[0]).toMatchObject({ kind: 'REFUND', amount: 5, run: { templateSlug: 'selection', templateName: 'Your selection' } });
    } finally {
      for (const slug of Object.keys(prices)) await prisma.template.update({ where: { slug }, data: { credits: 1 } });
    }
  });

  it('seleção não lida: o marcado que não cabe sai no Reading (skipped com o motivo) e não cobra', async () => {
    const u = await call('paid', 'POST', '/ad-templates/use', { slugs: ['meme-pov', 'direct-offer'], uploadId: await upload('paid') });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const b = await planReady('paid', u.data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    const t = b.data.template;
    expect(t.selection).toEqual({ slugs: ['meme-pov', 'direct-offer'], skipped: [{ slug: 'direct-offer', name: 'Direct offer', reason: 'no_price' }] });
    expect(t.lines.map((l: { slug: string }) => l.slug)).toEqual(['meme-pov']);
    expect(t.quote).toBe(1);
    expect(b.data.pieces.map((p: Piece) => p.type)).toEqual(['FRAME']);
  });

  // ───────── amostra (§5) ─────────

  it('amostra + seleção: Estático = 402 sample_tier com os slugs; soma acima dos usos = 402 INSUFFICIENT_CREDITS', async () => {
    const up = await upload('sample');
    const st = await call('sample', 'POST', '/ad-templates/use', { slugs: ['meme-pov', 'static-ad'], uploadId: up });
    expect(st.status).toBe(402);
    expect(st.error).toMatchObject({ code: 'PAYMENT_REQUIRED', details: { reason: 'sample_tier', slugs: ['static-ad'] } });
    const five = await call('sample', 'POST', '/ad-templates/use', { slugs: ['meme-pov', 'breaking-news', 'post-card', 'question-box', 'top-5'], uploadId: up });
    expect(five.status).toBe(402);
    expect(five.error).toMatchObject({ code: 'INSUFFICIENT_CREDITS', details: { need: 5, balance: 4, pool: 'SAMPLE' } });
    expect((await balance('sample')).sample.left).toBe(4);
  });

  it('amostra: 4 usos; quiz e Estático = 402; Gerar gasta 1 uso; peça travada (prévia, zip 402)', async () => {
    const c = await balance('sample');
    expect(c).toMatchObject({ access: 'SAMPLE', pool: 'SAMPLE', balance: 4, sample: { left: 4, total: 4 } });
    const quiz = await call('sample', 'POST', '/iterate', { uploadId: await upload('sample') });
    expect(quiz.status).toBe(402);
    expect(quiz.error.details.reason).toBe('sample_templates');
    const st = await call('sample', 'POST', '/ad-templates/static-ad/use', { uploadId: await upload('sample') });
    expect(st.status).toBe(402);
    expect(st.error.details.reason).toBe('sample_tier');
    const u = await call('sample', 'POST', '/ad-templates/meme-pov/use', { uploadId: await upload('sample') });
    expect([u.status, u.error]).toEqual([202, undefined]);
    expect(u.data.sample).toBe(true);
    const b = await planReady('sample', u.data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]); // não lança sozinha: espera o Gerar
    expect(b.data.template).toMatchObject({ pool: 'SAMPLE', quote: 1, balance: 4 });
    const s = await call('sample', 'POST', `/iterate/${u.data.id}/start`, { expectedPieces: b.data.pieces.length, expectedCostUsd: 0, expectedCredits: 1 });
    expect([s.status, s.error]).toEqual([202, undefined]);
    expect((await balance('sample')).sample.left).toBe(3);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: users.sample.id } })).sampleUsedAt).not.toBeNull();
    const done = await settled('sample', u.data.id);
    expect(done.data.template).toMatchObject({ charged: 1, refunded: 0 });
    for (const p of done.data.pieces) expect(p).toMatchObject({ locked: true, files: [] });
    expect((await call('sample', 'POST', `/iterate/${u.data.id}/zip`, {})).status).toBe(402);
    // os outros 3 usos (mesmo anúncio já lido: sem nova leitura) e o 5º = 402 sample_used
    const champ = done.data.source.championId;
    for (let k = 0; k < 3; k++) {
      const x = await call('sample', 'POST', '/ad-templates/meme-pov/use', { championId: champ });
      expect([x.status, x.error]).toEqual([202, undefined]);
      const r = await planReady('sample', x.data.id);
      expect((await call('sample', 'POST', `/iterate/${x.data.id}/start`, { expectedPieces: r.data.pieces.length, expectedCostUsd: 0, expectedCredits: 1 })).status).toBe(202);
    }
    expect((await balance('sample')).sample.left).toBe(0);
    const fifth = await call('sample', 'POST', '/ad-templates/meme-pov/use', { championId: champ });
    expect(fifth.status).toBe(402);
    expect(fifth.error.details.reason).toBe('sample_used');
  });

  it('equipe (INTERNAL): ilimitado, sem lançamento no livro; usa template sem vídeo de exemplo', async () => {
    expect(await balance('internal')).toMatchObject({ unlimited: true, balance: null, pool: null });
    const u = await call('internal', 'POST', '/ad-templates/top-5/use', { uploadId: await upload('internal') });
    expect([u.status, u.error]).toEqual([202, undefined]);
    const b = await planReady('internal', u.data.id);
    expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
    expect(b.data.template).toMatchObject({ quote: 1, balance: null, enough: true, pool: null });
    expect((await call('internal', 'POST', `/iterate/${u.data.id}/start`, { expectedPieces: b.data.pieces.length, expectedCostUsd: 0, expectedCredits: 1 })).status).toBe(202);
    expect(await prisma.creditEntry.count({ where: { userId: users.internal.id } })).toBe(0);
    const uses = await prisma.template.findUniqueOrThrow({ where: { slug: 'top-5' } });
    expect(uses.uses).toBeGreaterThan(saved.find((s) => s.slug === 'top-5')!.uses);
    internalChampion = b.data.source.championId;
  });

  // A6 (01/11): Cold open e Offer end card voltam (LIVE, 1 crédito, Edição), só no lote de template
  let internalChampion = '';
  it('A6: cold-open e offer-end-card: LIVE 1 crédito, fit = regra do plano, lote de template com 1 peça do tipo', async () => {
    // o campeão de teste (testsrc, sem rosto, último bloco com texto na tela) "já fecha com end card": o end card não cabe
    const ec = await call('internal', 'POST', '/ad-templates/fits', { slug: 'offer-end-card', sources: [{ championId: internalChampion }] });
    expect(ec.data.items[0].fit).toEqual({ level: 'hard', reason: 'has_end_card' });
    const no = await call('internal', 'POST', '/ad-templates/offer-end-card/use', { championId: internalChampion });
    expect(no.status).toBe(422);
    expect(no.error).toMatchObject({ code: 'TEMPLATE_DOESNT_FIT', details: { reason: 'has_end_card' } });
    // sem texto na tela no último bloco = sem end card no original → cabe (variante pelo Brain)
    const td = await prisma.teardown.findUniqueOrThrow({ where: { championId: internalChampion } });
    const sec = td.sections as { structure: { data: { blocks: { onScreen?: string | null }[] } } };
    for (const bl of sec.structure.data.blocks) bl.onScreen = '';
    await prisma.teardown.update({ where: { championId: internalChampion }, data: { sections: sec as object } });
    for (const [slug, type] of [['cold-open', 'COLD_OPEN'], ['offer-end-card', 'ENDCARD']] as const) {
      const card = await call('internal', 'GET', `/ad-templates/${slug}`);
      expect(card.data).toMatchObject({ slug, credits: 1, tier: 'EDIT', available: true });
      const f = await call('internal', 'POST', '/ad-templates/fits', { slug, sources: [{ championId: internalChampion }] });
      expect(f.data.items[0]).toMatchObject({ read: true, fit: { level: 'ok', reason: null } });
      const u = await call('internal', 'POST', `/ad-templates/${slug}/use`, { championId: internalChampion });
      expect([u.status, u.error]).toEqual([202, undefined]);
      const b = await planReady('internal', u.data.id);
      expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
      expect(b.data.pieces.map((p: Piece) => p.type)).toEqual([type]);
      expect(b.data.template).toMatchObject({ slug, quote: 1, fit: { level: 'ok' } });
    }
  });

  it('seleção: marcado que cabia e o plano não fez (mesmo depois do reparo) = skipped not_planned, fora do quote', async () => {
    const offer = await prisma.offer.findFirstOrThrow({ where: { workspaceId: users.internal.wsId } });
    await prisma.offer.update({ where: { id: offer.id }, data: { notes: '[mock:picked-drop]' } });
    try {
      const u = await call('internal', 'POST', '/ad-templates/use', { slugs: ['meme-pov', 'top-5'], championId: internalChampion });
      expect([u.status, u.error]).toEqual([202, undefined]);
      const b = await planReady('internal', u.data.id);
      expect([b.data.status, b.data.error]).toEqual(['PLAN_READY', null]);
      expect(b.data.template.selection).toEqual({ slugs: ['meme-pov', 'top-5'], skipped: [{ slug: 'top-5', name: 'Top 5', reason: 'not_planned' }] });
      expect(b.data.template.lines.map((l: { slug: string }) => l.slug)).toEqual(['meme-pov']);
      expect(b.data.template.quote).toBe(1);
    } finally {
      await prisma.offer.update({ where: { id: offer.id }, data: { notes: offer.notes } });
    }
  });
});
