// Trilha de b-roll (decisão do Gusta 25/10): nas molduras de 2 fontes, VÁRIOS clipes que acompanham a fala (1 por
// trecho), em vez de 1 clipe pro vídeo todo. Mesmo método da skill get-brolls, em lote:
//   1. UMA chamada Haiku monta 2-3 buscas "entidade + ação" (inglês) por trecho + o assunto da imagem de reserva;
//   2. Pexels: buscas deduplicadas, cache do cliente, TETO de pedidos HTTP por lote (cota de 200/h dividida com a
//      Launchwing); trecho com poucas opções pega emprestado o resultado dos vizinhos (trechos parecidos);
//   3. 1 folha de quadros por vídeo (reaproveitada entre trechos), mandadas ao Haiku em lotes de trechos; ele escolhe 1
//      clipe por trecho (+ uma alternativa), citando as células, e recusa marca d'água/texto/logo/rosto famoso;
//   4. nunca o mesmo clipe em trechos seguidos (troca pela alternativa ou deixa o trecho sem clipe) e prefere variar;
//   5. `fetchTrack` baixa cada vídeo escolhido UMA vez e corta um intervalo por trecho.
// Trecho sem clipe bom = `{ none: true, fallbackSubject }`: o backend decide entre imagem gerada e estender o vizinho.
// Contrato (25/10): `BrollPort.searchTrack` devolve as escolhas JÁ baixadas e cortadas no storage (`BrollPick`), uma por
// trecho, na mesma ordem. Internamente: `planTrack` (escolha, sem baixar) → `materialize` (baixa e corta).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrollPick, BrollProvenance, BrollSegment, BrollTrackClip, BrollTrackSearchInput, Usage } from '../contrato';
import { IntegracaoError } from '../erros';
import { recordLlmCost } from '../claude/custo';
import { parseJsonObject } from '../claude/validacao-campeao';
import type { ClaudeImage } from '../claude/transporte';
import { cellTimes, intervalFromCells } from './folha';
import { previewFile, rankVideos, finalFile, type PexelsVideo } from './pexels';
import type { PexelsBrollOptions } from './broll.service';
import { BROLL_MODEL, candidateIdOf, parseCandidateId, provenanceOf } from './ids';

export type BrollTrackSegment = BrollSegment;
export type BrollTrackInput = BrollTrackSearchInput;
/** Escolha de um trecho ANTES de baixar (o intervalo está no candidateId e na provenance). */
export interface TrackChoice {
  candidateId: string;
  provenance: BrollProvenance;
  posterUrl: string; previewUrl: string | null; durationSec: number; query: string;
  reason: string; cells: [number, number];
  /** 25/10 (Gusta: trilhas diferentes por moldura no mesmo lote): até 2 outros clipes que servem pro trecho (o
   *  `alternate`/`alternate2` da visão), cada um com intervalo próprio. Nunca o mesmo vídeo do principal. */
  alternatives?: TrackChoice[];
}
export type TrackNone = { none: true; fallbackSubject: string; reason?: string };
export type BrollTrackPick = TrackChoice | TrackNone;
export interface BrollTrackPlan { choices: BrollTrackPick[]; queries: string[][]; pexelsRequests: number }
export type { BrollTrackClip };
/** `BrollPick` do contrato + as alternativas já baixadas e cortadas (variantes da trilha). TRANSIÇÃO: pedir ao arquiteto
 *  `alternatives?: BrollPick[]` no `BrollPick` do contrato; até lá, este tipo (estrutural, a porta continua valendo). */
export type BrollPickAlt = BrollPick & { alternatives?: BrollPick[] };
export const MAX_ALTERNATIVES = 2;

export const TRACK_LIMITS = {
  /** pedidos HTTP à Pexels por lote (cache não conta) */
  maxPexelsRequests: 25,
  /** candidatos olhados por trecho */
  perSegment: 3,
  /** trechos por chamada de escolha (folhas únicas desse grupo ≤ ~12 imagens) */
  segmentsPerPick: 2,
  perQuery: 8,
} as const;

export const isNone = <T extends object>(p: T): p is Extract<T, { none: true }> => 'none' in p;

