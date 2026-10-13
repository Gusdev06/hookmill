import type { EditLayer, EditMap, Rect, TextStyle, TranscriptWord } from '@maquina/contratos';
import { hookLayerOf, layerArea, mainSegments } from '../campeoes/mapa-edicao';
import type { RemixKeepRenderInput } from '../render/contrato';

type TextLayer = RemixKeepRenderInput['textLayers'][number];
type FitCrop = (clip: { w: number; h: number }, clipFace: Rect, region: { w: number; h: number }, faceInRegion: Rect) => Rect;

export interface SwapPart {
  clipUrl: string;
  clip: { w: number; h: number };
  /** rosto do clipe (px do clipe), YuNet por score */
  clipFace: Rect;
  /** instante do campeão em que o take começa (janela AUDIO_LIPSYNC) */
  takeSourceStartSec: number;
}

/** §13.15: clipe de uma cena SWAP_VIDEO (1 trecho main), já no nº exato de frames do trecho. */
export interface SwapSpanPart {
  startFrame: number; endFrame: number;
  clipUrl: string;
  clip: { w: number; h: number };
  clipFace: Rect;
}

export interface RemixKeepArgs {
  renderId: string;
  editMap: EditMap;
  baseVideoUrl: string;
  audioPassthroughUrl: string;
  /** transcrição do campeão (karaokê redesenhado nos tempos originais) */
  words: TranscriptWord[];
  hookEndSec: number;
  swap?: SwapPart;
  /** §13.15: Trocar avatar com Kling/Seedance: um clipe por trecho main (no lugar do take) */
  swapSpans?: SwapSpanPart[];
  /** §13.15.4 (B) voz do motor: áudio montado (campeão com os trechos trocados) e toda legenda redesenhada com `words` mescladas */
  engineVoice?: { audioSplice: NonNullable<RemixKeepRenderInput['audioSplice']> };
  /** gancho escrito: texto novo da camada do gancho */
  hookText?: string | null;
  fitCrop: FitCrop;
}

const DEFAULT_STYLE: TextStyle = {
  fontId: 'montserrat-800', uppercase: false, fontSizePx: 48, lineHeight: 1.15, color: '#FFFFFF', highlightColor: null,
  strokeColor: '#000000', strokeWidthPx: 4, shadow: true, align: 'center',
};

const inside = (a: Rect, b: Rect) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/** Palavras da transcrição em frames da grade do campeão, só as que começam em [start, end). */
export function wordsInFrames(words: TranscriptWord[], fps: number, start: number, end: number) {
  return words
    .map((w) => {
      const s = Math.round(w.startSec * fps);
      return { word: captionWord(w.word), startFrame: s, endFrame: Math.max(s + 1, Math.round(w.endSec * fps)) };
    })
    .filter((w) => w.word && w.startFrame >= start && w.startFrame < end);
}

/** Palavra da legenda sem a pontuação do Whisper nas pontas ("vida," → "vida"; "don't" fica). */
export const captionWord = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%$€£]+$/gu, '');

function redraw(l: EditLayer, start: number, end: number, words: TranscriptWord[], fps: number, text?: string | null): TextLayer | null {
  const content: TextLayer['content'] = l.kind === 'caption'
    ? { kind: 'karaoke', words: wordsInFrames(words, fps, start, end), wordsPerPage: l.wordsPerPage ?? 3 }
    : { kind: 'static', text: text ?? l.text ?? '' };
  if (content.kind === 'karaoke' ? !content.words.length : !content.text) return null;
  return { id: `${l.id}@${start}`, startFrame: start, endFrame: end, box: l.box, background: l.background, style: l.style, content };
}

/**
 * RemixKeepRenderInput (§13.6) a partir do EditMap: vídeo do campeão de base; no Trocar avatar, o clipe do take colado
 * em cada trecho da trilha (recorte fitCrop por passo de escala) e as camadas de texto inteiras dentro da região
 * redesenhadas por cima; no gancho escrito, a camada do gancho redesenhada com o texto novo sobre o fundo dela.
 */
