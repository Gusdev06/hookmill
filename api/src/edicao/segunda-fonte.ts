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
import type { BrollCandidateDraft, BrollPick, BrollPort, FrameSecondSource, Usage } from '../integracoes/contrato';
import type { BrollSearchInputExt } from '../integracoes/broll';
import { isIntegracaoError } from '../integracoes/erros';
import { cortarFala, montarTrilha, type BrollTrack, type TrilhaDoLote } from './trilha-broll';
import { isNone, type BrollPickAlt, type TrackNone } from '../integracoes/broll';
/** Imagens geradas por lote no lugar de trecho `none` da trilha (o resto estende o clipe vizinho; custo previsível). */
export const IMAGENS_POR_TRILHA = 2;

/** Preço da imagem de reserva (GPT Image 2 1k, §B3.1) pro teto antes de gerar. */
export const IMAGEM_RESERVA_USD = 0.22;

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
  /** 25/10 (trilha, §B3.1 item 9): `picks[i]` responde `segments[i]`; `{ none }` = sem b-roll bom (o backend tenta imagem). */
  searchTrack?: BrollPort['searchTrack'];
}

/** Onde a trilha do lote mora (`variation_batches.settings.brollTrack`) + o teto do mês (imagem gerada) + a posição da
 *  moldura entre as de 2 fontes do lote. Ligado no EdicaoModule; null nos testes que não usam trilha. */
