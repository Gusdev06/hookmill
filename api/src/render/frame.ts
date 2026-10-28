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
  FRAME_SAFE, FRAME_USES_FACE, contentBoxDe, decidirLegenda, faixasProtegidasDe, faixasQueimadasDe, frameLayout, layoutDaPeca, opcoesDeLayout,
  faixasProtegidasNaSaida, propsDeFrameInput, reframeNaCaixa, unionBand,
  rostoPrincipal, textosQueNaoCouberam, type FrameTextsMap, type MolduraProps,
} from '@maquina/video';
import type { FrameSpec } from '../integracoes/contrato';
import { palavrasNaEscrita } from './escrita-chinesa';
import type { AutoEditContext } from './auto-edit';
import type { FrameRenderInput } from './contrato';

/** Erro de texto que não coube (a fila grava FRAME_TEXT_OVERFLOW na peça). */
export class FrameTextOverflowError extends Error {
  readonly code = 'FRAME_TEXT_OVERFLOW' as const;
  constructor(public readonly slots: { slot: string; overflow: string | null; size: number; lines: number }[], format: string) {
    super(`FRAME_TEXT_OVERFLOW (${format}): ${slots.map((s) => `${s.slot} ${s.overflow} ${s.lines} linhas a ${s.size}px`).join('; ')}`);
  }
}

/** legenda-protegida-v1 §3: nem desviar nem recortar sem cortar o rosto = a peça não sai (o plano já devia ter tirado). */
export class CaptionProtectedError extends Error {
  readonly code = 'CAPTION_PROTECTED' as const;
  constructor(public readonly reason: 'face_cut' | 'no_room', public readonly hits: { element: string; atSec: number; overlapPx: number }[]) {
    super(`CAPTION_PROTECTED (${reason}): ${hits.slice(0, 4).map((h) => `${h.element}@${h.atSec}s`).join(', ')}`);
  }
}

/** A nossa legenda no estilo da legenda queimada original (§2.2): palavras da transcrição + estilo da camada `caption`. */
export function legendaNoEstiloDaOriginal(ctx: AutoEditContext, highlight: string): MolduraProps['captions'] | null {
  const m = ctx.editMap;
  if (!m || !ctx.words.length) return null;
  const capas = m.layers.filter((l) => l.kind === 'caption').sort((a, b) => b.endFrame - b.startFrame - (a.endFrame - a.startFrame));
  const l = capas[0];
  if (!l) return null;
  const st = l.style;
  const ey = ctx.source.height / m.height;
  const size = Math.max(1, st.fontSizePx);
  return {
    words: palavrasNaEscrita(ctx.words, ctx.language).map((w) => ({ word: w.word, startSec: w.startSec, endSec: w.endSec })), highlightColor: highlight, language: ctx.language,
    style: {
      fontId: st.fontId ?? null, uppercase: !!st.uppercase, color: st.color || '#ffffff', highlightColor: st.highlightColor ?? null,
      strokeColor: st.strokeColor ?? null, strokeWidthRel: Math.round(((st.strokeWidthPx ?? 0) / size) * 1000) / 1000,
      sizeRel: Math.round(((size * ey) / ctx.source.height) * 10000) / 10000, shadow: !!st.shadow, wordsPerPage: l.wordsPerPage ?? null,
    },
  };
}

/** Caixa do rosto pra foto redonda quando o faceTrack não tem rosto: terço de cima, ao centro. */
const ROSTO_PADRAO = { x: 0.3, y: 0.08, w: 0.4, h: 0.4 };

/** Opções do build. `captionMode: 'replace'` (legenda-protegida-v1 §3, Retry depois de CAPTION_COVERED) pula o desvio e
 *  vai direto pro recorte com a nossa legenda; recorte impossível = CAPTION_PROTECTED. */
export interface OpcoesDeBuild { captionMode?: 'avoid' | 'replace' }

export function buildFrameInput(spec: FrameSpec, ctx: AutoEditContext, format: VideoFormat, opts: OpcoesDeBuild = {}): FrameRenderInput {
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
  // legenda-protegida-v1: legenda queimada do campeão = faixa protegida (nada por cima, nada cortando)
  const protectedBands = faixasProtegidasDe(em as never, src);
  const U = unionBand(protectedBands);
  const rosto = rostoPrincipal(src, ctx.editMap);
  const r3 = (v: number) => Math.round(v * 1000) / 1000;

  let second: MolduraProps['second'];
  // TRANSIÇÃO: `broll_track` entra no FrameSecondSource do contrato pelo arquiteto (25/10); até lá, forma local igual
  type BrollTrack = { kind: 'broll_track'; clips: { fromSec: number; toSec: number; fileUrl: string; srcStartSec: number; srcEndSec: number; segmentText?: string; provenance?: unknown }[] };
  const s = spec.second as FrameSpec['second'] | BrollTrack | null;
  if (s?.kind === 'champion_segment') second = { kind: 'champion_segment', startSec: s.startSec, endSec: s.endSec, reframe: reframeNaCaixa(L.secondBox ?? L.videoBox, src, ctx.editMap, 1080, contentBox, U) };
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
      source: src, timeline: [{ startSec: 0, endSec: src.durationSec }], joinFadeMs: 40, reframe: reframeNaCaixa(L.videoBox, src, ctx.editMap, 1080, contentBox, U),
      ...(contentBox && { contentBox }), ...(burnedTextBands.length && { burnedTextBands }), ...(protectedBands.length && { protectedBands }),
    },
    ...(second && { second }),
    ...(face && { face }),
    safeArea: FRAME_SAFE[format],
  };
  // §3: desviar → recortar e legendar no estilo da original → não oferecer
  let final: FrameRenderInput = input;
  if (protectedBands.length) {
    const { kind: _k, renderId: _r, templateId: _t, ...props } = input;
    const d = decidirLegenda(props as MolduraProps, ctx.editMap, legendaNoEstiloDaOriginal(ctx, spec.brand.color), opts.captionMode === 'replace' ? 'replace' : undefined);
    if (d.mode === 'blocked') throw new CaptionProtectedError(d.reason, d.check.hits);
    final = { kind: 'frame', renderId: ctx.renderId, templateId: 'frame', ...d.input, outputProtectedBands: faixasProtegidasNaSaida(d.input) };
  }
  // texto que não cabe, medido no layout FINAL (o mesmo da composição: com o desvio da legenda queimada)
  const fora = textosQueNaoCouberam(layoutDaPeca(final));
  if (fora.length) throw new FrameTextOverflowError(fora, format);
  // mesma validação da composição (limites, timeline dentro do campeão): erro aqui = RENDER_ERROR antes de ir pra fila
  propsDeFrameInput(final as never);
  return final;
}
