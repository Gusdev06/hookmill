// Editor universal v1 §9 (F-U1): fim do export do editor (re-render grátis da peça AUTO com o doc salvo). A fila e o
// Lambda são os de sempre (EdicaoService); este serviço assume no `settle` quando o render é de export:
//   arquivo no storage → checagem da legenda queimada (legenda-protegida-v1 §4.2) → checagem por visão SÓ dos textos
//   editados (D-E1-5) → passou: a peça passa a servir este render (finalRender, 4:5/1:1 stale); reprovou: render FAILED
//   com errorCode/failDetail e a peça CONTINUA servindo o anterior (nunca vira READY reprovado, §9.6).
// Não depende do EdicaoService (o EdicaoService chama este), sem ciclo de DI.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CaptionCheck } from '@maquina/contratos';
import { Prisma } from '@prisma/client';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageService } from '../arquivos/storage.service';
import { KeyedMutex } from '../common/util/mutex';
import { CreativeStateMachine } from '../criativos/state-machine';
import { CreativeViews } from '../criativos/views';
import { EventosService } from '../eventos/eventos.service';
import { CLAUDE_SERVICE, type ClaudeService } from '../integracoes';
import { captionFramesOf } from '../integracoes/claude/checagem-legenda';
import { ffmpegRunner } from '../integracoes/claude/checagem-texto';
import type { StaticTextCheckPort } from '../integracoes/contrato';
import { PrismaService } from '../prisma/prisma.service';
import type { RenderInput, RenderResult } from '../render/contrato';
import { ChecagemLegendaService } from './checagem-legenda';
import { exportViewOf, pendingFromDocs, type EditedTextCheck, type ExportFailDetail } from './editor-auto';
import { isEditorExport, primaryFormatOf } from './pecas';

type RenderRow = Prisma.RenderGetPayload<{ include: { creative: true } }>;

/** Frases do banner de falha (o web traduz pelo código; esta é a do log/failReason). */
export const EXPORT_FAIL_REASON: Record<string, string> = {
  CAPTION_COVERED: 'The original captions came out covered or cut. Move the box and export again, or retry the check.',
  TEXT_MISMATCH: 'An edited text did not come out readable. Fix it and export again, or retry the check.',
  RENDER_ERROR: 'The export failed. Your previous video is still the one in use. Export again.',
};

/** Input do render de export: o resolver grava aqui os textos editados (o que a visão confere) e o formato principal. */
export interface EditorCheckInput { texts: EditedTextCheck[] }

type Veredito = { ok: true } | { ok: false; code: 'CAPTION_COVERED' | 'TEXT_MISMATCH'; detail: ExportFailDetail };

@Injectable()
export class EditorExportService {
  private readonly log = new Logger('EditorExport');
  private readonly run = ffmpegRunner(process.env.FFMPEG_PATH || 'ffmpeg', 60_000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly legendas: ChecagemLegendaService,
    @Inject(CLAUDE_SERVICE) private readonly claude: ClaudeService,
    private readonly eventos: EventosService,
    private readonly views: CreativeViews,
    private readonly sm: CreativeStateMachine,
    private readonly locks: KeyedMutex,
  ) {}

  isExport(r: { settings: unknown }): boolean {
    return isEditorExport(r.settings);
  }

