// BrollPort do modo mock (§B3.1 item 6): determinístico, sem rede, custo 0. Candidatos de exemplo com proveniência
// Pexels de exemplo; `fetch` devolve o vídeo sintético do MockMediaController no tamanho do intervalo.
// Gatilhos nas notas da OFERTA (`BrollSearchInputExt.notes`):
//   [mock:broll-none]  nenhum candidato serve → BROLL_NO_MATCH (com fallbackSubject); o backend cai pro champion_segment.
//   searchTrack: rodízio de 3 vídeos, com as 2 alternativas por trecho (variantes 1-2 da trilha).
//   [mock:broll-fail]  o 1º `fetch` de cada candidato falha BROLL_UNAVAILABLE (o retry passa).
// Social (youtube/tiktok/instagram) sem pexels = BROLL_SOURCE_NOT_SUPPORTED, como no live.
import type { BrollProvenance, BrollTrackSearchInput, Usage } from '../contrato';
import { IntegracaoError } from '../erros';
import type { CostStore } from '../portas';
import { mockMediaUrl, seedOf } from '../mock/midia';
import { candidateIdOf, parseCandidateId, PEXELS_LICENSE, type BrollSearchInputExt, type BrollSearchResult } from './broll.service';
import { socialSourceFor } from './social';
import type { BrollPickAlt } from './trilha';

const r2 = (n: number) => Math.round(n * 100) / 100;

export class FakeBrollService {
  private readonly failedOnce = new Set<string>();
  constructor(private readonly costs: CostStore, private readonly opts: { publicApiUrl: string }) {}

