// editor-universal-v1 F-U1 (backend) contra a infra LOCAL (maquina_test + MinIO), integrações em mock, render FAKE, visão
// stubada (custo zero): GET/PUT v3 da peça AUTO de moldura e HEADLINE (manifesto, base dos 3 formatos, proxy 540p,
// guarda, fatos, issues), estrutura → 400, conflito com quem salvou (coluna), número novo pede confirmação e trava o
// export (422 EDIT_BLOCKED), export → render com o doc (MolduraProps.edicao / texto) → checagem de texto → peça servida
// com -ED (vista, zip) e 4:5/1:1 stale; export reprovado mantém a peça anterior + Retry check; 4:5 pedido depois sai com o
// doc; limite diário (429) e teto de gasto; SSE editor.export.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';
process.env.UPLOAD_MODE = 'proxy';
const PORT = 3183;
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
import { AppConfig } from '../config/app-config';
import { EventosService } from '../eventos/eventos.service';
import { CLAUDE_SERVICE } from '../integracoes';
import type { CheckStaticTextInput } from '../integracoes/contrato';
import { ZipService } from '../iteracao/zip.service';
import { JobsService } from '../jobs/jobs.service';
import { configureApp } from '../main';
import { PrismaService } from '../prisma/prisma.service';
import { PecasAutoService } from './pecas.service';
import { ProxyService } from './proxy.service';
import { resolverPropsMoldura, type MolduraProps, type RemixKeepProps } from '@maquina/video';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(600_000);
const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const brand = { name: 'Oferta editor', handle: '@editor', initials: 'OE', color: '#FF8A3D' };
const PLAN: { type: AutoVariationType; code: string; axis: VariationAxis; params: Record<string, unknown> }[] = [
  {
    type: 'FRAME' as AutoVariationType, code: 'FRAME-NEWS', axis: 'DIVERSITY',
    params: { template: 'news', texts: { topic: 'App', headline: { lead: 'People', highlight: 'save time' }, dek: 'A short app', cta: 'Download' }, sources: { 'headline.lead': 'promise', dek: 'transcript' }, screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: null },
  },
  { type: 'HEADLINE' as AutoVariationType, code: 'HEADLINE-1', axis: 'ITERATION', params: { mode: 'add', text: 'Save time today', highlight: null, original: null, format: 'VERTICAL_9_16', sources: { text: 'promise' } } },
  { type: 'CUT', code: 'CUT-15S', axis: 'ITERATION', params: { targetSec: 15 } },
];

