// Portas que o módulo iteracao (B1) consome do maquina-video (variacao-auto-v1.md §7.5, §7.6). O dono liga a
// implementação real trocando o provider no iteracao.module.ts (uma linha); testes trocam por fakes (overrideProvider).
//  - PAGE_CAPTURE: maquina-video V1 (medicao, §7.5). Sem implementação = página não capturada (SPLIT-LP sai: no_page).
//  - MEDIA_RULES: maquina-video V1 (medicao, §7.6: snapSpans, hasWrittenHook, hasEndCard). Até lá, fallback puro aqui.
import { Injectable } from '@nestjs/common';
import type { EditMap, TeardownSections, TranscriptWord } from '@maquina/contratos';

// ───────── V1: captura da página (§7.5) ─────────

export const PAGE_CAPTURE = Symbol('BACKEND_PAGE_CAPTURE');

export type PageCaptureResult =
  | { fileId: string; widthPx: number; heightPx: number; text: string }
  | { error: 'PAGE_FORBIDDEN' | 'PAGE_UNREADABLE' | 'PAGE_TIMEOUT'; status: number | null };

export interface PageCapturePort {
  capture(i: { workspaceId: string; url: string }): Promise<PageCaptureResult>;
}

/** Sem o serviço do video ligado: nada é capturado (o SPLIT-LP só entra com a foto do produto). */
@Injectable()
export class SemCapturaDePagina implements PageCapturePort {
  async capture(): Promise<PageCaptureResult> {
    return { error: 'PAGE_UNREADABLE', status: null };
  }
}

// ───────── V1: funções puras de mídia (§7.6) ─────────

export const MEDIA_RULES = Symbol('BACKEND_MEDIA_RULES');

export interface Span { startSec: number; endSec: number }
export interface MediaRulesPort {
  /** move cada borda pro meio do silêncio entre palavras mais próximo (nunca no meio de palavra) */
  snapSpans(spans: Span[], words: TranscriptWord[], silences: Span[]): Span[];
  hasWrittenHook(editMap: EditMap | null, withinSec: number): boolean;
  hasEndCard(editMap: EditMap | null, teardown: TeardownSections | null): boolean;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Fallback das funções do video até a medicao exportar as dela (o provider troca por elas). Mesmas regras do §7.6,
 * versão simples: borda dentro de uma palavra vai pro meio do silêncio (vão entre palavras) mais perto.
 */
export const regrasDeMidiaFallback: MediaRulesPort = {
  snapSpans(spans, words) {
    if (!words.length) return spans.map((s) => ({ startSec: r3(s.startSec), endSec: r3(s.endSec) }));
    const gaps: number[] = [0];
    for (let i = 0; i < words.length - 1; i++) gaps.push(r3((words[i].endSec + words[i + 1].startSec) / 2));
    gaps.push(r3(words[words.length - 1].endSec + 0.05));
    const inside = (t: number) => words.some((w) => t > w.startSec + 0.01 && t < w.endSec - 0.01);
    const snap = (t: number) => (inside(t) ? gaps.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)) : r3(t));
    return spans.map((s) => {
      const a = snap(s.startSec);
      const b = snap(s.endSec);
      return b > a ? { startSec: a, endSec: b } : { startSec: r3(s.startSec), endSec: r3(s.endSec) };
    });
  },
  hasWrittenHook(editMap, withinSec) {
    if (!editMap) return false;
    const lim = withinSec * editMap.fps;
    return editMap.layers.some((l) => l.kind !== 'caption' && !!l.text?.trim() && l.startFrame < lim);
  },
  hasEndCard(editMap, teardown) {
    if (editMap) {
      const tail = editMap.frameCount - 2 * editMap.fps;
      if (editMap.layers.some((l) => l.kind !== 'caption' && !!l.text?.trim() && l.startFrame >= tail)) return true;
    }
    const s = teardown?.offerProofCta;
    return s?.status === 'ok' && !!s.data?.ctaOnScreen?.trim() && !!teardown?.structure?.data?.blocks?.at(-1)?.onScreen?.trim();
  },
};
