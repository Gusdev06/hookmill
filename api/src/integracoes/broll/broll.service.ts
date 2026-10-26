// BrollPort (estatico-montado-e-molduras-v1 §B3.1): 2ª fonte das molduras de 2 fontes por b-roll, Pexels como padrão
// (decisão do Gusta 25/10). Método da skill get-brolls, sem a revisão humana do storyboard (no produto quem revisa é o
// usuário, trocando o clipe na peça):
//   1. o Claude (barato) monta 2-3 buscas "entidade + ação" em inglês a partir da fala do trecho;
//   2. Pexels Videos, vertical e HD primeiro (cache + reserva de cota: a chave é dividida com a Launchwing);
//   3. folha de 12 quadros numerados (ffmpeg) de cada candidato (até 6), do arquivo de prévia (o menor);
//   4. o Claude OLHA as folhas e escolhe clipe + intervalo citando as células, recusando marca d'água, texto, logo, rosto
//      famoso ou o que não bate com a fala; ninguém serve = BROLL_NO_MATCH (o backend cai pro champion_segment ou pra
//      imagem de reserva, `fallbackImage`);
//   5. `fetch` baixa só o arquivo escolhido (HD ≤ 1080), valida decodificando inteiro, corta o intervalo mudo e sobe
//      pelo `sink` (storage do backend);
//   6. proveniência: provider 'pexels', página, autor, "Pexels License", licenseCommercialOk true, intervalo.
// O candidateId carrega o vídeo e o intervalo (`pexels:<id>:<início>-<fim>`): `fetch` não depende de memória do processo.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrollCandidateDraft, BrollPort, BrollProvenance, BrollProvider, BrollSearchInput, Usage } from '../contrato';
import { IntegracaoError, isIntegracaoError } from '../erros';
import type { CostStore } from '../portas';
import { recordLlmCost } from '../claude/custo';
import type { ClaudeImage, ClaudeTransport } from '../claude/transporte';
import { FACE_MODEL_GPT_IMAGE_2, round4 } from '../catalogo/precos';
import type { WaveSpeedClient, WsPrediction } from '../wavespeed/cliente';
import { cellTimes, intervalFromCells, type Ffmpeg } from './folha';
import { finalFile, previewFile, rankVideos, type PexelsClient, type PexelsVideo } from './pexels';
import { PICK_SCHEMA, PICK_SYSTEM, QUERY_SCHEMA, QUERY_SYSTEM, fallbackImagePrompt, parsePick, parseQueries, pickUserMessage, queryUserMessage, type Pick } from './prompts';
import { socialSourceFor } from './social';
import { BROLL_MODEL, candidateIdOf, parseCandidateId, provenanceOf } from './ids';
import { searchTrack, type BrollTrackInput } from './trilha';
export { BROLL_MODEL, PEXELS_LICENSE, candidateIdOf, parseCandidateId, provenanceOf } from './ids';

export const BROLL_LIMITS = { maxCandidates: 6, perQuery: 8 };
/** Imagem de reserva: GPT Image 2 text-to-image high 1k (painel pequeno; página 25/10: US$ 0,22). */
export const BROLL_FALLBACK_IMAGE = { providerModel: FACE_MODEL_GPT_IMAGE_2.providerModel, quality: 'high', resolution: '1k', usd: 0.22, timeoutMs: 4 * 60_000 } as const;
/** Estimativa por b-roll: buscas (~1,5 mil in / 200 out) + escolha (6 folhas ~1,6 mil cada + texto, ~400 out), Haiku 4.5. */
export const BROLL_ESTIMATED_USD = 0.016;

/** Entrada com o que a §B3.1 pede e o tipo ainda não tem (TRANSIÇÃO; pedido ao arquiteto): a oferta (tom e entidades)
 *  e as notas da oferta (gatilhos do mock). */
