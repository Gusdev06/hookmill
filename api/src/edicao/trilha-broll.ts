// Trilha de b-roll das molduras de 2 fontes (decisão do Gusta 25/10, §B3.1 item 9): o painel de baixo tem VÁRIOS clipes
// que acompanham a fala, em vez de um clipe só em loop. PURO, testado em trilha-broll.spec.ts.
//  1. `cortarFala`: a janela que a peça toca (o campeão inteiro) vira trechos de 2-5 s, nas pausas e no fim das frases.
//  2. A ia escolhe 1 clipe por trecho UMA vez por lote (`BrollPort.searchTrack`); trecho `{ none }` vira imagem gerada
//     (passando pelo teto) na hora de montar a trilha do lote. O backend grava em `variation_batches.settings.brollTrack`
//     e reaproveita em todas as molduras de 2 fontes do lote e nos retries.
//  3. `montarTrilha`: `broll_track` cobrindo de 0 à duração, sem buraco; trecho sem nada estende o vizinho; o mesmo clipe
//     duas vezes seguidas vira 1.
import type { BrollProvenance, GeneratedProvenance, TranscriptWord } from '@maquina/contratos';
import type { BrollSegment, BrollTrackClip, FrameSecondSource } from '../integracoes/contrato';
import { variantPicks, type BrollPickAlt, type TrackNone } from '../integracoes/broll';

export type TrechoDaFala = BrollSegment & { index: number };
/** O clipe escolhido pra um trecho (arquivo já no nosso storage). */
export interface ClipeDoTrecho { fileUrl: string; srcStartSec: number; srcEndSec: number; provenance: BrollProvenance | GeneratedProvenance }
/** O que fica gravado no lote (1 busca por lote). `picks[i]` responde `segments[i]`; null = nada serviu (nem imagem). */
export interface TrilhaDoLote {
  version: 1; createdAt: string; language: string; durationSec: number;
  segments: TrechoDaFala[];
  /** o que o `searchTrack` devolveu (principal + até 2 alternativas por trecho, já baixadas), com os `none` que viraram
   *  imagem gerada no lugar; `none` que sobrou = trecho vazio (estende o vizinho) */
  picks: (BrollPickAlt | TrackNone)[];
  costUsd: number;
}
/** Variantes em rodízio entre as molduras de 2 fontes do lote (0 = a escolha principal; 1 e 2 = as alternativas). */
export const VARIANTES = 3;
export type BrollTrack = Extract<FrameSecondSource, { kind: 'broll_track' }>;

