import type { SemanticFact, SemanticPlan, SemanticPlanRequest } from '@maquina/contratos';
import type { Offer, Teardown } from '@prisma/client';
import { sectionsOf, transcriptOf } from '../campeoes/champion-views';

export interface SemanticContext {
  source: SemanticPlan['source'];
  language: string;
  facts: SemanticFact[];
  transcript: string;
  interpretation: unknown;
  request: SemanticPlanRequest;
}
type SourceRow = { id: string; name: string; rights: string; updatedAt: Date; language: string | null; offer: Offer; teardown: Teardown | null };
const FIELDS = ['what', 'audience', 'promise', 'pains', 'proof', 'offerAndPrice', 'cta', 'notes'] as const;

/** Nunca trata a fala de um concorrente como fato da oferta do cliente. */
export function semanticContext(c: SourceRow, request: SemanticPlanRequest): SemanticContext {
  const origins = c.offer.fieldSources as Record<string, unknown> | null;
  const facts = FIELDS.flatMap((field): SemanticFact[] => {
    const text = c.offer[field]?.trim();
    if (!text) return [];
    const origin = origins?.[field];
    return [{ id: `offer.${field}`, field, text: text.slice(0, 1800), origin: origin === 'user' || origin === 'page' ? origin : 'unknown', verification: 'provided_not_independently_verified' }];
  });
  const sections = sectionsOf(c.teardown?.sections);
  const transcript = transcriptOf(c.teardown?.transcript);
  return {
    source: { championId: c.id, championName: c.name, offerId: c.offer.id, offerName: c.offer.name, rights: c.rights, updatedAt: c.updatedAt.toISOString() },
    language: c.offer.language || c.language || 'en', facts,
    transcript: transcript?.words.map((w) => w.word).join(' ').slice(0, 12000) ?? '',
    // Interpretação reduzida ao diagnóstico necessário; nunca frames/URLs/base64 ou todo o Brain.
    interpretation: sections ? {
      identification: sections.identification?.status === 'ok' ? sections.identification.data : null,
      whySells: sections.whySells?.status === 'ok' ? sections.whySells.data : null,
    } : null,
    request,
  };
}
