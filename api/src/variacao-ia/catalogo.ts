import type { SemanticAxis, SemanticFormat } from '@maquina/contratos';

export const PURPOSE = 'semantic-variation-v1';
export const AXES: SemanticAxis[] = ['audience', 'situation', 'pain', 'desire', 'objection', 'awareness', 'angle', 'mechanism', 'proof', 'narrative', 'presentation_format', 'messenger', 'hook', 'execution', 'offer_cta', 'localization', 'placement'];
export const FORMATS: { id: SemanticFormat; name: string; description: string }[] = [
  { id: 'F02', name: 'Demo', description: 'Show the real product solving a concrete task.' },
  { id: 'F04', name: 'FAQ', description: 'Answer a specific objection with evidence.' },
  { id: 'F08', name: 'Static', description: 'One readable message, product and next step.' },
  { id: 'F09', name: 'Solo podcast', description: 'A presenter explains a relevant question conversationally.' },
  { id: 'F10', name: 'Podcast conversation', description: 'A host asks; a presenter explains. Alternate turns with new information.' },
  { id: 'F11', name: 'Narrated B-roll', description: 'Match each narrated argument to an appropriate scene and real proof.' },
];
export const FORMAT_IDS = FORMATS.map((f) => f.id);
export const FOCUSES = ['AUTO', 'FORMAT', 'AUDIENCE', 'ANGLE'] as const;
export const FORMAT_AXES = new Set<SemanticAxis>(['presentation_format', 'narrative', 'messenger', 'hook', 'execution', 'placement']);

/** Regras curadas da pesquisa de 04/11. Exemplos externos são repertório, não claims de performance. */
export const KNOWLEDGE = `
Angle = central reason to choose the offer. Hook = opening. Audience = intended buyer/context, not the actor's face.
Pain, desire, objection, awareness, narrative, presentation and production method are separate axes.
Operations can combine: execution iteration, format transposition, message expansion, audience expansion, new concept, localization.
Transposing talking head into a podcast requires useful questions and answers, not a monologue split between two voices.
UGC style is not an actual customer experience. Synthetic presenters cannot claim to be real customers, clinicians or known hosts.
Ad longevity, spend and popularity are not verified conversion, ROAS or profit. All proposals are hypotheses, not winners.
2027 findings are forecasts as of this knowledge version, never observed outcomes.
Exploring several axes is valid; report all changes without claiming causal attribution to one component.
New audiences require offer eligibility review. Pregnancy must not inherit generic weight-loss promises. Do not promise that appearance restores relationships.
Demo/FAQ/static/narrated/podcast are candidates to test, not a universal performance ranking.
`;
