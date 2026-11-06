// templates-creditos-v1 §3/§6/§7 (31/10): galeria (com fit por anúncio já lido), "usar template" (o lote AUTO com o tipo
// travado, sem quiz) e o admin do catálogo (preço, status, vídeo de exemplo no storage).
import { Injectable, Logger } from '@nestjs/common';
import { AI_KEYS } from '../templates-ai/contract';
import { TemplatesAiService } from '../templates-ai/templates-ai.service';
import type {
  AdminTemplate, FileRef, TemplateCard, TemplateExampleUpload, TemplateFit, TemplateFitsResponse, TemplateList, TemplateSourceRef, UpdateTemplateBody,
  UseTemplateBody, UseTemplatesBody,
} from '@maquina/contratos';
import { Prisma, type Template } from '@prisma/client';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MediaInvalidError, validateMedia } from '../arquivos/media-validator';
import { StorageService } from '../arquivos/storage.service';
import { sectionsOf } from '../campeoes/champion-views';
import type { AuthContext } from '../common/auth/auth-context';
import { testMode } from '../amostra/acesso';
import { AppException } from '../common/errors/app-exception';
import { num } from '../common/util/format';
import { CreditosService } from '../creditos/creditos.service';
import { IteracaoService } from '../iteracao/iteracao.service';
import { PlanoAutoService } from '../iteracao/plano-auto.service';
import { selectionFitOf, templateFitOf } from '../iteracao/templates-lote';
import { PrismaService } from '../prisma/prisma.service';
import {
  SELECTION_KEY, SELECTION_LIMITS, SELECTION_SLUG, asCategory, availabilityOf, checkSelection, isSelectionRow, packKeysOf, sampleOk, selectionMaxOf, tabOf, visibleToCustomer,
} from './catalogo';

export const EXAMPLE_MAX_BYTES = 60 * 1024 * 1024;
export const EXAMPLE_MAX_SEC = 60;
const UPLOAD_TTL_SEC = 15 * 60;
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

const SOURCE_KEYS = ['championId', 'metaAdId', 'creativeId', 'uploadId', 'researchAdId'] as const; // researchAdId: ads-research-v1 §6.1

