/**
 * estatico-montado-e-molduras-v1 §B2: buildFrameInput(spec, ctx, format) → FrameRenderInput (kind 'frame'). Função PURA do
 * maquina-video, como o buildAutoEditInput: o backend (edicao, dono da fila) monta o FrameSpec (payload.params da peça) e o
 * AutoEditContext do campeão, e chama ao tirar o render da fila (token FRAME_BUILDER). Mesmo spec + ctx + formato = mesmo input.
 *
 * - Layout e ajuste de texto = `frameLayout` do @maquina/video (o mesmo que a composição `Moldura` usa). Texto que não cabe
 *   no mínimo de 36 px (ou palavra maior que a linha) = erro com `code: 'FRAME_TEXT_OVERFLOW'` (peça failed, Leave out).
 * - Vídeo: o campeão inteiro, com o áudio dele; reenquadrado NA CAIXA do vídeo (`reframeNaCaixa`: rosto a 40 %, contain_blur
 *   quando o rosto ficaria gigante ou a janela cortaria texto queimado).
 * - Rosto redondo (question_box, live, gossip_page, gossip_white): frame `faceAtSec` do campeão recortado no faceTrack.
 * - 2ª fonte (B2): champion_segment / page_capture / product_photo / stock_broll, como vieram do backend.
 */
import type { VideoFormat } from '@prisma/client';
import {
  FRAME_SAFE, FRAME_USES_FACE, contentBoxDe, faixasQueimadasDe, frameLayout, layoutDaPeca, opcoesDeLayout, propsDeFrameInput, reframeNaCaixa,
  rostoPrincipal, textosQueNaoCouberam, type FrameTextsMap, type MolduraProps,
} from '@maquina/video';
import type { FrameSpec } from '../integracoes/contrato';
import type { AutoEditContext } from './auto-edit';
import type { FrameRenderInput } from './contrato';

/** Erro de texto que não coube (a fila grava FRAME_TEXT_OVERFLOW na peça). */
export class FrameTextOverflowError extends Error {
  readonly code = 'FRAME_TEXT_OVERFLOW' as const;
  constructor(public readonly slots: { slot: string; overflow: string | null; size: number; lines: number }[], format: string) {
    super(`FRAME_TEXT_OVERFLOW (${format}): ${slots.map((s) => `${s.slot} ${s.overflow} ${s.lines} linhas a ${s.size}px`).join('; ')}`);
  }
}

/** Caixa do rosto pra foto redonda quando o faceTrack não tem rosto: terço de cima, ao centro. */
const ROSTO_PADRAO = { x: 0.3, y: 0.08, w: 0.4, h: 0.4 };

export function buildFrameInput(spec: FrameSpec, ctx: AutoEditContext, format: VideoFormat): FrameRenderInput {
  const id = spec.template;
  const texts = spec.texts as FrameTextsMap[typeof id];
  // idioma da tela sem região ("zh") herda a do lote ("zh-TW"): decide tradicional × simplificado (fonte e rótulos)
  const lang = !spec.screenLanguage.includes('-') && ctx.language.toLowerCase().startsWith(spec.screenLanguage.toLowerCase()) ? ctx.language : spec.screenLanguage;
  // a `call` com foto/captura encaixa a imagem no slide (mesma regra da composição): o ajuste de texto muda com ela
  const L = frameLayout(id, format, texts as never, lang, opcoesDeLayout(spec.second));

  const src = ctx.source;
  // decisões de 25/10: só a área do vídeo real (sem letterbox/headline queimada) e o texto da moldura fora da legenda queimada
  const em = ctx.editMap as unknown as Parameters<typeof contentBoxDe>[1];
  const contentBox = contentBoxDe(src, em);
  const burnedTextBands = faixasQueimadasDe(src, em as never, contentBox);
  const rosto = rostoPrincipal(src, ctx.editMap);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  let second: MolduraProps['second'];
  // TRANSIÇÃO: `broll_track` entra no FrameSecondSource do contrato pelo arquiteto (25/10); até lá, forma local igual
  type BrollTrack = { kind: 'broll_track'; clips: { fromSec: number; toSec: number; fileUrl: string; srcStartSec: number; srcEndSec: number; segmentText?: string; provenance?: unknown }[] };
  const s = spec.second as FrameSpec['second'] | BrollTrack | null;
  if (s?.kind === 'champion_segment') second = { kind: 'champion_segment', startSec: s.startSec, endSec: s.endSec, reframe: reframeNaCaixa(L.secondBox ?? L.videoBox, src, ctx.editMap, 1080, contentBox) };
  else if (s?.kind === 'page_capture') second = { kind: 'page_capture', fileUrl: s.fileUrl, scroll: s.scroll };
  else if (s?.kind === 'product_photo') second = { kind: 'product_photo', fileUrl: s.fileUrl };
  else if (s?.kind === 'broll_track') {
    // trilha de b-roll: clipes na linha do tempo da peça (a composição fecha buracos e segura o último quadro)
    second = { kind: 'broll_track', clips: s.clips.map((c) => ({ fromSec: c.fromSec, toSec: c.toSec, fileUrl: c.fileUrl, srcStartSec: c.srcStartSec, srcEndSec: c.srcEndSec, ...(c.segmentText && { segmentText: c.segmentText }), ...(c.provenance !== undefined && { provenance: c.provenance }) })) };
  } else if (s?.kind === 'stock_broll') second = { kind: 'stock_broll', fileUrl: s.fileUrl, durationSec: Math.max(0.5, s.provenance.endSec - s.provenance.startSec) };

  let face: MolduraProps['face'];
  if (FRAME_USES_FACE.includes(id)) {
    const fps = ctx.editMap?.fps ?? src.fps;
    const seg = ctx.editMap?.faceTrack.find((t) => (t.role ?? 'main') === 'main' && t.faceInRegion.length);
    const atSec = spec.faceAtSec ?? (seg ? (seg.faceInRegion[0].atFrame || seg.startFrame) / fps + 0.5 : Math.min(1, src.durationSec / 2));
    const box = rosto
      ? { x: r3((rosto.cx - rosto.w / 2) / src.width), y: r3((rosto.cy - rosto.h / 2) / src.height), w: r3(rosto.w / src.width), h: r3(rosto.h / src.height) }
      : ROSTO_PADRAO;
    face = { kind: 'face_crop', atSec: r3(Math.min(Math.max(0, atSec), Math.max(0, src.durationSec - 0.1))), box };
  }

  const input: FrameRenderInput = {
    kind: 'frame', renderId: ctx.renderId, templateId: 'frame', format, language: lang,
    frame: { id, texts, brand: spec.brand } as MolduraProps['frame'],
    video: {
      source: src, timeline: [{ startSec: 0, endSec: src.durationSec }], joinFadeMs: 40, reframe: reframeNaCaixa(L.videoBox, src, ctx.editMap, 1080, contentBox),
      ...(contentBox && { contentBox }), ...(burnedTextBands.length && { burnedTextBands }),
    },
    ...(second && { second }),
    ...(face && { face }),
    safeArea: FRAME_SAFE[format],
  };
  // texto que não cabe, medido no layout FINAL (o mesmo da composição: com o desvio da legenda queimada)
  const fora = textosQueNaoCouberam(layoutDaPeca(input));
  if (fora.length) throw new FrameTextOverflowError(fora, format);
  // mesma validação da composição (limites, timeline dentro do campeão): erro aqui = RENDER_ERROR antes de ir pra fila
  propsDeFrameInput(input as never);
  return input;
}