// ---------------------------------------------------------------- prompts

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const TRACK_QUERY_SCHEMA = obj({
  segments: {
    type: 'array', description: 'One entry per stretch, same order.',
    items: obj({
      segment: int('Stretch number (1-based).'),
      queries: { type: 'array', items: str('2-5 English words: visible entity + action.'), description: '2 or 3 stock video searches for this stretch, best first. Reuse the exact same words as another stretch when the image would be the same.' },
      fallbackSubject: str('English, max 160: one concrete everyday photo of what this stretch says, no text, brand, logo or famous person.'),
    }),
  },
});

export const TRACK_QUERY_SYSTEM = `You plan stock B-roll that follows the speech of a short vertical video ad: one muted clip per stretch of speech, in a second panel. For each stretch write 2 or 3 searches for a stock video library (Pexels), in English, each "visible entity + action": what a camera would film while those words are said. Literal first (the thing, place or action named); abstract speech → the everyday moment it implies. Consecutive stretches should get visually different searches, unless they really say the same thing (then reuse the same words, it saves searches). Never a brand, logo, app name, product name, famous person or text on screen. Generic people only. Match the tone of the offer.`;

export function trackQueryMessage(i: Pick<BrollTrackInput, 'segments' | 'language' | 'offer'>): string {
  const o = i.offer;
  const brief = o ? [o.kind && `Kind: ${o.kind}`, o.what && `What it is: ${o.what}`, o.audience && `Audience: ${o.audience}`].filter(Boolean).join('\n') : '';
  return [
    `Speech language: ${i.language}.`,
    brief ? `<offer>\n${brief}\n</offer>` : '',
    `<stretches>\n${i.segments.map((s, k) => `${k + 1}. [${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)} s] "${s.text.replace(/"/g, '”')}"`).join('\n')}\n</stretches>`,
    'Write the searches for every stretch.',
  ].filter(Boolean).join('\n\n');
}

export const TRACK_PICK_SCHEMA = obj({
  picks: {
    type: 'array', description: 'One entry per stretch in this request.',
    items: obj({
      segment: int('Stretch number as given.'),
      candidate: int('Chosen candidate number, or 0 when none fits.'),
      alternate: int('Second-best candidate number (a different clip that also fits), or 0.'),
      alternate2: int('Third-best candidate number (another different clip that also fits), or 0.'),
      firstCell: int('First cell of the chosen stretch of the clip (1-12); 0 when none.'),
      lastCell: int('Last cell (>= firstCell); 0 when none.'),
      reason: str('One sentence citing the cells you saw, e.g. "cells 2-5 show hands typing an email". When none fits, why.'),
    }),
  },
});

export const TRACK_PICK_SYSTEM = `You choose stock B-roll by LOOKING at contact sheets: one muted clip per stretch of speech. Each candidate is one sheet of 12 numbered cells, left to right and top to bottom, evenly spaced in time (the request gives the seconds of each cell). For each stretch pick the candidate and the cells whose motion best shows what that stretch says, cite the cells you saw, and give up to two other different clips that also fit as alternate and alternate2 (0 when none). Never the same clip for two consecutive stretches, and prefer a different clip for every stretch. Reject any clip with a watermark, burned-in text or subtitles, a logo or brand, a recognizable famous person, or content that does not match; if none fits a stretch, candidate is 0. Only describe what is visible.`;

