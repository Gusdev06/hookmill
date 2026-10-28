import { Inject, Injectable, Logger } from '@nestjs/common';
import type { FieldOrigin, FieldOrigins, FieldSources, FileRef, Job, Offer as OfferBase, OfferBrief, OfferExtractOutput, OfferReadMeta, PageImageRef, PageRole, ReadMode, ReadPageRef } from '@maquina/contratos';
import { Prisma, type Offer as OfferRow } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { asAsyncErrorCode, failReasonFor, pageUnreadableDetailOf } from '../common/errors/falhas';
import { DEFAULT_LIMIT, afterCursor, decodeCursor, page } from '../common/http/pagination';
import { CustosService, EXTRACT_ESTIMATE_USD } from '../custos/custos.service';
import { CLAUDE_SERVICE, isIntegracaoError, type ClaudeService, type OfferBriefDraft } from '../integracoes';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../arquivos/storage.service';
import { UploadsService } from '../uploads/uploads.service';
import { OnboardingService } from '../workspaces/onboarding';
import { BRIEF_FIELDS, CreateOfferDto, SOURCE_KEYS, UpdateOfferDto, isReadMeta } from './ofertas.dto';

/** variacao-auto-v1 D4 (api.md "Mudanças 13/10"): `Offer` ganha `productImage`. O tipo do @maquina/contratos ainda não
 *  tem o campo (pendência do A0); a forma é a do contrato. */
export type Offer = OfferBase & { productImage: FileRef | null };

/** briefing-leitura-v2 §4.3: progress e etaSec por etapa do OFFER_EXTRACT (a ia emite as 6; etapa pulada é emitida e concluída na hora). */
export const EXTRACT_STAGES = ['fetching_page', 'rendering_page', 'walking_quiz', 'reading_subpages', 'reading_images', 'extracting', 'detecting_language'] as const;
export const STAGE_PROGRESS: Record<string, number> = { fetching_page: 10, rendering_page: 25, walking_quiz: 35, reading_subpages: 45, reading_images: 60, extracting: 80, detecting_language: 95 };
export const STAGE_ETA_SEC: Record<string, number> = { fetching_page: 5, rendering_page: 20, walking_quiz: 30, reading_subpages: 25, reading_images: 10, extracting: 20, detecting_language: 1 };

/**
 * O que a porta `extractOffer` pode devolver além do briefing (briefing-leitura-v2 §4.1). Lido de forma TOLERANTE: a ia
 * entrega os campos quando a cascata estiver pronta; antes disso o backend preenche o mínimo (readMode http/pasted,
 * só a página principal). `sources` = forma crua do modelo (`{ role, imageIndex? }` por campo) que vira `fieldOrigins`.
 */
interface ExtractExtras {
  readMode?: ReadMode;
  pages?: { url: string; role: PageRole; via?: 'http' | 'rendered'; chars?: number; text?: string }[];
  imagesRead?: (PageImageRef & { base64?: string; data?: string })[];
  fieldOrigins?: FieldOrigins;
  sources?: Partial<Record<string, { role: PageRole; imageIndex?: number }[]>>;
  relatedUrls?: string[];
}

export function readMetaOf(json: Prisma.JsonValue | null | undefined): OfferReadMeta | null {
  return isReadMeta(json) ? json : null;
}

/** `sources` do modelo (`role` + `imageIndex`) → `fieldOrigins` (role → url pela lista de páginas; imagem leva a url da página dela). */
export function fieldOriginsOf(extras: ExtractExtras, pages: ReadPageRef[], images: PageImageRef[]): FieldOrigins {
  if (extras.fieldOrigins && typeof extras.fieldOrigins === 'object') return extras.fieldOrigins;
  const out: FieldOrigins = {};
  if (!extras.sources) return out;
  const urlByRole = new Map<string, string>();
  for (const p of pages) if (!urlByRole.has(p.role)) urlByRole.set(p.role, p.url);
  const main = pages.find((p) => p.role === 'main')?.url ?? pages[0]?.url ?? '';
  for (const [field, list] of Object.entries(extras.sources)) {
    if (!(SOURCE_KEYS as readonly string[]).includes(field) || field === 'language' || !Array.isArray(list)) continue;
    const origins: FieldOrigin[] = [];
    for (const s of list) {
      if (!s || typeof s !== 'object' || typeof s.role !== 'string') continue;
      const o: FieldOrigin = { role: s.role, url: urlByRole.get(s.role) ?? main };
      if (typeof s.imageIndex === 'number' && images.some((i) => i.index === s.imageIndex)) o.imageIndex = s.imageIndex;
      origins.push(o);
    }
    if (origins.length) out[field as keyof FieldOrigins] = origins;
  }
  return out;
}

