import { Logger, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { integracoesMode } from '../integracoes';
import { MedicaoModule } from '../medicao';
import { RENDER_SERVICE, RenderModule, type RenderService } from '../render';
import { isRemixKeep } from '../render/contrato';
import { EdicaoController, TemplatesController } from './edicao.controller';
import { EdicaoService } from './edicao.service';
import { RenderWebhookController } from './render-webhook.controller';
import { FakeRenderService } from './fake-render.service';
import { EditorController } from './editor.controller';
import { EditorSaves } from './editor-saves';
import { EditorService } from './editor.service';
import { AUTO_EDIT_BUILDER } from './auto-edit-input';
import { FRAME_BUILDER, comConteudoDoCampeao } from './frame-input';
import { HEADLINE_BUILDER } from './headline-input';
import { buildHeadlineInput } from '../render/headline';
import { BROLL_PORT, IMAGENS_POR_TRILHA, SegundaFonteService, TRILHA_STORE, precisaSegundaFonte, type TrilhaStore } from './segunda-fonte';
import { VARIANTES, type TrilhaDoLote } from './trilha-broll';
import { CONCAT, baixarComEspera, chaveDaTrilha, chaveDoStorage, concatenarTrilha, trilhaNoArquivo } from './trilha-concat';
import { CustosService } from '../custos/custos.service';
import type { Prisma } from '@prisma/client';
import { createBrollService } from '../integracoes/broll';
import { PrismaCostStore } from '../integracoes/store/prisma.store';
import { StorageService } from '../arquivos/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFrameInput } from '../render/frame';
import { buildAutoEditInput } from '../render/auto-edit';
import { PecasAutoService } from './pecas.service';
import { PecasController } from './pecas.controller';
import { ImagemEstaticaService } from './imagem-estatica.service';

/**
 * Qual RenderService a fila usa: RENDER_IMPL=remotion (V2, @remotion/renderer) ou fake (ffmpeg sintético).
 * Padrão: fake com INTEGRACOES_MODE=mock (testes e QA), remotion no live.
 */
export function renderImpl(env: NodeJS.ProcessEnv = process.env): 'fake' | 'remotion' {
  if (env.RENDER_IMPL === 'fake' || env.RENDER_IMPL === 'remotion') return env.RENDER_IMPL;
  return integracoesMode(env) === 'mock' ? 'fake' : 'remotion';
}

@Module({
  imports: [RenderModule, MedicaoModule],
  controllers: [TemplatesController, EdicaoController, EditorController, PecasController, RenderWebhookController],
  providers: [
    // render-lambda-v1: a fila usa RENDER_PORTS (do RenderModule): fake/local/lambda por RENDER_IMPL + RENDER_LAMBDA_KINDS
    // variacao-auto-v1 §7.3: função pura do maquina-video que monta o AutoEditRenderInput
    { provide: AUTO_EDIT_BUILDER, useValue: buildAutoEditInput },
    // estatico-montado-e-molduras-v1 §B2: `buildFrameInput` do maquina-video (api/src/render/frame.ts)
    // headline-e-legenda-v1 §1.3: buildHeadlineInput do maquina-video (remix-keep)
    { provide: HEADLINE_BUILDER, useValue: buildHeadlineInput },
    { provide: FRAME_BUILDER, useValue: comConteudoDoCampeao(buildFrameInput) }, // + contentBox/burnedTextBands (25/10)
    EdicaoService,
    // §B3/§B3.1: 2ª fonte das molduras pela porta da maquina-ia (Pexels + escolha por visão + imagem de reserva). O sink
    // sobe o arquivo no nosso storage e devolve a URL assinada. Sem chave (live) = null: cai no trecho do campeão.
    {
      provide: BROLL_PORT,
      inject: [StorageService, PrismaService, AppConfig],
      useFactory: (storage: StorageService, prisma: PrismaService, cfg: AppConfig) => createBrollService({
        mode: integracoesMode(), costs: new PrismaCostStore(prisma), publicApiUrl: cfg.publicApiUrl,
        sink: {
          async put({ workspaceId, bytes, mimeType }) {
            const dir = await mkdtemp(join(tmpdir(), 'maquina-broll-'));
            try {
              const path = join(dir, mimeType === 'video/mp4' ? 'broll.mp4' : 'broll.png');
              await writeFile(path, bytes);
              const f = await storage.put(path, { workspaceId, kind: mimeType === 'video/mp4' ? 'SCENE_CLIP' : 'RENDER_IMAGE', mimeType });
              return { fileUrl: await storage.signedUrl(f) };
            } finally {
              await rm(dir, { recursive: true, force: true }).catch(() => undefined);
            }
          },
        },
      }),
    },
    // 25/10 (trilha de b-roll, §B3.1 item 9): 1 trilha por lote em variation_batches.settings.brollTrack; imagem gerada pelo teto
    {
      provide: TRILHA_STORE,
      inject: [PrismaService, CustosService, StorageService],
      useFactory: (prisma: PrismaService, custos: CustosService, storage: StorageService): TrilhaStore => ({
        async carregar(batchId) {
          const b = await prisma.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
          const t = (b?.settings as { brollTrack?: TrilhaDoLote } | null)?.brollTrack;
          return t && t.version === 1 ? t : null;
        },
        async gravar(batchId, t) {
          const b = await prisma.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
          const settings = (b?.settings ?? {}) as Record<string, unknown>;
          await prisma.variationBatch.update({ where: { id: batchId }, data: { settings: { ...settings, brollTrack: t } as unknown as Prisma.InputJsonValue } });
        },
        teto: (workspaceId, usd) => custos.assertWithinCap(workspaceId, usd),
        async variante(batchId, itemId) {
          const items = await prisma.variationItem.findMany({ where: { batchId, autoType: 'FRAME' }, orderBy: { index: 'asc' }, select: { id: true, payload: true } });
          const duas = items.filter((x) => precisaSegundaFonte(((x.payload ?? {}) as { params?: { template?: string } }).params?.template));
          const k = Math.max(0, duas.findIndex((x) => x.id === itemId));
          return k % VARIANTES;
        },
        // bug 429 (25/10): 1 MP4 por variante, guardado em settings.brollTrackFiles[variante] (chave = hash da trilha)
        async juntar({ batchId, workspaceId, variante, track }) {
          const key = chaveDaTrilha(track);
          const cached = await prisma.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
          const hit = ((cached?.settings ?? {}) as { brollTrackFiles?: Record<string, { key: string; fileId: string }> }).brollTrackFiles?.[String(variante)];
          if (hit?.key === key) {
            const f = await prisma.file.findUnique({ where: { id: hit.fileId } });
            if (f) return trilhaNoArquivo(track, await storage.signedUrl(f));
          }
          // URL vencida (403/400: a trilha guarda URLs assinadas de 6 h) = re-assina pela chave do nosso bucket
          const bucket = process.env.STORAGE_BUCKET ?? '';
          const baixar = async (url: string, p: string) => {
            try {
              await baixarComEspera(url, p);
            } catch (e) {
              const key = /download 40[03]/.test((e as Error).message) ? chaveDoStorage(url, bucket) : null;
              if (!key) throw e;
              await baixarComEspera(await storage.signedUrlForKey(key), p);
            }
          };
          const { path, dir, durationSec } = await concatenarTrilha(track, { baixar });
          try {
            const f = await storage.put(path, { workspaceId, kind: 'SCENE_CLIP', mimeType: 'video/mp4', meta: { durationSec, width: CONCAT.width, height: CONCAT.height } });
            const b = await prisma.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
            const settings = (b?.settings ?? {}) as Record<string, unknown>;
            const files = { ...((settings.brollTrackFiles as Record<string, unknown>) ?? {}), [String(variante)]: { key, fileId: f.id } };
            await prisma.variationBatch.update({ where: { id: batchId }, data: { settings: { ...settings, brollTrackFiles: files } as unknown as Prisma.InputJsonValue } });
            return trilhaNoArquivo(track, await storage.signedUrl(f));
          } finally {
            await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          }
        },
        async maxImagens(batchId) {
          const b = await prisma.variationBatch.findUnique({ where: { id: batchId }, select: { settings: true } });
          const n = (b?.settings as { brollTrackMaxImages?: unknown } | null)?.brollTrackMaxImages;
          return typeof n === 'number' && n >= 0 ? n : IMAGENS_POR_TRILHA;
        },
      }),
    },
    SegundaFonteService,
    EditorSaves,
    EditorService,
    PecasAutoService,
    ImagemEstaticaService, // rev. 23/10 §14.3: STATIC no GPT Image 2 (render IMAGE_GEN)
  ],
  exports: [EdicaoService, SegundaFonteService, PecasAutoService, ImagemEstaticaService],
})
export class EdicaoModule {}