  async search(i: BrollSearchInputExt): Promise<BrollSearchResult & Usage> {
    if (!i.providers.includes('pexels')) {
      const social = i.providers.find((p) => p === 'youtube' || p === 'tiktok' || p === 'instagram');
      if (social) socialSourceFor(social).assertEnabled();
      throw new IntegracaoError('BROLL_SOURCE_NOT_SUPPORTED', 'mock: provider not enabled', { reason: 'provider_not_enabled' });
    }
    const notes = i.notes ?? '';
    await this.costs.record({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, jobId: i.jobId, provider: 'ANTHROPIC', kind: 'LLM', model: 'mock', units: 0, unit: 'ktoken_out', amountUsd: 0 });
    const words = i.speech.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 3).join(' ').toLowerCase() || 'everyday moment';
    const queries = [`person ${words}`.slice(0, 40), `hands ${words}`.slice(0, 40)];
    const fallbackSubject = `a person in an everyday moment about ${words}`;
    if (notes.includes('[mock:broll-none]')) {
      throw new IntegracaoError('BROLL_NO_MATCH', 'mock: no candidate fits', { rejected: [{ candidate: 1, reason: 'watermark (mock)' }], queries, fallbackSubject, costUsd: 0 });
    }
    const base = Number.parseInt(seedOf(i.speech).slice(0, 6), 16) % 900000 + 100000;
    const n = Math.max(1, Math.min(i.limit || 3, 3));
    const candidates = Array.from({ length: n }, (_, k) => {
      const id = base + k;
      const dur = 12 + k * 3;
      const startSec = k === 0 ? 1 : 0;
      const endSec = r2(Math.min(dur, startSec + Math.max(i.minSec, 3)));
      return {
        candidateId: candidateIdOf(id, startSec, endSec),
        provenance: this.provenance(id, startSec, endSec),
        posterUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'static', seed: seedOf('poster', String(id)), format: 'VERTICAL_9_16' }),
        previewUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'video', seed: seedOf('preview', String(id)), format: 'VERTICAL_9_16', sec: dur }),
        durationSec: dur,
        query: queries[0],
        pick: { chosen: k === 0, reason: k === 0 ? 'cells 2-5 show a person in an everyday moment that matches the speech (mock)' : '', cells: k === 0 ? ([2, 5] as [number, number]) : null },
      };
    });
    return { candidates, queries, fallbackSubject, costUsd: 0 };
  }

  async fetch(i: { workspaceId: string; variationBatchId: string; candidateId: string; notes?: string | null }): Promise<{ fileUrl: string; provenance: BrollProvenance }> {
    const c = parseCandidateId(i.candidateId);
    if ((i.notes ?? '').includes('[mock:broll-fail]') && !this.failedOnce.has(i.candidateId)) {
      this.failedOnce.add(i.candidateId);
      throw new IntegracaoError('BROLL_UNAVAILABLE', 'mock: b-roll download failed', { reason: 'mock' });
    }
    const sec = Math.max(0.5, c.endSec - c.startSec);
    return {
      fileUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'video', seed: seedOf('broll', i.candidateId), format: 'VERTICAL_9_16', sec }),
      provenance: this.provenance(c.videoId, c.startSec, c.endSec),
    };
  }

  /** Trilha mock: 1 clipe por trecho, 3 vídeos em rodízio (nunca o mesmo em seguida), já "no storage" (vídeo sintético
   *  na duração do trecho). [mock:broll-none] = todo trecho sem clipe; [mock:broll-gap] = todo 3º trecho sem clipe. */
  async searchTrack(i: BrollTrackSearchInput): Promise<{ picks: (BrollPickAlt | { none: true; fallbackSubject: string })[] } & Usage> {
    const notes = i.notes ?? '';
    await this.costs.record({ workspaceId: i.workspaceId, variationBatchId: i.batchId, provider: 'ANTHROPIC', kind: 'LLM', model: 'mock', units: 0, unit: 'ktoken_out', amountUsd: 0 });
    const base = Number.parseInt(seedOf(i.batchId, i.language).slice(0, 6), 16) % 900000 + 100000;
    const picks = i.segments.map((seg, k) => {
      const subject = `a person in an everyday moment about: ${seg.text.slice(0, 80)}`;
      if (notes.includes('[mock:broll-none]') || (notes.includes('[mock:broll-gap]') && k % 3 === 2)) return { none: true as const, fallbackSubject: subject };
      const len = r2(Math.max(0.5, seg.endSec - seg.startSec));
      // principal = rodízio de 3 vídeos; alternativas = os outros 2 (variante v do trecho k = vídeo (k + v) % 3: nunca repete em seguida)
      const make = (id: number, tag: string) => {
        const candidateId = candidateIdOf(id, 0, len);
        return {
          candidateId,
          fileUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'video', seed: seedOf('broll-track', candidateId, String(k), tag), format: 'VERTICAL_9_16', sec: len }),
          srcStartSec: 0, srcEndSec: len,
          provenance: this.provenance(id, 0, len),
          reason: `cells 1-4 show an everyday moment that matches stretch ${k + 1} (mock${tag ? `, ${tag}` : ''})`,
        };
      };
      return { ...make(base + (k % 3), ''), alternatives: [make(base + ((k + 1) % 3), 'alternate 1'), make(base + ((k + 2) % 3), 'alternate 2')] };
    });
    return { picks, costUsd: 0 };
  }

  async fallbackImage(i: { workspaceId: string; variationBatchId: string; subject: string }): Promise<{ fileUrl: string; prompt: string; model: string; costUsd: number }> {
    await this.costs.record({ workspaceId: i.workspaceId, variationBatchId: i.variationBatchId, provider: 'WAVESPEED', kind: 'IMAGE', model: 'mock', units: 1, unit: 'image', amountUsd: 0 });
    return { fileUrl: mockMediaUrl(this.opts.publicApiUrl, { kind: 'static', seed: seedOf('broll-img', i.subject), format: 'VERTICAL_9_16' }), prompt: i.subject, model: 'mock', costUsd: 0 };
  }

  private provenance(id: number, startSec: number, endSec: number): BrollProvenance {
    return { provider: 'pexels', sourceUrl: `https://www.pexels.com/video/${id}/`, creator: 'Pexels creator (mock)', license: PEXELS_LICENSE, licenseCommercialOk: true, startSec, endSec };
  }
}
