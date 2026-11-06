import type { SemanticPlan, SemanticVariation, SemanticAxis, SemanticFormat, SemanticBeat } from '@maquina/contratos';
import { IntegracaoError } from '../integracoes/erros';
import { AXES, FORMAT_AXES } from './catalogo';
import type { SemanticContext } from './contexto';

function invalid(reason: string): never { throw new IntegracaoError('PROVIDER_ERROR', `semantic plan invalid: ${reason}`); }
function obj(v: unknown, fields: string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return invalid('object');
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !fields.includes(k)) || fields.some((k) => !(k in o))) return invalid('fields');
  return o;
}
function str(v: unknown, max = 700): string {
  if (typeof v !== 'string' || !v.trim() || v.length > max) return invalid('text');
  return v.trim();
}
function arr(v: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) return invalid('array');
  return v;
}
function one<T extends string>(v: unknown, values: readonly T[]): T {
  if (typeof v !== 'string' || !values.includes(v as T)) return invalid('enum');
  return v as T;
}
const norm = (s: string) => s.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Schema não basta: valida referências, foco, cobertura e estrutura de conversa antes de persistir. */
export function validateSemanticPlan(raw: unknown, ctx: SemanticContext, mode: 'mock' | 'live', costUsd: number): SemanticPlan {
  const root = obj(raw, ['diagnosis', 'variations']);
  const d = obj(root.diagnosis, ['summary', 'sourceAngle', 'sourceAudience', 'gaps']);
  const facts = new Set(ctx.facts.map((f) => f.id));
  const refs = (v: unknown, min = 0) => {
    const list = arr(v, min, 8).map((x) => str(x, 80));
    if (list.some((x) => !facts.has(x)) || new Set(list).size !== list.length) invalid('fact reference');
    return list;
  };
  const variations = arr(root.variations, 3, 3).map((v, index): SemanticVariation => {
    const x = obj(v, ['title', 'formatId', 'audience', 'angle', 'hypothesis', 'changes', 'preserved', 'factRefs', 'requirements', 'beats']);
    const formatId = one<SemanticFormat>(x.formatId, ctx.request.formatIds);
    const changes = arr(x.changes, 1, 10).map((c) => {
      const z = obj(c, ['axis', 'before', 'after']);
      const before = str(z.before, 350), after = str(z.after, 350);
      if (norm(before) === norm(after)) invalid('unchanged axis');
      return { axis: one<SemanticAxis>(z.axis, AXES), before, after };
    });
    const axes = changes.map((c) => c.axis);
    if (new Set(axes).size !== axes.length) invalid('duplicate axis');
    if (ctx.request.focus === 'FORMAT' && (!axes.includes('presentation_format') || axes.some((a) => !FORMAT_AXES.has(a)))) invalid('format focus');
    if (ctx.request.focus === 'AUDIENCE' && !axes.includes('audience')) invalid('audience focus');
    if (ctx.request.focus === 'ANGLE' && !axes.includes('angle')) invalid('angle focus');
    const factRefs = refs(x.factRefs, 1);
    const beats = arr(x.beats, 3, 8).map((b): SemanticBeat => {
      const z = obj(b, ['role', 'speaker', 'text', 'visual', 'factRefs']);
      const role = one(z.role, ['hook', 'objection', 'mechanism', 'proof', 'cta'] as const);
      const factRefsBeat = refs(z.factRefs, ['mechanism', 'proof', 'cta'].includes(role) ? 1 : 0);
      if (factRefsBeat.some((id) => !factRefs.includes(id))) invalid('unlisted beat fact');
      return { role, speaker: one(z.speaker, ['host', 'presenter', 'narrator'] as const), text: str(z.text, 600), visual: str(z.visual, 450), factRefs: factRefsBeat };
    });
    if (!beats.some((b) => b.role === 'cta')) invalid('missing CTA');
    if (formatId === 'F10') {
      if (beats[0].speaker !== 'host' || !beats.some((b) => b.speaker === 'presenter') || beats.some((b, n) => b.speaker === 'narrator' || (n > 0 && b.speaker === beats[n - 1].speaker))) invalid('podcast turns');
    }
    if (formatId === 'F09' && new Set(beats.map((b) => b.speaker)).size !== 1) invalid('solo speaker');
    const requirements = arr(x.requirements, 0, 8).map((r) => {
      const z = obj(r, ['kind', 'description']);
      return { kind: one(z.kind, ['proof', 'asset', 'eligibility'] as const), description: str(z.description, 450) };
    });
    if (axes.includes('audience') && !requirements.some((r) => r.kind === 'eligibility')) invalid('audience eligibility');
    return {
      id: `V${index + 1}`, title: str(x.title, 100), formatId, audience: str(x.audience, 350), angle: str(x.angle, 350), hypothesis: str(x.hypothesis, 700),
      changes, preserved: arr(x.preserved, 1, 8).map((s) => str(s, 200)), factRefs, requirements, beats,
      status: 'hypothesis', reviewRequired: true, audienceFit: axes.includes('audience') ? 'needs_review' : 'not_assessed', testInterpretation: 'concept_exploration_not_causal',
    };
  });
  if (ctx.request.formatIds.some((f) => !variations.some((v) => v.formatId === f))) invalid('missing requested format');
  const keys = variations.map((v) => `${v.formatId}|${norm(v.audience)}|${norm(v.angle)}|${v.changes.map((c) => `${c.axis}:${norm(c.after)}`).sort().join('|')}`);
  if (new Set(keys).size !== 3) invalid('duplicate concept');
  return {
    version: 'semantic-v1', knowledgeVersion: '2026-11-04', language: ctx.language, source: ctx.source, facts: ctx.facts,
    diagnosis: { summary: str(d.summary, 1000), sourceAngle: str(d.sourceAngle, 350), sourceAudience: str(d.sourceAudience, 350), gaps: arr(d.gaps, 0, 8).map((g) => str(g, 450)) },
    variations, generationMode: mode, costUsd, mediaGenerated: false,
  };
}
