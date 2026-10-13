import { Logger, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { integracoesMode } from '../integracoes';
import { MedicaoModule } from '../medicao';
import { RENDER_SERVICE, RenderModule, type RenderService } from '../render';
import { isRemixKeep } from '../render/contrato';
import { EdicaoController, TemplatesController } from './edicao.controller';
import { EdicaoService, RENDER_PORT } from './edicao.service';
import { FakeRenderService } from './fake-render.service';
import { EditorController } from './editor.controller';
import { EditorSaves } from './editor-saves';
import { EditorService } from './editor.service';
import { AUTO_EDIT_BUILDER } from './auto-edit-input';
import { buildAutoEditInput } from '../render/auto-edit';
import { PecasAutoService } from './pecas.service';
import { PecasController } from './pecas.controller';

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
  controllers: [TemplatesController, EdicaoController, EditorController, PecasController],
  providers: [
    {
      provide: RENDER_PORT,
      inject: [AppConfig, RENDER_SERVICE],
      useFactory: (cfg: AppConfig, real: RenderService): RenderService => {
        const impl = renderImpl();
        new Logger('Edicao').log(`render: ${impl}`);
        if (impl !== 'fake') return real;
        const fake = new FakeRenderService({ tmpDir: cfg.optional('RENDER_TMP_DIR') ?? '/tmp/maquina-render' });
        // §13.6: remix-keep é render local (CPU, US$ 0) e só se confere com a peça de verdade (md5 do áudio, PSNR):
        // no mock ele usa o Remotion real; o fake fica só pro Jest (JEST_WORKER_ID); RENDER_REMIX_IMPL força.
        const remixImpl = process.env.RENDER_REMIX_IMPL ?? (process.env.JEST_WORKER_ID ? 'fake' : 'remotion');
        if (remixImpl === 'fake') return fake;
        return { templates: () => fake.templates(), render: (input, onProgress) => (isRemixKeep(input) ? real : fake).render(input, onProgress) };
      },
    },
    // variacao-auto-v1 §7.3: função pura do maquina-video que monta o AutoEditRenderInput
    { provide: AUTO_EDIT_BUILDER, useValue: buildAutoEditInput },
    EdicaoService,
    EditorSaves,
    EditorService,
    PecasAutoService,
  ],
  exports: [EdicaoService, PecasAutoService],
})
export class EdicaoModule {}
