// templates-creditos-v1 §2/§6/A7 (31/10): o lote de template = o lote AUTO com o tipo travado. PURO, testado em
// templates-lote.spec.ts: restringe o `allowed` às chaves do template, calcula o fit (as MESMAS regras do plano) e lista/
// aplica os textos editáveis do Plan (FRAME e HEADLINE na v1).
import type { AutoVariationType, EditableText, FrameTemplateId, TemplateFit } from '@maquina/contratos';
import {
  type AllowedType, type PlanCtx, FRAME_FIELDS, allowedFor, allowedFrames, hasFace, listKeyOf, listTemplatesOf, templateOnlyTypesOf,
} from './regras';
import { applyListTexts, isListSpec, listEditableTexts } from './lista-plano';

/** As chaves do catálogo ("FRAME:news", "HEADLINE") → tipos e molduras. */
export function keysOf(keys: readonly string[]): { types: Set<string>; frames: Set<string> } {
  return {
    types: new Set(keys.map((k) => k.split(':')[0])),
    frames: new Set(keys.filter((k) => k.startsWith('FRAME:')).map((k) => k.slice('FRAME:'.length))),
  };
}

/** Chave de uma peça planejada (a mesma do `lineKeyOf` dos créditos). */
export const pieceKeyOf = (type: string, params: unknown): string =>
  type === 'FRAME' ? `FRAME:${(params as { template?: string } | null)?.template ?? ''}`
    // templates-lista-v1 §1: `LIST_OVERLAY:<templateId>`
    : type === 'LIST_OVERLAY' ? listKeyOf((params as { templateId?: string } | null)?.templateId ?? '') : type;

export const levelOf = (reason: string | null): TemplateFit['level'] => (!reason ? 'ok' : reason === 'burned_captions' ? 'soft' : 'hard');
const fitOfReason = (reason: string | null): TemplateFit => ({ level: levelOf(reason), reason });

/**
 * §2: o `allowed` do plano só com as chaves do template. FRAME = só as molduras do template que passam (sem nenhuma = o
 * motivo da moldura, `burned_captions` primeiro). `max` = o do template quando ele limita (STATIC 1, Headline 3…).
 */
export function restrictToTemplate(ctx: PlanCtx, allowed: readonly AllowedType[], tpl: { keys: readonly string[]; max?: Record<string, number> }): { allowed: AllowedType[]; frames: FrameTemplateId[] } {
  const { types, frames } = keysOf(tpl.keys);
  const fr = allowedFrames(ctx).filter((f) => frames.has(f.template));
  const okFrames = fr.filter((f) => f.allowed).map((f) => f.template);
  // templates-lista-v1 §1: LIST_OVERLAY só os templates das chaves (`LIST_OVERLAY:<id>`)
  const out = allowed.filter((a) => types.has(a.type) && (a.type !== 'LIST_OVERLAY' || tpl.keys.includes(listKeyOf(a.templateId ?? '')))).map((a): AllowedType => {
    if (a.type === 'FRAME') {
      const reason = okFrames.length ? null : fr.some((f) => f.blockedReason === 'burned_captions') ? 'burned_captions' : (fr[0]?.blockedReason ?? a.blockedReason ?? 'no_page');
      return { type: 'FRAME', max: okFrames.length, blockedReason: reason as AllowedType['blockedReason'] };
    }
    const cap = tpl.max?.[a.type];
    return cap != null && a.max > 0 ? { ...a, max: Math.min(a.max, cap) } : a;
  });
  return { allowed: out, frames: okFrames };
}

/** Fit do lote: template único = o motivo da sua linha; pack = ok se algum cabe, soft se só a legenda tira. */
export function batchFitOf(restricted: readonly AllowedType[], pack: boolean): TemplateFit {
  if (pack) {
    if (restricted.some((a) => a.max > 0)) return { level: 'ok', reason: null };
    return restricted.some((a) => a.blockedReason === 'burned_captions') ? fitOfReason('burned_captions') : fitOfReason(restricted[0]?.blockedReason ?? 'no_data');
  }
  const a = restricted[0];
  if (!a) return fitOfReason('no_data');
  return fitOfReason(a.max > 0 ? null : a.blockedReason ?? 'no_data');
}