export type BrollSearchInputExt = BrollSearchInput & {
  offer?: { name?: string | null; kind?: string | null; what?: string | null; audience?: string | null } | null;
  notes?: string | null;
};
/** Candidato com a escolha da visão (o 1º é o escolhido). */
export type BrollCandidatePick = BrollCandidateDraft & { pick: { chosen: boolean; reason: string; cells: [number, number] | null } };
export interface BrollSearchResult { candidates: BrollCandidatePick[]; queries: string[]; fallbackSubject: string }

/** Onde o arquivo final mora (o backend liga no StorageService: put + URL assinada). */
export interface BrollSink {
  put(i: { workspaceId: string; variationBatchId: string; bytes: Buffer; mimeType: 'video/mp4' | 'image/png'; sourceUrl: string }): Promise<{ fileUrl: string }>;
}

export interface PexelsBrollOptions {
  pexels: PexelsClient;
  transport: ClaudeTransport;
  costs: CostStore;
  ffmpeg: Ffmpeg;
  sink: BrollSink;
  /** reserva de imagem (sem ela, `fallbackImage` lança NOT_CONFIGURED) */
  wavespeed?: WaveSpeedClient | null;
  model?: string;
  fetchImpl?: typeof fetch;
  /** sonda: recebe cada folha (n, bytes) pra salvar */
  onSheet?: (n: number, videoId: number, jpeg: Buffer) => void;
  sleepMs?: number;
}


const STOCK_DONE: BrollProvider[] = ['pexels'];

export class PexelsBrollService implements BrollPort {
  constructor(private readonly o: PexelsBrollOptions) {}

  private get model() { return this.o.model ?? BROLL_MODEL; }

