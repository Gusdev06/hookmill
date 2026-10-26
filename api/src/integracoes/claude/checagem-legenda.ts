// legenda-protegida-v1 §4.2 (aprovado 26/10): depois do render, o Haiku OLHA 4-6 quadros da peça e diz se a legenda
// queimada do campeão está inteira, legível e sem nada por cima (modo `avoid`) ou se a nossa legenda está lá, no lugar,
// sem a original vazando (modo `replace`). Por quadro vai o recorte da região da legenda em resolução cheia (quando o
// backend sabe a faixa) + o quadro inteiro reduzido (lado maior 768). Saída estruturada strict; o veredito é calculado
// aqui (regra fixa abaixo) e o backend grava em `renders.input.captionCheck`. Falha = erro (o backend marca `skipped`).
// TIPOS: `CheckCaptionInput`/`CheckCaptionResult`/`CaptionCheckPort` do contrato (26/10). O resultado leva a mais o
// `status` (veredito pela regra abaixo) e o `problem` de cada quadro (`CheckCaptionVerdict`, superconjunto).
import { readFile } from 'node:fs/promises';
import type { CheckCaptionInput, CheckCaptionResult } from '../contrato';
import { IntegracaoError } from '../erros';
import { parseJsonObject } from './validacao-campeao';
import type { RunFfmpeg } from './checagem-texto';
import type { ClaudeImage } from './transporte';

export type CaptionProblem = 'covered' | 'cut' | 'missing' | 'illegible' | 'duplicated' | 'wrong_text';
export type { CheckCaptionInput, CheckCaptionResult };
/** Quadro como a checagem usa por dentro (bytes ou caminho também valem, pra sonda e pro backend que já extraiu). */
export interface CaptionFrame { atSec: number; image: string | Buffer; crop?: string | Buffer | null; expectedText?: string | null }
export interface CaptionFrameVerdict { atSec: number; ok: boolean; covered: boolean; duplicated: boolean; seen: string | null; problem: CaptionProblem | null }
/** `CheckCaptionResult` + veredito da peça (`covered` = vai pro Retry e sai do zip). */
export interface CheckCaptionVerdict extends CheckCaptionResult { status: 'ok' | 'covered'; frames: CaptionFrameVerdict[] }

/** Entrada aceita: a do contrato com o recorte da faixa OPCIONAL por quadro (26/10: o backend manda o recorte da faixa
 *  protegida em toda peça quando sabe; sem ele vai só o quadro reduzido). TRANSIÇÃO: pedir `bandUrl?: string | null` no contrato. */
export type CheckCaptionInputAny = Omit<CheckCaptionInput, 'frames'> & {
  frames: (Omit<CheckCaptionInput['frames'][number], 'bandUrl'> & { bandUrl?: string | null })[];
};

/** Quadros do contrato → internos (`expectedWords` viram o texto esperado; recorte vazio/ausente = sem recorte). */
export function captionFramesFromInput(i: CheckCaptionInputAny): CaptionFrame[] {
  return i.frames.map((f) => ({ atSec: f.atSec, image: f.frameUrl, crop: f.bandUrl || null, expectedText: f.expectedWords?.length ? f.expectedWords.join(' ') : null }));
}

export const CAPTION_CHECK = {
  model: 'claude-haiku-4-5',
  /** 6 quadros × (recorte ~430 + quadro ~440 tokens) + prompt + ~300 de saída (contrato §4.2) */
  estimatedUsd: 0.008,
  frameMaxSide: 768,
  cropMaxSide: 1024,
  maxFrames: 6,
  maxTokens: 3000,
} as const;

