// Editor universal v1 (docs/contratos/editor-universal-v1.md), F-U1 backend: editor da peça AUTO de moldura (FRAME, 18) e
// HEADLINE. GET (EditorStateV3: manifesto, base dos formatos com URL do proxy, guarda, fatos, proveniência, issues),
// PUT (autosave: estrutura → 400; checagens → `issues`, sem bloquear o save), POST …/export (re-render grátis com o doc,
// teto de gasto + limite diário, checagem antes de servir) e POST …/export/recheck. Manifesto, resolver, validação e
// checagens são do @maquina/video/lib (o mesmo código do Player no web).
import { Injectable } from '@nestjs/common';
import { editorFonts } from './editor-fontes';
import type {
  EditBlockedDetails, EditDocV3, EditIssue, EditManifest, EditTemplateKey, EditorExportView, EditorGuard, EditorPropsJson, EditorStateV3,
  FontId, FormatCode, PutEditorResponseV3, TextConfirmation,
} from '@maquina/contratos';
import {
  FONT_CATALOG, checarEdicao, manifestoDe, normalizarDocV3, resolverPropsHeadline, resolverPropsMoldura, validarDocHeadline, validarDocMoldura,
  type AnyEditDoc, type EditManifest as ManifestoVideo, type MolduraProps, type RemixKeepProps,
} from '@maquina/video';
import { Prisma, type Creative, type VideoFormat } from '@prisma/client';
import { StorageService } from '../arquivos/storage.service';
import { editMapOf, sectionsOf } from '../campeoes/champion-views';
import { faixasDoCampeao } from '../campeoes/faixas-protegidas';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { CreativeStateMachine } from '../criativos/state-machine';
import { CustosService } from '../custos/custos.service';
import { EventosService } from '../eventos/eventos.service';
import { brainOf } from '../iteracao/contexto';
import { HEADLINE_MAX_ADD } from '../iteracao/headline-plano';
import { PrismaService } from '../prisma/prisma.service';
import type { RenderInput } from '../render/contrato';
import type { AutoEditContext } from './auto-edit-input';
import { EdicaoService } from './edicao.service';
import {
  headlineRetiredOf,
  RECHECKABLE_CODES, exportViewOf, faceTrackDoArquivo, factsNumbersOf, lastPassedExportOf, pendingExportOf, pendingFromDocs, provenanceOf, templateKeyOf, utcDayStart,
} from './editor-auto';
import { EditorExportService } from './editor-export.service';
import { anunciarEdicao, lastSave } from './editor-saves';
import type { PutEditorDto } from './editor.dto';
import {
  ALL_FORMATS, AUTO_EDIT_TEMPLATE, FORMAT_CODE, FORMAT_OF_CODE, PRIORITY_ON_DEMAND, codeWithEd, editedFromRenders, latestReadyByFormat, paramsOf, primaryFormatOf,
  servedRenders, supportedFormatsOf,
} from './pecas';
import { ProxyService, proxyEtaSec } from './proxy.service';
import { textosDaMoldura } from '@maquina/video';

/** §9.5: custo nosso por export (Lambda + 1-2 checagens por visão), o que passa pelo teto do workspace. */
export const EDITOR_EXPORT_ESTIMATE_USD = 0.04;
/** §14: "Retry check" = 1-2 checagens por visão. */
export const EDITOR_RECHECK_ESTIMATE_USD = 0.016;
/** PUT/export não precisam de URL: a montagem (bases dos formatos) fica em cache curto por criativo. */
const CACHE_MS = 5 * 60_000;