/** Imagens lidas sem o binário (o print morre com o job; só src + o que o modelo leu ficam no output/read_meta). */
function imagesReadOf(extras: ExtractExtras): PageImageRef[] {
  return (extras.imagesRead ?? []).map(({ index, src, alt, kind, widthPx, heightPx, read }) => ({ index, src, alt: alt ?? null, kind, widthPx, heightPx, ...(read && { read }) }));
}

export function briefOf(o: Pick<OfferRow, (typeof BRIEF_FIELDS)[number]>): OfferBrief {
  return Object.fromEntries(BRIEF_FIELDS.map((k) => [k, o[k] ?? null])) as unknown as OfferBrief;
}

/** Oferta do banco → rascunho que a integracoes recebe. */
export function draftOf(o: OfferRow): OfferBriefDraft {
  return { name: o.name, language: o.language, ...briefOf(o) };
}

function sourcesOf(json: Prisma.JsonValue): FieldSources {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  return Object.fromEntries(
    Object.entries(json).filter(([k, v]) => (SOURCE_KEYS as readonly string[]).includes(k) && (v === 'page' || v === 'user')),
  ) as FieldSources;
}

@Injectable()
export class OfertasService {
  private readonly log = new Logger('Ofertas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly custos: CustosService,
    private readonly storage: StorageService,
    private readonly uploads: UploadsService,
    private readonly onboarding: OnboardingService,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
  ) {}

  /** Oferta do workspace (404 se não existe, é de outro workspace ou, com `active`, está arquivada). */
  async find(auth: AuthContext, id: string, opts: { active?: boolean } = {}): Promise<OfferRow> {
    const o = await this.prisma.offer.findFirst({
      where: { id, workspaceId: auth.workspaceId, ...(opts.active && { archivedAt: null }) },
    });
    if (!o) throw new AppException('NOT_FOUND');
    return o;
  }

  private async counts(offerIds: string[]) {
    const [all, winners] = await Promise.all([
      this.prisma.creative.groupBy({ by: ['offerId'], where: { offerId: { in: offerIds }, archivedAt: null }, _count: { _all: true } }),
      this.prisma.creative.groupBy({ by: ['offerId'], where: { offerId: { in: offerIds }, archivedAt: null, isWinner: true }, _count: { _all: true } }),
    ]);
    const m = (rows: typeof all) => new Map(rows.map((r) => [r.offerId, r._count._all]));
    return { all: m(all), winners: m(winners) };
  }

  private async productImages(rows: OfferRow[]): Promise<Map<string, FileRef>> {
    const ids = rows.map((o) => o.productImageFileId).filter((x): x is string => !!x);
    const out = new Map<string, FileRef>();
    if (!ids.length) return out;
    for (const f of await this.prisma.file.findMany({ where: { id: { in: ids } } })) out.set(f.id, await this.storage.fileRef(f));
    return out;
  }

  private present(o: OfferRow, c: { all: Map<string, number>; winners: Map<string, number> }, images: Map<string, FileRef>): Offer {
    return {
      id: o.id,
      name: o.name,
      language: o.language,
      sourceUrl: o.sourceUrl,
      ...briefOf(o),
      fieldSources: sourcesOf(o.fieldSources),
      creativesCount: c.all.get(o.id) ?? 0,
      winnersCount: c.winners.get(o.id) ?? 0,
      updatedAt: o.updatedAt.toISOString(),
      productImage: (o.productImageFileId && images.get(o.productImageFileId)) || null,
      readMeta: readMetaOf(o.readMeta),
    };
  }

  async presentOne(o: OfferRow): Promise<Offer> {
    return this.present(o, await this.counts([o.id]), await this.productImages([o]));
  }