const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const CAPTION_CHECK_SCHEMA = obj({
  frames: {
    type: 'array', description: 'One entry per frame, same order.',
    items: obj({
      frame: { type: 'integer', description: 'Frame number as given.' },
      captionVisible: { type: 'boolean', description: 'A burned-in subtitle (speech caption) is visible in this frame.' },
      intact: { type: 'boolean', description: 'The subtitle is whole and legible: no letters hidden by a card, band, sticker, panel or the edge of the video area.' },
      duplicated: { type: 'boolean', description: 'Two different subtitles of the same speech appear at once (for example an old one leaking at the edge of the video plus a new one).' },
      seen: { type: 'string', description: 'The subtitle text you read, exactly as drawn. Empty string if none.' },
      problem: { type: 'string', description: 'One of: covered, cut, missing, illegible, duplicated, none.' },
    }),
  },
});

export const CAPTION_CHECK_SYSTEM = `You check finished vertical video ads. The source video has speech subtitles burned into it (captions). Our editor placed the video inside a layout (cards, titles, bands, panels) and must NEVER cover those subtitles. For each frame you get the full frame (reduced) and, when available, a full-resolution crop of the area where the subtitle should be. Say whether a subtitle is visible, whether it is whole and legible with nothing on top of it and not cut by the edge of the video area, whether two different subtitles of the same speech appear at once, and transcribe exactly what you read. Titles, headlines, list items and buttons of the layout are NOT the subtitle: the subtitle is the line(s) of speech text that belongs to the video. Only describe what is visible.`;

export function captionCheckMessage(i: { mode: CheckCaptionInput['mode']; language: string; frames: CaptionFrame[] }): string {
  return [
    `Subtitle language: ${i.language}.`,
    i.mode === 'avoid'
      ? 'Expected: the ORIGINAL subtitle of the video, whole and uncovered.'
      : 'Expected: a NEW subtitle drawn by our editor in the style of the original, with the original one cropped out (no second subtitle leaking).',
    ...i.frames.map((f, k) => `Frame ${k + 1} at ${f.atSec.toFixed(1)} s${f.crop ? ' (full frame, then the subtitle area crop)' : ' (full frame)'}${f.expectedText ? `; speech at this moment: "${f.expectedText.replace(/"/g, '”')}"` : ''}.`),
    'Check every frame.',
  ].join('\n');
}

const norm = (t: string) => t.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
/** Fração dos caracteres esperados que aparecem no lido (ordem ignorada; serve pra CJK e latino). */
export function textOverlap(expected: string, seen: string): number {
  const e = [...norm(expected)];
  if (!e.length) return 1;
  const pool = [...norm(seen)];
  let hit = 0;
  for (const ch of e) {
    const k = pool.indexOf(ch);
    if (k >= 0) {
      hit++;
      pool.splice(k, 1);
    }
  }
  return hit / e.length;
}

const PROBLEMS: CaptionProblem[] = ['covered', 'cut', 'missing', 'illegible', 'duplicated'];

/** Veredito: quadro ok = legenda visível, inteira e sem duplicata (+ no `replace`, ≥ 50 % do texto esperado). A peça é
 *  `covered` se algum quadro tem a legenda tampada/cortada/duplicada, ou se 2+ quadros não mostram legenda (1 quadro sem
 *  legenda é tolerado: pode ser a troca de página do karaokê). */
export function parseCaptionCheck(text: string, i: { mode: CheckCaptionInput['mode']; frames: CaptionFrame[] }): CheckCaptionVerdict {
  const r = parseJsonObject(text);
  const rows = new Map<number, Record<string, unknown>>();
  for (const e of Array.isArray(r.frames) ? r.frames : []) {
    const x = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    const n = typeof x.frame === 'number' ? x.frame - 1 : -1;
    if (n >= 0 && n < i.frames.length && !rows.has(n)) rows.set(n, x);
  }
  const frames: CaptionFrameVerdict[] = i.frames.map((f, k) => {
    const x = rows.get(k);
    if (!x) return { atSec: f.atSec, ok: false, covered: false, duplicated: false, seen: null, problem: 'missing' };
    const seen = typeof x.seen === 'string' && x.seen.trim() ? x.seen.trim().slice(0, 300) : null;
    const said = PROBLEMS.find((p) => p === x.problem) ?? null;
    let problem: CaptionProblem | null =
      x.captionVisible !== true ? 'missing' : x.duplicated === true ? 'duplicated' : x.intact !== true ? (said === 'cut' || said === 'illegible' ? said : 'covered') : null;
    if (!problem && i.mode === 'replace' && f.expectedText && textOverlap(f.expectedText, seen ?? '') < 0.5) problem = 'wrong_text';
    return { atSec: f.atSec, ok: !problem, covered: problem === 'covered' || problem === 'cut', duplicated: problem === 'duplicated', seen, problem };
  });
  const hard = frames.some((f) => f.problem === 'covered' || f.problem === 'cut' || f.problem === 'duplicated' || f.problem === 'wrong_text' || f.problem === 'illegible');
  const missing = frames.filter((f) => f.problem === 'missing').length;
  return { status: hard || missing >= 2 ? 'covered' : 'ok', frames };
}

