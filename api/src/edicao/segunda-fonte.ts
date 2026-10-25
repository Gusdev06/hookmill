// 2ª fonte das molduras de 2 fontes (estatico-montado-e-molduras-v1 §B3/§B3.1; decisão do Gusta 25/10 depois do teste
// das 16 molduras): split_stack, split_torn, call_dialog, gossip_page, gossip_white, gossip_pink. Ordem:
//   1. b-roll do Pexels escolhido pela ia (porta `BrollPort`: busca pela fala + folha de quadros + escolha por visão,
//      método da skill get-brolls; a implementação é da maquina-ia em api/src/integracoes/broll/);
//   2. imagem gerada (GPT Image 2 1k, `fallbackImage` da mesma porta) sobre o `fallbackSubject` do BROLL_NO_MATCH
//      (TRANSIÇÃO: o kind de imagem gerada no `FrameSecondSource` é do arquiteto; até lá vai como imagem parada);
//   3. `champion_segment`: trecho de prova do próprio campeão que NUNCA mostra no painel de baixo o mesmo momento que toca
//      em cima (o vídeo de cima é o campeão inteiro; o de baixo é o trecho em loop).
// Redes sociais (YouTube/TikTok/Instagram) ficam desligadas por workspace (D15): só Pexels até o aceite do termo existir.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { BrollProvenance, BrollProvider, EditMap, FrameTemplateId, TranscriptWord } from '@maquina/contratos';
import type { BrollCandidateDraft, FrameSecondSource, Usage } from '../integracoes/contrato';
import type { BrollSearchInputExt } from '../integracoes/broll';
import { isIntegracaoError } from '../integracoes/erros';