  async list(auth: AuthContext, limit = DEFAULT_LIMIT, cursor?: string) {
    const c = decodeCursor(cursor);
    const rows = await this.prisma.offer.findMany({
      where: { workspaceId: auth.workspaceId, archivedAt: null, ...afterCursor('updatedAt', c) },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const p = page(rows, limit, (r) => r.updatedAt);
    const counts = await this.counts(p.items.map((r) => r.id));
    const images = await this.productImages(p.items);
    return { items: p.items.map((o) => this.present(o, counts, images)), nextCursor: p.nextCursor };
  }

  async get(auth: AuthContext, id: string): Promise<Offer> {
    return this.presentOne(await this.find(auth, id));
  }

  async create(auth: AuthContext, dto: CreateOfferDto): Promise<Offer> {
    const o = await this.prisma.offer.create({
      data: {
        workspaceId: auth.workspaceId,
        createdById: auth.userId,
        name: dto.name.trim(),
        language: dto.language,
        sourceUrl: dto.sourceUrl ?? null,
        ...Object.fromEntries(BRIEF_FIELDS.map((k) => [k, dto[k] ?? null])),
        fieldSources: (dto.fieldSources ?? {}) as Prisma.InputJsonValue,
        // briefing-leitura-v2 D5: "lido de" sobrevive ao wizard
        readMeta: dto.readMeta ? ({ ...dto.readMeta, readAt: dto.readMeta.readAt ?? new Date().toISOString() } as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    await this.onboarding.touchIfSetup(auth.workspaceId, auth.userId); // onboarding-v2 §1: oferta criada no wizard
    return this.presentOne(o);
  }

  /** Autosave: cada campo enviado passa a ser "user" em fieldSources. */
  async update(auth: AuthContext, id: string, dto: UpdateOfferDto): Promise<Offer> {
    const o = await this.find(auth, id, { active: true });
    const data: Prisma.OfferUpdateInput = {};
    const sources = sourcesOf(o.fieldSources);
    for (const k of SOURCE_KEYS) {
      if (dto[k] === undefined) continue;
      (data as Record<string, unknown>)[k] = k === 'name' ? (dto.name as string).trim() : dto[k];
      sources[k] = 'user';
    }
    if (dto.sourceUrl !== undefined) data.sourceUrl = dto.sourceUrl;
    // QA bug 14: o que o web manda em fieldSources vence o `user` automático (apply da leitura grava `page`)
    if (dto.fieldSources) Object.assign(sources, dto.fieldSources);
    if (dto.readMeta !== undefined) {
      data.readMeta = dto.readMeta ? ({ ...dto.readMeta, readAt: dto.readMeta.readAt ?? new Date().toISOString() } as unknown as Prisma.InputJsonValue) : Prisma.JsonNull;
    }
    data.fieldSources = sources as Prisma.InputJsonValue;
    const updated = await this.prisma.offer.update({ where: { id: o.id }, data });
    await this.onboarding.touchIfSetup(auth.workspaceId, auth.userId); // onboarding-v2 §1: só enquanto em SETUP
    return this.presentOne(updated);
  }

  // ───────── D4: foto do produto (variacao-auto-v1 §5.1) ─────────

  /** PUT /offers/:id/product-image: upload READY com purpose PRODUCT_IMAGE (outro purpose = 422 MEDIA_INVALID mime). */
  async setProductImage(auth: AuthContext, id: string, uploadId: string): Promise<Offer> {
    const o = await this.find(auth, id, { active: true });
    const file = await this.uploads.readyFile(auth.workspaceId, uploadId, 'PRODUCT_IMAGE');
    return this.presentOne(await this.prisma.offer.update({ where: { id: o.id }, data: { productImageFileId: file.id } }));
  }

  /** DELETE /offers/:id/product-image (idempotente). O arquivo fica (peças já renderizadas podem apontar pra ele). */
  async removeProductImage(auth: AuthContext, id: string): Promise<Offer> {
    const o = await this.find(auth, id, { active: true });
    return this.presentOne(await this.prisma.offer.update({ where: { id: o.id }, data: { productImageFileId: null } }));
  }

  async archive(auth: AuthContext, id: string) {
    const r = await this.prisma.offer.updateMany({
      where: { id, workspaceId: auth.workspaceId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (r.count !== 1) throw new AppException('NOT_FOUND');
    return { ok: true as const };
  }

  // ───────── extração do briefing (job OFFER_EXTRACT) ─────────

  async extract(auth: AuthContext, input: { url?: string; pageText?: string }): Promise<Job> {
    if (!input.url && !input.pageText) {
      throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'url', rule: 'isDefined' }, { field: 'pageText', rule: 'isDefined' }] });
    }
    return this.startExtraction(auth, input);
  }

  /** Relê a página: o output traz o briefing novo; nada é sobrescrito (o web aplica via PATCH). */
  async reread(auth: AuthContext, id: string, pageText?: string): Promise<Job> {
    const o = await this.find(auth, id, { active: true });
    if (!pageText && !o.sourceUrl) throw new AppException('INVALID_STATE', undefined, 'The offer has no link to read. Paste the page text.');
    return this.startExtraction(auth, { url: pageText ? o.sourceUrl ?? undefined : o.sourceUrl!, pageText }, o.id);
  }

  private async startExtraction(auth: AuthContext, input: { url?: string; pageText?: string }, offerId?: string): Promise<Job> {
    await this.custos.assertWithinCap(auth.workspaceId, EXTRACT_ESTIMATE_USD);
    const job = await this.jobs.create({
      workspaceId: auth.workspaceId,
      type: 'OFFER_EXTRACT',
      createdById: auth.userId,
      offerId,
      input: { ...(input.url && { url: input.url }), ...(input.pageText && { pageTextLength: input.pageText.length }) },
    });
    void this.jobs.detach(job.id, 'extração da oferta', () => this.runExtraction(job.id, auth.workspaceId, input));
    return job;
  }

  /** D6 (reconciliado 22/10): o job NÃO grava `offers.read_meta`; quem aplica o briefing manda `readMeta` no POST/PATCH (reread descartado não sobrescreve). */
  async runExtraction(jobId: string, workspaceId: string, input: { url?: string; pageText?: string }) {
    let stages = Promise.resolve();
    try {
      // Com texto colado, a integracoes não busca a página (a url só entra como sourceUrl).
      const brief = await this.claude.extractOffer(
        { url: input.pageText ? undefined : input.url, pageText: input.pageText, workspaceId, jobId },
        (stage: string) => {
          // §4.3: progress/etaSec por etapa; etapa desconhecida (porta mais nova que o backend) passa sem número
          stages = stages.then(() => this.jobs.stage(jobId, stage, STAGE_PROGRESS[stage], STAGE_ETA_SEC[stage] ?? null).then(() => undefined)).catch(() => undefined);
        },
      );
      await stages;
      const output = this.extractOutput(brief, input);
      await this.jobs.finish(jobId, { status: 'SUCCEEDED', output: output as unknown as Prisma.InputJsonValue });
    } catch (e) {
      await stages;
      const code = isIntegracaoError(e) ? asAsyncErrorCode(e.code) : 'PROVIDER_ERROR';
      if (!isIntegracaoError(e)) this.log.error(`extração ${jobId} falhou: ${(e as Error).stack ?? e}`);
      // §4.3: login_wall / empty_after_render vêm no details do IntegracaoError e trocam a frase (o code e a action não mudam)
      const detail = isIntegracaoError(e) ? pageUnreadableDetailOf(e.details) : undefined;
      await this.jobs.finish(jobId, { status: 'FAILED', errorCode: code, failReason: failReasonFor(code, detail) }).catch(() => undefined);
    }
  }

  /** Briefing + Usage + ExtractSources (tolerante, §4.1) → `Job.output` do OFFER_EXTRACT (§4.2) com `readMeta` pronto pro POST /offers. */
  extractOutput(brief: OfferBriefDraft & { costUsd?: number } & ExtractExtras, input: { url?: string; pageText?: string }): OfferExtractOutput {
    const fieldSources: FieldSources = { name: 'page', language: 'page' };
    for (const k of BRIEF_FIELDS) if (brief[k] != null && brief[k] !== '') fieldSources[k] = 'page';
    const pasted = !!input.pageText;
    const pages: ReadPageRef[] = (brief.pages ?? []).map((p) => ({ url: p.url, role: p.role, via: p.via ?? 'http', chars: p.chars ?? p.text?.length ?? 0 }));
    if (!pages.length && input.url && !pasted) pages.push({ url: input.url, role: 'main', via: 'http', chars: 0 });
    const imagesRead = imagesReadOf(brief);
    const readMode: ReadMode = pasted ? 'pasted' : brief.readMode ?? (imagesRead.length ? 'vision' : pages.length > 1 ? 'crawled' : 'http');
    const fieldOrigins = fieldOriginsOf(brief, pages, imagesRead);
    const relatedUrls = brief.relatedUrls ?? pages.filter((p) => p.role !== 'main').map((p) => p.url);
    const costUsd = Math.round((brief.costUsd ?? 0) * 10_000) / 10_000;
    const readMeta: OfferReadMeta = { readMode, pages, imagesRead, fieldOrigins, costUsd, readAt: new Date().toISOString() };
    return {
      name: brief.name, language: brief.language, sourceUrl: input.url ?? null,
      brief: briefOf(brief), fieldSources,
      readMode, pages, imagesRead, fieldOrigins, costUsd, readMeta, relatedUrls,
    };
  }
}
