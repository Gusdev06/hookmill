import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  AUTO_EDIT_COMPOSITION_ID,
  COMPOSITION_ID,
  FRAME_COMPOSITION_ID,
  propsDeFrameInput,
  propsDeAutoEditInput,
  REMIX_COMPOSITION_ID,
  RENDER_PADRAO,
  RENDER_REMIX,
  TEMPLATES,
  propsDeRemixInput,
  propsDeRenderInput,
} from '@maquina/video';
import { RenderError, RenderValidationError, isAutoEdit, isFrame, isRemixKeep, type AutoEditRenderInput, type FrameRenderInput, type RemixKeepRenderInput, type RenderInput, type RenderProgress, type RenderResult, type RenderService } from './contrato';
import { FilaLimitada } from './fila';
import { frameDoErro, limitarProgresso, mapearProgresso } from './progresso';
import { conferirSplice } from './troca-motor';
import { comporSobreOCampeao, contarFrames } from './posprocesso';
import { TEASER_MIN_SEC, emendasNoSilencio } from './emendas';

export interface RenderConfig {
  concurrency: number;            // RENDER_CONCURRENCY (renders simultâneos; 1 na v1)
  tmpDir: string;                 // RENDER_TMP_DIR
  bundleDir: string | null;       // REMOTION_BUNDLE_DIR (vazio = bundle na hora, só dev)
  /** Abas do Chrome por render. 1 = menos memória (docs/render.md). */
  framesConcurrency: number;      // RENDER_FRAMES_CONCURRENCY
  /**
   * Chrome Headless Shell já baixado (REMOTION_BROWSER_EXECUTABLE). Em produção é obrigatório: o download
   * do Remotion em tempo de render pode derrubar o processo (timer sem catch, visto em 05/10). Baixe no build
   * da imagem com `npx remotion browser ensure`.
   */
  browserExecutable: string | null;
  /** ffmpeg/ffprobe do sistema (FFMPEG_PATH/FFPROBE_PATH): remux do áudio e conferência de frames do remix-keep. */
  ffmpeg?: string;
  ffprobe?: string;
}

/** Fronteira com o Remotion, pra trocar por fake nos testes (e por Lambda no futuro). */
export interface RemotionPort {
  ensureBrowser(o: { browserExecutable: string | null }): Promise<unknown>;
  bundle(entryPoint: string, publicDir: string, onProgress: (pct: number) => void): Promise<string>;
  selectComposition(o: { serveUrl: string; id: string; inputProps: Record<string, unknown>; browserExecutable: string | null }): Promise<{ width: number; height: number; fps: number; durationInFrames: number }>;
  renderMedia(o: Record<string, unknown> & { onProgress: (p: { progress: number; renderedFrames: number; encodedFrames: number }) => void }): Promise<unknown>;
  renderStill(o: Record<string, unknown>): Promise<unknown>;
}

const raizDoVideo = () => path.dirname(require.resolve('@maquina/video/package.json'));

export const remotionReal = (): RemotionPort => ({
  ensureBrowser: async (o) => (await import('@remotion/renderer')).ensureBrowser(o),
  bundle: async (entryPoint, publicDir, onProgress) =>
    (await import('@remotion/bundler')).bundle({ entryPoint, publicDir, onProgress }),
  selectComposition: async (o) => (await import('@remotion/renderer')).selectComposition(o),
  renderMedia: async (o) => (await import('@remotion/renderer')).renderMedia(o as never),
  renderStill: async (o) => (await import('@remotion/renderer')).renderStill(o as never),
});

@Injectable()
export class RemotionRenderService implements RenderService {
  private readonly log = new Logger('RenderService');
  private readonly fila: FilaLimitada;
  private serveUrl: Promise<string> | null = null;
  private navegador: Promise<unknown> | null = null;
  /** Bordas movidas pro silêncio no último render auto-edit (diagnóstico; o script de verificação lê). */
  ultimasEmendas: { de: number; para: number; db: number }[] = [];

  constructor(private readonly cfg: RenderConfig, private readonly remotion: RemotionPort = remotionReal()) {
    this.fila = new FilaLimitada(cfg.concurrency);
  }

