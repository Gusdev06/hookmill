// STATIC do lote AUTO criado do zero no GPT Image 2 (variacao-auto-v1 Revisão 23/10 §14.3). O render IMAGE_GEN não passa
// pela fila do Remotion: aqui ele é submetido (porta `submitStaticImage` da ia), e o fim da tarefa chega pelo
// `provider.task.finished` (a task aponta pro render em `provider_tasks.render_id`; o orquestrador da geração ignora).
//   dispatch: QUEUED → RENDERING (stage 'image'; §A10: depois 'text_check' / 'retake') + submissão. Erro síncrono = FAILED PROVIDER_ERROR.
//   fim:      COMPLETED → ingest da imagem → READY (9:16: pôster + aprova a peça). Sem imagem → 1 reenvio (SAFETY_BLOCK =
//             prompt `safe`), depois FAILED com o código (9:16 = peça `failed`; sob demanda = só o formato).
//   boot:     QUEUED → dispatch; RENDERING com task SUBMITTED → nada (o reconciliador da ia fecha); terminada sem
//             handledAt → processa; sem task nenhuma (caiu entre o claim e a submissão) → volta pra QUEUED e submete.
// 25/10 (estatico-montado-e-molduras-v1 §A3.3/§A4/§A5/§A6): spec por `layout` (assembled = V2 com marca, paleta e
// referência da tela; photo_headline/poster = legado) e, no assembled, CHECAGEM DE TEXTO por visão depois do ingest:
//   tudo bate → READY `textCheck ok` · erro crítico com 1 task → teto + reenvio do mesmo prompt (2ª e última task, limite
//   dividido com a recusa) · erro só menor, 2ª também errada ou teto estourado → READY `mismatch` com a imagem de MENOS
//   erros críticos (empate: a 2ª) · checagem falhou → READY `skipped`. Imagem com texto errado é cobrada (cost_entry da ia).
import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { StaticTextCheck } from '@maquina/contratos';
import type { Prisma, ProviderTask } from '@prisma/client';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IngestError, StorageService } from '../arquivos/storage.service';
import { AppException } from '../common/errors/app-exception';
import { codeFromTaskStatus } from '../common/errors/falhas';
import { CustosService } from '../custos/custos.service';
import {
  CATALOG_SERVICE, CLAUDE_SERVICE, GENERATION_SERVICE, IntegracaoError, PROVIDER_TASK_FINISHED, type CatalogService, type ClaudeService,
  type GenerationService, type ProviderTaskFinishedEvent,
} from '../integracoes';
import type { StaticAspect, StaticImagePort, StaticImageSpecAny, StaticTextCheckPort } from '../integracoes/contrato';
import { paletaDoEstatico } from '../iteracao/paleta';
import { capturaValida } from './captura-valida';
import { MEDIA_ANALYSIS_SERVICE, type MediaAnalysisService } from '../medicao';
import { PrismaService } from '../prisma/prisma.service';
import { skippedCheck, expectedTexts, pickBest, shouldRedoForText, verdictOf, type StaticCandidate } from './checagem-texto';
import { EdicaoService } from './edicao.service';
import {
  STATIC_ASPECT, STATIC_MAX_TASKS, estimateStaticUsd, isAssembled, legacySpecOf, screenRefSourceOf, staticFailCode, staticLayoutOf, staticNextStep,
  staticSpecAnyOf,
} from './pecas';

/** O que fica em `Render.input` do IMAGE_GEN (§14.3 passo 1; 25/10: spec por layout, candidatas e textCheck). */
export interface StaticRenderInput {
  /** §A10.1: refação de peça `ready` (id do render 9:16 anterior) */
  retakeOf?: string;
  model: string | null; aspectRatio: string; spec: unknown; safe: boolean; providerTaskIds: string[];
  /** assembled: as imagens já checadas deste render (até 2) */
  candidates?: StaticCandidate[];
  /** assembled: o veredito da imagem entregue (vira `IteratePiece.textCheck`/`PieceFormat.textCheck`). §A10.3 pede
   *  em `renders.input.textCheck` (decisão do arquiteto 25/10; o §A10.3 foi corrigido). */
  textCheck?: StaticTextCheck | null;
}

