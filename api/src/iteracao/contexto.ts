// Monta o contexto puro das regras (PlanCtx) a partir das linhas do banco: campeão + teardown + oferta + workspace.
import type { Offer as OfferRow, Teardown as TeardownRow } from '@prisma/client';
import { editMapOf, measurementsOf, sectionsOf, transcriptOf } from '../campeoes/champion-views';
import { num } from '../common/util/format';
import type { MediaRulesPort } from './portas';
import { type Brain, type InsightFlags, type PlanBlock, type PlanCtx, CUT_MIN_SEC, brainEmpty, codeLanguageOf } from './regras';

export interface CtxSource {
  offer: OfferRow;
  workspace: { name: string };
  champion: { durationSec: unknown; hasSpeech: boolean };
  teardown: TeardownRow | null;
}

export function brainOf(o: OfferRow): Brain {
  return { what: o.what, audience: o.audience, pains: o.pains, promise: o.promise, proof: o.proof, offerAndPrice: o.offerAndPrice, cta: o.cta, notes: o.notes };
}

/** Blocos do teardown.structure (seção 'ok'); sem estrutura = 1 bloco com o vídeo inteiro. */
export function blocksOf(teardown: TeardownRow | null, durationSec: number): PlanBlock[] {
  const s = sectionsOf(teardown?.sections)?.structure;
  const blocks = s?.status === 'ok' ? s.data?.blocks ?? [] : [];
  if (!blocks.length) return [{ index: 0, label: 'Video', fn: 'other', startSec: 0, endSec: durationSec }];
  return blocks.map((b, index) => ({ index, label: b.label, fn: b.function, startSec: b.startSec, endSec: b.endSec }));
}

export function planCtxOf(src: CtxSource, media: MediaRulesPort, page: { captured: boolean }): PlanCtx {
  const m = measurementsOf(src.teardown?.measurements);
  const sections = sectionsOf(src.teardown?.sections);
  const editMap = editMapOf(src.teardown?.editMap);
  const transcript = transcriptOf(src.teardown?.transcript);
  const durationSec = m?.durationSec ?? (num(src.champion.durationSec as never) ?? 0);
  const cta = sections?.offerProofCta?.status === 'ok' ? sections.offerProofCta.data?.ctaSpoken ?? null : null;
  return {
    lang: codeLanguageOf(src.offer.language),
    durationSec,
    blocks: blocksOf(src.teardown, durationSec),
    hasSpeech: src.champion.hasSpeech,
    words: transcript?.words ?? [],
    silences: m?.silences ?? [],
    hasWrittenHook: media.hasWrittenHook(editMap, 3),
    hasEndCard: media.hasEndCard(editMap, sections),
    brain: brainOf(src.offer),
    spokenCta: cta && cta.trim() ? cta : null,
    pageCaptured: page.captured,
    productPhoto: !!src.offer.productImageFileId,
    brandTerms: [src.workspace.name, src.offer.name].filter(Boolean),
  };
}

export function flagsOf(ctx: PlanCtx): InsightFlags {
  return { brainEmpty: brainEmpty(ctx.brain), shortVideo: ctx.durationSec < CUT_MIN_SEC, pageCaptured: ctx.pageCaptured };
}
