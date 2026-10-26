// O que o Lambda renderiza pra cada kind: composição, props e as MESMAS opções de codificação do adaptador local
// (remotion-render.service.ts; render-lambda-v1 §1 item 4). O teste `plano` trava os valores contra o local.
import {
  AUTO_EDIT_COMPOSITION_ID,
  COMPOSITION_ID,
  FRAME_COMPOSITION_ID,
  REMIX_COMPOSITION_ID,
  RENDER_PADRAO,
  RENDER_REMIX,
  propsDeAutoEditInput,
  propsDeFrameInput,
  propsDeRemixInput,
  propsDeRenderInput,
} from '@maquina/video';
import {
  RenderError,
  isAutoEdit,
  isFrame,
  isRemixKeep,
  kindDe,
  type AutoEditRenderInput,
  type FrameRenderInput,
  type RemixKeepRenderInput,
  type RenderInput,
  type RenderKind,
} from '../contrato';
import { TEASER_MIN_SEC, emendasNoSilencio } from '../emendas';
import { conferirSplice } from '../troca-motor';

export interface PlanoLambda {
  kind: RenderKind;
  compositionId: string;
  props: Record<string, unknown>;
  /** Opções de codificação que vão direto pro renderMediaOnLambda. */
  codificacao: {
    codec: 'h264';
    imageFormat: 'jpeg' | 'png';
    jpegQuality?: number;
    pixelFormat: 'yuv420p';
    crf?: number;
    colorSpace?: 'bt709';
    muted?: boolean;
    audioCodec?: 'aac';
    x264Preset: 'medium';
    offthreadVideoCacheSizeInBytes: number;
  };
  /** Nome do arquivo na pasta do render: remix baixa o intermediário mudo e compõe sobre o campeão. */
  arquivoBaixado: 'video.mp4' | 'remotion.mudo.mp4';
  /** Bordas movidas pro silêncio (auto-edit; diagnóstico). */
  emendas?: { de: number; para: number; db: number }[];
}

const entradaInvalida = (e: unknown) => new RenderError('RENDER_ERROR', null, `entrada inválida: ${e instanceof Error ? e.message : String(e)}`);

/** Monta o plano. As emendas no silêncio (ffmpeg só de áudio) rodam aqui, na API, antes do submit (§1 item 10). */
export async function montarPlano(input: RenderInput, o: { ffmpeg: string; aviso?: (m: string) => void }): Promise<PlanoLambda> {
  const kind = kindDe(input);
  const base = {
    codec: RENDER_PADRAO.codec, pixelFormat: RENDER_PADRAO.pixelFormat, x264Preset: 'medium' as const,
    offthreadVideoCacheSizeInBytes: RENDER_PADRAO.offthreadVideoCacheSizeInBytes,
  };
  // Moldura (estatico-montado-e-molduras-v1 §B2): composição `Moldura`, campeão inteiro com o áudio dele, sem refino de
  // emenda (timeline de um trecho só), mesma codificação do local (remotion-render.service renderAutoEdit). A 2ª fonte
  // (`second.fileUrl`, e na trilha `broll_track` cada `second.clips[i].fileUrl`) e o rosto (`face`: face_crop do próprio
  // campeão ou `url` de imagem) passam pela checagem de mídia do submit (problemasDeMidia percorre arrays e objetos).
  if (isFrame(input)) {
    let props: Record<string, unknown>;
    try { props = propsDeFrameInput(input as never) as unknown as Record<string, unknown>; } catch (e) { throw entradaInvalida(e); }
    return {
      kind, compositionId: FRAME_COMPOSITION_ID, props, arquivoBaixado: 'video.mp4',
      codificacao: { ...base, imageFormat: RENDER_PADRAO.imageFormat, jpegQuality: 90, audioCodec: 'aac', muted: !input.video.source.hasAudio },
    };
  }

  if (isAutoEdit(input)) {
    let props: Record<string, unknown>;
    try { props = propsDeAutoEditInput(input as never) as unknown as Record<string, unknown>; } catch (e) { throw entradaInvalida(e); }
    let emendas: PlanoLambda['emendas'];
    const a = input as AutoEditRenderInput;
    if (a.source.hasAudio && a.timeline.length > 1) {
      try {
        const minSec = a.params.type === 'COLD_OPEN' ? [Math.min(TEASER_MIN_SEC, a.timeline[0].endSec - a.timeline[0].startSec)] : [];
        const r = await emendasNoSilencio(o.ffmpeg, a.source.videoUrl, a.timeline, a.source.durationSec, { minSec });
        props = { ...props, timeline: r.timeline };
        emendas = r.movidas;
      } catch (e) {
        o.aviso?.(`render ${a.renderId}: emendas sem refino (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    return {
      kind, compositionId: AUTO_EDIT_COMPOSITION_ID, props, arquivoBaixado: 'video.mp4', emendas,
      codificacao: { ...base, imageFormat: RENDER_PADRAO.imageFormat, jpegQuality: 90, audioCodec: 'aac', muted: !a.source.hasAudio },
    };
  }

  if (isRemixKeep(input)) {
    let props: Record<string, unknown>;
    try {
      props = propsDeRemixInput(input) as unknown as Record<string, unknown>;
      if (input.audioSplice) conferirSplice(input.audioSplice, input.canvas.frameCount);
    } catch (e) { throw entradaInvalida(e); }
    return {
      kind, compositionId: REMIX_COMPOSITION_ID, props, arquivoBaixado: 'remotion.mudo.mp4',
      codificacao: { ...base, imageFormat: RENDER_REMIX.imageFormat, crf: RENDER_REMIX.crf, colorSpace: RENDER_REMIX.colorSpace, muted: true },
    };
  }

  let props: Record<string, unknown>;
  try {
    props = propsDeRenderInput(input as Exclude<RenderInput, RemixKeepRenderInput | AutoEditRenderInput | FrameRenderInput>) as unknown as Record<string, unknown>;
  } catch (e) { throw entradaInvalida(e); }
  return { kind, compositionId: COMPOSITION_ID, props, arquivoBaixado: 'video.mp4', codificacao: { ...base, imageFormat: RENDER_PADRAO.imageFormat } };
}