export interface TrilhaStore {
  carregar(batchId: string): Promise<TrilhaDoLote | null>;
  gravar(batchId: string, t: TrilhaDoLote): Promise<void>;
  teto(workspaceId: string, usd: number): Promise<void>;
  /** imagens geradas permitidas na trilha deste lote (`settings.brollTrackMaxImages`; padrão IMAGENS_POR_TRILHA) */
  maxImagens?(batchId: string): Promise<number>;
  /** variante da trilha desta moldura: posição dela entre as de 2 fontes do lote (por índice) % VARIANTES */
  variante?(batchId: string, itemId: string | null): Promise<number>;
  /** bug 429 (25/10): a trilha da variante em 1 MP4 só (cache no lote por variante); devolve o `broll_track` apontando pra ele */
  juntar?(i: { batchId: string; workspaceId: string; variante: number; track: BrollTrack }): Promise<BrollTrack>;
}
export const TRILHA_STORE = Symbol('BACKEND_TRILHA_STORE');
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
  /** item da peça (posição entre as de 2 fontes do lote = qual variante da trilha ela usa) */
  itemId?: string | null;
  /** variante já gravada no item (retry repete a mesma) */
  variante?: number | null;
}
export interface SegundaFonteSaida { second: FrameSecondSource; nota: string; costUsd: number; /** só trilha */ variante?: number }

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

  private readonly emBusca = new Map<string, Promise<TrilhaDoLote | null>>();

  constructor(
    @Optional() @Inject(BROLL_PORT) private readonly broll: BrollServicePort | null = null,
    @Optional() @Inject(TRILHA_STORE) private readonly store: TrilhaStore | null = null,
  ) {}

  /**
   * Trilha do LOTE (25/10): 1 `searchTrack` por lote, gravada e reaproveitada por todas as molduras de 2 fontes e pelos
   * retries. Duas molduras pedindo ao mesmo tempo = a mesma promessa. Falhou = null (cadeia de antes).
   */
  async trilhaDoLote(i: SegundaFonteEntrada): Promise<TrilhaDoLote | null> {
    if (!this.store || !this.broll?.searchTrack || !i.variationBatchId) return null;
    const salva = await this.store.carregar(i.variationBatchId);
    if (salva && Math.abs(salva.durationSec - i.durationSec) < 0.5) return salva;
    const viva = this.emBusca.get(i.variationBatchId);
    if (viva) return viva;
    const p = (async () => {
      const segments = cortarFala(i.words, { startSec: 0, endSec: i.durationSec });
      if (!segments.length) return null;
      try {
        const r = await this.broll!.searchTrack!({
          workspaceId: i.workspaceId, batchId: i.variationBatchId, language: i.language, offer: i.offer ?? null, notes: i.notes ?? null,
          segments: segments.map(({ startSec, endSec, text }) => ({ startSec, endSec, text })),
        });
        let costUsd = r.costUsd ?? 0;
        let imagens = 0;
        const maxImagens = (await this.store!.maxImagens?.(i.variationBatchId)) ?? IMAGENS_POR_TRILHA;
        const picks: (BrollPickAlt | TrackNone)[] = [];
        for (const [k, s] of segments.entries()) {
          const pk = r.picks[k] as BrollPickAlt | TrackNone | undefined;
          if (pk && !isNone(pk)) {
            // só Pexels (D15), principal e alternativas
            const ok = (x: BrollPick) => PROVEDORES_PADRAO.includes(x.provenance.provider as BrollProvider);
            const opts = [pk, ...(pk.alternatives ?? [])].filter(ok);
            picks.push(opts.length ? { ...opts[0], alternatives: opts.slice(1) } : { none: true, fallbackSubject: s.text });
            continue;
          }
          // `none`: imagem gerada sobre o assunto (teto do mês; no máx. `maxImagens` por lote), senão estende o vizinho
          const subject = pk && isNone(pk) ? pk.fallbackSubject : null;
          if (subject && this.broll!.fallbackImage && imagens < maxImagens) {
            try {
              await this.store!.teto(i.workspaceId, IMAGEM_RESERVA_USD);
              const g = await this.broll!.fallbackImage({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, subject });
              imagens++;
              costUsd += g.costUsd;
              picks.push({
                candidateId: `generated:${k}`, fileUrl: g.fileUrl, srcStartSec: 0, srcEndSec: r4(s.endSec - s.startSec), reason: subject,
                provenance: { provider: 'generated', model: g.model, prompt: g.prompt, subject, licenseCommercialOk: true } as unknown as BrollPick['provenance'],
              });
              continue;
            } catch (e) {
              this.log.warn(`lote ${i.variationBatchId}: imagem do trecho ${k} não saiu (${(e as Error).message}); estende o vizinho`);
            }
          }
          picks.push({ none: true, fallbackSubject: subject ?? s.text });
        }
        const t: TrilhaDoLote = { version: 1, createdAt: new Date().toISOString(), language: i.language, durationSec: i.durationSec, segments, picks, costUsd: r4(costUsd) };
        await this.store!.gravar(i.variationBatchId, t);
        this.log.log(`lote ${i.variationBatchId}: trilha de b-roll com ${picks.filter((x) => !isNone(x)).length}/${segments.length} trechos (${imagens} imagem(ns), US$ ${t.costUsd})`);
        return t;
      } catch (e) {
        this.log.warn(`lote ${i.variationBatchId}: searchTrack falhou (${(e as Error).message}); cadeia de antes`);
        return null;
      }
    })();
    this.emBusca.set(i.variationBatchId, p);
    try {
      return await p;
    } finally {
      this.emBusca.delete(i.variationBatchId);
    }
  }

  /** A ordem do Gusta (25/10). Nunca lança: o `champion_segment` é o último recurso (sem ele = null). */
  async resolver(i: SegundaFonteEntrada): Promise<SegundaFonteSaida | null> {
    // 0. trilha de vários clipes que acompanham a fala (1 busca por lote)
    const trilha = await this.trilhaDoLote(i);
    if (trilha) {
      // 25/10 (Gusta): cada moldura do lote numa variante (rodízio 0, 1, 2); a do item vale no retry
      const variante = i.variante ?? (this.store?.variante ? await this.store.variante(i.variationBatchId, i.itemId ?? null) : 0);
      let track = montarTrilha(trilha, variante);
      if (track && this.store?.juntar) {
        try {
          track = await this.store.juntar({ batchId: i.variationBatchId, workspaceId: i.workspaceId, variante, track });
        } catch (e) {
          // sem o arquivo único o Lambda baixaria N arquivos por pedaço (429 do storage): melhor a cadeia de antes
          this.log.warn(`lote ${i.variationBatchId}: não juntou a trilha da variante ${variante} (${(e as Error).message}); cadeia de antes`);
          track = null;
        }
      }
      if (track) return { second: track, nota: `trilha de b-roll: ${track.clips.length} clipe(s), variante ${variante}`, costUsd: 0, variante }; // o custo da busca é do lote
    }
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
        if (this.store) await this.store.teto(i.workspaceId, IMAGEM_RESERVA_USD); // a imagem é paga: passa pelo teto do mês
        const g = await this.broll.fallbackImage({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, subject });
        const second: FrameSecondSource = { kind: 'generated_image', fileUrl: g.fileUrl, prompt: g.prompt, model: g.model, subject };
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
