import { Inject, Injectable } from '@nestjs/common';
import type {
  ChampionConfig, ChampionDetail, ChampionRow, Job, Section, Teardown, TeardownSectionKey, TeardownSections,
} from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { DEFAULT_LIMIT, afterCursor, decodeCursor, page } from '../common/http/pagination';
import { num } from '../common/util/format';
import { KeyedMutex } from '../common/util/mutex';
import { AppConfig } from '../config/app-config';
import { CustosService } from '../custos/custos.service';
import { CATALOG_SERVICE, type CatalogService } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import { AnaliseService } from './analise.service';
import { CHAMPION_ENTRY, ChampionStateMachine, assertChampionCan, championInvalidState } from './champion-state-machine';
import { CHAMPION_INCLUDE, ChampionViews, SECTION_KEYS, sectionsOf, transcriptOf } from './champion-views';
import type { AnalyzeChampionDto, CreateChampionDto, ListChampionsQueryDto, UpdateChampionDto, UpdateTeardownDto } from './campeoes.dto';
import { ALL_KINDS, CHAMPION_MIME_TYPES, ENABLED_KINDS, adArchiveIdOf, analysisEstimateUsd, analysisUsdPerSec } from './limites';
import { AD_LIBRARY, errorCodeOf, type AdLibraryService } from './portas';

/** Quanto o POST /champions espera a recusa síncrona da Ad Library (teto/sem chave) antes de responder 202. */
const SYNC_REFUSAL_WAIT_MS = 1500;