@Injectable()
export class TemplatesService {
  private readonly log = new Logger('Templates');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly creditos: CreditosService,
    private readonly iteracao: IteracaoService,
    private readonly plano: PlanoAutoService,
    private readonly ai: TemplatesAiService,
  ) {}

  // ───────── leitura ─────────

  private async locale(userId: string): Promise<string> {
    return (await this.prisma.user.findUnique({ where: { id: userId }, select: { uiLocale: true } }))?.uiLocale ?? 'EN';
  }

  private async isStaff(auth: AuthContext): Promise<boolean> {
    const me = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { access: true } });
    // 04/11 (Gusta): no modo teste o admin vale pra qualquer OWNER. Desligar TEST_MODE no lançamento (docs/backlog.md).
    return auth.role === 'OWNER' && (testMode() || me?.access === 'INTERNAL');
  }

  private async media(key: string | null, mimeType: string): Promise<FileRef | null> {
    return key ? { id: key, url: await this.storage.signedUrlForKey(key), mimeType } : null;
  }

  private async card(t: Template, locale: string, fit: TemplateFit | null): Promise<TemplateCard> {
    const pt = locale === 'PT_BR';
    return {
      slug: t.slug, name: pt ? t.namePt : t.nameEn, description: pt ? t.descPt : t.descEn, out: pt ? t.outPt : t.outEn,
      tier: t.tier, tab: tabOf(t.tier), category: asCategory(t.category), credits: t.credits, outputs: t.outputs, pack: t.pack, beta: t.beta,
      needs: t.needs, example: await this.media(t.exampleKey, 'video/mp4'), poster: await this.media(t.posterKey, 'image/jpeg'), uses: t.uses,
      available: availabilityOf(t).available && (t.autoType !== 'AI_VIDEO' || this.ai.available()), sampleOk: sampleOk(t.tier), fit,
      ...(t.autoType === 'AI_VIDEO' && { autoGenerate: true }),
    };
  }

  /** A fonte (exatamente 0 ou 1) → campeão do workspace (o mais novo) e se já foi lido. */
  async resolveSource(auth: AuthContext, src: TemplateSourceRef): Promise<{ championId: string | null; read: boolean } | null> {
    const given = SOURCE_KEYS.filter((k) => !!src[k]);
    if (!given.length) return null;
    if (given.length > 1) throw new AppException('VALIDATION_ERROR', { fields: [{ field: given[1], rule: 'exactlyOneOf:championId,metaAdId,creativeId,uploadId,researchAdId' }] });
    const base = { workspaceId: auth.workspaceId, archivedAt: null };
    let where: Prisma.ChampionWhereInput | null = null;
    if (src.championId) where = { ...base, id: src.championId };
    else if (src.metaAdId) where = { ...base, metaAdId: src.metaAdId };
    else if (src.creativeId) where = { ...base, sourceCreativeId: src.creativeId };
    // ads-research-v1 §6.1: anúncio do Ad Radar → o campeão do workspace pra ele (sem criar: fits só lê); nenhum = não lido
    else if (src.researchAdId) where = { ...base, researchAdId: src.researchAdId };
    else {
      const up = await this.prisma.upload.findFirst({ where: { id: src.uploadId, workspaceId: auth.workspaceId }, select: { fileId: true } });
      where = up?.fileId ? { ...base, videoFileId: up.fileId } : null;
    }
    const c = where ? await this.prisma.champion.findFirst({ where, orderBy: { createdAt: 'desc' }, include: { teardown: { select: { sections: true } } } }) : null;
    if (!c) return { championId: null, read: false };
    return { championId: c.id, read: c.status === 'READY' && !!sectionsOf(c.teardown?.sections) };
  }

  /** §6: fit de cada template num campeão já lido (null = não lido; as regras do plano, sem chamada paga). */
  private async fitter(championId: string | null, read: boolean, rows: Template[]): Promise<(t: Template) => TemplateFit> {
    const unknown: TemplateFit = { level: 'unknown', reason: 'not_read' };
    const ctx = championId && read ? await this.plano.ctxForChampion(championId) : null;
    const packKeys = packKeysOf(rows);
    return (t) => {
      if (!availabilityOf(t).available) return { level: 'hard', reason: 'coming_soon' };
      if (t.autoType === 'AI_VIDEO') return ctx ? { level: 'ok', reason: null } : unknown;
      return ctx ? templateFitOf(ctx, t, packKeys) : unknown;
    };
  }

  /** `GET /templates`. */
  async list(auth: AuthContext, q: TemplateSourceRef): Promise<TemplateList> {
    const locale = await this.locale(auth.userId);
    const rows = await this.prisma.template.findMany({ orderBy: [{ order: 'asc' }, { slug: 'asc' }] });
    const src = await this.resolveSource(auth, q);
    const fit = src ? await this.fitter(src.championId, src.read, rows) : null;
    const staff = await this.isStaff(auth);
    const visible = rows.filter((t) => visibleToCustomer(t) || (staff && t.autoType === 'AI_VIDEO' && t.status === 'DRAFT'));
    const cards = await Promise.all(visible.filter((t) => !t.pack).map((t) => this.card(t, locale, fit ? fit(t) : null)));
    const pack = visible.find((t) => t.pack);
    return {
      items: cards, pack: pack ? await this.card(pack, locale, fit ? fit(pack) : null) : null, credits: await this.creditos.summary(auth), fitsFor: src,
      selection: { ...SELECTION_LIMITS }, // templates-multi-v1 §3.3
    };
  }

  /** Cliente: só o visível; equipe: qualquer um, menos a linha de sistema da seleção (404 pra todos, templates-multi-v1 M7). */
  private async findVisible(auth: AuthContext, rows: Template[], slug: string): Promise<Template> {
    const t = rows.find((x) => x.slug === slug);
    if (!t || isSelectionRow(t) || (!visibleToCustomer(t) && !(await this.isStaff(auth)))) throw new AppException('NOT_FOUND');
    return t;
  }

  /** `GET /templates/:slug` (cliente: só o visível; equipe: qualquer um). */
  async detail(auth: AuthContext, slug: string, q: TemplateSourceRef): Promise<TemplateCard> {
    const rows = await this.prisma.template.findMany();
    const t = await this.findVisible(auth, rows, slug);
    const src = await this.resolveSource(auth, q);
    const fit = src ? (await this.fitter(src.championId, src.read, rows))(t) : null;
    return this.card(t, await this.locale(auth.userId), fit);
  }

  /**
   * `POST /templates/fits`: o fit de UM template (`slug`) ou de uma SELEÇÃO (`slugs`, templates-multi-v1 §3.2) em várias
   * fontes (passo Ad). Seleção: `bySlug` na ordem pedida e `fit` = o da seleção. 1 contexto por fonte; os fits são puros.
   */
  async fits(auth: AuthContext, body: { slug?: string; slugs?: string[] }, sources: TemplateSourceRef[]): Promise<TemplateFitsResponse> {
    if (!!body.slug === !!body.slugs) throw new AppException('VALIDATION_ERROR', { fields: [{ field: body.slug ? 'slugs' : 'slug', rule: 'exactlyOneOf:slug,slugs' }] });
    const rows = await this.prisma.template.findMany();
    const picked: Template[] = [];
    for (const s of body.slugs ?? [body.slug!]) picked.push(await this.findVisible(auth, rows, s));
    const items: TemplateFitsResponse['items'] = [];
    for (const s of sources) {
      const r = (await this.resolveSource(auth, s)) ?? { championId: null, read: false };
      const fit = await this.fitter(r.championId, r.read, rows);
      if (!body.slugs) {
        items.push({ source: s, read: r.read, championId: r.championId, fit: fit(picked[0]) });
        continue;
      }
      const bySlug = picked.map((t) => ({ slug: t.slug, fit: fit(t) }));
      items.push({ source: s, read: r.read, championId: r.championId, fit: selectionFitOf(bySlug.map((x) => x.fit), r.read), bySlug });
    }
    return { items };
  }

  // ───────── usar (§7) ─────────

  /**
   * `POST /templates/:slug/use`: confere disponibilidade, amostra (Edição, usos) e o fit (se o anúncio já foi lido; `hard` =
   * 422) e cria o lote AUTO com o tipo travado (settings.template + TemplateRun DRAFT). Ler e planejar não cobram crédito.
   */
  async use(auth: AuthContext, slug: string, body: UseTemplateBody) {
    const rows = await this.prisma.template.findMany();
    const t = rows.find((x) => x.slug === slug);
    const staff = await this.isStaff(auth);
    // a equipe usa qualquer template disponível (é como os vídeos de exemplo são feitos); o cliente, só o visível. A linha de
    // sistema da seleção (templates-multi-v1 M7) = 404 até pra equipe.
    if (!t || isSelectionRow(t) || (!visibleToCustomer(t) && !staff)) throw new AppException('NOT_FOUND');
    const avail = availabilityOf(t);
    if (!avail.available) throw new AppException('TEMPLATE_UNAVAILABLE', { reason: avail.reason });
    const payer = await this.creditos.payerOf(auth.workspaceId);
    const sample = payer.pool === 'SAMPLE';
    if (t.autoType === 'AI_VIDEO') {
      const format = AI_KEYS[t.internalKey];
      if (!format || !this.ai.available()) throw new AppException('TEMPLATE_UNAVAILABLE', { reason: 'disabled' });
      if (sample || (t.credits == null && payer.pool != null)) throw new AppException('PAYMENT_REQUIRED');
      if (!body.generation) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'generation', rule: 'required' }] });
      const { generation, ...source } = body;
      const fingerprint = JSON.stringify([t.id, ...SOURCE_KEYS.map((k) => body[k] ?? null), body.offerId ?? null, body.cleanUploadId ?? null, generation.expectedCredits]);
      return this.iteracao.create(auth, source, {
        templateId: t.id, settings: { slug: t.slug, pack: false, keys: [t.internalKey], fit: { level: 'ok', reason: null } }, cap: null, sample: false,
        aiGeneration: { ...generation, format, fingerprint },
      });
    }
    if (sample) {
      if (t.tier !== 'EDIT') throw new AppException('PAYMENT_REQUIRED', { reason: 'sample_tier', unlock: { pieces: 0 } });
      if (payer.accountId) await this.creditos.ensureSampleGrant(payer.accountId, auth.workspaceId);
      if (!((await this.creditos.balanceOf(payer)) ?? 0)) throw new AppException('PAYMENT_REQUIRED', { reason: 'sample_used', unlock: { pieces: 0 } });
    }
    const src = await this.resolveSource(auth, body);
    if (src?.read) {
      const fit = (await this.fitter(src.championId, true, rows))(t);
      if (fit.level === 'hard') throw new AppException('TEMPLATE_DOESNT_FIT', { reason: fit.reason });
    }
    const keys = t.pack ? packKeysOf(rows) : [t.internalKey];
    const settings = { slug: t.slug, pack: t.pack, keys, ...(!t.pack && t.autoType && t.autoType !== 'FRAME' && { max: { [t.autoType]: t.outputs } }) };
    const { offerId, cleanUploadId, ...source } = body;
    return this.iteracao.create(auth, { ...source, offerId, cleanUploadId }, { templateId: t.id, settings, cap: t.pack ? t.credits : null, sample });
  }

  /**
   * templates-multi-v1 §3.1 `POST /ad-templates/use`: vários templates marcados, 1 lote, preço = Σ das linhas (sem teto).
   * Checagens na ordem do contrato (a 1ª que falhar responde); o DTO já conferiu 2-12 slugs distintos.
   */
  async useMany(auth: AuthContext, body: UseTemplatesBody) {
    // 1. exatamente 1 fonte (400; o DTO só confere a forma de cada campo)
    const given = SOURCE_KEYS.filter((k) => !!body[k]);
    if (given.length !== 1) throw new AppException('VALIDATION_ERROR', { fields: [{ field: given[1] ?? 'uploadId', rule: 'exactlyOneOf:uploadId,creativeId,metaAdId,championId,researchAdId' }] });
    const rows = await this.prisma.template.findMany();
    const staff = await this.isStaff(auth);
    // 2-6. existe/visível, pack, IA, disponível, Σ outputs ≤ 12
    const chk = checkSelection(rows, body.slugs, staff);
    if (!chk.ok) throw new AppException(chk.code, chk.details);
    const picked = chk.picked;
    const payer = await this.creditos.payerOf(auth.workspaceId);
    const sample = payer.pool === 'SAMPLE';
    if (sample) {
      // 7-9. amostra: só Edição; garante o GRANT; saldo 0; Σ créditos ≤ usos restantes (M9)
      const notEdit = picked.filter((t) => t.tier !== 'EDIT').map((t) => t.slug);
      if (notEdit.length) throw new AppException('PAYMENT_REQUIRED', { reason: 'sample_tier', unlock: { pieces: 0 }, slugs: notEdit });
      if (payer.accountId) await this.creditos.ensureSampleGrant(payer.accountId, auth.workspaceId);
      const left = (await this.creditos.balanceOf(payer)) ?? 0;
      if (!left) throw new AppException('PAYMENT_REQUIRED', { reason: 'sample_used', unlock: { pieces: 0 } });
      const need = picked.reduce((n, t) => n + (t.credits ?? 0), 0);
      if (need > left) throw new AppException('INSUFFICIENT_CREDITS', { need, balance: left, pool: 'SAMPLE' });
    }
    // 10. anúncio já lido: nenhum marcado `hard` (M5: recusa a seleção inteira, com a lista)
    const src = await this.resolveSource(auth, body);
    if (src?.read) {
      const fit = await this.fitter(src.championId, true, rows);
      const hard = picked.map((t) => ({ slug: t.slug, fit: fit(t) })).filter((x) => x.fit.level === 'hard').map((x) => ({ slug: x.slug, reason: x.fit.reason ?? 'no_data' }));
      if (hard.length) throw new AppException('TEMPLATE_DOESNT_FIT', { reason: hard[0].reason, slug: hard[0].slug, items: hard });
    }
    const anchor = rows.find((r) => r.internalKey === SELECTION_KEY);
    if (!anchor) throw new Error(`catálogo sem a linha de sistema '${SELECTION_SLUG}' (migração 20261104000100_templates_selection)`);
    const settings = {
      slug: SELECTION_SLUG, pack: false, selection: true, slugs: picked.map((t) => t.slug), keys: picked.map((t) => t.internalKey), max: selectionMaxOf(picked),
    };
    // 11. as do POST /iterate (OFFER_REQUIRED, upload…)
    const { offerId, cleanUploadId, slugs: _slugs, ...source } = body;
    return this.iteracao.create(auth, { ...source, offerId, cleanUploadId }, { templateId: anchor.id, settings, cap: null, sample });
  }

  // ───────── admin (§7) ─────────

  private async adminView(t: Template): Promise<AdminTemplate> {
    return {
      id: t.id, slug: t.slug, internalKey: t.internalKey, autoType: t.autoType, frameId: t.frameId, status: t.status, order: t.order,
      nameEn: t.nameEn, namePt: t.namePt, descEn: t.descEn, descPt: t.descPt, outEn: t.outEn, outPt: t.outPt,
      tier: t.tier, tab: tabOf(t.tier), category: asCategory(t.category), credits: t.credits, outputs: t.outputs, pack: t.pack, beta: t.beta, needs: t.needs,
      example: await this.media(t.exampleKey, 'video/mp4'), poster: await this.media(t.posterKey, 'image/jpeg'), uses: t.uses,
      available: availabilityOf(t).available, sampleOk: sampleOk(t.tier), exampleDurationSec: num(t.exampleDurationSec), needsExample: t.status === 'LIVE' && !t.exampleKey,
    };
  }

  async adminList(auth: AuthContext): Promise<{ items: AdminTemplate[] }> {
    await this.creditos.assertStaff(auth);
    const rows = await this.prisma.template.findMany({ orderBy: [{ order: 'asc' }, { slug: 'asc' }] });
    // a linha de sistema da seleção não aparece nem se edita (templates-multi-v1 M7)
    return { items: await Promise.all(rows.filter((t) => !isSelectionRow(t)).map((t) => this.adminView(t))) };
  }

  private async adminGet(auth: AuthContext, slug: string): Promise<Template> {
    await this.creditos.assertStaff(auth);
    const t = await this.prisma.template.findUnique({ where: { slug } });
    if (!t || isSelectionRow(t)) throw new AppException('NOT_FOUND');
    return t;
  }

  /** `PATCH /admin/templates/:slug`: preço, status, ordem, textos. LIVE sem preço = 422 TEMPLATE_UNPRICED. */
  async adminUpdate(auth: AuthContext, slug: string, body: UpdateTemplateBody): Promise<AdminTemplate> {
    const t = await this.adminGet(auth, slug);
    const credits = body.credits === undefined ? t.credits : body.credits;
    const status = body.status ?? t.status;
    if (status === 'LIVE' && credits == null) throw new AppException('TEMPLATE_UNPRICED');
    const r = await this.prisma.template.update({
      where: { id: t.id },
      data: {
        credits, status, ...(body.order !== undefined && { order: body.order }), ...(body.beta !== undefined && { beta: body.beta }),
        ...(body.nameEn && { nameEn: body.nameEn.trim() }), ...(body.namePt && { namePt: body.namePt.trim() }),
        ...(body.descEn && { descEn: body.descEn.trim() }), ...(body.descPt && { descPt: body.descPt.trim() }),
      },
    });
    return this.adminView(r);
  }

  /** `POST /admin/templates/:slug/example`: PUT pré-assinado (15 min) pra `templates/<slug>/example-<uuid>.mp4`. */
  async adminExampleUpload(auth: AuthContext, slug: string, body: { mimeType: string; sizeBytes: number }): Promise<TemplateExampleUpload> {
    const t = await this.adminGet(auth, slug);
    if (body.mimeType !== 'video/mp4') throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'mimeType', rule: 'video/mp4' }] });
    if (body.sizeBytes > EXAMPLE_MAX_BYTES) throw new AppException('MEDIA_TOO_LARGE', { maxBytes: EXAMPLE_MAX_BYTES });
    const key = `templates/${t.slug}/example-${randomUUID()}.mp4`;
    const uploadUrl = await this.storage.presignPut(key, { contentType: 'video/mp4', contentLength: body.sizeBytes, expiresInSec: UPLOAD_TTL_SEC });
    await this.prisma.template.update({ where: { id: t.id }, data: { pendingExampleKey: key } });
    return { uploadUrl, key, expiresAt: new Date(Date.now() + UPLOAD_TTL_SEC * 1000).toISOString() };
  }

  /** `POST /admin/templates/:slug/example/complete`: confere (MP4 vertical ≤ 60 s), tira o pôster e troca o vídeo. */
  async adminExampleComplete(auth: AuthContext, slug: string, key: string): Promise<AdminTemplate> {
    const t = await this.adminGet(auth, slug);
    if (!key || key !== t.pendingExampleKey) throw new AppException('VALIDATION_ERROR', { fields: [{ field: 'key', rule: 'not_the_pending_upload' }] });
    const head = await this.storage.head(key);
    if (!head) throw new AppException('UPLOAD_INCOMPLETE', { expectedBytes: 0, actualBytes: null });
    const dir = await mkdtemp(join(tmpdir(), 'maquina-tpl-'));
    try {
      const video = join(dir, 'example.mp4');
      const poster = join(dir, 'poster.jpg');
      await this.storage.downloadTo({ storageKey: key }, video);
      const info = await validateMedia(video, 'video').catch((e) => {
        if (e instanceof MediaInvalidError) throw new AppException('MEDIA_INVALID', { reason: 'undecodable' });
        throw e;
      });
      if ((info.durationSec ?? 0) > EXAMPLE_MAX_SEC) throw new AppException('MEDIA_TOO_LONG', { durationSec: info.durationSec, maxSec: EXAMPLE_MAX_SEC });
      if (!info.width || !info.height || info.height <= info.width) throw new AppException('MEDIA_INVALID', { reason: 'not_vertical' });
      await promisify(execFile)(FFMPEG_BIN, ['-hide_banner', '-nostdin', '-v', 'error', '-y', '-ss', String(Math.min(1, (info.durationSec ?? 1) / 2)), '-i', video, '-frames:v', '1', '-q:v', '3', poster], { timeout: 60_000 });
      const posterKey = key.replace(/\.mp4$/, '-poster.jpg');
      await this.storage.putStream(posterKey, createReadStream(poster), 'image/jpeg');
      const r = await this.prisma.template.update({
        where: { id: t.id }, data: { exampleKey: key, posterKey, exampleDurationSec: info.durationSec ?? null, pendingExampleKey: null },
      });
      for (const old of [t.exampleKey, t.posterKey]) if (old && old !== key && old !== posterKey) await this.storage.deleteObject(old);
      return this.adminView(r);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
