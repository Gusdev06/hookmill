import type { SemanticPlan, SemanticVariation } from '@maquina/contratos';
import { producibleVariation } from './contract';

const variation = (patch: Partial<SemanticVariation> = {}): SemanticVariation => ({
  id: 'one', title: 'Conversation', formatId: 'F10', audience: 'Original audience', angle: 'Original argument', hypothesis: 'Explain the offer clearly',
  changes: [{ axis: 'presentation_format', before: 'Talking head', after: 'Podcast' }], preserved: ['Offer'], factRefs: ['offer.what', 'offer.cta'], requirements: [],
  beats: [
    { role: 'hook', speaker: 'host', text: 'How does this work in practice?', visual: 'Host', factRefs: [] },
    { role: 'mechanism', speaker: 'presenter', text: 'The app organizes meals and shopping lists.', visual: 'Presenter', factRefs: ['offer.what'] },
    { role: 'objection', speaker: 'host', text: 'Where can I see how it works?', visual: 'Host', factRefs: [] },
    { role: 'cta', speaker: 'presenter', text: 'Visit the website and see the demonstration.', visual: 'Presenter', factRefs: ['offer.cta'] },
  ], status: 'hypothesis', reviewRequired: true, audienceFit: 'not_assessed', testInterpretation: 'concept_exploration_not_causal', ...patch,
});
const plan = (...variations: SemanticVariation[]) => ({ variations } as SemanticPlan);

it('escolhe uma proposta produzível do formato pedido, preservando a ordem das falas', () => {
  const pending = variation({ requirements: [{ kind: 'proof', description: 'Supply a testimonial' }] });
  const ready = variation({ id: 'ready' });
  expect(producibleVariation(plan(pending, ready), 'F10')).toBe(ready);
});
it('não transforma prova, asset ou elegibilidade faltante em mídia inventada', () => {
  for (const kind of ['proof', 'asset', 'eligibility'] as const) expect(() => producibleVariation(plan(variation({ requirements: [{ kind, description: 'Missing' }] })), 'F10')).toThrow('NOT_PRODUCIBLE');
});
it('rejeita formato errado, fala longa demais ou curta demais para lipsync', () => {
  expect(() => producibleVariation(plan(variation()), 'F09')).toThrow('NOT_PRODUCIBLE');
  for (const text of ['Hi', Array(130).fill('word').join(' ')]) {
    const v = variation(); v.beats[0].text = text;
    expect(() => producibleVariation(plan(v), 'F10')).toThrow('NOT_PRODUCIBLE');
  }
});
it('não aceita podcast de duas pessoas com uma única voz narrativa', () => {
  const v = variation(); v.beats[1].speaker = 'host';
  expect(() => producibleVariation(plan(v), 'F10')).toThrow('DIALOGUE_INVALID');
});