export function remixKeepInput(a: RemixKeepArgs): RemixKeepRenderInput {
  const m = a.editMap;
  const overlays: RemixKeepRenderInput['overlays'] = [];
  const textLayers: TextLayer[] = [];
  if (a.swap || a.swapSpans) {
    // rosto novo só nos frames `main`; cortes da convidada e inserts de b-roll ficam como o original
    for (const seg of mainSegments(m.faceTrack)) {
      const steps = [...seg.faceInRegion].sort((x, y) => x.atFrame - y.atFrame);
      steps.forEach((st, i) => {
        const start = i === 0 ? seg.startFrame : Math.max(seg.startFrame, st.atFrame);
        const end = i + 1 < steps.length ? Math.min(seg.endFrame, steps[i + 1].atFrame) : seg.endFrame;
        if (end <= start) return;
        // take (Lipsync): clipe contínuo a partir do início da janela; motor (§13.15): o clipe da cena dona do trecho
        const part = a.swapSpans?.find((p) => start >= p.startFrame && start < p.endFrame);
        if (a.swapSpans && !part) throw new Error(`trecho main ${start}-${end} sem cena SWAP_VIDEO`);
        const src = part ?? { clipUrl: a.swap!.clipUrl, clip: a.swap!.clip, clipFace: a.swap!.clipFace };
        const offsetSec = part ? (start - part.startFrame) / m.fps : start / m.fps - a.swap!.takeSourceStartSec;
        overlays.push({
          startFrame: start, endFrame: Math.min(end, part?.endFrame ?? end), region: seg.region, clipUrl: src.clipUrl,
          clipOffsetSec: Math.max(0, Math.round(offsetSec * 1000) / 1000),
          crop: a.fitCrop(src.clip, src.clipFace, { w: seg.region.w, h: seg.region.h }, st.box),
        });
      });
      for (const l of m.layers) {
        if (a.engineVoice && l.kind === 'caption') continue; // (B): legenda inteira redesenhada abaixo
        const start = Math.max(l.startFrame, seg.startFrame);
        const end = Math.min(l.endFrame, seg.endFrame);
        if (end <= start || !inside(layerArea(l), seg.region)) continue;
        const t = redraw(l, start, end, a.words, m.fps);
        if (t) textLayers.push(t);
      }
    }
  }
  if (a.engineVoice) {
    // a voz mudou nos trechos main: todo karaokê vira o da fala nova (por cima do fundo medido)
    for (const l of m.layers.filter((x) => x.kind === 'caption')) {
      const t = redraw(l, l.startFrame, l.endFrame, a.words, m.fps);
      if (t) textLayers.push(t);
    }
  }
  if (a.hookText != null) {
    const l = hookLayerOf(m.layers, m.fps, a.hookEndSec);
    if (l) {
      const t = redraw(l, l.startFrame, l.endFrame, a.words, m.fps, a.hookText);
      if (t) textLayers.push(t);
    } else if (a.hookText) {
      // sem texto no gancho original: camada nova no estilo da legenda, no topo, durante o gancho
      const cap = m.layers.find((x) => x.kind === 'caption');
      const box = { x: Math.round(m.width * 0.05), y: Math.round(m.height * 0.08), w: Math.round(m.width * 0.9), h: Math.round(m.height * 0.12) };
      textLayers.push({
        id: 'hook-new', startFrame: 0, endFrame: Math.max(1, Math.round(a.hookEndSec * m.fps)), box,
        background: { kind: 'none', color: null, box: null }, style: cap?.style ?? DEFAULT_STYLE, content: { kind: 'static', text: a.hookText },
      });
    }
  }
  return {
    renderId: a.renderId, templateId: 'remix-keep', kind: 'remix-keep',
    canvas: { width: m.width, height: m.height, fps: m.fps, frameCount: m.frameCount },
    baseVideoUrl: a.baseVideoUrl, audioPassthroughUrl: a.audioPassthroughUrl, overlays, textLayers,
    ...(a.engineVoice && { audioSplice: a.engineVoice.audioSplice }),
  };
}

/**
 * (B) palavras da legenda: teardown fora dos trechos, transcrição reencaixada dentro (relativa ao início do trecho).
 * Mesmo critério do `mesclarPalavras` do render (meio da palavra), em segundos do campeão.
 */
export function mergeEngineWords(base: TranscriptWord[], spans: { startFrame: number; endFrame: number; words: TranscriptWord[] }[], fps: number): TranscriptWord[] {
  const inside = (sec: number) => spans.some((t) => sec * fps >= t.startFrame && sec * fps < t.endFrame);
  const out = base.filter((w) => !inside((w.startSec + w.endSec) / 2));
  for (const t of spans) {
    const a = t.startFrame / fps;
    const b = t.endFrame / fps;
    for (const w of t.words) out.push({ word: w.word, startSec: Math.min(b, a + w.startSec), endSec: Math.min(b, a + w.endSec) });
  }
  return out.sort((x, y) => x.startSec - y.startSec);
}
