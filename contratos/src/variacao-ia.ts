/** Variação semântica v1: planejamento persistido; ainda não produz mídia nem cria VariationItems. */
export type SemanticAxis = 'audience' | 'situation' | 'pain' | 'desire' | 'objection' | 'awareness' | 'angle' | 'mechanism' | 'proof' | 'narrative' | 'presentation_format' | 'messenger' | 'hook' | 'execution' | 'offer_cta' | 'localization' | 'placement';
export type SemanticFormat = 'F02' | 'F04' | 'F08' | 'F09' | 'F10' | 'F11';
export type SemanticFocus = 'AUTO' | 'FORMAT' | 'AUDIENCE' | 'ANGLE';
export interface SemanticPlanRequest {
  championId: string;
  requestId: string;
  focus: SemanticFocus;
  instructions: string;
  formatIds: SemanticFormat[];
}
export interface SemanticFact {
  id: string;
  field: string;
  text: string;
  origin: 'user' | 'page' | 'unknown';
  verification: 'provided_not_independently_verified';
}
export interface SemanticBeat {
  role: 'hook' | 'objection' | 'mechanism' | 'proof' | 'cta';
  speaker: 'host' | 'presenter' | 'narrator';
  text: string;
  visual: string;
  factRefs: string[];
}
export interface SemanticVariation {
  id: string;
  title: string;
  formatId: SemanticFormat;
  audience: string;
  angle: string;
  hypothesis: string;
  changes: { axis: SemanticAxis; before: string; after: string }[];
  preserved: string[];
  factRefs: string[];
  requirements: { kind: 'proof' | 'asset' | 'eligibility'; description: string }[];
  beats: SemanticBeat[];
  /** A validação estrutural não comprova claims. Revisão do criativo antes de publicar. */
  status: 'hypothesis';
  reviewRequired: true;
  audienceFit: 'not_assessed' | 'needs_review';
  testInterpretation: 'concept_exploration_not_causal';
}
export interface SemanticPlan {
  version: 'semantic-v1';
  knowledgeVersion: '2026-11-04';
  language: string;
  source: { championId: string; championName: string; offerId: string; offerName: string; rights: string; updatedAt: string };
  facts: SemanticFact[];
  diagnosis: { summary: string; sourceAngle: string; sourceAudience: string; gaps: string[] };
  variations: SemanticVariation[];
  generationMode: 'mock' | 'live';
  costUsd: number;
  mediaGenerated: false;
}
export interface SemanticPlanJob {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  championId: string;
  offerId: string;
  request: SemanticPlanRequest;
  plan: SemanticPlan | null;
  errorCode: string | null;
  createdAt: string;
}
export interface SemanticPlannerConfig {
  enabled: boolean;
  available: boolean;
  reason: 'disabled' | 'not_configured' | 'access_required' | null;
  mode: 'mock' | 'live';
  formats: { id: SemanticFormat; name: string; description: string }[];
  variationsPerPlan: 3;
  producesMedia: false;
}