export const TRECHO_MIN_SEC = 2;
export const TRECHO_MAX_SEC = 5;
/** Vão entre palavras que conta como pausa (s). */
export const PAUSA_SEC = 0.25;
const FIM_DE_FRASE = /[.!?…。！？]["'”’)\]]*$/;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Corta [startSec, endSec) em trechos contíguos de 2-5 s. Fecha um trecho (com ≥ 2 s) no fim de frase ou numa pausa;
 * passaria de 5 s, fecha na fronteira de palavra anterior. Sobra < 2 s no fim = junta no anterior. Sem fala = blocos de 4 s.
 */
export function cortarFala(words: TranscriptWord[], janela: { startSec: number; endSec: number }, o: { minSec?: number; maxSec?: number; pausaSec?: number } = {}): TrechoDaFala[] {
  const min = o.minSec ?? TRECHO_MIN_SEC, max = o.maxSec ?? TRECHO_MAX_SEC, pausa = o.pausaSec ?? PAUSA_SEC;
  const { startSec: A, endSec: B } = janela;
  if (B - A <= 0) return [];
  const ws = words.filter((w) => w.endSec > A && w.startSec < B).sort((a, b) => a.startSec - b.startSec);
  const cortes: number[] = [];
  let ini = A;
  if (ws.length) {
    let anterior: number | null = null;
    for (let k = 0; k < ws.length; k++) {
      const w = ws[k];
      const prox = ws[k + 1];
      // fronteira = meio do vão até a próxima palavra (ou o fim da palavra, se é a última)
      const fronteira = prox ? (w.endSec + prox.startSec) / 2 : w.endSec;
      if (fronteira - ini > max && anterior !== null && anterior - ini >= min) {
        cortes.push(anterior);
        ini = anterior;
      }
      const quebra = FIM_DE_FRASE.test(w.word.trim()) || (prox ? prox.startSec - w.endSec >= pausa : false);
      if (quebra && fronteira - ini >= min && fronteira < B) {
        cortes.push(fronteira);
        ini = fronteira;
        anterior = null;
        continue;
      }
      anterior = fronteira;
    }
    // depois da última palavra (silêncio ou música até o fim): fecha no fim da fala e segue em blocos de até 5 s
    const fimDaFala = Math.min(B, ws[ws.length - 1].endSec);
    if (B - ini > max && fimDaFala - ini >= min && B - fimDaFala >= min) {
      cortes.push(fimDaFala);
      ini = fimDaFala;
    }
    for (let t = ini + max; t < B - min + 1e-9; t += max) cortes.push(t);
  } else {
    for (let t = A + 4; t < B - min + 1e-9; t += 4) cortes.push(t);
  }
  const bordas = [A, ...cortes.filter((c) => c > A && c < B), B];
  // sobra < 2 s no fim: junta no anterior; se a soma passar de 5 s, divide os dois ao meio (os dois ficam ≥ 2,5 s)
  while (bordas.length > 2 && bordas[bordas.length - 1] - bordas[bordas.length - 2] < min) {
    const n = bordas.length;
    if (bordas[n - 1] - bordas[n - 3] <= max) bordas.splice(n - 2, 1);
    else bordas[n - 2] = (bordas[n - 3] + bordas[n - 1]) / 2;
  }
  return bordas.slice(0, -1).map((s, index) => {
    const e = bordas[index + 1];
    const text = ws.filter((w) => w.startSec >= s - 0.05 && w.endSec <= e + 0.05).map((w) => w.word).join(' ').trim();
    return { index, startSec: r3(s), endSec: r3(e), text };
  });
}

const mesmo = (a: ClipeDoTrecho, b: ClipeDoTrecho) => a.fileUrl === b.fileUrl && a.srcStartSec === b.srcStartSec;

/**
 * `broll_track` de UMA moldura a partir da trilha do lote: cobre de 0 à duração, em ordem, sem buraco; trecho sem clipe
 * estende o vizinho de antes (no começo, o seguinte); o mesmo clipe seguido vira 1. Nenhum clipe = null (cadeia de antes).
 * Clipe estendido além do trecho do arquivo: o render segura o último quadro (pendência do video, se quiser loop).
 * `variante` (0, 1, 2…): qual opção de cada trecho esta moldura usa (molduras do mesmo lote ficam diferentes).
 */
export function montarTrilha(t: TrilhaDoLote, variante = 0): BrollTrack | null {
  // rodízio da ia (`variantPicks`: variante 0 = principal, 1-2 = alternativas, sem repetir vídeo seguido; sem opção = null)
  const escolhidos: (ClipeDoTrecho | null)[] = variantPicks(t.picks, variante).map((p) => (p ? { fileUrl: p.fileUrl, srcStartSec: p.srcStartSec, srcEndSec: p.srcEndSec, provenance: p.provenance } : null));
  if (!escolhidos.some(Boolean)) return null;
  const clips: (BrollTrackClip & { _pick: ClipeDoTrecho | null })[] = [];
  for (const [k, s] of t.segments.entries()) {
    const p = escolhidos[k] ?? null;
    const last = clips[clips.length - 1];
    if (!p) {
      if (last) {
        last.toSec = s.endSec;
        last.segmentText = `${last.segmentText} ${s.text}`.trim();
      }
      else clips.push({ fromSec: s.startSec, toSec: s.endSec, fileUrl: '', srcStartSec: 0, srcEndSec: 0, segmentText: s.text, provenance: null as never, _pick: null });
      continue;
    }
    if (last && !last._pick) {
      Object.assign(last, { toSec: s.endSec, fileUrl: p.fileUrl, srcStartSec: p.srcStartSec, srcEndSec: p.srcEndSec, provenance: p.provenance, _pick: p });
      last.segmentText = `${last.segmentText} ${s.text}`.trim();
      continue;
    }
    if (last && last._pick && mesmo(last._pick, p)) {
      last.toSec = s.endSec;
      last.segmentText = `${last.segmentText} ${s.text}`.trim();
      continue;
    }
    clips.push({ fromSec: s.startSec, toSec: s.endSec, fileUrl: p.fileUrl, srcStartSec: p.srcStartSec, srcEndSec: p.srcEndSec, segmentText: s.text, provenance: p.provenance, _pick: p });
  }
  return { kind: 'broll_track', clips: clips.map(({ _pick: _, ...c }) => ({ ...c, fromSec: r3(c.fromSec), toSec: r3(c.toSec) })) };
}

/** Proveniência de tudo que entrou de fora na 2ª fonte (peça e README do zip, §B3.1), sem repetir o mesmo trecho. */
export function proveniencias(second: unknown): (BrollProvenance | GeneratedProvenance)[] {
  const s = second as { kind?: string; provenance?: BrollProvenance; clips?: { provenance?: BrollProvenance | GeneratedProvenance }[]; prompt?: string; model?: string; subject?: string } | null;
  if (!s) return [];
  if (s.kind === 'stock_broll' && s.provenance) return [s.provenance];
  if (s.kind === 'generated_image') return [{ provider: 'generated', model: s.model ?? '', prompt: s.prompt ?? '', subject: s.subject ?? '', licenseCommercialOk: true }];
  if (s.kind !== 'broll_track') return [];
  const vistos = new Set<string>();
  const out: (BrollProvenance | GeneratedProvenance)[] = [];
  for (const c of s.clips ?? []) {
    const p = c.provenance;
    if (!p) continue;
    const k = p.provider === 'generated' ? `gen#${p.subject}` : `${p.sourceUrl}#${p.startSec}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(p);
  }
  return out;
}
