// troca-texto-queimado-v1 §6.2 / F2: modo `swap` do `checkCaption`. Depois da troca de legenda (placa limpa + legenda
// refeita com as MESMAS palavras, §15.6), o Haiku olha os 6 PIORES quadros (escolhidos pelo vídeo a partir de
// `trem`/`degrau`/fantasma) e diz, por quadro, se sobrou `ghost` (letra antiga vazando, duas legendas) ou `smear`
// (mancha/borrão na área apagada). Mesma regra de veredito do F9: 2+ quadros ruins, ou 1 com motivo, reprova.
// Reprovou = o backend marca o formato `failed` com `CAPTION_RESIDUE`. Os tipos abaixo são locais (o `CheckCaptionInput`
// do contrato só tem avoid|replace; ver relatório do F2 pro pedido de contrato).
import type { RunFfmpeg } from './checagem-texto';
import { parseJsonObject } from './validacao-campeao';
import { textOverlap, captionCheckImages, CAPTION_CHECK, type CaptionFrame } from './checagem-legenda';

export type SwapProblem = 'ghost' | 'smear' | 'missing' | 'illegible' | 'wrong_text';

/** Entrada do modo swap. `frames` = os piores quadros do vídeo (até 6, em ordem de pior pra menos pior ou do tempo; tanto faz).
 *  `expectedWords` = as palavras da legenda REFEITA nesse instante (as mesmas da original, §15.6); null = não sabe. */
export interface CheckCaptionSwapInput {
  workspaceId: string; creativeId: string; variationBatchId: string; renderId: string;
  mode: 'swap';
  language: string;
  frames: { atSec: number; frameUrl: string; /** recorte largo da faixa da legenda, resolução cheia (recomendado) */ bandUrl?: string | null; expectedWords: string[] | null }[];
  /** notes da OFERTA: só o mock lê ([mock:swap-ghost], [mock:swap-smear], [mock:caption-fail]) */
  notes?: string | null;
}
export interface CaptionSwapFrameVerdict {
  /** posição do quadro na lista de entrada (0-based) */ index: number;
  atSec: number; ok: boolean;
  /** letra antiga visível / segunda legenda */ ghost: boolean;
  /** mancha ou borrão na área apagada */ smear: boolean;
  /** o que o modelo leu como legenda nova; null = nada */ seen: string | null;
  problem: SwapProblem | null; reason: string | null;
}
export interface CaptionSwapVerdict {
  status: 'ok' | 'residue';
  frames: CaptionSwapFrameVerdict[];
  /** quadros com ghost / com smear, pra mensagem de erro e pro log do backend */
  ghostFrames: number[]; smearFrames: number[];
  costUsd: number;
}

export const isSwapInput = (i: { mode: string }): i is CheckCaptionSwapInput => i.mode === 'swap';

export function swapFramesFromInput(i: CheckCaptionSwapInput): CaptionFrame[] {
  return i.frames.map((f) => ({ atSec: f.atSec, image: f.frameUrl, crop: f.bandUrl || null, expectedText: f.expectedWords?.length ? f.expectedWords.join(' ') : null }));
}

const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const CAPTION_SWAP_SCHEMA = obj({
  frames: {
    type: 'array', description: 'One entry per frame, same order.',
    items: obj({
      frame: { type: 'integer', description: 'Frame number as given.' },
      captionVisible: { type: 'boolean', description: 'The NEW subtitle is visible in this frame.' },
      legible: { type: 'boolean', description: 'The new subtitle is whole and easy to read.' },
      ghost: { type: 'boolean', description: 'Letters of the OLD subtitle are still visible (faint or sharp), or two subtitles show at once.' },
      smear: { type: 'boolean', description: 'A smudge, blur, blotch, discolored patch or soft rectangle is visible where the old subtitle was erased.' },
      seen: { type: 'string', description: 'The new subtitle text you read, exactly as drawn. Empty string if none.' },
      reason: { type: 'string', description: 'When ghost or smear is true (or the subtitle is illegible): where it is and what you see (which letters or area), as specific as you can. Empty string otherwise.' },
    }),
  },
});