/** Bytes de URL, caminho local ou Buffer. */
async function bytesOf(src: string | Buffer, fetchImpl: typeof fetch): Promise<Buffer> {
  if (Buffer.isBuffer(src)) return src;
  if (/^https?:\/\//.test(src)) {
    const res = await fetchImpl(src, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(src.replace(/^file:\/\//, ''));
}

/** Reduz pra JPEG com lado maior ≤ max (ffmpeg); sem ffmpeg, a imagem como veio (se for JPEG/PNG pequeno). */
async function shrink(buf: Buffer, max: number, run: RunFfmpeg | null): Promise<{ data: Buffer; mediaType: ClaudeImage['mediaType'] }> {
  if (run) {
    const out = await run(['-hide_banner', '-v', 'error', '-i', 'pipe:0', '-vf', `scale='if(gt(iw,ih),min(${max},iw),-2)':'if(gt(iw,ih),-2,min(${max},ih))'`, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'], buf);
    return { data: out, mediaType: 'image/jpeg' };
  }
  if (buf.length > 3_700_000) throw new IntegracaoError('PROVIDER_ERROR', 'caption check: image too large and no ffmpeg');
  return { data: buf, mediaType: buf[0] === 0x89 ? 'image/png' : 'image/jpeg' };
}

export async function captionCheckImages(i: { frames: CaptionFrame[] }, run: RunFfmpeg | null, fetchImpl: typeof fetch): Promise<ClaudeImage[]> {
  const out: ClaudeImage[] = [];
  for (const [k, f] of i.frames.slice(0, CAPTION_CHECK.maxFrames).entries()) {
    const full = await shrink(await bytesOf(f.image, fetchImpl), CAPTION_CHECK.frameMaxSide, run);
    out.push({ mediaType: full.mediaType, data: full.data.toString('base64'), caption: `Frame ${k + 1} (full):` });
    if (f.crop) {
      const crop = await shrink(await bytesOf(f.crop, fetchImpl), CAPTION_CHECK.cropMaxSide, run);
      out.push({ mediaType: crop.mediaType, data: crop.data.toString('base64'), caption: `Frame ${k + 1} (subtitle area):` });
    }
  }
  return out;
}

/** Utilitário pro backend/sonda: N quadros PNG de um MP4 nos instantes dados (+ recorte da faixa, se houver), em memória. */
export async function captionFramesOf(run: RunFfmpeg, video: Buffer | null, path: string | null, times: number[], band: { x: number; y: number; w: number; h: number } | null):
  Promise<{ atSec: number; image: Buffer; crop: Buffer | null }[]> {
  const out: { atSec: number; image: Buffer; crop: Buffer | null }[] = [];
  for (const t of times) {
    const args = ['-hide_banner', '-v', 'error', '-ss', t.toFixed(2), '-i', path ?? 'pipe:0', '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'];
    const image = await run(args, video ?? Buffer.alloc(0));
    const crop = band ? await run(['-hide_banner', '-v', 'error', '-i', 'pipe:0', '-vf', `crop=${band.w}:${band.h}:${band.x}:${band.y}`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'], image) : null;
    out.push({ atSec: t, image, crop });
  }
  return out;
}