  templates() {
    const raiz = raizDoVideo();
    return TEMPLATES.map((t) => ({
      id: t.id,
      kind: t.kind,
      labelKey: t.labelKey,
      thumbnailPath: t.thumbnailPath ? path.join(raiz, t.thumbnailPath) : '',
      supportsHeadline: t.supportsHeadline,
    }));
  }

  render(input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> {
    return this.fila.executar(() => this.renderAgora(input, onProgress));
  }

  /** Bundle pronto (produção) ou compilado uma vez na primeira chamada (dev). */
  private obterServeUrl(onPct: (pct: number) => void): Promise<string> {
    if (!this.serveUrl) {
      const dir = this.cfg.bundleDir ? path.resolve(this.cfg.bundleDir) : null;
      if (dir && existsSync(path.join(dir, 'index.html'))) {
        this.serveUrl = Promise.resolve(dir);
      } else {
        if (dir) this.log.warn(`REMOTION_BUNDLE_DIR sem index.html (${dir}); compilando o bundle na hora`);
        const raiz = raizDoVideo();
        this.serveUrl = this.remotion.bundle(path.join(raiz, 'src', 'index.ts'), path.join(raiz, 'public'), onPct);
        this.serveUrl.catch(() => (this.serveUrl = null));
      }
    }
    return this.serveUrl;
  }

  private async renderAgora(input: RenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> {
    if (isAutoEdit(input) || isFrame(input)) return this.renderAutoEdit(input, onProgress);
    const avisar = limitarProgresso(onProgress);
    // uma pasta por render: o backend apaga dirname(outputPath) depois de subir (não pode levar o RENDER_TMP_DIR junto)
    const dir = path.join(this.cfg.tmpDir, input.renderId);
    const outputPath = path.join(dir, 'video.mp4');
    const posterPath = path.join(dir, 'poster.jpg');
    const remix = isRemixKeep(input);
    const compositionId = remix ? REMIX_COMPOSITION_ID : COMPOSITION_ID;
    const mudoPath = path.join(dir, 'remotion.mudo.mp4');
    let props: Record<string, unknown>;
    try {
      props = remix ? propsDeRemixInput(input) : propsDeRenderInput(input as Exclude<RenderInput, RemixKeepRenderInput | AutoEditRenderInput | FrameRenderInput>);
      if (remix && input.audioSplice) conferirSplice(input.audioSplice, input.canvas.frameCount);
    } catch (e) {
      throw new RenderError('RENDER_ERROR', null, `entrada inválida: ${e instanceof Error ? e.message : String(e)}`);
    }

    let totalFrames = 0;
    let ultimoFrame = 0;
    try {
      await mkdir(dir, { recursive: true });
      avisar({ stage: 'bundling', progress: 0, frame: 0, totalFrames: 0 });
      const browserExecutable = this.cfg.browserExecutable;
      if (!this.navegador) {
        this.navegador = this.remotion.ensureBrowser({ browserExecutable });
        this.navegador.catch(() => (this.navegador = null));
      }
      await this.navegador;
      const serveUrl = await this.obterServeUrl((pct) => avisar({ stage: 'bundling', progress: Math.floor(pct), frame: 0, totalFrames: 0 }));
      const composition = await this.remotion.selectComposition({ serveUrl, id: compositionId, inputProps: props, browserExecutable });
      totalFrames = composition.durationInFrames;
      avisar({ stage: 'rendering', progress: 0, frame: 0, totalFrames });

      await this.remotion.renderMedia({
        serveUrl,
        composition,
        inputProps: props,
        outputLocation: remix ? mudoPath : outputPath,
        // remix-keep sai mudo: o áudio do campeão entra depois, copiado sem recodificar (§13.3 item 7)
        ...(remix ? { muted: true, crf: RENDER_REMIX.crf, colorSpace: RENDER_REMIX.colorSpace } : {}),
        codec: RENDER_PADRAO.codec,
        imageFormat: remix ? RENDER_REMIX.imageFormat : RENDER_PADRAO.imageFormat,
        pixelFormat: RENDER_PADRAO.pixelFormat,
        concurrency: this.cfg.framesConcurrency,
        offthreadVideoCacheSizeInBytes: RENDER_PADRAO.offthreadVideoCacheSizeInBytes,
        overwrite: true,
        logLevel: 'error',
        browserExecutable,
        onProgress: (p) => {
          ultimoFrame = p.renderedFrames;
          avisar(mapearProgresso(p, totalFrames));
        },
      });

      if (remix) {
        await this.comporSobreOCampeao(input, mudoPath, outputPath);
        const n = await this.contarFrames(outputPath);
        if (n !== input.canvas.frameCount) {
          throw new RenderValidationError('RENDER_ERROR', null, `nb_frames ${n} != campeão ${input.canvas.frameCount}`);
        }
      }

      await this.remotion.renderStill({
        serveUrl,
        composition,
        inputProps: props,
        output: posterPath,
        frame: Math.min(Math.round(1.5 * composition.fps), totalFrames - 1),
        // o pôster não precisa de áudio; no remix as fontes/vídeos são os mesmos do render
        imageFormat: 'jpeg',
        jpegQuality: 85,
        overwrite: true,
        browserExecutable,
        offthreadVideoCacheSizeInBytes: RENDER_PADRAO.offthreadVideoCacheSizeInBytes,
        logLevel: 'error',
      });

      const { size } = await stat(outputPath);
      avisar({ stage: 'encoding', progress: 100, frame: totalFrames, totalFrames });
      return {
        outputPath,
        posterPath,
        durationSec: totalFrames / composition.fps,
        width: composition.width,
        height: composition.height,
        sizeBytes: size,
        mimeType: 'video/mp4',
      };
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      if (e instanceof RenderError) throw e;
      const frame = frameDoErro(e) ?? (totalFrames > 0 ? Math.min(ultimoFrame, totalFrames - 1) : null);
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`render ${input.renderId} falhou no frame ${frame}: ${msg}`);
      throw new RenderError('RENDER_ERROR', frame, msg.split('\n')[0].slice(0, 500));
    }
  }

  /**
   * variacao-auto-v1 §7.2: peça `auto-edit`. Vídeo = H.264 1080 de largura, 30 fps, áudio do campeão recortado pelo
   * timeline (AAC), nb_frames conferido contra a duração calculada. Rev. 23/10 (§14.6): sem still; o STATIC é imagem
   * do GPT Image 2 e chega aqui só por engano (RENDER_ERROR "entrada inválida").
   * Moldura (kind 'frame', estatico-montado-e-molduras-v1 §B2) usa o mesmo caminho: composição `Moldura`, campeão inteiro
   * com o áudio dele (sem refino de emenda: o timeline é um trecho só).
   */
  private async renderAutoEdit(input: AutoEditRenderInput | FrameRenderInput, onProgress: (p: RenderProgress) => void): Promise<RenderResult> {
    const moldura = isFrame(input);
    const fonte = moldura ? input.video.source : input.source;
    const rotulo = moldura ? `frame ${input.frame.id}` : `auto-edit ${input.type}`;
    const avisar = limitarProgresso(onProgress);
    const dir = path.join(this.cfg.tmpDir, input.renderId);
    const outputPath = path.join(dir, 'video.mp4');
    const posterPath = path.join(dir, 'poster.jpg');
    let props: Record<string, unknown>;
    try {
      props = moldura ? propsDeFrameInput(input as never) : propsDeAutoEditInput(input as never);
    } catch (e) {
      throw new RenderError('RENDER_ERROR', null, `entrada inválida: ${e instanceof Error ? e.message : String(e)}`);
    }
    // emendas no silêncio medido do áudio (o Whisper erra a borda da palavra em 0,1-0,2 s); só com mais de um trecho
    if (!moldura && input.source.hasAudio && input.timeline.length > 1) {
      try {
        // COLD-OPEN: o teaser (trecho 0) nunca fica abaixo de 1,5 s (regra do §7.1)
        const minSec = input.params.type === 'COLD_OPEN' ? [Math.min(TEASER_MIN_SEC, input.timeline[0].endSec - input.timeline[0].startSec)] : [];
        const r = await emendasNoSilencio(this.cfg.ffmpeg || 'ffmpeg', input.source.videoUrl, input.timeline, input.source.durationSec, { minSec });
        props = { ...props, timeline: r.timeline };
        this.ultimasEmendas = r.movidas;
      } catch (e) {
        this.log.warn(`render ${input.renderId}: emendas sem refino (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    const browserExecutable = this.cfg.browserExecutable;
    let totalFrames = 0;
    let ultimoFrame = 0;
    try {
      await mkdir(dir, { recursive: true });
      avisar({ stage: 'bundling', progress: 0, frame: 0, totalFrames: 0 });
      if (!this.navegador) {
        this.navegador = this.remotion.ensureBrowser({ browserExecutable });
        this.navegador.catch(() => (this.navegador = null));
      }
      await this.navegador;
      const serveUrl = await this.obterServeUrl((pct) => avisar({ stage: 'bundling', progress: Math.floor(pct), frame: 0, totalFrames: 0 }));
      const composition = await this.remotion.selectComposition({
        serveUrl, id: moldura ? FRAME_COMPOSITION_ID : AUTO_EDIT_COMPOSITION_ID, inputProps: props, browserExecutable,
      });
      totalFrames = composition.durationInFrames;
      avisar({ stage: 'rendering', progress: 0, frame: 0, totalFrames });
      const comum = {
        serveUrl, composition, inputProps: props, overwrite: true, logLevel: 'error', browserExecutable,
        offthreadVideoCacheSizeInBytes: RENDER_PADRAO.offthreadVideoCacheSizeInBytes,
      };
      await this.remotion.renderMedia({
        ...comum,
        outputLocation: outputPath,
        codec: RENDER_PADRAO.codec,
        imageFormat: RENDER_PADRAO.imageFormat,
        jpegQuality: 90,
        pixelFormat: RENDER_PADRAO.pixelFormat,
        audioCodec: 'aac',
        muted: !fonte.hasAudio,
        concurrency: this.cfg.framesConcurrency,
        onProgress: (p) => {
          ultimoFrame = p.renderedFrames;
          avisar(mapearProgresso(p, totalFrames));
        },
      });
      const n = await this.contarFrames(outputPath);
      if (n !== totalFrames) throw new RenderError('RENDER_ERROR', null, `nb_frames ${n} != ${totalFrames} calculados`);
      await this.remotion.renderStill({
        ...comum, output: posterPath, frame: Math.min(Math.round(1.5 * composition.fps), totalFrames - 1), imageFormat: 'jpeg', jpegQuality: 85,
      });
      const { size } = await stat(outputPath);
      avisar({ stage: 'encoding', progress: 100, frame: totalFrames, totalFrames });
      return {
        outputPath, posterPath,
        durationSec: totalFrames / composition.fps,
        width: composition.width, height: composition.height, sizeBytes: size,
        mimeType: 'video/mp4',
      };
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      if (e instanceof RenderError) throw e;
      const frame = frameDoErro(e) ?? (totalFrames > 0 ? Math.min(ultimoFrame, totalFrames - 1) : null);
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`render ${input.renderId} (${rotulo} ${input.format}) falhou no frame ${frame}: ${msg}`);
      throw new RenderError('RENDER_ERROR', frame, msg.split('\n')[0].slice(0, 500));
    }
  }

  /** Pós-processo em ./posprocesso (o adaptador lambda usa o mesmo). */
  private ff() { return { ffmpeg: this.cfg.ffmpeg || 'ffmpeg', ffprobe: this.cfg.ffprobe || 'ffprobe' }; }
  private comporSobreOCampeao(input: RemixKeepRenderInput, mudo: string, saida: string): Promise<void> {
    return comporSobreOCampeao(this.ff(), input, mudo, saida);
  }
  private contarFrames(arquivo: string): Promise<number> {
    return contarFrames(this.ff(), arquivo);
  }
}