/** Tipos de IA (F3): o fit olha rosto, fala e Brain (as condições do F3.3); a disponibilidade é outra conta. */
const AI_TYPES = new Set(['AVATAR_FACE', 'AVATAR_PERSONA', 'REMIX_DISCOVERY', 'REMIX_PODCAST', 'REMIX_KLING']);
const filled = (s: string | null | undefined) => !!s && s.trim().length > 0;

/** §6: fit de UM template do catálogo num anúncio já lido (sem chamada paga). */
export function templateFitOf(ctx: PlanCtx, t: { internalKey: string; autoType: string | null; frameId: string | null; pack: boolean }, packKeys: readonly string[] = []): TemplateFit {
  // os templates grátis entram no allowedFor só com ctx.templates.enabled (a disponibilidade da flag é outra conta)
  // A6: COLD_OPEN/ENDCARD entram no allowedFor só com a chave do template (ou do pack) no ctx
  const keys = t.pack ? packKeys : [t.internalKey];
  // templates-lista-v1 §4: a chave `LIST_OVERLAY:<id>` vira `ctx.listTemplates = [id]` (o AllowedType daquele template)
  const c: PlanCtx = { ...ctx, ...(ctx.templates && { templates: { ...ctx.templates, enabled: true } }), templateOnlyTypes: templateOnlyTypesOf(keys), listTemplates: listTemplatesOf(keys) };
  if (t.pack) return batchFitOf(restrictToTemplate(c, allowedFor(c), { keys: packKeys }).allowed, true);
  const type = t.autoType ?? '';
  if (AI_TYPES.has(type)) {
    if (type === 'AVATAR_FACE') return fitOfReason(!hasFace(c) ? 'no_face' : !c.hasSpeech ? 'no_speech' : null);
    if (type === 'AVATAR_PERSONA') return fitOfReason(filled(c.brain.audience) ? null : 'no_audience');
    return fitOfReason(!c.hasSpeech ? 'no_speech' : filled(c.brain.promise) || filled(c.brain.proof) ? null : 'no_promise');
  }
  const r = restrictToTemplate(c, allowedFor(c), { keys: [t.internalKey] });
  return batchFitOf(r.allowed, false);
}

/** `insight.captionBlocked` do lote de template: só as chaves do template. */
export function captionBlockedForTemplate<T extends { type: AutoVariationType; template: FrameTemplateId | null; listTemplate?: string }>(list: readonly T[] | undefined, keys: readonly string[]): T[] {
  const { types, frames } = keysOf(keys);
  return (list ?? []).filter((x) => (x.type === 'FRAME' ? !!x.template && frames.has(x.template)
    : x.type === 'LIST_OVERLAY' ? !!x.listTemplate && keys.includes(listKeyOf(x.listTemplate)) : types.has(x.type)));
}

// ───────── textos editáveis (A7) ─────────

const getPath = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
function setPath(o: Record<string, unknown>, path: string, value: string): void {
  const ks = path.split('.');
  let cur: Record<string, unknown> | unknown[] = o;
  for (let i = 0; i < ks.length - 1; i++) cur = (cur as Record<string, unknown>)[ks[i]] as Record<string, unknown>;
  (cur as Record<string, unknown>)[ks[ks.length - 1]] = value;
}

/** Limite do Headline (headline-plano: replace = original × 1,2 entre 20 e 90; add = 60). */
export function headlineMaxChars(params: { mode?: string; original?: string | null }): number {
  if (params.mode !== 'replace' || !params.original) return 60;
  return Math.min(90, Math.max(20, Math.round(params.original.trim().length * 1.2)));
}

