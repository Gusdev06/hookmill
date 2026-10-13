import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RemotionRenderService, type RenderConfig } from './remotion-render.service';

/** Token de injeção. O backend injeta por ele e tipa pela interface RenderService de ./contrato. */
export const RENDER_SERVICE = Symbol('RENDER_SERVICE');

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

@Module({
  providers: [
    {
      provide: RENDER_SERVICE,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => new RemotionRenderService(renderConfig((k) => cfg.get<string>(k))),
    },
  ],
  exports: [RENDER_SERVICE],
})
export class RenderModule {}