@Injectable()
export class CampeoesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly views: ChampionViews,
    private readonly sm: ChampionStateMachine,
    private readonly analise: AnaliseService,
    private readonly uploads: UploadsService,
    private readonly custos: CustosService,
    private readonly jobs: JobsService,
    private readonly locks: KeyedMutex,
    private readonly cfg: AppConfig,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    @Inject(AD_LIBRARY) private readonly adlib: AdLibraryService,
  ) {}

  private async full(auth: AuthContext, id: string) {
    const c = await this.views.load(auth.workspaceId, id);
    if (!c) throw new AppException('NOT_FOUND');
    return c;
  }

  // ───────── leitura ─────────

  async config(): Promise<ChampionConfig> {
    const st = await this.adlib.status().catch(() => ({ available: false, reason: 'not_configured' as const, retryAfter: null }));
    return {
      maxBytes: this.cfg.uploadMaxBytes,
      minSec: this.cfg.championMinSec,
      maxSec: this.cfg.championMaxSec,
      mimeTypes: [...CHAMPION_MIME_TYPES],
      adLibrary: { available: st.available, reason: st.available ? null : st.reason ?? 'not_configured', retryAfter: st.retryAfter ?? null },
      analysisUsdPerSec: analysisUsdPerSec(this.catalog),
      kinds: ALL_KINDS.map((kind) => ({ kind, enabled: ENABLED_KINDS.includes(kind) })),
    };
  }

  async list(auth: AuthContext, q: ListChampionsQueryDto): Promise<{ items: ChampionRow[]; nextCursor: string | null }> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const rows = await this.prisma.champion.findMany({
      where: { AND: [{ workspaceId: auth.workspaceId, archivedAt: null }, q.offerId ? { offerId: q.offerId } : {}, afterCursor('updatedAt', decodeCursor(q.cursor))] },
      include: CHAMPION_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const p = page(rows, limit, (r) => r.updatedAt);
    return { items: await Promise.all(p.items.map((c) => this.views.row(c))), nextCursor: p.nextCursor };
  }

  async get(auth: AuthContext, id: string): Promise<ChampionDetail> {
    return this.views.detail(await this.full(auth, id));
  }

  // ───────── criar ─────────

  /** POST /champions: upload (ANALYZING) e/ou link (só link = RESOLVING). `rights` só é gravado (decisão D1). */
  async create(auth: AuthContext, dto: CreateChampionDto): Promise<ChampionDetail> {
    if (!dto.uploadId && !dto.adLibraryUrl) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'uploadId', rule: 'uploadIdOrAdLibraryUrl' }] });
    }
    const adArchiveId = dto.adLibraryUrl ? adArchiveIdOf(dto.adLibraryUrl) : null;
    if (dto.adLibraryUrl && !adArchiveId) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'adLibraryUrl', rule: 'ad_library_single_ad' }] });
    const offer = await this.prisma.offer.findFirst({ where: { id: dto.offerId, workspaceId: auth.workspaceId, archivedAt: null } });
    if (!offer) throw new AppException('NOT_FOUND');
    const file = dto.uploadId ? await this.uploads.readyFile(auth.workspaceId, dto.uploadId) : null;
    const durationSec = num(file?.durationSec) ?? null;
    await this.custos.assertWithinCap(auth.workspaceId, analysisEstimateUsd(this.catalog, durationSec ?? 30));

    const linkOnly = !file;
    if (linkOnly) {
      const st = await this.adlib.status().catch(() => ({ available: false, reason: 'not_configured' as const, retryAfter: null }));
      if (!st.available) throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: st.reason ?? 'not_configured', retryAfter: st.retryAfter ?? null });
    }
    const now = new Date();
    const name = dto.name?.trim() || (file ? stripExt(await this.uploadFilename(dto.uploadId!)) : `Ad ${adArchiveId}`);
    const { champion, job } = await this.prisma.$transaction(async (tx) => {
      const champion = await tx.champion.create({
        data: {
          workspaceId: auth.workspaceId, offerId: offer.id, name: name.slice(0, 120),
          status: linkOnly ? CHAMPION_ENTRY.LINK_ONLY : CHAMPION_ENTRY.WITH_UPLOAD,
          rights: dto.rights, rightsDeclaredById: auth.userId, rightsDeclaredAt: now,
          adLibraryUrl: dto.adLibraryUrl ?? null, adArchiveId, videoFileId: file?.id ?? null, durationSec,
          notes: dto.notes ?? null, createdById: auth.userId,
        },
      });
      const job = await tx.job.create({
        data: {
          workspaceId: auth.workspaceId, type: linkOnly ? 'CHAMPION_RESOLVE' : 'CHAMPION_ANALYZE', status: 'QUEUED',
          input: { championId: champion.id }, championId: champion.id, offerId: offer.id, createdById: auth.userId,
        },
      });
      return { champion, job };
    });

    if (linkOnly) {
      // 202 = o campeão como nasceu (RESOLVING, contrato §19); o resolve segue em segundo plano. A Ad Library pode
      // recusar na hora (teto, sem chave): aí nada fica criado e a resposta é 503 síncrono.
      const born = await this.get(auth, champion.id);
      const run = this.analise.runResolve(job.id, champion.id, auth.userId);
      await Promise.race([run, new Promise((r) => setTimeout(r, SYNC_REFUSAL_WAIT_MS).unref())]);
      const after = await this.prisma.champion.findUnique({ where: { id: champion.id }, select: { status: true, errorCode: true, adMeta: true } });
      if (after?.status === 'FAILED' && after.errorCode === 'AD_LIBRARY_UNAVAILABLE') {
        const refusal = this.analise.takeAdRefusal(champion.id);
        await this.prisma.champion.delete({ where: { id: champion.id } });
        throw new AppException('AD_LIBRARY_UNAVAILABLE', { reason: refusal?.reason ?? 'provider_error', retryAfter: refusal?.retryAfter ?? null });
      }
      return born;
    } else {
      void this.jobs.detach(job.id, 'análise do campeão', () => this.analise.runAnalyze(job.id, champion.id));
    }
    return this.get(auth, champion.id);
  }

  private async uploadFilename(uploadId: string): Promise<string> {
    const up = await this.prisma.upload.findUnique({ where: { id: uploadId }, select: { filename: true } });
    return up?.filename ?? 'Champion';
  }

  // ───────── editar ─────────

  async update(auth: AuthContext, id: string, dto: UpdateChampionDto): Promise<ChampionDetail> {
    const c = await this.full(auth, id);
    await this.prisma.champion.update({
      where: { id: c.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.rights !== undefined && { rights: dto.rights, rightsDeclaredById: auth.userId, rightsDeclaredAt: new Date() }),
      },
    });
    return this.get(auth, id);
  }

  /** PUT /champions/:id/video: anexa um upload a um campeão FAILED (ex.: link não resolveu) e analisa. */
  async attachVideo(auth: AuthContext, id: string, uploadId: string): Promise<ChampionDetail> {
    const jobId = await this.locks.run(`champion:${id}`, async () => {
      const c = await this.full(auth, id);
      assertChampionCan(c.status, 'ATTACH_VIDEO');
      const file = await this.uploads.readyFile(auth.workspaceId, uploadId);
      const d = num(file.durationSec);
      await this.custos.assertWithinCap(auth.workspaceId, analysisEstimateUsd(this.catalog, d ?? 30));
      const job = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({
          tx, championId: c.id, event: 'ATTACH_VIDEO', from: c.status, to: 'ANALYZING',
          data: { videoFileId: file.id, audioFileId: null, thumbnailFileId: null, durationSec: d, errorCode: null, failReason: null, hasSpeech: false },
        });
        // vídeo novo: transcrição e medições do anterior não valem mais
        await tx.teardown.deleteMany({ where: { championId: c.id } });
        return tx.job.create({ data: { workspaceId: c.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId: c.id }, championId: c.id, offerId: c.offerId, createdById: auth.userId } });
      });
      return job.id;
    });
    void this.jobs.detach(jobId, 'análise do campeão', () => this.analise.runAnalyze(jobId, id));
    return this.get(auth, id);
  }

  /** POST /champions/:id/analyze: de FAILED ou READY; com seção editada exige confirm (409 CONFIRM_DOWNSTREAM_RESET). */
  async analyze(auth: AuthContext, id: string, dto: AnalyzeChampionDto): Promise<{ job: Job }> {
    const jobId = await this.locks.run(`champion:${id}`, async () => {
      const c = await this.full(auth, id);
      assertChampionCan(c.status, 'ANALYZE_AGAIN');
      if (!c.videoFileId) throw championInvalidState(c.status, ['READY']); // sem vídeo: action upload_video
      const edited = c.teardown?.editedSections ?? [];
      if (edited.length && !dto.confirm) throw new AppException('CONFIRM_DOWNSTREAM_RESET', { editedSections: edited });
      await this.custos.assertWithinCap(auth.workspaceId, analysisEstimateUsd(this.catalog, num(c.durationSec) ?? 30));
      const job = await this.prisma.$transaction(async (tx) => {
        await this.sm.transition({ tx, championId: c.id, event: 'ANALYZE_AGAIN', from: c.status, to: 'ANALYZING', data: { errorCode: null, failReason: null } });
        return tx.job.create({ data: { workspaceId: c.workspaceId, type: 'CHAMPION_ANALYZE', status: 'QUEUED', input: { championId: c.id, confirm: !!dto.confirm }, championId: c.id, offerId: c.offerId, createdById: auth.userId } });
      });
      return job.id;
    });
    void this.jobs.detach(jobId, 'análise do campeão', () => this.analise.runAnalyze(jobId, id));
    return { job: await this.jobs.get(auth, jobId) };
  }

  /** PATCH /champions/:id/teardown: seções editadas (autosave) e correção de palavra (tempos não mudam). */
  async updateTeardown(auth: AuthContext, id: string, dto: UpdateTeardownDto): Promise<Teardown> {
    return this.locks.run(`champion:${id}`, async () => {
      const c = await this.full(auth, id);
      if (c.status === 'ANALYZING' || c.status === 'RESOLVING') throw championInvalidState(c.status, ['READY', 'FAILED']);
      const t = c.teardown;
      const sections = sectionsOf(t?.sections);
      if (!t || !sections) throw new AppException('NOT_FOUND');
      const data: Prisma.TeardownUpdateInput = {};
      const edited = new Set(t.editedSections);
      if (dto.sections) {
        const next = { ...sections } as Record<TeardownSectionKey, Section<unknown>>;
        for (const [key, value] of Object.entries(dto.sections)) {
          if (!(SECTION_KEYS as readonly string[]).includes(key)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: `sections.${key}`, rule: 'isSectionKey' }] });
          if (!isSection(value)) throw new AppException('VALIDATION_ERROR', { fields: [{ field: `sections.${key}`, rule: 'isSection' }] });
          next[key as TeardownSectionKey] = value;
          edited.add(key);
        }
        data.sections = next as unknown as Prisma.InputJsonValue;
        data.editedSections = [...edited];
      }
      if (dto.transcriptWords?.length) {
        const tr = transcriptOf(t.transcript);
        if (!tr) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'transcriptWords', rule: 'noTranscript' }] });
        const words = tr.words.map((w) => ({ ...w }));
        for (const e of dto.transcriptWords) {
          if (!words[e.index]) throw new AppException('VALIDATION_ERROR', { fields: [{ field: `transcriptWords.${e.index}.index`, rule: 'exists' }] });
          words[e.index].word = e.word.trim();
        }
        data.transcript = { ...tr, words, text: words.map((w) => w.word).join(' ') } as unknown as Prisma.InputJsonValue;
      }
      const fresh = await this.prisma.teardown.update({ where: { id: t.id }, data });
      await this.prisma.champion.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
      return (await this.views.teardown(fresh))!;
    });
  }

  /** DELETE: arquiva (os criativos de variação ficam). */
  async remove(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const c = await this.full(auth, id);
    await this.prisma.champion.update({ where: { id: c.id }, data: { archivedAt: new Date() } });
    return { ok: true };
  }

  // ───────── retomada ─────────

  /** Boot: campeão RESOLVING/ANALYZING sem processo vivo → FAILED INTERRUPTED (jobs já foram encerrados pela retomada). */
  async recover(workspaceId?: string): Promise<number> {
    const rows = await this.prisma.champion.findMany({ where: { ...(workspaceId && { workspaceId }), status: { in: ['RESOLVING', 'ANALYZING'] }, archivedAt: null } });
    for (const c of rows) {
      if (c.status === 'RESOLVING') {
        await this.sm.transition({ championId: c.id, event: 'RESOLVE_FAILED', from: 'RESOLVING', to: 'FAILED', data: { errorCode: 'INTERRUPTED', failReason: 'The server restarted while this was running. Try again.' } }).catch(() => undefined);
      } else {
        await this.analise.failAnalysis(c.id, null, 'INTERRUPTED');
      }
    }
    return rows.length;
  }
}

function stripExt(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{2,4}$/, '').trim() || 'Champion';
}

function isSection(v: unknown): v is Section<unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Record<string, unknown>;
  if (s.status !== 'ok' && s.status !== 'na') return false;
  if (s.naReason !== null && s.naReason !== undefined && typeof s.naReason !== 'string') return false;
  if (s.data !== null && s.data !== undefined && (typeof s.data !== 'object')) return false;
  if (s.status === 'na' && !s.naReason) return false;
  return true;
}

export type { TeardownSections };
export { errorCodeOf };