  async search(i: BrollSearchInputExt): Promise<BrollSearchResult & Usage> {
    if (!i.providers.includes('pexels')) {
      const social = i.providers.find((p) => p === 'youtube' || p === 'tiktok' || p === 'instagram');
      if (social) socialSourceFor(social).assertEnabled();
      throw new IntegracaoError('BROLL_SOURCE_NOT_SUPPORTED', `b-roll providers ${i.providers.join(',')} not enabled (only ${STOCK_DONE.join(',')})`, { reason: 'provider_not_enabled' });
    }
    let total = 0;
    const charge = async (usage: Parameters<typeof recordLlmCost>[2]) => {
      total += await recordLlmCost(this.o.costs, { workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, jobId: i.jobId, model: this.model }, usage);
    };

    // 1. buscas pela fala
    const plan = await this.retryOnce(async () => {
      const res = await this.o.transport.run({ system: QUERY_SYSTEM, user: queryUserMessage(i), schema: QUERY_SCHEMA, maxTokens: 2000, model: this.model, effort: null });
      await charge(res.usage);
      this.finished(res.stopReason);
      const p = parseQueries(res.text);
      if (!p.queries.length) throw new IntegracaoError('PROVIDER_ERROR', 'b-roll: no search query');
      return p;
    });

    // 2. Pexels (vertical primeiro; completa sem orientação), vertical e HD no topo
    const seen = new Map<number, PexelsVideo>();
    for (const q of plan.queries) {
      for (const orientation of ['portrait', null] as const) {
        const vids = await this.o.pexels.search(q, { orientation, perPage: BROLL_LIMITS.perQuery });
        for (const v of vids) if (!seen.has(v.id) && previewFile(v)) seen.set(v.id, v);
        if (vids.length >= 3) break;
      }
    }
    const max = Math.max(1, Math.min(i.limit || BROLL_LIMITS.maxCandidates, BROLL_LIMITS.maxCandidates));
    const pool = rankVideos([...seen.values()], i.minSec).slice(0, max);
    if (!pool.length) throw new IntegracaoError('BROLL_NO_MATCH', 'b-roll: pexels returned nothing', { rejected: [], queries: plan.queries, fallbackSubject: plan.fallbackSubject, costUsd: round6(total) });

    // 3. folhas de quadros (falhou a folha = candidato fora)
    const sheets = await Promise.all(pool.map(async (v) => {
      try {
        return await this.o.ffmpeg.contactSheet(previewFile(v)!.link, v.duration, v.height > v.width);
      } catch {
        return null;
      }
    }));
    const looked = pool.map((v, k) => ({ v, sheet: sheets[k] })).filter((x): x is { v: PexelsVideo; sheet: Buffer } => !!x.sheet);
    if (!looked.length) throw new IntegracaoError('BROLL_UNAVAILABLE', 'b-roll: no contact sheet could be made', { reason: 'preview_failed' });
    looked.forEach((x, k) => this.o.onSheet?.(k + 1, x.v.id, x.sheet));

    // 4. o Claude olha e escolhe
    const images: ClaudeImage[] = looked.map((x, k) => ({ mediaType: 'image/jpeg', data: x.sheet.toString('base64'), caption: `Candidate ${k + 1}:` }));
    const pick: Pick = await this.retryOnce(async () => {
      const res = await this.o.transport.run({
        system: PICK_SYSTEM, images,
        user: pickUserMessage({ speech: i.speech, language: i.language, minSec: i.minSec, candidates: looked.map((x, k) => ({ n: k + 1, durationSec: x.v.duration, cellTimes: cellTimes(x.v.duration) })) }),
        schema: PICK_SCHEMA, maxTokens: 3000, model: this.model, effort: null,
      });
      await charge(res.usage);
      this.finished(res.stopReason);
      return parsePick(res.text, looked.length);
    });
    if (!pick.choice) {
      throw new IntegracaoError('BROLL_NO_MATCH', `b-roll: no candidate fits (${pick.reason})`, { rejected: pick.rejected, reason: pick.reason, queries: plan.queries, fallbackSubject: plan.fallbackSubject, costUsd: round6(total) });
    }

    // 5. candidatos: o escolhido primeiro (com o intervalo das células), depois os não recusados (intervalo do início)
    const rejected = new Set(pick.rejected.map((r) => r.candidate));
    const out: BrollCandidatePick[] = [];
    looked.forEach((x, k) => {
      const n = k + 1;
      const chosen = n === pick.choice;
      if (!chosen && rejected.has(n)) return;
      const span = chosen ? intervalFromCells(x.v.duration, pick.firstCell, pick.lastCell, i.minSec) : intervalFromCells(x.v.duration, 1, 1, i.minSec);
      const draft: BrollCandidatePick = {
        candidateId: candidateIdOf(x.v.id, span.startSec, span.endSec),
        provenance: provenanceOf(x.v, span.startSec, span.endSec),
        posterUrl: x.v.image, previewUrl: previewFile(x.v)?.link ?? null, durationSec: x.v.duration, query: plan.queries[0],
        pick: { chosen, reason: chosen ? pick.reason : '', cells: chosen ? [pick.firstCell, pick.lastCell] : null },
      };
      if (chosen) out.unshift(draft);
      else out.push(draft);
    });
    return { candidates: out, queries: plan.queries, fallbackSubject: plan.fallbackSubject, costUsd: round6(total) };
  }