export const CAPTION_SWAP_SYSTEM = `You check finished vertical video ads after a subtitle swap. The original video had speech subtitles burned into the picture. We erased them and drew a NEW subtitle with the same words, in the same place. For each frame you get the full frame (reduced) and, when available, a full-resolution crop of the subtitle area. Report, per frame: is the new subtitle visible and legible; is any trace of the OLD subtitle left (ghost: faint or sharp letters, a second line, an outline of old letters, two subtitles at once); is there any smear (a blur, smudge, blotch, patch of different color or texture, or a soft rectangle where the old subtitle was erased). Look hard at the area around and behind the new subtitle: the new subtitle itself is NOT a ghost and its own shadow or outline is NOT a smear. Transcribe the new subtitle exactly as drawn. Only describe what is visible; when you flag ghost or smear, say where and what.`;

export function captionSwapMessage(i: { language: string; frames: CaptionFrame[] }): string {
  return [
    `Subtitle language: ${i.language}.`,
    'Expected: ONE new subtitle in the usual place, with no trace of the old one and no smear in the erased area.',
    ...i.frames.map((f, k) => `Frame ${k + 1} at ${f.atSec.toFixed(1)} s${f.crop ? ' (full frame, then the subtitle area crop)' : ' (full frame)'}${f.expectedText ? `; the new subtitle should say: "${f.expectedText.replace(/"/g, '”')}"` : ''}.`),
    'Check every frame.',
  ].join('\n');
}

const SEM_MOTIVO = /^(none|n\/?a|no|ok|null|-+|\.+)?$/i;
const motivoDe = (x: unknown) => (typeof x === 'string' && !SEM_MOTIVO.test(x.trim()) ? x.trim().slice(0, 300) : null);

/**
 * Veredito (regra do F9/F10 do §6.2): quadro ok = legenda nova visível e legível, sem ghost, sem smear (e ≥ 50 % do texto
 * esperado lido). A peça reprova (`residue`) com 2+ quadros ruins, ou 1 quadro com ghost/smear COM motivo (onde e o quê),
 * ou 2+ quadros sem legenda (1 é tolerado: troca de página do karaokê). 1 quadro ruim sem motivo é tolerado.
 */
export function parseCaptionSwap(text: string, i: { frames: CaptionFrame[] }): Omit<CaptionSwapVerdict, 'costUsd'> {
  const r = parseJsonObject(text);
  const rows = new Map<number, Record<string, unknown>>();
  for (const e of Array.isArray(r.frames) ? r.frames : []) {
    const x = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    const n = typeof x.frame === 'number' ? x.frame - 1 : -1;
    if (n >= 0 && n < i.frames.length && !rows.has(n)) rows.set(n, x);
  }
  const frames: CaptionSwapFrameVerdict[] = i.frames.map((f, k) => {
    const x = rows.get(k);
    if (!x) return { index: k, atSec: f.atSec, ok: false, ghost: false, smear: false, seen: null, problem: 'missing', reason: null };
    const seen = typeof x.seen === 'string' && x.seen.trim() ? x.seen.trim().slice(0, 300) : null;
    const ghost = x.ghost === true;
    const smear = x.smear === true;
    let problem: SwapProblem | null = ghost ? 'ghost' : smear ? 'smear' : x.captionVisible !== true ? 'missing' : x.legible !== true ? 'illegible' : null;
    if (!problem && f.expectedText && textOverlap(f.expectedText, seen ?? '') < 0.5) problem = 'wrong_text';
    return { index: k, atSec: f.atSec, ok: !problem, ghost, smear, seen, problem, reason: problem ? motivoDe(x.reason) : null };
  });
  const ruins = frames.filter((f) => f.problem && f.problem !== 'missing');
  const provado = ruins.some((f) => (f.ghost || f.smear) && !!f.reason);
  const missing = frames.filter((f) => f.problem === 'missing').length;
  return {
    status: ruins.length >= 2 || provado || missing >= 2 ? 'residue' : 'ok',
    frames,
    ghostFrames: frames.filter((f) => f.ghost).map((f) => f.index),
    smearFrames: frames.filter((f) => f.smear).map((f) => f.index),
  };
}

/** Mesmas imagens do modo antigo (quadro reduzido + recorte). */
export const captionSwapImages = (i: { frames: CaptionFrame[] }, run: RunFfmpeg | null, fetchImpl: typeof fetch) => captionCheckImages(i, run, fetchImpl);
export const CAPTION_SWAP = { ...CAPTION_CHECK, maxFrames: 6 } as const;