const RENDER_INCLUDE = {
  creative: {
    include: {
      variationItem: true,
      variationBatch: { select: { id: true, language: true, pageCapture: true } },
      offer: { select: { notes: true, name: true, productImage: true } },
      workspace: { select: { brandColor: true } },
      champion: { select: { teardown: { select: { measurements: true } } } },
    },
  },
} satisfies Prisma.RenderInclude;
type RenderRow = Prisma.RenderGetPayload<{ include: typeof RENDER_INCLUDE }>;

@Injectable()
export class ImagemEstaticaService implements OnApplicationBootstrap {
  private readonly log = new Logger('ImagemEstatica');
  private readonly inflight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly edicao: EdicaoService,
    private readonly custos: CustosService,
    @Inject(GENERATION_SERVICE) private readonly gen: GenerationService,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
    @Inject(CATALOG_SERVICE) private readonly catalog: CatalogService,
    @Inject(MEDIA_ANALYSIS_SERVICE) private readonly media: MediaAnalysisService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.BOOT_RECOVERY === 'off') return;
    void this.recover().catch((e) => this.log.error(`retomada do STATIC falhou: ${(e as Error).stack ?? e}`));
  }

  // ───────── 1. dispatch ─────────

  /** Depois do commit do start, do retry da peça e do pedido de formato (e no boot). Idempotente: só pega QUEUED. Nunca lança. */
  async dispatch(renderId: string): Promise<void> {
    try {
      const claimed = await this.prisma.render.updateMany({
        where: { id: renderId, status: 'QUEUED', engine: 'IMAGE_GEN', stale: false, creative: { archivedAt: null } },
        data: { status: 'RENDERING', stage: 'image', progress: 0, startedAt: new Date() },
      });
      if (claimed.count !== 1) return;
      await this.edicao.publish(renderId);
      await this.submit(renderId, false);
    } catch (e) {
      this.log.error(`dispatch ${renderId}: ${(e as Error).stack ?? e}`);
    }
  }

  /**
   * Spec do render por layout (§A5). Reenvio reaproveita o gravado (mesmo prompt, §A6 passo 2). assembled: marca = nome da
   * oferta, paleta pela cadeia do §A3.3, referência da tela = captura da página ou foto do produto (D4).
   */
  private async specFor(r: RenderRow): Promise<StaticImageSpecAny> {
    const prev = (r.input as Partial<StaticRenderInput> | null)?.spec as StaticImageSpecAny | undefined;
    if (prev && typeof prev === 'object' && 'screenLanguage' in prev) return prev;
    const c = r.creative;
    const params = ((c.variationItem?.payload ?? {}) as { params?: Record<string, unknown> }).params ?? null;
    const lang = c.variationBatch?.language ?? c.language;
    if (staticLayoutOf(params) !== 'assembled') return staticSpecAnyOf(params, lang, { brandName: c.offer?.name ?? '', palette: paletaDoEstatico({}), screenRefUrl: null });
    // bug 25/10: captura quebrada (página de erro, muro anti-robô, tela de uma cor) não vira referência nem paleta:
    // cai pra foto do produto ou pra tela abstrata sem texto (§A4/D4)
    const cap = c.variationBatch?.pageCapture ?? null;
    const page = cap && (await capturaValida(this.storage, cap, `STATIC ${r.id}`)) ? cap : null;
    const photo = c.offer?.productImage ?? null;
    const brand = c.workspace?.brandColor ?? null;
    const measurements = (c.champion?.teardown?.measurements ?? null) as { palette?: string[] } | null;
    const palette = paletaDoEstatico({ brandColor: brand, pageColors: brand ? null : await this.pageColors(page), championPalette: measurements?.palette ?? null });
    const kind = ((params?.visualV2 ?? params?.visual) as { product?: { kind?: 'phone_screen' | 'laptop_screen' | 'physical_product' | 'none' } } | undefined)?.product?.kind;
    const src = screenRefSourceOf(kind, { page: !!page, photo: !!photo });
    const ref = src === 'page' ? page : src === 'photo' ? photo : null;
    const screenRefUrl = ref ? await this.storage.signedUrl(ref).catch(() => null) : null;
    return staticSpecAnyOf(params, lang, { brandName: c.offer?.name ?? '', palette: { background: palette.background, accent: palette.accent }, screenRefUrl });
  }

  /** Cores dominantes da captura da página (§A3.3); falhou = null (a cadeia segue pro campeão). */
  private async pageColors(page: { storageKey: string } | null): Promise<string[] | null> {
    if (!page) return null;
    const dir = await mkdtemp(join(tmpdir(), 'maquina-pal-'));
    try {
      const path = join(dir, 'page.img');
      await this.storage.downloadTo(page, path);
      return await this.media.palette([path], 5);
    } catch (e) {
      this.log.warn(`paleta da página: ${(e as Error).message}`);
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Uma submissão (1ª ou o reenvio). `input.safe` é gravado ANTES da chamada: o fim da task pode chegar antes do retorno. */
  private async submit(renderId: string, safe: boolean): Promise<void> {
    const r = await this.prisma.render.findUniqueOrThrow({ where: { id: renderId }, include: RENDER_INCLUDE });
    const c = r.creative;
    const format = r.format ?? 'VERTICAL_9_16';
    const aspect = STATIC_ASPECT[format];
    const cur = (r.input as Partial<StaticRenderInput> | null) ?? {};
    const prev = cur.providerTaskIds ?? [];
    try {
      const spec = await this.specFor(r);
      const input: StaticRenderInput = { model: null, aspectRatio: aspect, spec, safe, providerTaskIds: prev, ...(cur.candidates && { candidates: cur.candidates }), ...(cur.retakeOf && { retakeOf: cur.retakeOf }) };
      await this.prisma.render.update({ where: { id: renderId }, data: { input: input as unknown as Prisma.InputJsonValue } });
      // TRANSIÇÃO (§14.5): o GenerationService ganha `extends StaticImagePort` no fechamento; até a R-I, sem o método = indisponível
      const port = this.gen as unknown as Partial<StaticImagePort>;
      if (typeof port.submitStaticImage !== 'function') throw new IntegracaoError('PROVIDER_UNAVAILABLE', 'submitStaticImage ainda não existe na integração');
      if (!c.variationBatchId) throw new IntegracaoError('PROVIDER_ERROR', 'peça sem lote');
      const sub = await port.submitStaticImage.call(this.gen, {
        workspaceId: r.workspaceId, renderId, creativeId: c.id, variationBatchId: c.variationBatchId,
        spec: legacySpecOf(spec), aspectRatio: aspect, safe, notes: c.offer?.notes ?? null,
        ...(isAssembled(spec) && { specV2: spec }),
      });
      const task = await this.prisma.providerTask.findUnique({ where: { id: sub.providerTaskId }, select: { model: true } });
      const now = await this.prisma.render.findUnique({ where: { id: renderId }, select: { input: true } });
      const nowIn = (now?.input as Partial<StaticRenderInput> | null) ?? {};
      const ids = nowIn.providerTaskIds ?? prev;
      await this.prisma.render.update({
        where: { id: renderId },
        data: { input: { ...input, ...nowIn, model: task?.model ?? null, providerTaskIds: [...new Set([...ids, sub.providerTaskId])] } as unknown as Prisma.InputJsonValue },
      });
    } catch (e) {
      // erro síncrono (PROVIDER_UNAVAILABLE, RATE_LIMITED…) = render FAILED PROVIDER_ERROR (§14.3 passo 1);
      // reenvio por texto que não sobe: entrega a melhor imagem que já chegou (§A6 passo 3)
      this.log.warn(`STATIC ${renderId}: submissão falhou: ${(e as Error).message}`);
      const now = await this.prisma.render.findUnique({ where: { id: renderId }, include: RENDER_INCLUDE });
      if (now?.status !== 'RENDERING') return;
      const best = pickBest((now.input as Partial<StaticRenderInput> | null)?.candidates ?? []);
      if (best) await this.deliver(now, best);
      else await this.edicao.failAuto({ id: r.id, creativeId: c.id, format, creative: c }, 'PROVIDER_ERROR', null);
    }
  }

  // ───────── 2-4. fim da task ─────────

  @OnEvent(PROVIDER_TASK_FINISHED, { async: true })
  async onFinished(e: ProviderTaskFinishedEvent) {
    if (e.kind !== 'STATIC_IMAGE') return;
    await this.handle(e.providerTaskId);
  }

  /** Processa uma task STATIC_IMAGE terminada (evento ou boot). Idempotente; nunca lança. `force` = boot, ignora o handledAt. */
  async handle(providerTaskId: string, force = false): Promise<void> {
    if (this.inflight.has(providerTaskId)) return;
    this.inflight.add(providerTaskId);
    try {
      const t = await this.prisma.providerTask.findUnique({ where: { id: providerTaskId } });
      if (!t || t.kind !== 'STATIC_IMAGE' || !t.renderId || t.status === 'SUBMITTED' || (t.handledAt && !force)) return;
      await this.apply(t);
      await this.prisma.providerTask.updateMany({ where: { id: t.id, handledAt: null }, data: { handledAt: new Date() } });
    } catch (err) {
      this.log.error(`task STATIC ${providerTaskId}: ${(err as Error).stack ?? err}`);
    } finally {
      this.inflight.delete(providerTaskId);
    }
  }

  private async apply(t: ProviderTask): Promise<void> {
    const r = await this.prisma.render.findUnique({ where: { id: t.renderId! }, include: RENDER_INCLUDE });
    if (!r || r.status !== 'RENDERING' || r.stale || r.creative.archivedAt) return; // render já assentou / foi refeito
    const tasks = await this.prisma.providerTask.findMany({ where: { renderId: r.id }, orderBy: { submittedAt: 'asc' }, select: { id: true } });
    if (tasks[tasks.length - 1]?.id !== t.id) return; // resultado de uma tentativa anterior do mesmo render
    const format = r.format ?? 'VERTICAL_9_16';
    const ref = { id: r.id, creativeId: r.creativeId, format, creative: r.creative };
    const input = (r.input as Partial<StaticRenderInput> | null) ?? {};

    let code: string | null = null;
    if (t.status === 'COMPLETED' && t.outputUrls[0]) {
      try {
        const file = await this.storage.ingestFromUrl(t.outputUrls[0], { workspaceId: r.workspaceId, kind: 'RENDER_IMAGE', validate: 'image' });
        if (!isAssembled(input.spec)) {
          await this.deliver(r, { providerTaskId: t.id, fileId: file.id, check: null, criticalErrors: 0 });
          return;
        }
        // §A6: checagem de texto (só no assembled)
        await this.prisma.render.updateMany({ where: { id: r.id, status: 'RENDERING' }, data: { stage: 'text_check' } });
        await this.edicao.publish(r.id);
        const cand = await this.checkText(r, t.id, file.id, file);
        const candidates = [...(input.candidates ?? []).filter((x) => x.providerTaskId !== t.id), cand];
        if (cand.check.status === 'mismatch' && shouldRedoForText(cand, tasks.length, STATIC_MAX_TASKS) && (await this.withinCap(r.workspaceId))) {
          await this.prisma.render.update({ where: { id: r.id }, data: { input: { ...input, candidates } as unknown as Prisma.InputJsonValue } });
          this.log.warn(`STATIC ${r.id}: ${cand.criticalErrors} texto(s) crítico(s) errado(s); refaz com o mesmo prompt`);
          await this.prisma.render.updateMany({ where: { id: r.id, status: 'RENDERING' }, data: { stage: 'retake' } });
          await this.submit(r.id, !!input.safe);
          return;
        }
        await this.deliver(r, pickBest(candidates)!, candidates);
        return;
      } catch (e) {
        if (!(e instanceof IngestError)) throw e;
        code = 'DOWNLOAD_INVALID';
      }
    } else {
      code = codeFromTaskStatus(t.status, t.errorCode);
    }

    // a refação por texto falhou (recusa, timeout…): a 1ª imagem, já checada, é entregue com o aviso
    const best = pickBest(input.candidates ?? []);
    if (best) {
      this.log.warn(`STATIC ${r.id}: refação sem imagem (${code}); entrega a 1ª`);
      await this.deliver(r, best);
      return;
    }
    const next = staticNextStep({ code, tasks: tasks.length, safe: !!input.safe });
    if (next.resend) {
      this.log.warn(`STATIC ${r.id}: ${code}; reenvio ${next.safe ? 'com prompt seguro' : 'igual'}`);
      await this.prisma.render.updateMany({ where: { id: r.id, status: 'RENDERING' }, data: { stage: 'retake' } });
      await this.submit(r.id, next.safe);
      return;
    }
    await this.edicao.failAuto(ref, staticFailCode(code), null);
  }

  /** Teto do mês com 1 imagem a mais (§A6 passo 2). Estourado = não refaz (entrega com aviso). */
  private async withinCap(workspaceId: string): Promise<boolean> {
    try {
      await this.custos.assertWithinCap(workspaceId, estimateStaticUsd(this.catalog, 1));
      return true;
    } catch (e) {
      if (e instanceof AppException) return false;
      throw e;
    }
  }

  /** Checagem por visão (porta `checkStaticText` da ia). Falhou = `skipped` (não segura a peça). */
  private async checkText(r: RenderRow, providerTaskId: string, fileId: string, file: { storageKey: string }): Promise<StaticCandidate> {
    const input = (r.input as Partial<StaticRenderInput> | null) ?? {};
    const spec = input.spec as Parameters<typeof expectedTexts>[0];
    const aspect = (input.aspectRatio ?? STATIC_ASPECT[r.format ?? 'VERTICAL_9_16']) as StaticAspect;
    const expected = expectedTexts(spec, aspect);
    try {
      // TRANSIÇÃO (§C.0): `ClaudeService extends StaticTextCheckPort` no fechamento
      const port = this.claude as unknown as Partial<StaticTextCheckPort>;
      if (typeof port.checkStaticText !== 'function') throw new IntegracaoError('PROVIDER_UNAVAILABLE', 'checkStaticText ainda não existe na integração');
      const res = await port.checkStaticText.call(this.claude, {
        workspaceId: r.workspaceId, creativeId: r.creativeId, variationBatchId: r.creative.variationBatchId ?? '', renderId: r.id,
        imageUrl: await this.storage.signedUrl(file), language: spec.screenLanguage,
        expected: expected.map((e) => ({ key: e.key, text: e.text, critical: e.critical })), notes: r.creative.offer?.notes ?? null,
      });
      const v = verdictOf(expected, res);
      return { providerTaskId, fileId, check: v.check, criticalErrors: v.criticalErrors };
    } catch (e) {
      this.log.warn(`STATIC ${r.id}: checagem de texto falhou (${(e as Error).message}); segue sem checagem`);
      return { providerTaskId, fileId, check: skippedCheck(expected), criticalErrors: 0 };
    }
  }

  /** READY com a imagem escolhida (9:16: pôster + aprova a peça). `check` null = legado (sem checagem). */
  private async deliver(r: RenderRow, pick: Omit<StaticCandidate, 'check'> & { check: StaticTextCheck | null }, candidates?: StaticCandidate[]): Promise<void> {
    const format = r.format ?? 'VERTICAL_9_16';
    const input = (r.input as Partial<StaticRenderInput> | null) ?? {};
    const next: Partial<StaticRenderInput> = { ...input, ...(candidates && { candidates }), ...(pick.check && { textCheck: pick.check }) };
    const done = await this.prisma.render.updateMany({
      where: { id: r.id, status: 'RENDERING' },
      data: {
        status: 'READY', stage: null, progress: 100, fileId: pick.fileId, durationSec: null, errorCode: null, failReason: null, finishedAt: new Date(),
        input: next as unknown as Prisma.InputJsonValue,
      },
    });
    if (!done.count) return;
    // 9:16: o pôster da peça é a própria imagem; sob demanda: só o render.updated
    if (format === 'VERTICAL_9_16') {
      await this.prisma.creative.update({ where: { id: r.creativeId }, data: { thumbnailFileId: pick.fileId } });
      const retakeOf = (input as { retakeOf?: string }).retakeOf;
      if (retakeOf) {
        // §A10.1: refação de peça pronta: a anterior sai de cena, o render final passa a ser este (adName não muda)
        await this.prisma.render.updateMany({ where: { creativeId: r.creativeId, format: 'VERTICAL_9_16', id: { not: r.id }, stale: false }, data: { stale: true } });
        await this.prisma.creative.updateMany({ where: { id: r.creativeId, state: 'APPROVED' }, data: { finalRenderId: r.id } });
      }
      // G1 (Gusta 25/10): texto crítico ainda errado no fim = a peça sai do zip por padrão (o usuário devolve com 1 clique);
      // refação que corrigiu volta pro zip
      if (r.creative.variationItemId && (pick.criticalErrors > 0 || retakeOf)) {
        await this.prisma.variationItem.update({ where: { id: r.creative.variationItemId }, data: { inZip: pick.criticalErrors === 0 } });
      }
    }
    await this.edicao.publish(r.id);
    await this.edicao.settleAuto(r.creativeId);
  }

  // ───────── 6. boot ─────────

  /** `workspaceId` restringe (testes). Devolve quantos renders foram mexidos (os sem task contam uma vez, no dispatch). */
  async recover(workspaceId?: string): Promise<number> {
    const ws = workspaceId ? { workspaceId } : {};
    // lote de antes da revisão: STATIC ainda QUEUED na fila do Remotion vira IMAGE_GEN (o Remotion não faz mais o STATIC)
    await this.prisma.render.updateMany({
      where: { ...ws, status: 'QUEUED', engine: 'REMOTION', stale: false, creative: { variationKind: 'AUTO_EDIT', variationItem: { autoType: 'STATIC' } } },
      data: { engine: 'IMAGE_GEN' },
    });
    let n = 0;
    const rendering = await this.prisma.render.findMany({ where: { ...ws, status: 'RENDERING', engine: 'IMAGE_GEN', stale: false }, select: { id: true } });
    for (const r of rendering) {
      const last = await this.prisma.providerTask.findFirst({ where: { renderId: r.id }, orderBy: { submittedAt: 'desc' } });
      if (last?.status === 'SUBMITTED') continue; // o reconciliador da ia fecha (2 min / 10 min)
      if (last) {
        n++;
        await this.handle(last.id, true);
      } else await this.prisma.render.updateMany({ where: { id: r.id, status: 'RENDERING' }, data: { status: 'QUEUED', stage: null, startedAt: null } });
    }
    const queued = await this.prisma.render.findMany({
      where: { ...ws, status: 'QUEUED', engine: 'IMAGE_GEN', stale: false, creative: { archivedAt: null } }, orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], select: { id: true },
    });
    for (const r of queued) await this.dispatch(r.id);
    return n + queued.length;
  }
}