/** Os textos que o Plan deixa editar, com o caminho, o limite e a fonte. [] = tipo sem edição na v1. */
export function editableTextsOf(type: string | null, params: Record<string, unknown> | null): EditableText[] {
  if (!params) return [];
  if (type === 'FRAME') {
    const template = params.template as FrameTemplateId;
    const texts = params.texts;
    const sources = (params.sources ?? {}) as Record<string, string>;
    const out: EditableText[] = [];
    for (const f of FRAME_FIELDS[template] ?? []) {
      const val = getPath(texts, f.path);
      if (f.list) (Array.isArray(val) ? val : []).forEach((x, k) => {
        if (typeof x === 'string') out.push({ path: `${f.path}.${k}`, label: `${f.path}.${k}`, value: x, maxChars: f.max, source: sources[`${f.path}.${k}`] ?? sources[f.path] ?? null });
      });
      else if (typeof val === 'string') out.push({ path: f.path, label: f.path, value: val, maxChars: f.max, source: sources[f.path] ?? null });
    }
    return out;
  }
  if (type === 'HEADLINE') {
    const sources = (params.sources ?? {}) as Record<string, string>;
    return [{ path: 'text', label: 'headline', value: String(params.text ?? ''), maxChars: headlineMaxChars(params as { mode?: string; original?: string | null }), source: sources.text ?? null }];
  }
  // templates-lista-v1 §5: `list.heads.bad|good`, `list.title`, `list.lines.<id>`
  if (type === 'LIST_OVERLAY' && isListSpec(params)) return listEditableTexts(params);
  return [];
}

/** Aplica as edições num clone dos params (FRAME: em `texts`; HEADLINE: `text`, e o destaque some se saiu do texto). */
export function applyTexts(type: string, params: Record<string, unknown>, edits: readonly { path: string; value: string }[]): { params: Record<string, unknown>; unknownPaths: string[] } {
  if (type === 'LIST_OVERLAY' && isListSpec(params)) {
    const r = applyListTexts(params, edits);
    return { params: r.params as unknown as Record<string, unknown>, unknownPaths: r.unknownPaths };
  }
  const allowed = new Set(editableTextsOf(type, params).map((t) => t.path));
  const unknownPaths = edits.filter((e) => !allowed.has(e.path)).map((e) => e.path);
  const next = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
  if (unknownPaths.length) return { params: next, unknownPaths };
  for (const e of edits) {
    const v = e.value.replace(/\s+/g, ' ').trim();
    if (type === 'FRAME') {
      setPath(next.texts as Record<string, unknown>, e.path, v);
      if (next.template === 'read_caption' && e.path === 'primaryText') next.suggestedPrimaryText = v;
    } else {
      next.text = v;
      if (typeof next.highlight === 'string' && !v.includes(next.highlight.trim())) next.highlight = null;
    }
  }
  return { params: next, unknownPaths };
}

// ───────── templates-multi-v1 (04/11): seleção de vários templates ─────────

/**
 * §3.2: fit da SELEÇÃO num anúncio: `unknown` se não foi lido; senão `hard` se algum é hard (motivo = o do 1º hard); senão
 * `soft` se algum é soft; senão `ok`.
 */
export function selectionFitOf(fits: readonly TemplateFit[], read: boolean): TemplateFit {
  if (!read) return { level: 'unknown', reason: 'not_read' };
  const hard = fits.find((f) => f.level === 'hard');
  if (hard) return { level: 'hard', reason: hard.reason };
  const soft = fits.find((f) => f.level === 'soft');
  if (soft) return { level: 'soft', reason: soft.reason };
  return { level: 'ok', reason: null };
}

/**
 * §3.4 `selection.skipped`: marcados que não viraram linha. Motivo = o fit `hard` gravado no Reading, o `soft` (legenda queimada) sem peça, ou `not_planned`
 * (cabia, mas o plano não fez peça dele). `planned` = as chaves com peça no lote (marcada ou não: desmarcar não é "ficar de
 * fora"). Sem `fits` (plano ainda não pronto) = nada.
 */
export function skippedOf(sel: { slugs: readonly string[]; keys: readonly string[]; fits?: Record<string, TemplateFit> }, planned: ReadonlySet<string>): { slug: string; reason: string }[] {
  if (!sel.fits) return [];
  const out: { slug: string; reason: string }[] = [];
  sel.slugs.forEach((slug, k) => {
    const fit = sel.fits![slug];
    if (fit?.level === 'hard') out.push({ slug, reason: fit.reason ?? 'no_data' });
    else if (!planned.has(sel.keys[k])) out.push({ slug, reason: fit?.level === 'soft' ? fit.reason ?? 'burned_captions' : 'not_planned' });
  });
  return out;
}
