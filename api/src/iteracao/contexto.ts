// Monta o contexto puro das regras (PlanCtx) a partir das linhas do banco: campeão + teardown + oferta + workspace.
import type { EditMap } from '@maquina/contratos';
import type { Offer as OfferRow, Teardown as TeardownRow } from '@prisma/client';
import { editMapOf, measurementsOf, sectionsOf, transcriptOf } from '../campeoes/champion-views';
import { initials, num } from '../common/util/format';
import type { FrameBrand } from '../integracoes';
import { handleDe } from '../render/auto-edit';
import { paletaDoEstatico } from './paleta';
import { captionsAutoOf, headlineInfoOf } from './headline-plano';
import type { MediaRulesPort } from './portas';
import { type Brain, type InsightFlags, type PlanBlock, type PlanCtx, CUT_MIN_SEC, brainEmpty, codeLanguageOf } from './regras';

export interface CtxSource {
  offer: OfferRow;
  /** 25/10: `brandColor` (D3) entra na cor da marca das molduras */
  workspace: { name: string; brandColor?: string | null };
  /** 25/10: `language` = idioma da fala (textos de tela) */
  champion: { durationSec: unknown; hasSpeech: boolean; language?: string | null };
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

/**
 * §B2: instante do rosto redondo das molduras (question_box, live, gossip_*): 0,5 s depois do início do 1º trecho do
 * rosto principal com ≥ 1 s (ou o meio do trecho, se for curto). Sem faceTrack = null (o template fica sem foto).
 */
export function faceAtSecOf(editMap: EditMap | null): number | null {
  if (!editMap?.faceTrack?.length || !editMap.fps) return null;
  const main = editMap.timeline?.length
    ? editMap.faceTrack.filter((f) => editMap.timeline!.some((t) => t.kind === 'main' && t.startFrame <= f.startFrame && t.endFrame > f.startFrame))
    : editMap.faceTrack;
  const segs = (main.length ? main : editMap.faceTrack).filter((f) => f.endFrame > f.startFrame);
  const seg = segs.find((f) => (f.endFrame - f.startFrame) / editMap.fps >= 1) ?? segs[0];
  if (!seg) return null;
  const start = seg.startFrame / editMap.fps;
  const len = (seg.endFrame - seg.startFrame) / editMap.fps;
  return Math.round((start + Math.min(0.5, len / 2)) * 1000) / 1000;
}

/** §B2 FrameBrand: nome = offer.name, handle = workspace.name normalizado (= handle do STORY), cor = acento da paleta. */
export function frameBrandOf(src: Pick<CtxSource, 'offer' | 'workspace'>, championPalette: string[] | null | undefined): FrameBrand {
  const { accent } = paletaDoEstatico({ brandColor: src.workspace.brandColor ?? null, championPalette });
  return { name: src.offer.name, handle: handleDe(src.workspace.name), initials: initials(src.offer.name), color: accent };
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
    screenLanguage: src.champion.language || transcript?.language || src.offer.language,
    offerName: src.offer.name,
    offerKind: src.offer.kind ?? null,
    frame: { brand: frameBrandOf(src, m?.palette), faceAtSec: faceAtSecOf(editMap) },
    // headline-e-legenda-v1: modo/limites/bloqueio da headline e se o lote ganha legenda automática
    headline: headlineInfoOf(editMap, {
      screenLanguage: src.champion.language || transcript?.language || src.offer.language, offerLanguage: src.offer.language,
      width: m?.width ?? editMap?.width ?? 0, height: m?.height ?? editMap?.height ?? 0,
    }),
    captionsAuto: captionsAutoOf(editMap, transcript?.words ?? []),
  };
}

export function flagsOf(ctx: PlanCtx): InsightFlags {
  return { brainEmpty: brainEmpty(ctx.brain), shortVideo: ctx.durationSec < CUT_MIN_SEC, pageCaptured: ctx.pageCaptured };
}