export const FRAME_DUAS_FONTES: readonly FrameTemplateId[] = ['split_stack', 'split_torn', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'];
export const precisaSegundaFonte = (t: string | null | undefined) => !!t && (FRAME_DUAS_FONTES as readonly string[]).includes(t);

/** D15: provedores ligados por padrão. Redes sociais só com o aceite do workspace (campo ainda não existe no banco). */
export const PROVEDORES_PADRAO: BrollProvider[] = ['pexels'];

/**
 * Porta da ia (`createBrollService` em api/src/integracoes/broll/: Pexels + folha de quadros + escolha por visão; o 1º
 * candidato é o escolhido). `fallbackImage` = passo 2 (GPT Image 2 1k sobre `fallbackSubject`). null = desligada.
 */
export interface BrollServicePort {
  search(i: BrollSearchInputExt): Promise<{ candidates: BrollCandidateDraft[]; fallbackSubject?: string } & Usage>;
  fetch(i: { workspaceId: string; variationBatchId: string; candidateId: string }): Promise<{ fileUrl: string; provenance: BrollProvenance }>;
  fallbackImage?(i: { workspaceId: string; variationBatchId: string; subject: string }): Promise<{ fileUrl: string; prompt: string; model: string; costUsd: number }>;
}
export const BROLL_PORT = Symbol('BACKEND_BROLL_PORT');

export interface Span { startSec: number; endSec: number }
export interface BlocoDaFala { label: string; fn: string; startSec: number; endSec: number }

export const SEGMENTO_MIN_SEC = 3;
/** Distância mínima entre o momento de cima e o de baixo (s); em loop curto, até L/2 − 0,25. */
export const SEGMENTO_GAP_SEC = 2;
const SEGMENTO_MAX_SEC = 8;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Menor distância entre o que toca em cima (campeão inteiro, t de 0 a D) e embaixo (trecho [a, a+L) em loop: a + t mod L)
 * ao longo do vídeo: na volta k (t ∈ [kL, (k+1)L)) a diferença é |a − kL|. 0 = em algum momento é o mesmo quadro.
 */
export function distanciaMinima(a: number, L: number, durationSec: number): number {
  let min = Infinity;
  for (let k = 0; k * L < durationSec; k++) min = Math.min(min, Math.abs(a - k * L));
  return min;
}

/**
 * Trecho do campeão pro painel de baixo (§B3): blocos de prova primeiro (depois os do meio, nunca gancho nem CTA),
 * ≥ 3 s, com o rosto quando `comRosto` (call_dialog), e que nunca repete o momento que toca em cima (≥ 2 s de distância
 * em todas as voltas do loop). Encurta o trecho até achar um comprimento que sirva. Nada serve = null.
 */
export function trechoSemRepetir(i: {
  durationSec: number; blocks: BlocoDaFala[]; rostos?: Span[]; comRosto?: boolean; minSec?: number; gapSec?: number;
}): (Span & { bloco: string }) | null {
  const min = i.minSec ?? SEGMENTO_MIN_SEC;
  const gap = i.gapSec ?? SEGMENTO_GAP_SEC;
  const fn = (b: BlocoDaFala) => b.fn.trim().toLowerCase();
  const hook = i.blocks.find((b) => /hook|gancho/.test(fn(b))) ?? i.blocks[0];
  const rank = (b: BlocoDaFala) => (fn(b) === 'proof' ? 0 : /story|testimonial|result|demo|social/.test(fn(b)) ? 1 : /cta/.test(fn(b)) ? 9 : 2);
  const cands = i.blocks.filter((b) => b !== hook && rank(b) < 9).sort((a, b) => rank(a) - rank(b) || b.endSec - b.startSec - (a.endSec - a.startSec));
  for (const b of cands) {
    let spans: Span[] = [{ startSec: b.startSec, endSec: b.endSec }];
    if (i.comRosto) {
      spans = (i.rostos ?? [])
        .map((f) => ({ startSec: Math.max(f.startSec, b.startSec), endSec: Math.min(f.endSec, b.endSec) }))
        .filter((s) => s.endSec - s.startSec >= min)
        .sort((x, y) => y.endSec - y.startSec - (x.endSec - x.startSec));
    }
    for (const s of spans) {
      const ok = semRepetirDentro(s, i.durationSec, { minSec: min, gapSec: gap });
      if (ok) return { ...ok, bloco: `${b.label} (${b.fn})` };
    }
  }
  return null;
}

/** Dentro de um trecho: o maior pedaço (≤ 8 s, ≥ minSec) que nunca mostra embaixo o momento que toca em cima. */
export function semRepetirDentro(s: Span, durationSec: number, o: { minSec?: number; gapSec?: number } = {}): Span | null {
  const min = o.minSec ?? SEGMENTO_MIN_SEC;
  const gap = o.gapSec ?? SEGMENTO_GAP_SEC;
  for (let L = Math.min(SEGMENTO_MAX_SEC, s.endSec - s.startSec); L >= min - 1e-9; L -= 0.1) {
    // num loop de L s a maior distância possível é L/2 (a no meio de duas voltas): trecho curto usa o que dá, nunca 0
    const g = Math.min(gap, L / 2 - 0.25);
    for (let a = s.startSec; a + L <= s.endSec + 1e-9; a += 0.1) {
      if (distanciaMinima(a, L, durationSec) >= g) return { startSec: r3(a), endSec: r3(a + L) };
    }
  }
  return null;
}

/** Fala de um trecho (texto pra busca do b-roll). */
export function falaDe(words: TranscriptWord[], s: Span | null, max = 300): string {
  const ws = s ? words.filter((w) => w.startSec >= s.startSec - 0.05 && w.endSec <= s.endSec + 0.05) : words;
  return ws.map((w) => w.word).join(' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export interface SegundaFonteEntrada {
  workspaceId: string; variationBatchId: string; jobId?: string | null;
  template: FrameTemplateId; language: string; durationSec: number;
  blocks: BlocoDaFala[]; words: TranscriptWord[]; editMap: EditMap | null;
  /** tom e entidades da busca; `notes` = gatilhos do mock ([mock:broll-none] / [mock:broll-fail]) */
  offer?: { name?: string | null; kind?: string | null; what?: string | null; audience?: string | null } | null;
  notes?: string | null;
}
export interface SegundaFonteSaida { second: FrameSecondSource; nota: string; costUsd: number }

/** Trechos com rosto principal do faceTrack (s). */
export function rostosDe(editMap: EditMap | null): Span[] {
  if (!editMap?.faceTrack?.length || !editMap.fps) return [];
  return editMap.faceTrack
    .filter((f) => ((f as { role?: string }).role ?? 'main') === 'main' && f.endFrame > f.startFrame)
    .map((f) => ({ startSec: f.startFrame / editMap.fps, endSec: f.endFrame / editMap.fps }));
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

@Injectable()
export class SegundaFonteService {
  private readonly log = new Logger('SegundaFonte');

  constructor(@Optional() @Inject(BROLL_PORT) private readonly broll: BrollServicePort | null = null) {}

  /** A ordem do Gusta (25/10). Nunca lança: o `champion_segment` é o último recurso (sem ele = null). */
  async resolver(i: SegundaFonteEntrada): Promise<SegundaFonteSaida | null> {
    const seg = trechoSemRepetir({ durationSec: i.durationSec, blocks: i.blocks, rostos: rostosDe(i.editMap), comRosto: i.template === 'call_dialog' });
    const speech = falaDe(i.words, seg) || falaDe(i.words, null);
    let costUsd = 0;
    let subject: string | null = null;
    // 1. b-roll do Pexels (a ia busca pela fala e escolhe pela folha de quadros; o 1º candidato é o escolhido)
    if (this.broll && speech) {
      try {
        const r = await this.broll.search({
          workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, jobId: i.jobId ?? '', speech, language: i.language,
          minSec: SEGMENTO_MIN_SEC, providers: PROVEDORES_PADRAO, limit: 6, offer: i.offer ?? null, notes: i.notes ?? null,
        });
        costUsd += r.costUsd ?? 0;
        subject = r.fallbackSubject ?? null;
        for (const c of r.candidates.filter((x) => PROVEDORES_PADRAO.includes(x.provenance.provider))) {
          try {
            const f = await this.broll.fetch({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, candidateId: c.candidateId });
            return { second: { kind: 'stock_broll', fileUrl: f.fileUrl, provenance: f.provenance }, nota: `b-roll ${f.provenance.provider}: ${c.query}`, costUsd: r4(costUsd) };
          } catch (e) {
            this.log.warn(`b-roll ${c.candidateId} não baixou (${(e as Error).message}); próximo`);
          }
        }
      } catch (e) {
        // BROLL_NO_MATCH: nenhum clipe serve; o assunto vai pra imagem de reserva
        const d = isIntegracaoError(e) ? ((e as { details?: { fallbackSubject?: string; costUsd?: number } }).details ?? {}) : {};
        costUsd += d.costUsd ?? 0;
        subject = d.fallbackSubject ?? subject;
        this.log.warn(`b-roll sem candidato (${(e as Error).message}); passo 2`);
      }
    }
    // 2. imagem gerada (GPT Image 2 1k) sobre o assunto do trecho
    if (this.broll?.fallbackImage && subject) {
      try {
        const g = await this.broll.fallbackImage({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, subject });
        // TRANSIÇÃO: o kind de imagem gerada entra no FrameSecondSource (arquiteto); até lá vai como imagem parada
        // (mesmo desenho do product_photo no render) com a marca `generated` pro rastreio
        const second = { kind: 'product_photo', fileUrl: g.fileUrl, generated: { prompt: g.prompt, model: g.model, subject } } as unknown as FrameSecondSource;
        return { second, nota: `imagem gerada: ${subject}`, costUsd: r4(costUsd + g.costUsd) };
      } catch (e) {
        this.log.warn(`imagem de reserva falhou (${(e as Error).message}); trecho do campeão`);
      }
    }
    // 3. trecho do campeão que não repete o de cima
    if (seg) return { second: { kind: 'champion_segment', startSec: seg.startSec, endSec: seg.endSec }, nota: `trecho do campeão ${seg.bloco}`, costUsd: r4(costUsd) };
    return null;
  }
}
