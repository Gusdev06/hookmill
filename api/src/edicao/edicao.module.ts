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
import { BROLL_PORT, SegundaFonteService } from './segunda-fonte';
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
    SegundaFonteService,
    EditorSaves,
    EditorService,
    PecasAutoService,
    ImagemEstaticaService, // rev. 23/10 §14.3: STATIC no GPT Image 2 (render IMAGE_GEN)
  ],
  exports: [EdicaoService, SegundaFonteService, PecasAutoService, ImagemEstaticaService],
})
export class EdicaoModule {}