describe(isLocal ? 'Editor universal F-U1 (integração local)' : 'Editor universal F-U1 [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  const prisma = new PrismaClient();
  let ws: { id: string; userId: string; token: string };
  let dir: string;
  let batchId: string;
  const items: Record<string, string> = {};
  const checks: CheckStaticTextInput[] = [];
  let textoLegivel = true;
  const eventos: { creativeId: string; event: string; data: { stage?: string } }[] = [];
  const base = `http://127.0.0.1:${PORT}/api/v1`;

  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${ws.token}` }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 240_000): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (ok(v) || Date.now() > end) return v;
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  const pieces = () => app.get(PecasAutoService).pieces({ id: batchId, workspaceId: ws.id, status: 'LAUNCHED' });
  const piece = async (code: string) => (await pieces()).find((p) => p.code.replace(/-ED$/, '') === code)!;
  const creativeOf = async (code: string) => (await piece(code)).creativeId!;
  const exportDone = (creativeId: string, renderId: string) =>
    until(() => prisma.render.findUniqueOrThrow({ where: { id: renderId } }), (r) => r.status === 'READY' || r.status === 'FAILED').then(async (r) => {
      // a peça assenta depois do render (finalRender etc. na mesma trava)
      await new Promise((ok) => setTimeout(ok, 200));
      return r;
    });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'maquina-editor-u-'));
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    // visão (porta da ia) stubada: legível ou não pelo flag do teste
    const claude = app.get(CLAUDE_SERVICE) as unknown as { checkStaticText: (i: CheckStaticTextInput) => Promise<unknown> };
    claude.checkStaticText = async (i) => {
      checks.push(i);
      return { items: i.expected.map((e) => ({ key: e.key, found: textoLegivel, seen: textoLegivel ? e.text : null })), extraText: [], costUsd: 0.004 };
    };
    const ev = app.get(EventosService);
    const pub = ev.publish.bind(ev);
    ev.publish = (creativeId: string, event: never, data: unknown) => {
      eventos.push({ creativeId, event, data: data as { stage?: string } });
      return pub(creativeId, event, data);
    };

    const hash = await hashPassword(PASSWORD);
    const email = `editor-u-${RUN}@teste.local`;
    const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: 'Editora Ana', passwordHash: hash } });
    const w = await prisma.workspace.create({ data: { name: `editor-u-${RUN}`, shortCode: 'EU', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
    const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
    ws = { id: w.id, userId: user.id, token: (await res.json()).data.accessToken };

    const offer = await prisma.offer.create({
      data: { workspaceId: ws.id, name: 'Oferta editor', language: 'en', what: 'App', promise: 'Save time', proof: '1.000 users', cta: 'Download', notes: 'teste', createdById: ws.userId },
    });
    const path = join(dir, 'champ.mp4');
    await run(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path], { timeout: 60_000 });
    const video = await app.get(StorageService).put(path, { workspaceId: ws.id, kind: 'CHAMPION_VIDEO', mimeType: 'video/mp4', meta: { durationSec: 4, width: 360, height: 640 } });
    const championId = (await prisma.champion.create({
      data: { workspaceId: ws.id, offerId: offer.id, name: 'Champ editor', status: 'READY', rights: 'OWN', videoFileId: video.id, durationSec: 4, hasSpeech: true, language: 'en', createdById: ws.userId },
    })).id;
    await prisma.teardown.create({
      data: {
        workspaceId: ws.id, championId, measurements: { palette: ['#808080', '#C04040'] }, sections: {},
        transcript: { language: 'en', words: [{ word: 'save', startSec: 0.2, endSec: 0.5 }, { word: '2', startSec: 0.5, endSec: 0.7 }, { word: 'hours', startSec: 0.7, endSec: 1 }] },
      },
    });
    const b = await prisma.variationBatch.create({
      data: {
        workspaceId: ws.id, championId, offerId: offer.id, status: 'PLAN_READY', mode: 'AUTO', language: 'en', requests: [], createdById: ws.userId,
        items: {
          create: PLAN.map((p, index) => ({
            workspaceId: ws.id, kind: 'AUTO_EDIT' as const, index, status: 'READY' as const, autoType: p.type, code: p.code, axis: p.axis,
            change: `changes ${p.code}`, rationale: 'r', inZip: true, payload: { params: { type: p.type, ...p.params } },
          })),
        },
      },
      include: { items: true },
    });
    batchId = b.id;
    for (const i of b.items) items[i.code!] = i.id;
    const svc = app.get(PecasAutoService);
    const launchedAt = new Date();
    const launched = await app.get(PrismaService).$transaction(async (tx) => {
      await tx.variationBatch.update({ where: { id: batchId }, data: { status: 'LAUNCHED', launchedAt } });
      return svc.createPieces(tx, { batchId, userId: ws.userId, launchedAt });
    });
    svc.launched(launched);
    await until(pieces, (ps) => ps.every((p) => ['ready', 'failed', 'left_out'].includes(p.status)));
  });

  afterAll(async () => {
    if (ws?.id) {
      await until(() => prisma.render.count({ where: { workspaceId: ws.id, status: { in: ['QUEUED', 'RENDERING'] } } }), (n) => n === 0, 120_000);
      await app.get(JobsService).idle();
      await prisma.creative.updateMany({ where: { workspaceId: ws.id }, data: { finalRenderId: null, thumbnailFileId: null } });
      await prisma.costEntry.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.render.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.creative.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.teardown.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.champion.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.job.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.offer.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.deleteMany({ where: { id: ws.id } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `editor-u-${RUN}` } } });
    }
    await app?.close();
    await prisma.$disconnect();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('as peças assentaram: FRAME e HEADLINE prontas com Edit disponível; CUT sem editor', async () => {
    const ps = await pieces();
    const by = Object.fromEntries(ps.map((p) => [p.code, p]));
    expect(by['FRAME-NEWS']).toMatchObject({ status: 'ready', editor: { available: true, reason: null, edited: false, pendingExport: false, export: null } });
    expect(by['HEADLINE-1']).toMatchObject({ status: 'ready', editor: { available: true } });
    expect(by['CUT-15S'].editor).toMatchObject({ available: false, reason: 'auto_type_not_editable' });
    const cut = await call('GET', `/creatives/${by['CUT-15S'].creativeId}/editor`);
    expect(cut.status).toBe(422);
    expect(cut.error).toMatchObject({ code: 'EDIT_NOT_SUPPORTED', details: { reason: 'auto_type_not_editable' } });
  });

  it('GET v3 da moldura: manifesto, base dos 3 formatos, guarda, fatos, proveniência; proxy building → ready (troca só a URL)', async () => {
    const id = await creativeOf('FRAME-NEWS');
    const g = await call('GET', `/creatives/${id}/editor`);
    expect(g.status).toBe(200);
    const s = g.data;
    expect(s).toMatchObject({
      version: 3, revision: 0, base: 'auto-piece', composition: 'Moldura', templateKey: 'frame:news', doc: null, settings: null, issues: [],
      dirty: false, exported: null, export: null, editedInEditor: false, code: 'FRAME-NEWS', baseCode: 'FRAME-NEWS', readOnly: null,
      piece: { id: items['FRAME-NEWS'], batchId },
    });
    expect(s.manifest).toMatchObject({ manifestVersion: 1, templateKey: 'frame:news', formats: ['9x16', '4x5', '1x1'], clientImage: true });
    expect(s.manifest.layers.map((l: { id: string }) => l.id)).toEqual(expect.arrayContaining(['slot:topic', 'slot:headline.lead', 'slot:cta', 'video']));
    expect(s.source.formats.map((f: { format: string; supported: boolean }) => [f.format, f.supported])).toEqual([['9x16', true], ['4x5', true], ['1x1', true]]);
    expect(s.source.formats[0].base).toMatchObject({ format: 'VERTICAL_9_16', frame: { id: 'news' } });
    expect(s.source.formats[0].base.kind).toBeUndefined(); // a base são as props da composição (sem kind/renderId)
    expect(s.source.guard).toMatchObject({ source: { width: 360, height: 640 }, protectedBands: [], faceTrack: [] });
    expect(s.source.words).toHaveLength(3);
    expect(s.facts.numbers).toEqual(expect.arrayContaining(['1000', '2']));
    expect(s.provenance['layer:slot:headline.lead']).toMatchObject({ source: 'brain', field: 'promise', quote: 'Save time', original: 'People' });
    expect(s.provenance['layer:slot:dek']).toMatchObject({ source: 'transcript' });
    expect(s.provenance['layer:slot:topic']).toMatchObject({ source: 'template' });
    expect(s.brandColor).toBeNull();
    expect(s.fonts.length).toBeGreaterThan(3);

    // proxy 540p: o lote já enfileirou no launch (o 1º GET pode já pegar pronto); a base vem com a URL dele e as dimensões do original
    const champ = await prisma.champion.findFirstOrThrow({ where: { workspaceId: ws.id }, include: { videoFile: true } });
    const proxy = await app.get(ProxyService).ensure(champ.videoFile!);
    expect(proxy).toMatchObject({ kind: 'PROXY', proxyOfFileId: champ.videoFileId, width: 360 });
    const g2 = await call('GET', `/creatives/${id}/editor`);
    expect(g2.data.proxy).toEqual({ status: 'ready', etaSec: null });
    const b0 = JSON.stringify(g2.data.source.formats[0].base);
    expect(b0).toContain(proxy!.storageKey);
    expect(b0).not.toContain(champ.videoFile!.storageKey);
    const { videoUrl: _a, ...dims2 } = g2.data.source.formats[0].base.video.source;
    expect(dims2).toEqual({ width: 360, height: 640, fps: 30, durationSec: 4, hasAudio: true }); // dimensões do ORIGINAL (proxy = troca de URL)
  });

  it('PUT: estrutura inválida = 400 (não salva); número novo = issue confirm e o export trava (422 EDIT_BLOCKED); confirmar libera', async () => {
    const id = await creativeOf('FRAME-NEWS');
    const doc = (layers: unknown[], extra: Record<string, unknown> = {}) => ({ version: 3, clips: [], trim: null, layers, captionWords: [], ...extra });
    const bad = await call('PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: doc([{ id: 'nao-existe', text: 'x' }]) });
    expect(bad.status).toBe(400);
    expect(bad.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { fields: [{ field: 'layers[0].id', rule: 'unknown_layer' }] } });
    expect(await call('PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: doc([], { templateOpts: { brand: 'red' } }) })).toMatchObject({ status: 400, error: { details: { fields: [{ rule: 'bad_template_opt_value' }] } } });

    const p1 = await call('PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: doc([{ id: 'slot:headline.lead', text: 'Save 37 hrs' }], { templateOpts: { brand: '#2E7DFF' } }) });
    expect(p1.status).toBe(200);
    expect(p1.data).toMatchObject({ revision: 1, dirty: true, settings: null, doc: { version: 3, templateOpts: { brand: '#2E7DFF' }, layers: [{ id: 'slot:headline.lead', text: 'Save 37 hrs' }] } });
    expect(p1.data.issues.filter((i: { format: string }) => i.format === '9x16')).toEqual([
      { rule: 'invented_number', level: 'confirm', layerId: 'slot:headline.lead', itemId: null, format: '9x16', atSec: null, detail: { numbers: ['37'] } },
    ]);
    const c1 = await prisma.creative.findUniqueOrThrow({ where: { id } });
    expect(c1).toMatchObject({ editRevision: 1, editSavedById: ws.userId, editDirty: true });
    expect(c1.editSavedAt).not.toBeNull();
    expect((await piece('FRAME-NEWS')).editor).toMatchObject({ pendingExport: true, edited: false });

    const blocked = await call('POST', `/creatives/${id}/editor/export`, { revision: 1 });
    expect(blocked.status).toBe(422);
    expect(blocked.error).toMatchObject({ code: 'EDIT_BLOCKED', details: { issues: [{ rule: 'invented_number', level: 'confirm' }] } });

    // conflito: quem salvou vem das colunas (sobrevive a reiniciar a API)
    const conflict = await call('PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: null });
    expect(conflict.status).toBe(409);
    expect(conflict.error).toMatchObject({ code: 'EDIT_CONFLICT', details: { revision: 1, savedBy: { id: ws.userId, name: 'Editora Ana', initials: 'EA' } } });

    // "It's true, keep it": o servidor carimba quem e quando
    const p2 = await call('PUT', `/creatives/${id}/editor`, {
      baseRevision: 1, doc: doc([{ id: 'slot:headline.lead', text: 'Save 37 hrs' }], { templateOpts: { brand: '#2E7DFF' }, confirmations: [{ path: 'layer:slot:headline.lead', numbers: ['37'] }] }),
    });
    expect(p2.status).toBe(200);
    expect(p2.data.issues.filter((i: { rule: string }) => i.rule === 'invented_number')).toEqual([]);
    expect(p2.data.doc.confirmations).toEqual([{ path: 'layer:slot:headline.lead', numbers: ['37'], byUserId: ws.userId, at: expect.any(String) }]);
    expect(await call('PUT', `/creatives/${id}/editor`, {
      baseRevision: 2, doc: doc([{ id: 'slot:headline.lead', text: 'Save 37 hrs' }], { confirmations: [{ path: 'layer:slot:headline.lead', numbers: ['99'] }] }),
    })).toMatchObject({ status: 400, error: { details: { fields: [{ rule: 'bad_confirmation' }] } } });
  });

  it('export: render com o doc → checagem do texto editado → a peça serve a editada (-ED na vista e no zip), 4:5 fica stale', async () => {
    const id = await creativeOf('FRAME-NEWS');
    const pid = items['FRAME-NEWS'];
    // um 4:5 pronto ANTES do export (vai ficar stale)
    expect((await call('POST', `/iterate/pieces/${pid}/formats`, { format: '4x5' })).status).toBe(202);
    await until(() => piece('FRAME-NEWS'), (x) => x.formats!.find((f) => f.format === '4x5')!.state === 'ready');
    const antes = await prisma.render.findFirstOrThrow({ where: { creativeId: id, format: 'VERTICAL_9_16', status: 'READY' }, orderBy: { createdAt: 'desc' } });

    const e = await call('POST', `/creatives/${id}/editor/export`, { revision: 2 });
    expect(e.status).toBe(202);
    expect(e.data).toMatchObject({ revision: 2, stage: 'saving', progress: 0, error: null });
    // enquanto exporta: PUT e outro export dão 409; a peça segue `ready` servindo a anterior
    const mid = await piece('FRAME-NEWS');
    expect(mid.status).toBe('ready');
    const r = await exportDone(id, e.data.renderId);
    expect(r).toMatchObject({ status: 'READY', format: 'VERTICAL_9_16', priority: 10, editRevision: 2, settings: { templateId: 'auto-edit', editorExport: true } });
    // o input é o builder de hoje + resolver: texto editado, cor da marca, e os textos que a visão conferiu
    const input = r.input as { frame: { texts: { headline: { lead: string } }; brand: { color: string } }; editorCheck: { texts: { key: string; text: string }[] } };
    expect(input.frame.texts.headline.lead).toBe('Save 37 hrs');
    expect(input.frame.brand.color).toBe('#2E7DFF');
    expect(input.editorCheck.texts).toEqual([expect.objectContaining({ key: 'layer:slot:headline.lead', text: 'Save 37 hrs', layerId: 'slot:headline.lead' })]);
    expect(checks.filter((c) => c.renderId === r.id).flatMap((c) => c.expected.map((x) => x.text))).toEqual(['Save 37 hrs']);
    expect((r.input as { editorTextCheck?: { status: string } }).editorTextCheck?.status).toBe('ok');
    expect(eventos.filter((x) => x.creativeId === id && x.event === 'editor.export').map((x) => x.data.stage)).toEqual(expect.arrayContaining(['saving', 'text_check', 'done']));

    const c = await prisma.creative.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ finalRenderId: r.id, editDirty: false, state: 'APPROVED' });
    expect(await prisma.render.findFirst({ where: { creativeId: id, format: 'PORTRAIT_4_5', stale: false } })).toBeNull();
    expect((await prisma.render.findUniqueOrThrow({ where: { id: antes.id } })).stale).toBe(false); // o 9:16 anterior fica (histórico)

    const p = await piece('FRAME-NEWS');
    expect(p.code).toBe('FRAME-NEWS-ED');
    expect(p.editor).toMatchObject({ available: true, edited: true, pendingExport: false, export: null });
    expect(p.formats!.map((f) => f.state)).toEqual(['ready', 'none', 'none']);
    expect(p.files.map((f) => f.name)).toEqual([expect.stringMatching(/^EU_\d{4}_FRAME-NEWS-ED_9x16\.mp4$/)]);
    const zip = await (app.get(ZipService) as unknown as { entries: (b: string, l: boolean) => Promise<{ files: { name: string; file: { id: string } }[] }[]> }).entries(batchId, true);
    const z = zip.flatMap((x) => x.files).find((f) => f.name.includes('FRAME-NEWS'))!;
    expect(z.name).toMatch(/_FRAME-NEWS-ED_9x16\.mp4$/);
    expect(z.file.id).toBe(r.fileId); // a editada substitui a original no zip

    const g = await call('GET', `/creatives/${id}/editor`);
    expect(g.data).toMatchObject({ dirty: false, exported: { revision: 2 }, editedInEditor: true, code: 'FRAME-NEWS-ED', export: null });
    // nada novo pra exportar
    expect((await call('POST', `/creatives/${id}/editor/export`, { revision: 2 })).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'nothing_to_export' } });
    // revisão velha = conflito
    expect((await call('POST', `/creatives/${id}/editor/export`, { revision: 1 })).error).toMatchObject({ code: 'EDIT_CONFLICT' });
  });

  it('4:5 pedido depois do export sai com o doc exportado (texto e cor valem em todos os formatos)', async () => {
    const id = await creativeOf('FRAME-NEWS');
    expect((await call('POST', `/iterate/pieces/${items['FRAME-NEWS']}/formats`, { format: '4x5' })).status).toBe(202);
    await until(() => piece('FRAME-NEWS'), (x) => x.formats!.find((f) => f.format === '4x5')!.state === 'ready');
    const r = await prisma.render.findFirstOrThrow({ where: { creativeId: id, format: 'PORTRAIT_4_5', stale: false } });
    expect(r.doc).toMatchObject({ version: 3, templateOpts: { brand: '#2E7DFF' } });
    expect((r.input as { frame: { texts: { headline: { lead: string } } } }).frame.texts.headline.lead).toBe('Save 37 hrs');
    expect((r.input as { editorCheck?: unknown }).editorCheck).toBeUndefined(); // só o export confere por visão
  });

  it('export reprovado na checagem de texto: render FAILED com o "Jump to", a peça continua servindo a anterior; Retry check passa', async () => {
    const id = await creativeOf('FRAME-NEWS');
    const servida = (await prisma.creative.findUniqueOrThrow({ where: { id } })).finalRenderId;
    const g = await call('GET', `/creatives/${id}/editor`);
    // + a caixa do CTA desce 2 % (mesmo tamanho): vai pro render como MolduraProps.edicao
    const cta = resolverPropsMoldura(g.data.source.formats[0].base as MolduraProps, null, { format: '9x16' }).layout.layers.find((l) => l.id === 'slot:cta')!.rect;
    const novo = { ...g.data.doc, layers: [{ id: 'slot:headline.lead', text: 'Save more' }, { id: 'slot:cta', rect: { ...cta, y: cta.y - 0.02 } }], confirmations: [] };
    expect((await call('PUT', `/creatives/${id}/editor`, { baseRevision: g.data.revision, doc: novo })).status).toBe(200);
    textoLegivel = false;
    const e = await call('POST', `/creatives/${id}/editor/export`, { revision: g.data.revision + 1 });
    expect(e.status).toBe(202);
    const r = await exportDone(id, e.data.renderId);
    expect(r).toMatchObject({ status: 'FAILED', errorCode: 'TEXT_MISMATCH', failDetail: { rule: 'text_mismatch', layerId: 'slot:headline.lead', atSec: expect.any(Number) } });
    expect(r.fileId).not.toBeNull(); // o arquivo fica pro Retry check
    expect((await prisma.creative.findUniqueOrThrow({ where: { id } })).finalRenderId).toBe(servida);
    const p = await piece('FRAME-NEWS');
    expect(p.status).toBe('ready');
    expect(p.code).toBe('FRAME-NEWS-ED');
    expect(p.formats![0].state).toBe('ready');
    expect(p.editor).toMatchObject({ pendingExport: true, export: { stage: 'failed', error: { code: 'TEXT_MISMATCH', layerId: 'slot:headline.lead', canRecheck: true } } });
    expect((await call('GET', `/creatives/${id}/editor`)).data.export).toMatchObject({ renderId: r.id, stage: 'failed' });

    textoLegivel = true;
    const rc = await call('POST', `/creatives/${id}/editor/export/recheck`, {});
    expect(rc.status).toBe(202);
    expect(rc.data).toMatchObject({ renderId: r.id, stage: 'caption_check' });
    const ok = await exportDone(id, r.id);
    expect(ok).toMatchObject({ status: 'READY', errorCode: null, failDetail: null });
    const camadas = (ok.input as { edicao?: { camadas: { id: string; visible: boolean; para: unknown }[] } }).edicao?.camadas ?? [];
    expect(camadas).toEqual([expect.objectContaining({ id: 'slot:cta', visible: true, para: expect.any(Object) })]);
    expect((await prisma.creative.findUniqueOrThrow({ where: { id } })).finalRenderId).toBe(r.id);
    expect((await piece('FRAME-NEWS')).editor).toMatchObject({ edited: true, pendingExport: false, export: null });
    // sem falha de checagem pendente = não há o que reconferir
    expect((await call('POST', `/creatives/${id}/editor/export/recheck`, {})).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'cannot_recheck' } });
  });

  it('HEADLINE: GET (RemixKeep, 1 formato), PUT texto + faixa, export → render com o texto novo', async () => {
    const id = await creativeOf('HEADLINE-1');
    const g = await call('GET', `/creatives/${id}/editor`);
    expect(g.status).toBe(200);
    expect(g.data).toMatchObject({ composition: 'RemixKeep', templateKey: 'headline', manifest: { formats: ['9x16'] }, code: 'HEADLINE-1' });
    expect(g.data.manifest.layers.map((l: { id: string }) => l.id)).toEqual(expect.arrayContaining(['headline', 'headline:box', 'video']));
    expect(g.data.source.formats.map((f: { supported: boolean }) => f.supported)).toEqual([true, false, false]);
    expect(g.data.provenance['layer:headline']).toMatchObject({ source: 'brain', field: 'promise', original: 'Save time today' });
    const put = await call('PUT', `/creatives/${id}/editor`, {
      baseRevision: 0, doc: { version: 3, clips: [], trim: null, captionWords: [], layers: [{ id: 'headline', text: 'Save time now' }, { id: 'headline:box', fill: '#112233' }] },
    });
    expect(put.status).toBe(200);
    expect(put.data.issues.filter((i: { level: string }) => i.level === 'block' || i.level === 'confirm')).toEqual([]);
    const e = await call('POST', `/creatives/${id}/editor/export`, { revision: 1 });
    expect(e.status).toBe(202);
    const r = await exportDone(id, e.data.renderId);
    expect(r.status).toBe('READY');
    const layer = (r.input as { textLayers: { id: string; content: { text: string }; background: { color: string } }[] }).textLayers.find((l) => l.id === 'headline-nova')!;
    expect(layer.content.text).toBe('Save time now');
    expect(layer.background.color).toBe('#112233');
    expect((await piece('HEADLINE-1')).code).toBe('HEADLINE-1-ED');
  });

  it('vídeo do cliente (F-U2): manifesto; estrutura = 400; rosto cortado salva e trava o export; caixa + aparar exporta com o doc', async () => {
    const id = await creativeOf('FRAME-NEWS');
    const champ = await prisma.creative.findUniqueOrThrow({ where: { id }, select: { championId: true } });
    // rosto no meio do quadro (grade 360×640, a mesma do arquivo): o GET refaz a guarda
    await prisma.teardown.update({ where: { championId: champ.championId! }, data: { editMap: {
      version: 1, width: 360, height: 640, fps: 25, frameCount: 100, layers: [], overlays: [], cells: [], mainSpeaker: null,
      faceTrack: [{ startFrame: 0, endFrame: 100, role: 'main', region: { x: 0, y: 0, w: 360, h: 640 }, faceInRegion: [{ atFrame: 0, box: { x: 0.35, y: 0.3, w: 0.3, h: 0.2 } }] }],
    } as never } });
    const g = await call('GET', `/creatives/${id}/editor`);
    expect(g.status).toBe(200);
    expect(g.data.source.guard.faceTrack).toHaveLength(1);
    const v = g.data.manifest.layers.find((l: { id: string }) => l.id === 'video');
    expect(v).toMatchObject({ editable: { move: true, resize: true, reframe: true, trim: true, rotate: false }, video: { zoomMin: 0.5, zoomMax: 3, minTrimSec: 1, trimMinSec: 0, trimMaxSec: 4 } });
    const docCom = (video: Record<string, unknown>) => ({ version: 3, clips: [], trim: null, captionWords: [], layers: g.data.doc?.layers ?? [], ...(g.data.doc?.confirmations && { confirmations: g.data.doc.confirmations }), ...(g.data.doc?.templateOpts && { templateOpts: g.data.doc.templateOpts }), video: { layerId: 'video', ...video } });
    let rev = g.data.revision;

    expect(await call('PUT', `/creatives/${id}/editor`, { baseRevision: rev, doc: docCom({ framing: { fit: 'cover', zoom: 9, panX: 0, panY: 0 } }) }))
      .toMatchObject({ status: 400, error: { code: 'VALIDATION_ERROR', details: { fields: [{ field: 'video.framing.zoom', rule: 'video_zoom_out_of_range' }] } } });
    expect(await call('PUT', `/creatives/${id}/editor`, { baseRevision: rev, doc: docCom({ trim: { inSec: 1, outSec: 1.5 } }) }))
      .toMatchObject({ status: 400, error: { details: { fields: [{ rule: 'trim_too_short' }] } } });

    // autosave salva com pílula vermelha; o export bloqueia
    const ruim = await call('PUT', `/creatives/${id}/editor`, { baseRevision: rev, doc: docCom({ framing: { fit: 'cover', zoom: 1, panX: 1, panY: 0 } }) });
    expect(ruim.status).toBe(200);
    rev = ruim.data.revision;
    const pilula = ruim.data.issues.find((i: { rule: string; format: string }) => i.rule === 'face_cut' && i.format === '9x16');
    expect(pilula).toMatchObject({ level: 'block', layerId: 'video', detail: { visiblePct: expect.any(Number) } });
    expect((await prisma.creative.findUniqueOrThrow({ where: { id } })).editRevision).toBe(rev);
    const trava = await call('POST', `/creatives/${id}/editor/export`, { revision: rev });
    expect(trava.status).toBe(422);
    expect(trava.error).toMatchObject({ code: 'EDIT_BLOCKED', details: { issues: expect.arrayContaining([expect.objectContaining({ rule: 'face_cut' })]) } });

    // mudar a caixa mantendo o framing de antes volta ao auto reframe
    const box = { x: 0.1, y: 0.25, w: 0.8, h: 0.5 };
    const zerou = await call('PUT', `/creatives/${id}/editor`, { baseRevision: rev, doc: docCom({ box, framing: { fit: 'cover', zoom: 1, panX: 1, panY: 0 }, trim: { inSec: 1, outSec: 3 } }) });
    expect(zerou.status).toBe(200);
    rev = zerou.data.revision;
    expect(zerou.data.doc.video).toEqual({ layerId: 'video', box, trim: { inSec: 1, outSec: 3 } });
    expect(zerou.data.issues.filter((i: { rule: string; format: string }) => i.format === '9x16' && (i.rule === 'face_cut' || i.rule === 'caption_cut'))).toEqual([]);

    const e = await call('POST', `/creatives/${id}/editor/export`, { revision: rev });
    expect(e.status).toBe(202);
    const r = await exportDone(id, e.data.renderId);
    expect(r.status).toBe('READY');
    const input = r.input as unknown as MolduraProps;
    expect(input.video.timeline).toEqual([{ startSec: 1, endSec: 3 }]);
    expect(input.edicao!.video!.box).toEqual({ x: 108, y: 480, w: 864, h: 960 });
    expect(input.video.faceHint).toBeDefined();
  });

  it('HEADLINE com vídeo (F-U2): caixa e aparar vão pro input do RemixKeep', async () => {
    const id = await creativeOf('HEADLINE-1');
    const g = await call('GET', `/creatives/${id}/editor`);
    const put = await call('PUT', `/creatives/${id}/editor`, {
      baseRevision: g.data.revision,
      doc: { ...g.data.doc, video: { layerId: 'video', box: { x: 0, y: 0.2, w: 1, h: 0.6 }, trim: { inSec: 1, outSec: 3 } } },
    });
    expect(put.status).toBe(200);
    const e = await call('POST', `/creatives/${id}/editor/export`, { revision: put.data.revision });
    expect(e.status).toBe(202);
    const r = await exportDone(id, e.data.renderId);
    expect(r.status).toBe('READY');
    const input = r.input as unknown as RemixKeepProps;
    expect(input.canvas.frameCount).toBe(50);
    expect(input.edicao!.video.inFrame).toBe(25);
    expect(input.edicao!.video.pintura!.box).toEqual({ x: 0, y: 128, w: 360, h: 384 });
    expect(input.textLayers.find((l) => l.id === 'headline-nova')).toMatchObject({ startFrame: 0, endFrame: 50 });
    // volta ao vídeo inteiro pro próximo teste
    expect((await call('PUT', `/creatives/${id}/editor`, { baseRevision: put.data.revision, doc: g.data.doc })).status).toBe(200);
  });

  it('limite diário de exports (429) e teto de gasto (409 SPEND_CAP_EXCEEDED) antes de criar o render', async () => {
    const id = await creativeOf('HEADLINE-1');
    const g = await call('GET', `/creatives/${id}/editor`);
    expect((await call('PUT', `/creatives/${id}/editor`, { baseRevision: g.data.revision, doc: { ...g.data.doc, layers: [{ id: 'headline', text: 'Save time later' }] } })).status).toBe(200);
    const rev = g.data.revision + 1;
    const antes = await prisma.render.count({ where: { creativeId: id } });
    const cfg = app.get(AppConfig);
    Object.defineProperty(cfg, 'editorExportsPerDay', { configurable: true, get: () => 2 }); // este workspace já exportou 3 hoje
    try {
      const lim = await call('POST', `/creatives/${id}/editor/export`, { revision: rev });
      expect(lim.status).toBe(429);
      expect(lim.error).toMatchObject({ code: 'RATE_LIMITED', details: { limit: 2 } });
    } finally {
      delete (cfg as unknown as Record<string, unknown>).editorExportsPerDay;
    }
    await prisma.workspace.update({ where: { id: ws.id }, data: { monthlySpendCapUsd: 0.01 } });
    try {
      const cap = await call('POST', `/creatives/${id}/editor/export`, { revision: rev });
      expect(cap.error).toMatchObject({ code: 'SPEND_CAP_EXCEEDED', details: { estimateUsd: 0.04 } });
    } finally {
      await prisma.workspace.update({ where: { id: ws.id }, data: { monthlySpendCapUsd: null } });
    }
    expect(await prisma.render.count({ where: { creativeId: id } })).toBe(antes);
  });
});