const CREATIVE_INCLUDE = {
  variationItem: { select: { id: true, batchId: true, autoType: true, payload: true, code: true } },
  renders: { where: { stale: false }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.CreativeInclude;
type CreativeRow = Prisma.CreativeGetPayload<{ include: typeof CREATIVE_INCLUDE }>;

interface Peca {
  c: CreativeRow;
  key: EditTemplateKey;
  params: Record<string, unknown> | null;
  primary: VideoFormat;
  primaryCode: FormatCode;
}

interface Montagem {
  ctx: AutoEditContext;
  /** base de cada formato (builder de hoje, sem doc); null = o formato não existe/não coube nesta peça */
  bases: Map<FormatCode, RenderInput | null>;
  manifest: EditManifest;
  guard: EditorGuard;
}

/** Tira do input o que é da fila (kind/renderId/templateId): a `base` do editor são as props da composição. */
function propsDoInput(i: RenderInput): EditorPropsJson {
  const { kind: _k, renderId: _r, templateId: _t, ...rest } = i as unknown as Record<string, unknown>;
  return rest;
}

const manifestoVideo = (m: EditManifest) => m as unknown as ManifestoVideo;

@Injectable()
export class EditorAutoService {
  private readonly cache = new Map<string, { at: number; m: Montagem }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly edicao: EdicaoService,
    private readonly proxy: ProxyService,
    private readonly fin: EditorExportService,
    private readonly custos: CustosService,
    private readonly eventos: EventosService,
    private readonly sm: CreativeStateMachine,
    private readonly locks: KeyedMutex,
    private readonly config: AppConfig,
  ) {}

  // ───────── peça, estado e montagem ─────────

  private async peca(auth: AuthContext, id: string): Promise<Peca> {
    const c = await this.prisma.creative.findFirst({ where: { id, workspaceId: auth.workspaceId, archivedAt: null }, include: CREATIVE_INCLUDE });
    if (!c) throw new AppException('NOT_FOUND');
    const params = paramsOf(c.variationItem?.payload);
    const key = templateKeyOf(c.variationItem?.autoType ?? null, params);
    if (!key) throw new AppException('EDIT_NOT_SUPPORTED', { reason: 'auto_type_not_editable' });
    if (headlineRetiredOf(c.variationItem?.autoType, params)) throw new AppException('EDIT_NOT_SUPPORTED', { reason: 'headline_plate_retired' });
    const primary = primaryFormatOf(c.variationItem?.autoType ?? null, params);
    // §7.3: abre quando o formato principal está pronto (a peça AUTO pronta é APPROVED com o 9:16/aspecto READY)
    const ready = c.state === 'APPROVED' && !!latestReadyByFormat(servedRenders(c.renders)).get(primary);
    if (!ready) throw new AppException('INVALID_STATE', { state: c.state, allowed: ['APPROVED'], reason: 'piece_not_ready' });
    return { c, key, params, primary, primaryCode: FORMAT_CODE[primary] };
  }

  /** §7.3: `published` = anúncio criado na Meta pela integração (PUBLISHING/PAUSED/ACTIVE). A peça AUTO pronta é sempre
   *  APPROVED, então `approved` só vale pro criativo do zero (F-U2). */
  private async readOnlyOf(c: Creative): Promise<EditorStateV3['readOnly']> {
    const n = await this.prisma.metaPublication.count({ where: { creativeId: c.id, status: { in: ['PUBLISHING', 'PAUSED', 'ACTIVE'] } } });
    return n ? { reason: 'published' } : null;
  }

  private formatosDe(p: Peca): FormatCode[] {
    if (p.key === 'headline') return [p.primaryCode];
    const sup = supportedFormatsOf(p.c.variationItem?.autoType ?? null, p.params) ?? ['9x16', '4x5', '1x1'];
    return ALL_FORMATS.map((f) => FORMAT_CODE[f]).filter((f) => sup.includes(f));
  }

  private headlineMaxChars(p: Peca): number | null {
    if (p.key !== 'headline') return null;
    const original = typeof p.params?.original === 'string' ? p.params.original : null;
    return p.params?.mode === 'add' || !original ? HEADLINE_MAX_ADD : Math.min(90, Math.max(20, Math.round(original.length * 1.2)));
  }

  /** Bases dos formatos (builder de hoje, sem doc), manifesto e guarda. `videoUrl` = proxy (só o GET precisa). */
  private async montar(p: Peca, videoUrl: string | null): Promise<Montagem> {
    let ctx: AutoEditContext;
    try {
      ctx = await this.edicao.editorContext(p.c);
    } catch (e) {
      throw new AppException('INVALID_STATE', { state: p.c.state, allowed: [], reason: (e as { code?: string }).code === 'SOURCE_UNAVAILABLE' ? 'source_unavailable' : 'piece_not_ready' });
    }
    const formatos = this.formatosDe(p);
    const bases = new Map<FormatCode, RenderInput | null>();
    for (const f of ALL_FORMATS.map((x) => FORMAT_CODE[x])) {
      if (!formatos.includes(f)) { bases.set(f, null); continue; }
      try {
        bases.set(f, (await this.edicao.editorBase(p.c, FORMAT_OF_CODE[f], { videoUrl, ctx })).input);
      } catch {
        bases.set(f, null); // o texto da IA não coube neste formato (FRAME_TEXT_OVERFLOW etc.): formato sem base
      }
    }
    const principal = bases.get(p.primaryCode);
    if (!principal) throw new AppException('INVALID_STATE', { state: p.c.state, allowed: [], reason: 'piece_not_ready' });
    const ok = [p.primaryCode, ...formatos.filter((f) => f !== p.primaryCode && bases.get(f))];
    const manifest = manifestoDe(p.key, principal as unknown as MolduraProps | RemixKeepProps, { formats: ok, headlineMaxChars: this.headlineMaxChars(p) }) as unknown as EditManifest;
    const dims = { width: ctx.source.width, height: ctx.source.height };
    const guard: EditorGuard = {
      source: { ...dims, fps: ctx.source.fps },
      protectedBands: faixasDoCampeao(ctx.editMap ?? null, dims),
      faceTrack: faceTrackDoArquivo(ctx.editMap ?? null, ctx.source),
    };
    return { ctx, bases, manifest, guard };
  }

  private async montagemEmCache(p: Peca): Promise<Montagem> {
    const hit = this.cache.get(p.c.id);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.m;
    const m = await this.montar(p, null);
    this.cache.set(p.c.id, { at: Date.now(), m });
    return m;
  }

  private resolver(p: Peca, base: RenderInput, doc: AnyEditDoc | null, fmt: FormatCode) {
    return p.key === 'headline'
      ? resolverPropsHeadline(base as unknown as RemixKeepProps, doc, { format: fmt, principal: p.primaryCode })
      : resolverPropsMoldura(base as unknown as MolduraProps, doc, { format: fmt, principal: p.primaryCode });
  }

  /** §6.2: checagens do doc em cada formato que a peça tem (o Export olha só o principal). */
  private issues(p: Peca, m: Montagem, doc: EditDocV3 | null, facts: string[]): EditIssue[] {
    const out: EditIssue[] = [];
    for (const fmt of m.manifest.formats) {
      const base = m.bases.get(fmt);
      if (!base) continue;
      const r = this.resolver(p, base, doc as AnyEditDoc | null, fmt);
      out.push(...(checarEdicao(r.layout, m.guard as never, r.textos, { numbers: facts }, doc as AnyEditDoc | null) as unknown as EditIssue[]));
    }
    return out;
  }

  /** `anterior` (o doc salvo, no PUT): mudar a caixa do vídeo mantendo o enquadramento de antes zera o enquadramento (§4). */
  private normalizar(p: Peca, m: Montagem, doc: unknown, anterior?: unknown): EditDocV3 | null {
    return normalizarDocV3(doc as AnyEditDoc | null, m.bases.get(p.primaryCode) as unknown as MolduraProps | RemixKeepProps, manifestoVideo(m.manifest), anterior as AnyEditDoc | null | undefined) as unknown as EditDocV3 | null;
  }

  /** Fatos (números que podem aparecer sem confirmação) e o Brain da oferta. */
  private async fatos(c: Creative, ctx: AutoEditContext): Promise<{ numbers: string[]; brain: Record<string, string | null> }> {
    const [offer, td] = await Promise.all([
      this.prisma.offer.findUnique({ where: { id: c.offerId } }),
      c.championId ? this.prisma.teardown.findUnique({ where: { championId: c.championId }, select: { sections: true } }) : null,
    ]);
    const brain = offer ? (brainOf(offer) as unknown as Record<string, string | null>) : {};
    const s = sectionsOf(td?.sections)?.offerProofCta;
    const spokenCta = s?.status === 'ok' ? s.data?.ctaSpoken ?? null : null;
    return { numbers: factsNumbersOf({ brain, spokenCta, words: ctx.words }), brain };
  }

  // ───────── GET ─────────

  async get(auth: AuthContext, creativeId: string): Promise<EditorStateV3> {
    const p = await this.peca(auth, creativeId);
    const c = p.c;
    // §8: proxy 540p do vídeo do campeão (o que a peça usa: a versão sem legenda, se houver); sem ele, enfileira e responde building
    const ch = c.championId ? await this.prisma.champion.findUnique({ where: { id: c.championId }, include: { videoFile: true, cleanVideoFile: true } }) : null;
    const original = ch?.cleanVideoFile ?? ch?.videoFile ?? null;
    const proxyFile = original ? await this.proxy.of(original.id) : null;
    if (original && !proxyFile) void this.proxy.ensure(original);
    const m = await this.montar(p, proxyFile ? await this.storage.signedUrl(proxyFile) : null);
    this.cache.set(c.id, { at: Date.now(), m });
    const doc = this.normalizar(p, m, c.editDoc);
    const { numbers, brain } = await this.fatos(c, m.ctx);
    const principal = m.bases.get(p.primaryCode)!;
    const textos: Map<string, string> = p.key === 'headline'
      ? new Map([['layer:headline', String(p.params?.text ?? '')]])
      : textosDaMoldura(principal as unknown as MolduraProps);
    const exported = lastPassedExportOf(c.renders, p.primary);
    const pend = pendingExportOf(c.renders);
    const edited = editedFromRenders(c.renders, p.primary);
    const ws = await this.prisma.workspace.findUnique({ where: { id: c.workspaceId }, select: { brandColor: true } });
    const baseCode = c.variationItem?.code ?? c.variationCode ?? null;
    return {
      version: 3,
      revision: c.editRevision,
      base: 'auto-piece',
      composition: p.key === 'headline' ? 'RemixKeep' : 'Moldura',
      templateKey: p.key,
      manifest: m.manifest,
      doc,
      source: {
        kind: 'auto-piece',
        fps: m.ctx.source.fps,
        durationSec: m.ctx.source.durationSec,
        language: m.ctx.language,
        formats: ALL_FORMATS.map((f) => {
          const b = m.manifest.formats.includes(FORMAT_CODE[f]) ? m.bases.get(FORMAT_CODE[f]) ?? null : null;
          return { format: FORMAT_CODE[f], supported: !!b, base: b ? propsDoInput(b) : null };
        }),
        guard: m.guard,
        words: m.ctx.words.map((w) => ({ word: w.word, startSec: w.startSec, endSec: w.endSec })),
      },
      settings: null,
      facts: { numbers },
      provenance: provenanceOf(textos, (p.params?.sources ?? null) as Record<string, unknown> | null, brain, p.key === 'headline' ? 'headline' : 'frame'),
      issues: this.issues(p, m, doc, numbers),
      proxy: proxyFile ? { status: 'ready', etaSec: null } : original ? { status: 'building', etaSec: proxyEtaSec(Number(original.durationSec ?? 0) || null) } : { status: 'none', etaSec: null },
      urlsExpireAt: new Date(Date.now() + this.config.storage.signedUrlTtlSec * 1000).toISOString(),
      fonts: editorFonts(), // decisão 06/11: o seletor fica com as 9 fontes de antes do F1b
      brandColor: ws?.brandColor ?? null,
      readOnly: await this.readOnlyOf(c),
      dirty: pendingFromDocs(doc, exported?.doc ?? null),
      exported: exported ? { revision: exported.editRevision ?? 0, at: (exported.finishedAt ?? exported.createdAt).toISOString() } : null,
      export: pend ? exportViewOf(pend) : null,
      editedInEditor: edited,
      code: baseCode ? codeWithEd(baseCode, edited) : null,
      baseCode,
      piece: c.variationItem ? { id: c.variationItem.id, batchId: c.variationItem.batchId } : null,
    };
  }

  // ───────── PUT (autosave) ─────────

  private exportRodando(c: CreativeRow): boolean {
    const pend = pendingExportOf(c.renders);
    return !!pend && (pend.status === 'QUEUED' || pend.status === 'RENDERING');
  }

  /** "It's true, keep it": confirmação nova (ou com outros números) leva quem confirmou e quando; a mesma de antes fica como estava. */
  private carimbar(doc: EditDocV3 | null, antes: unknown, userId: string, now: Date): EditDocV3 | null {
    if (!doc?.confirmations?.length) return doc;
    const velhas = ((antes as EditDocV3 | null)?.confirmations ?? []) as TextConfirmation[];
    const igual = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
    const confirmations = doc.confirmations.map((x) => {
      const v = velhas.find((o) => o.path === x.path && igual(o.numbers ?? [], x.numbers ?? []));
      return v ? { ...x, byUserId: v.byUserId, at: v.at } : { ...x, byUserId: userId, at: now.toISOString() };
    });
    return { ...doc, confirmations };
  }

  async put(auth: AuthContext, creativeId: string, dto: PutEditorDto): Promise<PutEditorResponseV3> {
    return this.locks.run(creativeId, async () => {
      const p = await this.peca(auth, creativeId);
      const c = p.c;
      if (await this.readOnlyOf(c)) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'read_only' });
      if (this.exportRodando(c)) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'export_running' });
      if (dto.baseRevision !== c.editRevision) {
        const last = await lastSave(this.prisma, c);
        throw new AppException('EDIT_CONFLICT', { revision: c.editRevision, savedBy: last.savedBy, savedAt: last.savedAt });
      }
      // `settings` (EditSettings) é só do criativo do zero
      if (dto.settings && Object.values(dto.settings).some((v) => v !== undefined)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'settings', rule: 'not_editable' }] });
      const m = await this.montagemEmCache(p);
      const base = m.bases.get(p.primaryCode)!;
      const pedido = (dto.doc ?? null) as unknown as AnyEditDoc | null;
      const erros = p.key === 'headline'
        ? validarDocHeadline(pedido, base as unknown as RemixKeepProps, { manifest: manifestoVideo(m.manifest) })
        : validarDocMoldura(pedido, base as unknown as MolduraProps, { manifest: manifestoVideo(m.manifest) });
      if (erros.length) throw new AppException('VALIDATION_ERROR', { fields: erros });
      const now = new Date();
      const doc = this.carimbar(this.normalizar(p, m, pedido, c.editDoc), c.editDoc, auth.userId, now);
      const { numbers } = await this.fatos(c, m.ctx);
      const issues = this.issues(p, m, doc, numbers);
      const exported = lastPassedExportOf(c.renders, p.primary);
      const revision = c.editRevision + 1;
      // §7.3: salvar não muda a peça servida (só o doc, a revisão e quem salvou)
      const r = await this.prisma.creative.updateMany({
        where: { id: c.id, editRevision: c.editRevision, archivedAt: null },
        data: {
          editDoc: doc ? (doc as unknown as Prisma.InputJsonValue) : Prisma.DbNull, editRevision: revision,
          editDirty: pendingFromDocs(doc, exported?.doc ?? null), editSavedById: auth.userId, editSavedAt: now,
        },
      });
      if (r.count !== 1) {
        const fresh = await this.prisma.creative.findUniqueOrThrow({ where: { id: c.id } });
        const last = await lastSave(this.prisma, fresh);
        throw new AppException('EDIT_CONFLICT', { revision: fresh.editRevision, savedBy: last.savedBy, savedAt: last.savedAt });
      }
      this.sm.announce(c.id);
      await anunciarEdicao({ prisma: this.prisma, eventos: this.eventos }, c.id, auth.userId, revision, now);
      return { revision, doc, settings: null, issues, dirty: true as const, savedAt: now.toISOString() };
    });
  }

  // ───────── export (§9) ─────────

  async export(auth: AuthContext, creativeId: string, revision: number): Promise<EditorExportView> {
    const renderId = await this.locks.run(creativeId, async () => {
      const p = await this.peca(auth, creativeId);
      const c = p.c;
      if (await this.readOnlyOf(c)) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'read_only' });
      if (revision !== c.editRevision) {
        const last = await lastSave(this.prisma, c);
        throw new AppException('EDIT_CONFLICT', { revision: c.editRevision, savedBy: last.savedBy, savedAt: last.savedAt });
      }
      if (this.exportRodando(c)) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'export_running' });
      if (servedRenders(c.renders).some((r) => r.status === 'QUEUED' || r.status === 'RENDERING')) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'render_running' });
      const exported = lastPassedExportOf(c.renders, p.primary);
      if (!pendingFromDocs(c.editDoc, exported?.doc ?? null)) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'nothing_to_export' });
      // §6.2: recalculado no servidor, com a mesma função do web; só o formato principal decide
      const m = await this.montagemEmCache(p);
      const doc = this.normalizar(p, m, c.editDoc);
      const { numbers } = await this.fatos(c, m.ctx);
      const travas = this.issues(p, m, doc, numbers).filter((i) => i.format === p.primaryCode && (i.level === 'block' || i.level === 'confirm'));
      if (travas.length) throw new AppException('EDIT_BLOCKED', { issues: travas } satisfies EditBlockedDetails);
      // §7.1: limite de exports grátis por workspace por dia (UTC) e o teto de gasto (o custo do Lambda/visão é nosso)
      const desde = utcDayStart();
      const hoje = await this.prisma.render.count({ where: { workspaceId: c.workspaceId, createdAt: { gte: desde }, settings: { path: ['editorExport'], equals: true } } });
      const limit = this.config.editorExportsPerDay;
      if (hoje >= limit) throw new AppException('RATE_LIMITED', { limit, resetAt: new Date(desde.getTime() + 86_400_000).toISOString() });
      await this.custos.assertWithinCap(c.workspaceId, EDITOR_EXPORT_ESTIMATE_USD);
      const r = await this.prisma.render.create({
        data: {
          workspaceId: c.workspaceId, creativeId: c.id, status: 'QUEUED', format: p.primary, engine: 'REMOTION', priority: PRIORITY_ON_DEMAND,
          settings: { templateId: AUTO_EDIT_TEMPLATE, editorExport: true }, input: {},
          doc: doc ? (doc as unknown as Prisma.InputJsonValue) : Prisma.DbNull, editRevision: c.editRevision,
        },
      });
      return r.id;
    });
    this.edicao.kick();
    await this.fin.publish(renderId);
    return exportViewOf(await this.prisma.render.findUniqueOrThrow({ where: { id: renderId } }));
  }

  async recheck(auth: AuthContext, creativeId: string): Promise<EditorExportView> {
    const renderId = await this.locks.run(creativeId, async () => {
      const p = await this.peca(auth, creativeId);
      const c = p.c;
      if (await this.readOnlyOf(c)) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'read_only' });
      const pend = pendingExportOf(c.renders);
      if (!pend || pend.status !== 'FAILED' || !RECHECKABLE_CODES.has(pend.errorCode ?? '') || !pend.fileId) {
        throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'cannot_recheck' });
      }
      await this.custos.assertWithinCap(c.workspaceId, EDITOR_RECHECK_ESTIMATE_USD);
      const n = await this.prisma.render.updateMany({
        where: { id: pend.id, status: 'FAILED' },
        // impl null: o poller do Lambda não pega; finalizingAt: o settle não pega (a checagem roda aqui)
        data: { status: 'RENDERING', stage: 'caption_check', impl: null, finalizingAt: new Date(), errorCode: null, failReason: null, failDetail: Prisma.DbNull, finishedAt: null },
      });
      if (n.count !== 1) throw new AppException('INVALID_STATE', { state: c.state, allowed: [], reason: 'cannot_recheck' });
      return pend.id;
    });
    await this.fin.publish(renderId);
    void this.fin.recheck(renderId);
    return exportViewOf(await this.prisma.render.findUniqueOrThrow({ where: { id: renderId } }));
  }
}
