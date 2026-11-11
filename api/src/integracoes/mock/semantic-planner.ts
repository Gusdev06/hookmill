import type { PlanOneRequest, PlanPreviewsRequest, SemanticAxis, SemanticBeat } from '@maquina/contratos';
import { FORMATS } from '../../variacao-ia/catalogo';
import type { SemanticContext } from '../../variacao-ia/contexto';
import { validateSemanticPlan } from '../../variacao-ia/plano';
import type { SemanticBillingV2, SemanticPlannerPort } from '../claude/semantic-planner';
import type { SemanticContextV2 } from '../claude/semantic-v2';
import { mockPlanOne, mockPlanPreviews } from './semantic-v2-mock';

/** Fixture de desenvolvimento, explicitamente identificada na resposta e na UI. Não se passa por escrita de IA. */
export function semanticMockDraft(ctx: SemanticContext) {
  const pt = ctx.language.startsWith('pt');
  const production = ctx.request.instructions.includes('automatic production');
  const text = (p: string, e: string) => pt ? p : e;
  const what = ctx.facts.find((f) => f.id === 'offer.what')!;
  const cta = ctx.facts.find((f) => f.id === 'offer.cta')!;
  const audience = ctx.facts.find((f) => f.id === 'offer.audience')?.text.slice(0, 250) || text('Público a investigar', 'Audience to investigate');
  const angle = text('Entender como a oferta funciona', 'Understand how the offer works');
  const treatments = [text('Mostrar o processo', 'Show the process'), text('Resolver a dúvida inicial', 'Resolve the initial question'), text('Explicar antes de escolher', 'Explain before choosing')];
  return {
    diagnosis: { summary: text('Simulação de desenvolvimento baseada nos campos da oferta; não é uma análise feita pelo modelo.', 'Development simulation based on offer fields; not model-generated analysis.'), sourceAngle: angle, sourceAudience: audience, gaps: [text('Revisar as afirmações e fornecer demonstração real.', 'Review claims and supply a real demonstration.')] },
    variations: Array.from({ length: 3 }, (_, i) => {
      const formatId = ctx.request.formatIds[i % ctx.request.formatIds.length];
      const changes: { axis: SemanticAxis; before: string; after: string }[] = [{ axis: 'presentation_format', before: text('Criativo de origem', 'Source creative'), after: FORMATS.find((f) => f.id === formatId)!.name }];
      changes.push({ axis: 'narrative', before: text('Estrutura original', 'Original structure'), after: treatments[i] });
      if (ctx.request.focus === 'AUDIENCE') changes.push({ axis: 'audience', before: audience, after: text(`Hipótese de contexto ${i + 1}: pessoas avaliando a oferta`, `Context hypothesis ${i + 1}: people evaluating the offer`) });
      if (ctx.request.focus === 'ANGLE' || ctx.request.focus === 'AUTO') changes.push({ axis: 'angle', before: angle, after: treatments[i] });
      const q = text('Como isso funciona na prática?', 'How does this work in practice?');
      const beat = (role: SemanticBeat['role'], speaker: SemanticBeat['speaker'], speech: string, refs: string[]): SemanticBeat => ({ role, speaker, text: speech, factRefs: refs, visual: text('Usar material real do produto, a fornecer.', 'Use actual product assets, to be supplied.') });
      const solo = formatId === 'F09' ? 'presenter' : 'narrator';
      const beats = formatId === 'F10' ? [
        beat('hook', 'host', q, []), beat('mechanism', 'presenter', what.text.slice(0, 550), [what.id]),
        beat('objection', 'host', text('E qual é o próximo passo?', 'And what is the next step?'), []), beat('cta', 'presenter', cta.text.slice(0, 550), [cta.id]),
      ] : [beat('hook', solo, q, []), beat('mechanism', solo, what.text.slice(0, 550), [what.id]), beat('cta', solo, cta.text.slice(0, 550), [cta.id])];
      return {
        title: treatments[i], formatId, audience: changes.find((c) => c.axis === 'audience')?.after ?? audience,
        angle: changes.find((c) => c.axis === 'angle')?.after ?? angle,
        hypothesis: text('Hipótese ilustrativa: a estrutura pode tornar a explicação mais compreensível; precisa ser testada.', 'Illustrative hypothesis: this structure may clarify the explanation; it needs testing.'),
        changes, preserved: [text('Produto, condições e CTA declarados', 'Declared product, terms and CTA')], factRefs: [what.id, cta.id], beats,
        requirements: [...(production ? [] : [{ kind: 'asset', description: text('Demonstração real do produto.', 'Actual product demonstration.') }]), ...(ctx.request.focus === 'AUDIENCE' ? [{ kind: 'eligibility', description: text('Verificar se a oferta atende esse contexto.', 'Check whether the offer fits this context.') }] : [])],
      };
    }),
  };
}
export class MockSemanticPlanner implements SemanticPlannerPort {
  readonly mode = 'mock' as const;
  readonly configured = true;
  estimate() { return 0; }
  async plan(ctx: SemanticContext) { return validateSemanticPlan(semanticMockDraft(ctx), ctx, 'mock', 0); }
  // semantic-v2: fake determinístico com gatilhos [mock:plan-*] (mock/semantic-v2-mock.ts). Custo 0, nada em cost_entries.
  estimatePreviews() { return 0; }
  estimateOne() { return 0; }
  async planPreviews(ctx: SemanticContextV2, req: PlanPreviewsRequest, _billing?: SemanticBillingV2) { return mockPlanPreviews(ctx, req); }
  async planOne(ctx: SemanticContextV2, req: PlanOneRequest, _billing?: SemanticBillingV2) { return mockPlanOne(ctx, req); }
}