export function trackPickMessage(i: { language: string; segments: { n: number; seg: BrollTrackSegment; candidates: number[] }[]; candidates: { n: number; durationSec: number }[]; previousVideo: number | null }): string {
  return [
    `Speech language: ${i.language}.`,
    ...i.segments.map((s) => `Stretch ${s.n} [${(s.seg.endSec - s.seg.startSec).toFixed(1)} s]: "${s.seg.text.replace(/"/g, '”')}". Candidates to consider: ${s.candidates.join(', ')}.`),
    ...i.candidates.map((c) => `Candidate ${c.n}: ${c.durationSec} s; cells at ${cellTimes(c.durationSec).map((t, k) => `${k + 1}=${t}s`).join(', ')}.`),
    i.previousVideo ? `The stretch right before the first one here used candidate ${i.previousVideo}: do not use it for the first stretch.` : '',
    'Choose one clip per stretch.',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- busca

interface Planned { queries: string[]; fallbackSubject: string }

export function parseTrackQueries(text: string, count: number): Planned[] {
  const r = parseJsonObject(text);
  const out: Planned[] = Array.from({ length: count }, () => ({ queries: [], fallbackSubject: '' }));
  for (const e of Array.isArray(r.segments) ? r.segments : []) {
    const x = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    const n = typeof x.segment === 'number' ? x.segment - 1 : -1;
    if (n < 0 || n >= count || out[n].queries.length) continue;
    const qs = (Array.isArray(x.queries) ? x.queries : [])
      .map((q) => (typeof q === 'string' ? q.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim().toLowerCase() : ''))
      .filter((q) => q.length >= 3 && q.split(' ').length <= 8);
    out[n] = { queries: [...new Set(qs)].slice(0, 3), fallbackSubject: typeof x.fallbackSubject === 'string' ? x.fallbackSubject.replace(/["“”]/g, '').trim().slice(0, 160) : '' };
  }
  return out;
}

interface PickRow { segment: number; candidate: number; alternate: number; alternate2: number; firstCell: number; lastCell: number; reason: string }
export function parseTrackPicks(text: string): PickRow[] {
  const r = parseJsonObject(text);
  const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : 0);
  return (Array.isArray(r.picks) ? r.picks : []).map((e) => {
    const x = e && typeof e === 'object' ? (e as Record<string, unknown>) : {};
    const first = Math.min(12, Math.max(1, n(x.firstCell) || 1));
    return { segment: n(x.segment), candidate: n(x.candidate), alternate: n(x.alternate), alternate2: n(x.alternate2), firstCell: first, lastCell: Math.min(12, Math.max(first, n(x.lastCell) || first)), reason: typeof x.reason === 'string' ? x.reason.trim().slice(0, 300) : '' };
  });
}

/** O corte não passa do trecho (+0,5 s de folga): células escolhidas além disso não viram download/corte inútil. */
export function capSpan(span: { startSec: number; endSec: number }, segLen: number): { startSec: number; endSec: number } {
  const max = Math.max(0.5, segLen + 0.5);
  return span.endSec - span.startSec <= max ? span : { startSec: span.startSec, endSec: Math.round((span.startSec + max) * 100) / 100 };
}

/** Sem o mesmo vídeo em trechos seguidos: troca pela alternativa; sem alternativa válida, o trecho fica sem clipe. */
export function noConsecutiveRepeats(chosen: ({ video: number; alt: number | null } | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let k = 0; k < chosen.length; k++) {
    const c = chosen[k];
    const prev = k > 0 ? out[k - 1] : null;
    if (!c) out.push(null);
    else if (c.video !== prev) out.push(c.video);
    else if (c.alt != null && c.alt !== prev) out.push(c.alt);
    else out.push(null);
  }
  return out;
}

export async function planTrack(o: PexelsBrollOptions, i: BrollTrackInput): Promise<BrollTrackPlan & Usage> {
  const model = o.model ?? BROLL_MODEL;
  if (!i.segments.length) return { choices: [], queries: [], pexelsRequests: 0, costUsd: 0 };
  let total = 0;
  const charge = async (usage: Parameters<typeof recordLlmCost>[2]) => {
    const spent = await recordLlmCost(o.costs, { workspaceId: i.workspaceId, variationBatchId: i.batchId, model }, usage);
    total += spent; // nunca `total += await` (as escolhas rodam em paralelo e se sobrescreveriam)
  };
  const finished = (stop: string | null) => {
    if (stop === 'refusal') throw new IntegracaoError('SAFETY_BLOCK', 'claude declined (refusal)');
    if (stop === 'max_tokens') throw new IntegracaoError('PROVIDER_ERROR', 'claude hit max_tokens');
  };

  // 1. uma chamada: buscas de todos os trechos
  const res = await o.transport.run({ system: TRACK_QUERY_SYSTEM, user: trackQueryMessage(i), schema: TRACK_QUERY_SCHEMA, maxTokens: 4000, model, effort: null });
  await charge(res.usage);
  finished(res.stopReason);
  const plan = parseTrackQueries(res.text, i.segments.length);

  // 2. Pexels: cada busca uma vez, até o teto de pedidos HTTP do lote
  const start = o.pexels.requests;
  const byQuery = new Map<string, PexelsVideo[]>();
  const videos = new Map<number, PexelsVideo>();
  const budgetLeft = () => TRACK_LIMITS.maxPexelsRequests - (o.pexels.requests - start);
  // ordem: a 1ª busca de cada trecho primeiro, depois as 2ªs… (o teto corta as menos importantes)
  const order: string[] = [];
  for (let r = 0; r < 3; r++) for (const p of plan) if (p.queries[r] && !order.includes(p.queries[r])) order.push(p.queries[r]);
  for (const q of order) {
    if (budgetLeft() <= 0) break;
    const found: PexelsVideo[] = [];
    for (const orientation of ['portrait', null] as const) {
      if (budgetLeft() <= 0 && found.length) break;
      const vs = await o.pexels.search(q, { orientation, perPage: TRACK_LIMITS.perQuery });
      for (const v of vs) if (previewFile(v) && !found.some((x) => x.id === v.id)) found.push(v);
      if (found.length >= 3) break;
    }
    byQuery.set(q, found);
    for (const v of found) videos.set(v.id, v);
  }

  // candidatos por trecho: os das suas buscas; com menos de N, empresta dos vizinhos (trechos parecidos)
  const pool = i.segments.map((seg, k) => {
    const own = plan[k].queries.flatMap((q) => byQuery.get(q) ?? []);
    const near = [k - 1, k + 1, k - 2, k + 2].filter((x) => x >= 0 && x < i.segments.length).flatMap((x) => plan[x].queries.flatMap((q) => byQuery.get(q) ?? []));
    const uniq: PexelsVideo[] = [];
    for (const v of [...rankVideos(own, seg.endSec - seg.startSec), ...near]) if (!uniq.some((u) => u.id === v.id)) uniq.push(v);
    return uniq.slice(0, TRACK_LIMITS.perSegment);
  });

  // 3. folhas: 1 por vídeo
  const sheets = new Map<number, Buffer | null>();
  await Promise.all([...new Set(pool.flat().map((v) => v.id))].map(async (id) => {
    const v = videos.get(id)!;
    try {
      sheets.set(id, await o.ffmpeg.contactSheet(previewFile(v)!.link, v.duration, v.height > v.width));
    } catch {
      sheets.set(id, null);
    }
  }));

  // escolha em grupos pequenos e em paralelo (sonda 25/10: com 12 folhas por chamada o Haiku trocava os números dos
  // candidatos no motivo); a regra de não repetir em seguida é aplicada depois, sobre o resultado inteiro
  const raw: ({ video: number; alt: number | null; alts: number[]; row: PickRow } | null)[] = i.segments.map(() => null);
  const groups: number[][] = [];
  for (let g = 0; g < i.segments.length; g += TRACK_LIMITS.segmentsPerPick) groups.push(Array.from({ length: Math.min(TRACK_LIMITS.segmentsPerPick, i.segments.length - g) }, (_, k) => g + k));
  await Promise.all(groups.map(async (segIdx) => {
    const vids = [...new Set(segIdx.flatMap((k) => pool[k].map((v) => v.id)))].filter((id) => sheets.get(id));
    if (!vids.length) return;
    const num = (id: number) => vids.indexOf(id) + 1;
    vids.forEach((id, k) => o.onSheet?.(k + 1, id, sheets.get(id)!));
    const images: ClaudeImage[] = vids.map((id) => ({ mediaType: 'image/jpeg', data: sheets.get(id)!.toString('base64'), caption: `Candidate ${num(id)}:` }));
    const pr = await o.transport.run({
      system: TRACK_PICK_SYSTEM, images, schema: TRACK_PICK_SCHEMA, maxTokens: 4000, model, effort: null,
      user: trackPickMessage({
        language: i.language,
        segments: segIdx.map((k) => ({ n: k + 1, seg: i.segments[k], candidates: pool[k].filter((v) => sheets.get(v.id)).map((v) => num(v.id)) })),
        candidates: vids.map((id) => ({ n: num(id), durationSec: videos.get(id)!.duration })),
        previousVideo: null,
      }),
    });
    await charge(pr.usage);
    finished(pr.stopReason);
    for (const row of parseTrackPicks(pr.text)) {
      const k = row.segment - 1;
      if (!segIdx.includes(k) || raw[k]) continue;
      const video = row.candidate >= 1 && row.candidate <= vids.length ? vids[row.candidate - 1] : null;
      const valid = (c: number) => (c >= 1 && c <= vids.length ? vids[c - 1] : null);
      const alts = [...new Set([valid(row.alternate), valid(row.alternate2)].filter((x): x is number => x != null && x !== video))].slice(0, MAX_ALTERNATIVES);
      raw[k] = video ? { video, alt: alts[0] ?? null, alts, row } : null;
    }
  }));

  // 4. sem repetir em seguida
  const final = noConsecutiveRepeats(raw.map((r) => (r ? { video: r.video, alt: r.alt } : null)));
  const choices: BrollTrackPick[] = i.segments.map((seg, k) => {
    const id = final[k];
    const r = raw[k];
    if (id == null || !r) return { none: true as const, fallbackSubject: plan[k].fallbackSubject || seg.text.slice(0, 160), reason: r ? 'same clip as the previous stretch and no alternate' : 'no candidate fits' };
    const v = videos.get(id)!;
    const usedAlt = id !== r.video;
    const segLen = seg.endSec - seg.startSec;
    // alternativas: as outras escolhas da visão (se a principal foi trocada pela alternativa, a original vira alternativa)
    const altIds = [...new Set([...(usedAlt ? [r.video] : []), ...r.alts].filter((x) => x !== id))].slice(0, MAX_ALTERNATIVES);
    const alternatives: TrackChoice[] = altIds.map((aid) => {
      const av = videos.get(aid)!;
      const as = capSpan(intervalFromCells(av.duration, 1, 1, segLen), segLen);
      return {
        candidateId: candidateIdOf(av.id, as.startSec, as.endSec), provenance: provenanceOf(av, as.startSec, as.endSec),
        posterUrl: av.image, previewUrl: previewFile(av)?.link ?? null, durationSec: av.duration, query: plan[k].queries[0] ?? '',
        reason: `alternate for this stretch; ${r.row.reason}`, cells: [1, 1],
      };
    });
    const span = capSpan(usedAlt ? intervalFromCells(v.duration, 1, 1, segLen) : intervalFromCells(v.duration, r.row.firstCell, r.row.lastCell, segLen), segLen);
    return {
      candidateId: candidateIdOf(v.id, span.startSec, span.endSec), provenance: provenanceOf(v, span.startSec, span.endSec),
      posterUrl: v.image, previewUrl: previewFile(v)?.link ?? null, durationSec: v.duration, query: plan[k].queries[0] ?? '',
      reason: usedAlt ? `alternate (the chosen clip repeated the previous stretch); ${r.row.reason}` : r.row.reason,
      cells: usedAlt ? [1, 1] : [r.row.firstCell, r.row.lastCell],
      alternatives,
    };
  });
  return { choices, queries: plan.map((p) => p.queries), pexelsRequests: o.pexels.requests - start, costUsd: Math.round(total * 1e6) / 1e6 };
}

/** 5. Baixa cada vídeo escolhido UMA vez (HD ≤ 1080, validado inteiro) e corta 1 intervalo por trecho, subindo cada corte
 *  pelo sink. As alternativas também saem prontas (decisão 25/10: é o mais barato — o vídeo da alternativa quase sempre
 *  já é o principal de outro trecho, então só custa um corte local; baixar sob demanda depois gastaria cota da Pexels de
 *  novo pra reler o vídeo, e a moldura teria que esperar). Devolve o `BrollPick` por trecho (`none` passa adiante). */
export async function materialize(o: PexelsBrollOptions, download: (url: string, path: string) => Promise<void>,
  i: { workspaceId: string; batchId: string; choices: BrollTrackPick[] }): Promise<(BrollPickAlt | TrackNone)[]> {
  const dir = mkdtempSync(join(tmpdir(), 'broll-track-'));
  try {
    const sources = new Map<number, { path: string; video: PexelsVideo }>();
    let n = 0;
    const cutOne = async (p: TrackChoice): Promise<BrollPick> => {
      const c = parseCandidateId(p.candidateId);
      let src = sources.get(c.videoId);
      if (!src) {
        const video = await o.pexels.video(c.videoId);
        const file = finalFile(video);
        if (!file) throw new IntegracaoError('BROLL_UNAVAILABLE', `b-roll: pexels video ${video.id} has no mp4`, { reason: 'no_file' });
        const path = join(dir, `${video.id}.mp4`);
        await download(file.link, path);
        src = { path, video };
        sources.set(c.videoId, src);
      }
      const end = Math.min(c.endSec, src.video.duration);
      const startSec = Math.min(c.startSec, Math.max(0, end - 0.5));
      const cut = join(dir, `cut-${n++}.mp4`);
      await o.ffmpeg.cut(src.path, startSec, end, cut);
      await o.ffmpeg.validate(cut);
      const { fileUrl } = await o.sink.put({ workspaceId: i.workspaceId, variationBatchId: i.batchId, bytes: readFileSync(cut), mimeType: 'video/mp4', sourceUrl: src.video.url });
      // fileUrl é o CORTE: src* é relativo a ele (0..duração do corte); o intervalo no vídeo original fica na provenance
      return { candidateId: p.candidateId, fileUrl, srcStartSec: 0, srcEndSec: Math.round((end - startSec) * 100) / 100, provenance: provenanceOf(src.video, startSec, end), reason: p.reason.slice(0, 160) };
    };
    const out: (BrollPickAlt | TrackNone)[] = [];
    for (const p of i.choices) {
      if (isNone(p)) {
        out.push(p);
        continue;
      }
      const main = await cutOne(p);
      const alternatives: BrollPick[] = [];
      for (const a of p.alternatives ?? []) {
        try {
          alternatives.push(await cutOne(a));
        } catch {
          // alternativa que não baixa só sai da lista; o principal já está pronto
        }
      }
      out.push(alternatives.length ? { ...main, alternatives } : main);
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `BrollPort.searchTrack`: escolhe (planTrack) e baixa/corta (materialize). Trecho sem clipe = `{ none, fallbackSubject }`. */
export async function searchTrack(o: PexelsBrollOptions, download: (url: string, path: string) => Promise<void>, i: BrollTrackInput):
  Promise<{ picks: (BrollPickAlt | TrackNone)[] } & Usage & Omit<BrollTrackPlan, 'choices'> & { choices: BrollTrackPick[] }> {
  const plan = await planTrack(o, i);
  const picks = await materialize(o, download, { workspaceId: i.workspaceId, batchId: i.batchId, choices: plan.choices });
  return { ...plan, picks };
}

/** Clip de cada trecho na variante `variant` (0 = principal; 1-2 = alternativas). Trecho sem a alternativa pedida usa
 *  outra opção; a regra de não repetir o vídeo em trechos seguidos vale dentro de cada variante (se nenhuma opção do
 *  trecho difere do anterior, o trecho fica sem clipe, como um `none`, e o backend estende o vizinho). */
export function variantPicks(picks: (BrollPickAlt | TrackNone)[], variant = 0): (BrollPick | null)[] {
  const out: (BrollPick | null)[] = [];
  let prev: string | null = null;
  for (const p of picks) {
    if (isNone(p)) {
      out.push(null);
      prev = null;
      continue;
    }
    const { alternatives, ...main } = p;
    const alts = alternatives ?? [];
    const order: BrollPick[] = variant > 0 ? [alts[variant - 1], main, ...alts].filter((x): x is BrollPick => !!x) : [main, ...alts];
    const chosen = order.find((x) => x.provenance.sourceUrl !== prev) ?? null;
    out.push(chosen);
    prev = chosen ? chosen.provenance.sourceUrl : null;
  }
  return out;
}

/** Clipes da trilha (FrameSecondSource `broll_track`) da variante `variant`, na linha do tempo da peça. */
export function trackClips(segments: BrollSegment[], picks: (BrollPickAlt | TrackNone)[], variant = 0): BrollTrackClip[] {
  return variantPicks(picks, variant).flatMap((p, k) => (p ? [{ fromSec: segments[k].startSec, toSec: segments[k].endSec, fileUrl: p.fileUrl, srcStartSec: p.srcStartSec, srcEndSec: p.srcEndSec, segmentText: segments[k].text, provenance: p.provenance }] : []));
}