  async fetch(i: { workspaceId: string; variationBatchId: string; candidateId: string }): Promise<{ fileUrl: string; provenance: BrollProvenance }> {
    const c = parseCandidateId(i.candidateId);
    const v = await this.o.pexels.video(c.videoId);
    const file = finalFile(v);
    if (!file) throw new IntegracaoError('BROLL_UNAVAILABLE', `b-roll: pexels video ${v.id} has no mp4`, { reason: 'no_file' });
    const end = Math.min(c.endSec, v.duration);
    const start = Math.min(c.startSec, Math.max(0, end - 0.5));
    const dir = mkdtempSync(join(tmpdir(), 'broll-'));
    try {
      const src = join(dir, 'src.mp4');
      await this.download(file.link, src);
      const out = join(dir, 'cut.mp4');
      await this.o.ffmpeg.cut(src, start, end, out);
      await this.o.ffmpeg.validate(out);
      const { fileUrl } = await this.o.sink.put({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, bytes: readFileSync(out), mimeType: 'video/mp4', sourceUrl: v.url });
      return { fileUrl, provenance: provenanceOf(v, start, end) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Reserva quando nenhum clipe serve (BROLL_NO_MATCH.details.fallbackSubject): 1 imagem GPT Image 2 high 1k 9:16 do
   * assunto do trecho, sem texto; síncrona (polling até 4 min), validada e no storage. cost_entry IMAGE no lote.
   * TRANSIÇÃO: `FrameSecondSource` ainda não tem um kind pra imagem gerada (pedido ao arquiteto).
   */
  async fallbackImage(i: { workspaceId: string; variationBatchId: string; subject: string }): Promise<{ fileUrl: string; prompt: string; model: string; costUsd: number }> {
    const ws = this.o.wavespeed;
    if (!ws) throw new IntegracaoError('NOT_CONFIGURED', 'b-roll fallback image: WAVESPEED_API_KEY is empty');
    const m = BROLL_FALLBACK_IMAGE;
    const prompt = fallbackImagePrompt(i.subject);
    let p: WsPrediction = await ws.submit(m.providerModel, { prompt, aspect_ratio: '9:16', resolution: m.resolution, quality: m.quality, output_format: 'png' }, null);
    const t0 = Date.now();
    while (!['completed', 'failed', 'cancelled', 'timeout', 'deleted'].includes(p.status)) {
      if (Date.now() - t0 > m.timeoutMs) throw new IntegracaoError('PROVIDER_TIMEOUT', `b-roll fallback image ${p.id} timeout`);
      await new Promise((r) => setTimeout(r, this.o.sleepMs ?? 3000));
      p = await ws.result(p.id, p.getUrl);
    }
    if (p.status !== 'completed') throw new IntegracaoError(/nsfw|content|moderat/i.test(String(p.error)) ? 'SAFETY_BLOCK' : 'PROVIDER_ERROR', `b-roll fallback image ${p.id} ${p.status}`);
    await this.o.costs.record({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, provider: 'WAVESPEED', kind: 'IMAGE', model: m.providerModel, units: 1, unit: 'image', amountUsd: m.usd });
    const url = p.outputs.find((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
    if (!url) throw new IntegracaoError('PROVIDER_ERROR', `b-roll fallback image ${p.id} without output`);
    const dir = mkdtempSync(join(tmpdir(), 'broll-img-'));
    try {
      const f = join(dir, 'img.png');
      await this.download(url, f);
      const { fileUrl } = await this.o.sink.put({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, bytes: readFileSync(f), mimeType: 'image/png', sourceUrl: url });
      return { fileUrl, prompt, model: m.providerModel, costUsd: m.usd };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Trilha (25/10): 1 clipe por trecho da fala, já baixado e cortado no storage (trilha.ts). */
  searchTrack(i: BrollTrackInput) {
    return searchTrack(this.o, (url, path) => this.download(url, path), i);
  }

  /** Baixa e valida decodificando inteiro; até 3 tentativas (download truncado sem erro). */
  private async download(url: string, path: string): Promise<void> {
    let last: Error | null = null;
    for (let k = 0; k < 3; k++) {
      try {
        const res = await (this.o.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(120_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length) throw new Error('empty');
        writeFileSync(path, buf);
        await this.o.ffmpeg.validate(path);
        return;
      } catch (e) {
        last = e as Error;
      }
    }
    throw new IntegracaoError('DOWNLOAD_INVALID', `b-roll download failed 3x: ${last?.message}`);
  }

  private finished(stop: string | null) {
    if (stop === 'refusal') throw new IntegracaoError('SAFETY_BLOCK', 'claude declined (refusal)');
    if (stop === 'max_tokens') throw new IntegracaoError('PROVIDER_ERROR', 'claude hit max_tokens');
  }

  private async retryOnce<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const code = isIntegracaoError(e) ? e.code : 'PROVIDER_ERROR';
      if (code !== 'PROVIDER_ERROR' || (e as Error).message.includes('max_tokens')) throw e;
      return fn();
    }
  }
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
