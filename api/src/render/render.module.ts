import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FakeRenderService } from '../edicao/fake-render.service';
import type { RenderPort, RenderService } from './contrato';
import { LambdaRenderPort, escolhaDeImpl, faltandoNoLambda, lambdaConfig } from './lambda';
import { RenderPorts } from './portas';
import { RemotionRenderService, type RenderConfig } from './remotion-render.service';
import { ServicoComoPorta } from './servico-como-porta';

/** Token de injeção. O backend injeta por ele e tipa pela interface RenderService de ./contrato. */
export const RENDER_SERVICE = Symbol('RENDER_SERVICE');
/** render-lambda-v1 §6.1: os adaptadores da RenderPort (fake/local/lambda), escolhidos por env e kind. Tipo: RenderPorts. */
export const RENDER_PORTS = Symbol('RENDER_PORTS');

export function renderConfig(get: (k: string) => string | undefined): RenderConfig {
  const int = (k: string, d: number) => {
    const n = Number(get(k));
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  return {
    concurrency: int('RENDER_CONCURRENCY', 1),
    tmpDir: get('RENDER_TMP_DIR') || '/tmp/maquina-render',
    bundleDir: get('REMOTION_BUNDLE_DIR') || null,
    framesConcurrency: int('RENDER_FRAMES_CONCURRENCY', 1),
    browserExecutable: get('REMOTION_BROWSER_EXECUTABLE') || null,
    ffmpeg: get('FFMPEG_PATH') || 'ffmpeg',
    ffprobe: get('FFPROBE_PATH') || 'ffprobe',
  };
}

/**
 * Monta os adaptadores. `local` embrulha o RenderService real; `fake` o FakeRenderService (ffmpeg sintético); `lambda` só
 * existe com REMOTION_LAMBDA_FUNCTION + REMOTION_SERVE_URL (e é obrigatório com RENDER_IMPL=lambda: falha no boot).
 * Sem RENDER_IMPL: `fake` com INTEGRACOES_MODE=mock, `local` no live (a mesma regra do renderImpl() do edicao).
 */
export function criarRenderPorts(get: (k: string) => string | undefined, local: RenderService, o: { fake?: RenderService; lambda?: RenderPort } = {}): RenderPorts {
  const semEnv = (get('INTEGRACOES_MODE') ?? 'mock') === 'mock' ? 'fake' : 'local';
  const { impl, lambdaKinds } = escolhaDeImpl(get, semEnv);
  const portas: Partial<Record<'fake' | 'local' | 'lambda', RenderPort>> = {
    local: new ServicoComoPorta('local', local),
    fake: new ServicoComoPorta('fake', o.fake ?? new FakeRenderService({ tmpDir: get('RENDER_TMP_DIR') || '/tmp/maquina-render' })),
  };
  if (o.lambda) portas.lambda = o.lambda;
  else {
    const cfg = lambdaConfig(get);
    const falta = faltandoNoLambda(cfg);
    if (!falta.length) portas.lambda = new LambdaRenderPort(cfg, { templates: () => local.templates() });
    else if (impl === 'lambda') throw new Error(`RENDER_IMPL=lambda sem configuração: ${falta.join(', ')}`);
  }
  return new RenderPorts(impl, lambdaKinds, portas);
}

@Module({
  providers: [
    {
      provide: RENDER_SERVICE,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => new RemotionRenderService(renderConfig((k) => cfg.get<string>(k))),
    },
    {
      provide: RENDER_PORTS,
      inject: [ConfigService, RENDER_SERVICE],
      useFactory: (cfg: ConfigService, local: RenderService) => {
        const portas = criarRenderPorts((k) => cfg.get<string>(k), local);
        new Logger('Render').log(`portas: padrão ${portas.impl}, lambda ${portas.todos().some((p) => p.impl === 'lambda') ? `ligado (kinds ${[...portas.lambdaKinds].join(',')})` : 'desligado'}`);
        return portas;
      },
    },
  ],
  exports: [RENDER_SERVICE, RENDER_PORTS],
})
export class RenderModule {}
