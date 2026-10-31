// Editor v1 F2a (docs/contratos/editor-v1.md §5) contra a infra LOCAL: GET/PUT /editor, validação, EDIT_CONFLICT, SSE
// editor.updated, §3.2 no PATCH /edit, render com doc (fake), dirty por revisão, selo editado, remix-keep 422.
// Integrações em mock e render fake (custo zero). Pula se o banco não for localhost.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.RENDER_IMPL = 'fake';
process.env.BOOT_RECOVERY = 'off';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { EventosService, type SseMessage } from '../eventos/eventos.service';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(90_000);
const RUN = `ed-${Date.now().toString(36)}`;
const PASSWORD = 'senha-teste-1234';
const SETTINGS = { templateId: 'clean', captionStyle: 'word', captionPosition: 'bottom', headline: 'Big hook', ctaText: 'Start free', endCard: true };

describe(isLocal ? 'Editor F2a (integração local)' : 'Editor F2a [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }
  let app: NestExpressApplication;
  let base: string;
  const prisma = new PrismaClient();
  const ws: Record<'A' | 'B', { id: string; userId: string; token: string }> = {} as never;
  let offerId: string;

  const call = async (k: 'A' | 'B', method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ws[k].token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await r.json().catch(() => null)) as any;
    return { status: r.status, data: json?.data, error: json?.error };
  };
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> => {
    const end = Date.now() + ms;
    let v = await fn();
    while (!ok(v) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 300));
      v = await fn();
    }
    if (!ok(v)) throw new Error(`timeout: ${JSON.stringify(v).slice(0, 300)}`);
    return v;
  };

  /** Criativo do zero em RENDER_READY com 3 cenas prontas (2 soltas + nada de take) direto no banco. */
  const seedCreative = async (opts: { state?: string; templateId?: string } = {}) => {
    const c = await prisma.creative.create({
      data: {
        workspaceId: ws.A.id, offerId, name: `${RUN} c`, language: 'en', createdById: ws.A.userId, state: (opts.state ?? 'RENDER_READY') as never,
        editSettings: { ...SETTINGS, templateId: opts.templateId ?? 'clean' }, engine: 'SCENES', engineModel: 'kling-3.0', format: 'VERTICAL_9_16',
      },
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const f = await prisma.file.create({
        data: { workspaceId: ws.A.id, kind: 'SCENE_CLIP' as never, storageKey: `ws/${ws.A.id}/scene_clip/${RUN}-${c.id}-${i}.mp4`, mimeType: 'video/mp4', sizeBytes: 10, durationSec: 3 },
      });
      const s = await prisma.scene.create({
        data: {
          workspaceId: ws.A.id, creativeId: c.id, generation: 1, index: i, label: `S${i}`, startSec: i * 3, endSec: i * 3 + 3, speech: 'x', visualPrompt: 'y',
          status: 'READY', progress: 100, pipeline: 'SCENE_VIDEO', clipFileId: f.id,
          words: [{ word: `w${i}a`, startSec: 0.2, endSec: 0.6 }, { word: `w${i}b`, startSec: 0.7, endSec: 1.1 }],
        },
      });
      ids.push(s.id);
    }
    return { id: c.id, scenes: ids };
  };

  beforeAll(async () => {
    // jest.setup-env força o maquina_test (nunca o maquina do dev/API LIVE); prova com o banco de verdade
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    console.log(`[editor.int] banco: ${db} · bucket: ${process.env.STORAGE_BUCKET}`);
    expect(db).toBe('maquina_test');
    expect(process.env.STORAGE_BUCKET).toBe('maquina-anuncios-test');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as import('node:net').AddressInfo).port}`;
    const hash = await hashPassword(PASSWORD);
    for (const k of ['A', 'B'] as const) {
      const email = `${RUN}-${k.toLowerCase()}@teste.local`;
      const user = await prisma.user.create({ data: { access: 'INTERNAL', email, name: `Editor ${k}`, passwordHash: hash } });
      const w = await prisma.workspace.create({ data: { name: `${RUN}-${k}`, shortCode: 'TS', memberships: { create: { userId: user.id, role: 'OWNER' } } } });
      const r = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      ws[k] = { id: w.id, userId: user.id, token: ((await r.json()) as any).data.accessToken };
    }
    offerId = (await prisma.offer.create({ data: { workspaceId: ws.A.id, name: 'Oferta Editor', language: 'en', createdById: ws.A.userId } })).id;
  });

  afterAll(async () => {
    await app?.close();
    for (const k of ['A', 'B'] as const) if (ws[k]) await prisma.workspace.deleteMany({ where: { id: ws[k].id } });
    await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  it('GET/PUT, validação, conflito, SSE, §3.2, export com doc, dirty por revisão e selo editado', async () => {
    const { id, scenes } = await seedCreative();

    // GET: fonte assinada, padrões das 3 camadas, doc nulo
    const g = await call('A', 'GET', `/creatives/${id}/editor`);
    expect(g.status).toBe(200);
    expect(g.data).toMatchObject({ revision: 0, base: 'scratch', composition: 'Criativo', doc: null, dirty: false, editedInEditor: false });
    expect(g.data.source.scenes.map((s: any) => s.sceneId)).toEqual(scenes);
    expect(g.data.source.scenes[0]).toMatchObject({ durationSec: 3, clipStartSec: 0, attempt: 1 });
    expect(g.data.source.scenes[0].clip.url).toContain('X-Amz-Signature');
    expect(Date.parse(g.data.urlsExpireAt)).toBeGreaterThan(Date.now() + 3600_000);
    expect(g.data.layers.map((l: any) => l.id)).toEqual(['hook', 'caption', 'cta']);
    expect(g.data.layers[0].defaults.text).toBeNull(); // clean não tem gancho
    expect(g.data.layers[2].defaults.text).toBe('Start free');
    expect(g.data.fonts.length).toBe(9);

    // outro workspace não enxerga
    expect((await call('B', 'GET', `/creatives/${id}/editor`)).status).toBe(404);
    expect((await call('B', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: null })).status).toBe(404);

    // DTO: campo fora da whitelist, faixa, doc ausente
    const empty = { version: 1, clips: [], trim: null, layers: [], captionWords: [] };
    let r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: { ...empty, extra: 1 } });
    expect(r.status).toBe(400);
    expect(r.error.details.fields).toContainEqual({ field: 'doc.extra', rule: 'notAllowed' });
    r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: { ...empty, layers: [{ id: 'hook', transform: { x: 0.5, y: 0.5, scale: 9, rotationDeg: 0, boxWidth: 1 } }] } });
    expect(r.status).toBe(400);
    expect(r.error.details.fields[0]).toMatchObject({ field: 'doc.layers.0.transform.scale', rule: 'max' });
    expect((await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0 })).status).toBe(400);

    // semântica (validarDoc): regras do contrato
    const clip = (sceneId: string, extra: object = {}) => ({ sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3, ...extra });
    r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: { ...empty, clips: [clip(scenes[0]), clip(scenes[1])] } });
    expect(r.status).toBe(400);
    expect(r.error.details.fields.map((f: any) => f.rule)).toContain('clips_must_cover_scenes');
    r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: { ...empty, clips: [clip('nope'), clip(scenes[0]), clip(scenes[1]), clip(scenes[2])] } });
    expect(r.error.details.fields.map((f: any) => f.rule)).toContain('unknown_scene');
    r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: { ...empty, layers: [{ id: 'hook', style: { color: 'red', fontId: 'comic' } }], captionWords: [{ key: `${scenes[0]}@1:9`, text: 'x' }] } });
    expect(r.error.details.fields.map((f: any) => f.rule).sort()).toEqual(['bad_color', 'unknown_font', 'unknown_word']);
    expect((await prisma.creative.findUniqueOrThrow({ where: { id } })).editRevision).toBe(0);

    // SSE do criativo
    const sse: SseMessage[] = [];
    const sub = app.get(EventosService).stream(id).subscribe((m) => sse.push(m));

    // salva: reordena, apara, apaga uma cena, move a legenda, corrige palavra
    const doc = {
      ...empty,
      clips: [clip(scenes[2], { inSec: 0.5 }), clip(scenes[0]), clip(scenes[1], { enabled: false })],
      layers: [{ id: 'caption', transform: { x: 0.5, y: 0.4, scale: 1.1, rotationDeg: 3, boxWidth: 0.8 } }, { id: 'cta', style: { color: '#FF0000' } }],
      captionWords: [{ key: `${scenes[0]}@1:0`, text: 'fixed' }],
    };
    r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ revision: 1, dirty: true, settings: SETTINGS });
    expect(r.data.doc.clips.map((c: any) => [c.sceneId, c.enabled, c.inSec])).toEqual([[scenes[2], true, 0.5], [scenes[0], true, 0], [scenes[1], false, 0]]);
    let c = await prisma.creative.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ state: 'EDIT_PENDING', editDirty: true, editRevision: 1 });
    await until(async () => sse.filter((m) => m.event === 'editor.updated').length, (n) => n >= 1);
    expect(sse.find((m) => m.event === 'editor.updated')!.data).toMatchObject({ revision: 1, savedBy: { id: ws.A.userId, name: 'Editor A' } });

    // conflito: revisão velha
    r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: null });
    expect(r.status).toBe(409);
    expect(r.error).toMatchObject({ code: 'EDIT_CONFLICT', details: { revision: 1, savedBy: { name: 'Editor A' } } });

    // GET devolve o doc salvo; GET /edit sabe que há edição
    expect((await call('A', 'GET', `/creatives/${id}/editor`)).data.doc).toEqual(r.data ?? (await call('A', 'GET', `/creatives/${id}/editor`)).data.doc);
    const ed = await call('A', 'GET', `/creatives/${id}/edit`);
    expect(ed.data).toMatchObject({ hasEditorChanges: true, editorAvailable: true, dirty: true });

    // §3.2: trocar template pelo PATCH apaga os transform (revisão + 1, editor.updated)
    expect((await call('A', 'PATCH', `/creatives/${id}/edit`, { templateId: 'bold' })).status).toBe(200);
    c = await prisma.creative.findUniqueOrThrow({ where: { id } });
    expect(c.editRevision).toBe(2);
    expect((c.editDoc as any).layers).toEqual([{ id: 'cta', style: { color: '#FF0000' } }]);
    await until(async () => sse.filter((m) => m.event === 'editor.updated').length, (n) => n >= 2);
    sub.unsubscribe();

    // Exportar = POST /render: grava doc + revisão, input resolvido pelo resolverProps
    const ren = await call('A', 'POST', `/creatives/${id}/render`, {});
    expect(ren.status).toBe(202);
    expect(ren.data).toMatchObject({ editRevision: 2 });
    expect(ren.data.doc.clips).toHaveLength(3);
    const row = await prisma.render.findUniqueOrThrow({ where: { id: ren.data.id } });
    const input = row.input as any;
    expect(input.scenes).toHaveLength(2); // cena 1 apagada
    expect(input.scenes[0]).toMatchObject({ clipStartSec: 0.5, durationSec: 2.5 });
    expect(input.scenes[1].words[0].word).toBe('fixed');
    expect(input.layers.cta.style.color).toBe('#FF0000');
    expect(input.templateId).toBe('bold');

    // render termina com a mesma revisão = RENDER_READY limpo, selo editado
    await until(async () => (await prisma.creative.findUniqueOrThrow({ where: { id } })).state, (s) => s === 'RENDER_READY' || s === 'RENDER_FAILED');
    c = await prisma.creative.findUniqueOrThrow({ where: { id } });
    expect(c).toMatchObject({ state: 'RENDER_READY', editDirty: false });
    expect((await call('A', 'GET', `/creatives/${id}`)).data.editedInEditor).toBe(true);
    expect((await call('A', 'GET', '/creatives')).data.find((x: any) => x.id === id).editedInEditor).toBe(true);

    // edição não exportada bloqueia o OK final (§5.3)
    r = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 2, doc: null });
    expect(r.data).toMatchObject({ revision: 3, doc: null });
    expect((await call('A', 'POST', `/creatives/${id}/approve`, {})).status).toBe(409);
    expect((await call('A', 'POST', `/creatives/${id}/render`, {})).status).toBe(202);
    await until(async () => (await prisma.creative.findUniqueOrThrow({ where: { id } })).state, (s) => s === 'RENDER_READY');
    expect((await call('A', 'GET', `/creatives/${id}`)).data.editedInEditor).toBe(false); // vigente saiu sem doc
    expect((await call('A', 'POST', `/creatives/${id}/approve`, {})).status).toBe(200);
    expect((await call('A', 'GET', `/creatives/${id}/editor`)).status).toBe(409); // APPROVED
  });

  it('render que termina depois de uma edição cai em EDIT_PENDING (dirty por revisão)', async () => {
    const { id } = await seedCreative({ state: 'EDIT_PENDING' });
    const ren = await call('A', 'POST', `/creatives/${id}/render`, {});
    expect(ren.status).toBe(202);
    const put = await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 0, doc: { version: 1, clips: [], trim: null, layers: [{ id: 'hook', text: 'New' }], captionWords: [] } });
    expect(put.status).toBe(200);
    await until(async () => (await prisma.render.findUniqueOrThrow({ where: { id: ren.data.id } })).status, (s) => s === 'READY' || s === 'FAILED');
    await until(async () => (await prisma.creative.findUniqueOrThrow({ where: { id } })).state, (s) => s !== 'RENDERING');
    expect(await prisma.creative.findUniqueOrThrow({ where: { id } })).toMatchObject({ state: 'EDIT_PENDING', editDirty: true });
  });

  it('cena gerando = 409; remix-keep = 422 EDIT_NOT_SUPPORTED', async () => {
    const a = await seedCreative({ state: 'SCENES_GENERATING' });
    await prisma.scene.update({ where: { id: a.scenes[1] }, data: { status: 'GENERATING', clipFileId: null } });
    expect((await call('A', 'GET', `/creatives/${a.id}/editor`)).error.code).toBe('INVALID_STATE');
    expect((await call('A', 'GET', `/creatives/${a.id}/edit`)).data.editorAvailable).toBe(false);
    const b = await seedCreative({ templateId: 'remix-keep' });
    const g = await call('A', 'GET', `/creatives/${b.id}/editor`);
    expect(g.status).toBe(422);
    expect(g.error).toMatchObject({ code: 'EDIT_NOT_SUPPORTED', details: { reason: 'remix_editor_not_enabled' } });
    const p = await call('A', 'PUT', `/creatives/${b.id}/editor`, { baseRevision: 0, doc: null });
    expect(p.status).toBe(422);
    expect(p.error).toMatchObject({ code: 'EDIT_NOT_SUPPORTED', details: { reason: 'remix_editor_not_enabled' } });
    expect((await call('A', 'GET', `/creatives/${b.id}/edit`)).data.editorAvailable).toBe(false);
  });

  it('corte só de uma cena regerada: render sem doc (NULL de SQL), sem selo "editado" e sem "com ajustes"; JSON null antigo = sem ajuste', async () => {
    const { id, scenes } = await seedCreative();
    const clip = (sceneId: string, extra: object = {}) => ({ sceneId, enabled: true, attempt: 1, inSec: 0, outSec: 3, ...extra });
    const put = await call('A', 'PUT', `/creatives/${id}/editor`, {
      baseRevision: 0, doc: { version: 1, trim: null, layers: [], captionWords: [], clips: [clip(scenes[0], { inSec: 0.5 }), clip(scenes[1]), clip(scenes[2])] },
    });
    expect(put.status).toBe(200);
    expect(put.data.doc.clips).toHaveLength(3);
    expect((await call('A', 'GET', `/creatives/${id}/edit`)).data.hasEditorChanges).toBe(true);

    // a cena 0 foi regerada (attempt + 1, renders stale, como o POST /scenes/:i/regenerate faz): o corte dela caiu
    await prisma.scene.update({ where: { id: scenes[0] }, data: { attempt: 2 } });
    await prisma.render.updateMany({ where: { creativeId: id }, data: { stale: true } });
    expect((await call('A', 'GET', `/creatives/${id}/edit`)).data.hasEditorChanges).toBe(false);
    expect((await call('A', 'GET', `/creatives/${id}/editor`)).data.doc).toBeNull();

    // render gravado ANTES da correção (doc cru, com o corte velho) não ganha o selo
    const velho = await prisma.render.create({
      data: { workspaceId: ws.A.id, creativeId: id, status: 'READY', settings: SETTINGS, input: {}, doc: (await prisma.creative.findUniqueOrThrow({ where: { id } })).editDoc as Prisma.InputJsonValue, editRevision: 1 },
    });
    expect((await call('A', 'GET', `/creatives/${id}`)).data.editedInEditor).toBe(false);
    await prisma.render.delete({ where: { id: velho.id } });

    // exportar: o render sai com doc NULL de SQL (não JSON null) e o vídeo vigente não é "editado"
    const ren = await call('A', 'POST', `/creatives/${id}/render`, {});
    expect(ren.status).toBe(202);
    expect(ren.data.doc).toBeNull();
    const [sql] = await prisma.$queryRaw<{ isnull: boolean }[]>`select doc is null as isnull from renders where id = ${ren.data.id}`;
    expect(sql.isnull).toBe(true);
    await until(async () => (await prisma.creative.findUniqueOrThrow({ where: { id } })).state, (s) => s === 'RENDER_READY' || s === 'RENDER_FAILED');
    expect((await prisma.creative.findUniqueOrThrow({ where: { id } })).state).toBe('RENDER_READY');
    expect((await call('A', 'GET', `/creatives/${id}`)).data.editedInEditor).toBe(false);
    expect((await call('A', 'GET', '/creatives')).data.find((x: any) => x.id === id).editedInEditor).toBe(false);

    // voltar ao padrão grava NULL de SQL no criativo
    expect((await call('A', 'PUT', `/creatives/${id}/editor`, { baseRevision: 1, doc: null })).status).toBe(200);
    const [c1] = await prisma.$queryRaw<{ isnull: boolean }[]>`select edit_doc is null as isnull from creatives where id = ${id}`;
    expect(c1.isnull).toBe(true);

    // linhas antigas com JSON null (não NULL de SQL): leitura = sem ajuste
    const old = await seedCreative();
    await prisma.creative.update({ where: { id: old.id }, data: { editDoc: Prisma.JsonNull } });
    await prisma.render.create({ data: { workspaceId: ws.A.id, creativeId: old.id, status: 'READY', settings: SETTINGS, input: {}, doc: Prisma.JsonNull, editRevision: 0 } });
    const [j] = await prisma.$queryRaw<{ t: string | null }[]>`select jsonb_typeof(edit_doc) as t from creatives where id = ${old.id}`;
    expect(j.t).toBe('null');
    expect((await call('A', 'GET', `/creatives/${old.id}/edit`)).data.hasEditorChanges).toBe(false);
    expect((await call('A', 'GET', `/creatives/${old.id}/editor`)).data.doc).toBeNull();
    expect((await call('A', 'GET', `/creatives/${old.id}`)).data.editedInEditor).toBe(false);
  });
});