  /** SSE: `render.updated` (de sempre) + `editor.export` (etapa, % e o "Jump to"). */
  async publish(renderId: string): Promise<void> {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, include: { file: true } });
    if (!r) return;
    this.eventos.publish(r.creativeId, 'render.updated', await this.views.render(r));
    this.eventos.publish(r.creativeId, 'editor.export', exportViewOf(r));
  }

  /** `settle` de um render de export: arquivo + pôster → checagens → passou/reprovou. */
  async complete(r: RenderRow, res: RenderResult): Promise<void> {
    const [video, poster] = await Promise.all([
      this.storage.put(res.outputPath, { workspaceId: r.workspaceId, kind: 'RENDER_VIDEO', mimeType: 'video/mp4', meta: { durationSec: res.durationSec, width: res.width, height: res.height } }),
      this.storage.put(res.posterPath, { workspaceId: r.workspaceId, kind: 'THUMBNAIL', mimeType: res.posterPath.endsWith('.png') ? 'image/png' : 'image/jpeg', meta: { width: res.width, height: res.height } }),
    ]);
    // o arquivo fica no render já agora (o Retry check confere o MESMO arquivo); só vira READY se passar
    await this.prisma.render.update({ where: { id: r.id }, data: { fileId: video.id, durationSec: res.durationSec, progress: 100, input: { ...(r.input as object), posterFileId: poster.id } as Prisma.InputJsonValue } });
    const v = await this.checks(r, res.outputPath, { width: res.width, height: res.height });
    if (v.ok) await this.pass(r.id, poster.id);
    else await this.fail(r.id, v.code, null, v.detail);
  }

  /**
   * Reprovado: FAILED com o código e o detalhe (`fail_detail`), sem tocar no item nem no criativo (a peça continua com o
   * render anterior). `detail` null = falha do render (RENDER_ERROR/RENDER_TIMEOUT/...): instante pelo quadro, se houver.
   */
  async fail(renderId: string, code: string, failedFrame: number | null, detail: ExportFailDetail | null): Promise<void> {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, select: { input: true } });
    const fps = fpsOf(r?.input);
    const d: ExportFailDetail = detail ?? { rule: code.toLowerCase(), atSec: failedFrame != null && fps ? Math.round((failedFrame / fps) * 100) / 100 : null, layerId: null };
    await this.prisma.render.updateMany({
      where: { id: renderId, status: { in: ['QUEUED', 'RENDERING'] } },
      data: {
        status: 'FAILED', stage: null, errorCode: code, failReason: EXPORT_FAIL_REASON[code] ?? EXPORT_FAIL_REASON.RENDER_ERROR, failedFrame,
        failDetail: d as unknown as Prisma.InputJsonValue, finishedAt: new Date(), finalizingAt: null,
      },
    });
    await this.publish(renderId);
  }

  /** `POST …/export/recheck`: o render já está RENDERING/caption_check (o serviço do editor travou); confere o mesmo arquivo. */
  async recheck(renderId: string): Promise<void> {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, include: { creative: true, file: true } });
    if (!r?.file) return;
    const dir = await mkdtemp(join(tmpdir(), 'editor-recheck-'));
    try {
      const path = join(dir, 'export.mp4');
      await this.storage.downloadTo(r.file, path);
      const v = await this.checks(r, path, { width: r.file.width ?? 1080, height: r.file.height ?? 1920 });
      const poster = (r.input as { posterFileId?: string } | null)?.posterFileId ?? null;
      if (v.ok) await this.pass(r.id, poster);
      else await this.fail(r.id, v.code, null, v.detail);
    } catch (e) {
      this.log.warn(`recheck ${renderId}: ${(e as Error).message}`);
      await this.fail(renderId, 'RENDER_ERROR', null, { rule: 'recheck_failed', atSec: null, layerId: null });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ───────── checagens (§9 passo 2) ─────────

  private async stage(renderId: string, stage: 'caption_check' | 'text_check') {
    await this.prisma.render.updateMany({ where: { id: renderId, status: 'RENDERING' }, data: { stage } });
    await this.publish(renderId);
  }

  private async checks(r: RenderRow, outputPath: string, output: { width: number; height: number }): Promise<Veredito> {
    const c = r.creative;
    const input = r.input as unknown as RenderInput & { editorCheck?: EditorCheckInput };
    const [batch, offer] = await Promise.all([
      c.variationBatchId ? this.prisma.variationBatch.findUnique({ where: { id: c.variationBatchId }, select: { language: true } }) : null,
      this.prisma.offer.findUnique({ where: { id: c.offerId }, select: { notes: true } }),
    ]);
    const language = batch?.language ?? 'en';
    const notes = offer?.notes ?? null;

    // 1. legenda queimada (só com faixa protegida; vale para toda peça, troca-texto-queimado-v1 §15.3.1)
    await this.stage(r.id, 'caption_check');
    if (c.variationBatchId) {
      const cc: CaptionCheck | null = await this.legendas.check({
        renderId: r.id, workspaceId: r.workspaceId, creativeId: r.creativeId, variationBatchId: c.variationBatchId, championId: c.championId,
        language, notes, input, outputPath, output, attempt: 1,
      });
      if (cc) await this.mergeInput(r.id, { captionCheck: cc });
      if (cc?.status === 'covered') {
        const bad = cc.frames.find((f) => !f.ok);
        return { ok: false, code: 'CAPTION_COVERED', detail: { rule: 'caption_covered', atSec: bad?.atSec ?? null, layerId: null } };
      }
    }

    // 2. textos editados (D-E1-5): a visão diz se cada um aparece legível no quadro em que ele está na tela
    const texts = input.editorCheck?.texts ?? [];
    if (!texts.length || !c.variationBatchId) return { ok: true };
    await this.stage(r.id, 'text_check');
    const port = this.claude as unknown as Partial<StaticTextCheckPort>;
    const dir = await mkdtemp(join(tmpdir(), 'editor-texto-'));
    const items: { key: string; found: boolean; seen: string | null }[] = [];
    try {
      if (typeof port.checkStaticText !== 'function') throw new Error('checkStaticText ainda não existe na integração');
      const instantes = [...new Set(texts.map((t) => t.atSec))].sort((a, b) => a - b);
      for (const at of instantes) {
        const [shot] = await captionFramesOf(this.run, null, outputPath, [at], null);
        if (!shot) throw new Error(`quadro de ${at}s não saiu`);
        const path = join(dir, `t${items.length}.png`);
        await writeFile(path, shot.image);
        const aqui = texts.filter((t) => t.atSec === at);
        const res = await port.checkStaticText.call(this.claude, {
          workspaceId: r.workspaceId, creativeId: r.creativeId, variationBatchId: c.variationBatchId, renderId: r.id, imageUrl: path, language, notes,
          expected: aqui.map((t) => ({ key: t.key, text: t.text, critical: true })),
        });
        for (const t of aqui) {
          const got = res.items.find((x) => x.key === t.key);
          items.push({ key: t.key, found: !!got?.found, seen: got?.seen ?? null });
          if (!got?.found) {
            await this.mergeInput(r.id, { editorTextCheck: { status: 'mismatch', items } });
            return { ok: false, code: 'TEXT_MISMATCH', detail: { rule: 'text_mismatch', atSec: at, layerId: t.layerId } };
          }
        }
      }
      await this.mergeInput(r.id, { editorTextCheck: { status: 'ok', items } });
      return { ok: true };
    } catch (e) {
      // Claude fora = `skipped`: não segura o export (mesma regra das outras checagens por visão)
      this.log.warn(`export ${r.id}: checagem de texto pulada (${(e as Error).message})`);
      await this.mergeInput(r.id, { editorTextCheck: { status: 'skipped', items } });
      return { ok: true };
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async mergeInput(renderId: string, extra: Record<string, unknown>) {
    const r = await this.prisma.render.findUnique({ where: { id: renderId }, select: { input: true } });
    await this.prisma.render.update({ where: { id: renderId }, data: { input: { ...((r?.input as object) ?? {}), ...extra } as Prisma.InputJsonValue } });
  }

  /**
   * §9 passo 3: a peça passa a servir este render. READY + finalRender (Biblioteca, download, Meta) + pôster; os 4:5/1:1
   * prontos/falhos ficam stale (o card volta a "Make 4:5/1:1", grátis). `editDirty` = doc salvo ≠ este doc.
   */
  private async pass(renderId: string, posterFileId: string | null): Promise<void> {
    const r0 = await this.prisma.render.findUnique({ where: { id: renderId }, select: { creativeId: true } });
    if (!r0) return;
    await this.locks.run(r0.creativeId, async () => {
      const r = await this.prisma.render.findUniqueOrThrow({ where: { id: renderId }, include: { creative: { include: { variationItem: { select: { autoType: true, payload: true } } } } } });
      if (r.status !== 'RENDERING') return;
      const c = r.creative;
      const params = ((c.variationItem?.payload ?? {}) as { params?: Record<string, unknown> }).params ?? null;
      const primary = primaryFormatOf(c.variationItem?.autoType ?? null, params);
      await this.prisma.$transaction(async (tx) => {
        await tx.render.update({
          where: { id: r.id },
          data: { status: 'READY', stage: null, progress: 100, finishedAt: new Date(), finalizingAt: null, errorCode: null, failReason: null, failDetail: Prisma.DbNull },
        });
        await tx.render.updateMany({ where: { creativeId: c.id, stale: false, id: { not: r.id }, format: { not: primary }, status: { in: ['READY', 'FAILED'] } }, data: { stale: true } });
        await tx.creative.update({
          where: { id: c.id },
          data: {
            ...(c.state === 'APPROVED' && { finalRenderId: r.id }),
            ...(posterFileId && { thumbnailFileId: posterFileId }),
            editDirty: pendingFromDocs(c.editDoc, r.doc),
          },
        });
      });
    });
    await this.publish(renderId);
    this.sm.announce(r0.creativeId);
  }
}

function fpsOf(input: unknown): number | null {
  const i = (input ?? {}) as { canvas?: { fps?: number }; kind?: string; fps?: number };
  if (typeof i.canvas?.fps === 'number') return i.canvas.fps;
  if (typeof i.fps === 'number') return i.fps;
  return i.kind === 'frame' ? 30 : null;
}
