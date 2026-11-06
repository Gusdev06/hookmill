// templates-creditos-v1 §3 (31/10): regras do catálogo. PURO, testado em catalogo.spec.ts.
import type { TemplateCategory, TemplateTab, TemplateTier } from '@maquina/contratos';
import { AUTO_TYPES_FORA, AUTO_TYPES_NOVOS, TEMPLATE_ONLY_TYPES, TYPE_MAX } from '../iteracao/regras';
import { templatesLigados } from '../iteracao/templates-plano';

export interface CatalogRow {
  slug: string; internalKey: string; autoType: string | null; frameId: string | null; pack: boolean; tier: TemplateTier;
  credits: number | null; status: 'DRAFT' | 'LIVE' | 'HIDDEN'; exampleKey: string | null;
}

export type Unavailable = 'coming_soon' | 'retired' | 'disabled';

/**
 * O tipo roda hoje? Edição dos lotes novos + STATIC = sim; CHAT_DM/PERSON_MOTION só com ITERATE_TEMPLATES=on; COLD_OPEN/ENDCARD
 * = sim (A6, 01/11: voltam só no lote de template); os outros que saíram em 25/10 (HOOK_TEXT, STORY, SPLIT_LP) = `retired`; IA = `coming_soon` até o F3; sem preço = `disabled`.
 */
export function availabilityOf(t: Pick<CatalogRow, 'autoType' | 'pack' | 'credits'>, env: Record<string, string | undefined> = process.env): { available: boolean; reason: Unavailable | null } {
  if (t.autoType === 'AI_VIDEO') return env.AI_TEMPLATES_ENABLED === 'off' ? { available: false, reason: 'disabled' } : { available: true, reason: null };
  if (t.credits == null) return { available: false, reason: 'disabled' };
  if (t.pack) return { available: true, reason: null };
  const type = t.autoType ?? '';
  if (type === 'CHAT_DM' || type === 'PERSON_MOTION') return templatesLigados(env) ? { available: true, reason: null } : { available: false, reason: 'disabled' };
  if ((AUTO_TYPES_NOVOS as readonly string[]).includes(type) || (TEMPLATE_ONLY_TYPES as readonly string[]).includes(type)) return { available: true, reason: null };
  if ((AUTO_TYPES_FORA as readonly string[]).includes(type)) return { available: false, reason: 'retired' };
  return { available: false, reason: 'coming_soon' };
}

/** O cliente vê: LIVE e disponível. 02/11 (Gusta): o vídeo de exemplo deixou de ser obrigatório; sem ele o card mostra a
 *  ilustração do tipo (web `TemplateExample`) até o Admin subir o vídeo. */
export function visibleToCustomer(t: CatalogRow, env: Record<string, string | undefined> = process.env): boolean {
  return t.status === 'LIVE' && t.credits != null && availabilityOf(t, env).available;
}

/** As chaves que o pack pode usar: templates de Edição (tier EDIT, nem STATIC nem IA) LIVE e disponíveis. Vídeo não importa. */
export function packKeysOf(rows: readonly CatalogRow[], env: Record<string, string | undefined> = process.env): string[] {
  return rows.filter((t) => !t.pack && t.tier === 'EDIT' && t.status === 'LIVE' && availabilityOf(t, env).available).map((t) => t.internalKey);
}

export const tabOf = (tier: TemplateTier): TemplateTab => (tier === 'AI' ? 'ai' : 'edit');
export const sampleOk = (tier: TemplateTier): boolean => tier === 'EDIT';
export const asCategory = (c: string): TemplateCategory => c as TemplateCategory;

// ───────── templates-multi-v1 (04/11): vários templates marcados num lote só ─────────

/** M7: a linha de SISTEMA do catálogo (âncora do TemplateRun da seleção). Nunca na galeria, no admin nem no `/:slug/use`. */
export const SELECTION_SLUG = 'selection';
export const SELECTION_KEY = 'SELECTION';
export const isSelectionRow = (t: Pick<CatalogRow, 'internalKey'>): boolean => t.internalKey === SELECTION_KEY;

/** §3.3 `TemplateList.selection` (M2/M4): 2 a 12 marcados, Σ outputs ≤ 12 (o BATCH_MAX do lote auto); 04/11: ≤ 8 molduras
 *  (o FRAME ≤ 8 do plano, regra de 25/10 — `TYPE_MAX.FRAME`). */
export const SELECTION_LIMITS = { minTemplates: 2, maxTemplates: 12, maxVideos: 12, maxFrames: TYPE_MAX.FRAME } as const;

export type SelectionRow = CatalogRow & { outputs: number };

export type SelectionCheck<R extends SelectionRow> =
  | { ok: true; picked: R[] }
  | { ok: false; code: 'TEMPLATE_SELECTION_INVALID'; details: { reason: 'not_found' | 'pack' | 'ai_tier' | 'too_many_videos' | 'too_many_frames'; slugs: string[]; videos?: number; maxVideos?: number; frames?: number; max?: number } }
  | { ok: false; code: 'TEMPLATE_UNAVAILABLE'; details: { reason: Unavailable; slug: string } };

/**
 * §3.1 checagens 2-6 (a 1ª que falhar responde): existe e é visível (equipe: qualquer um que não seja a linha de sistema) →
 * nenhum pack → nenhum IA → todos disponíveis (o 1º) → molduras ≤ maxFrames (04/11) → Σ outputs ≤ maxVideos. `picked` sai na ordem do pedido.
 */
export function checkSelection<R extends SelectionRow>(rows: readonly R[], slugs: readonly string[], staff: boolean, env: Record<string, string | undefined> = process.env): SelectionCheck<R> {
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const found = (s: string) => {
    const t = bySlug.get(s);
    return !!t && !isSelectionRow(t) && (staff || visibleToCustomer(t, env));
  };
  const missing = slugs.filter((s) => !found(s));
  if (missing.length) return { ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'not_found', slugs: missing } };
  const picked = slugs.map((s) => bySlug.get(s)!);
  const packs = picked.filter((t) => t.pack).map((t) => t.slug);
  if (packs.length) return { ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'pack', slugs: packs } };
  const ai = picked.filter((t) => t.tier === 'AI').map((t) => t.slug);
  if (ai.length) return { ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'ai_tier', slugs: ai } };
  for (const t of picked) {
    const a = availabilityOf(t, env);
    if (!a.available) return { ok: false, code: 'TEMPLATE_UNAVAILABLE', details: { reason: a.reason!, slug: t.slug } };
  }
  const frames = picked.filter((t) => t.autoType === 'FRAME').map((t) => t.slug);
  if (frames.length > SELECTION_LIMITS.maxFrames) return { ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'too_many_frames', slugs: frames, frames: frames.length, max: SELECTION_LIMITS.maxFrames } };
  const videos = picked.reduce((n, t) => n + t.outputs, 0);
  if (videos > SELECTION_LIMITS.maxVideos) return { ok: false, code: 'TEMPLATE_SELECTION_INVALID', details: { reason: 'too_many_videos', slugs: [], videos, maxVideos: SELECTION_LIMITS.maxVideos } };
  return { ok: true, picked };
}

/** §2 `settings.template.max`: por autoType ≠ FRAME, Σ outputs dos marcados daquele tipo (HEADLINE 3, CUT 2, STATIC 1…). */
export function selectionMaxOf(picked: readonly Pick<SelectionRow, 'autoType' | 'outputs'>[]): Record<string, number> {
  const max: Record<string, number> = {};
  for (const t of picked) if (t.autoType && t.autoType !== 'FRAME') max[t.autoType] = (max[t.autoType] ?? 0) + t.outputs;
  return max;
}
