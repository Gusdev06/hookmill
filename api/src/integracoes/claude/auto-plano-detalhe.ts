// 2ª etapa do planAutoBatch (bug live 25/10): um esquema só com plano + textos do STATIC montado + molduras estourou o
// limite interno da gramática da saída estruturada ("The compiled grammar is too large"; medido com a sonda
// sondas/sonda-schema-plano.ts: 105 propriedades falha, 55 compila). Então:
//   1. o plano (AUTO_PLAN_SCHEMA) só escolhe: STATIC = refAtSec + emoção + conceito; FRAME = template;
//   2. cada STATIC ganha UMA chamada própria (STATIC_DETAIL_SCHEMA) e TODAS as molduras com texto vão numa chamada só
//      (FRAMES_DETAIL_SCHEMA, lista por peça, effort low: até 8 molduras por lote desde 25/10, e uma chamada por moldura
//      encarecia o plano); mesmo sistema e mesmo contexto do lote (prefixo cacheado), em paralelo;
//   3. a resposta é encaixada no item cru e o `parseAutoPlan` de sempre lê tudo: a saída pro backend não muda.
// Peça cuja 2ª etapa falhou sai do plano (o backend completa no reparo, como qualquer peça inválida).
import type { FrameTemplateId, StaticEmotion } from '../contrato';
import { STATIC_COPY_SCHEMA, STATIC_EMOTIONS, STATIC_VISUAL_V2_SCHEMA } from './auto-plano-estatico';
import { FRAME_SCHEMA, FRAME_TEMPLATES } from './auto-plano-moldura';

const obj = (properties: Record<string, object>, description?: string) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties, ...(description ? { description } : {}),
});

export const STATIC_DETAIL_SCHEMA = obj({ copy: STATIC_COPY_SCHEMA, visualV2: STATIC_VISUAL_V2_SCHEMA });
/** Uma moldura só (`{ frame }`): usado pelo script de teste src/dev/molduras-todas*.ts e pelo teto de tamanho. */
export const FRAME_DETAIL_SCHEMA = obj({ frame: FRAME_SCHEMA });
/** Todas as molduras do lote numa chamada: `piece` = número da peça no plano (1-based) + os campos planos do FRAME_SCHEMA. */
export const FRAMES_DETAIL_SCHEMA = obj({
  frames: {
    type: 'array',
    description: 'One entry per FRAME piece listed in the request, same order.',
    items: obj({ piece: { type: 'integer', description: 'The piece number given in the request.' }, ...(FRAME_SCHEMA.properties as Record<string, object>) }),
  },
});

const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const o = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Item cru do plano que precisa da 2ª etapa. `live` não tem texto: dispensa. */
export interface DetailTarget {
  index: number;
  kind: 'STATIC' | 'FRAME' | 'CHAT_DM' | 'PERSON_MOTION';
  whyKey: string; change: string; rationale: string;
  concept: string; emotion: StaticEmotion | null; template: FrameTemplateId | null;
}

export function detailTargets(root: Record<string, unknown>, allowedFrames: FrameTemplateId[]): DetailTarget[] {
  const items = Array.isArray(root.items) ? root.items.map(o) : [];
  const out: DetailTarget[] = [];
  items.forEach((it, index) => {
    const type = s(it.type);
    const p = o(it.params);
    const base = { index, whyKey: s(it.whyKey), change: s(it.change), rationale: s(it.rationale) };
    if (type === 'STATIC') {
      out.push({ ...base, kind: 'STATIC', concept: s(p.concept), emotion: STATIC_EMOTIONS.find((e) => e === s(p.emotion)) ?? null, template: null });
    } else if (type === 'FRAME') {
      const template = FRAME_TEMPLATES.find((t) => t === s(p.template)) ?? null;
      if (template && template !== 'live' && allowedFrames.includes(template)) out.push({ ...base, kind: 'FRAME', concept: '', emotion: null, template });
    } else if (type === 'CHAT_DM' || type === 'PERSON_MOTION') {
      // iterate-v2 F1.2: o roteiro do template sai na 2ª etapa (1 chamada por template)
      out.push({ ...base, kind: type, concept: '', emotion: null, template: null });
    }
  });
  return out;
}

const whyLine = (whys: Record<string, string>, key: string) => (whys[key] ? ` ("${whys[key]}")` : '');

export function staticDetailMessage(t: DetailTarget, ctx: { screenLanguage: string; whys: Record<string, string>; others: DetailTarget[]; violations?: string[]; refImages: number }): string {
  const lines = [
    'Second step of this plan: write the on-screen texts and the visual concept of ONE STATIC piece, following "STATIC assembled ads" and "Nothing invented, block by block".',
    `Screen language for every on-screen text: ${ctx.screenLanguage}. visualV2 in English.`,
    `The piece attacks the ${t.whyKey} line${whyLine(ctx.whys, t.whyKey)}. Change: "${t.change}". Rationale: "${t.rationale}".`,
    `Concept chosen in the plan: ${t.concept || '(none given)'}. Hero emotion: ${t.emotion ?? 'pick the one the rules give for this why line'}.`,
  ];
  if (ctx.others.length) lines.push(`Other STATIC pieces in this batch (use a different headline and a different emotion):\n${ctx.others.map((x) => `- ${x.concept || x.change} (emotion ${x.emotion ?? 'n/a'})`).join('\n')}`);
  if (ctx.refImages > 0) lines.push(`The ${ctx.refImages} images attached right before this request are key frames of the champion: REFERENCE only.`);
  if (ctx.violations?.length) lines.push(`A previous plan broke these rules; make this piece respect every one that applies:\n${ctx.violations.map((v) => `- ${v}`).join('\n')}`);
  lines.push('Return copy and visualV2.');
  return lines.join('\n\n');
}

const RANKING_NOTE = 'ranking: every item needs its own sources entry ("items.0", "items.1", …) with pains, what, promise or proof. No item without a source.';
const WIDTH_NOTE = 'Limits are in visible width: a full-width character (Chinese, Japanese, Korean, full-width punctuation) counts as 2.';

/** Uma moldura só (script de teste src/dev/molduras-todas*.ts; o plano usa `framesDetailMessage`). */
export function frameDetailMessage(t: DetailTarget, ctx: { screenLanguage: string; whys: Record<string, string>; others: DetailTarget[]; violations?: string[] }): string {
  const lines = [
    `Second step of this plan: write the on-screen texts of ONE FRAME piece, template ${t.template}, following "FRAME (video frames)": fill only the fields of ${t.template}, each with its source in "sources"; empty strings and empty lists for every other field.`,
    `Screen language: ${ctx.screenLanguage}. ${WIDTH_NOTE}`,
    `The piece attacks the ${t.whyKey} line${whyLine(ctx.whys, t.whyKey)}. Change: "${t.change}". Rationale: "${t.rationale}".`,
  ];
  if (t.template === 'ranking') lines.push(RANKING_NOTE);
  if (ctx.others.length) lines.push(`Other FRAME pieces of this batch use templates ${ctx.others.map((x) => x.template).join(', ')}: do not repeat their texts.`);
  if (ctx.violations?.length) lines.push(`A previous plan broke these rules; make this piece respect every one that applies:\n${ctx.violations.map((v) => `- ${v}`).join('\n')}`);
  lines.push('Return frame.');
  return lines.join('\n\n');
}

/** Pedido único com todas as molduras do lote (cada uma com o número da peça). */
export function framesDetailMessage(ts: DetailTarget[], ctx: { screenLanguage: string; whys: Record<string, string>; violations?: string[] }): string {
  const lines = [
    'Second step of this plan: write the on-screen texts of the FRAME pieces below, following "FRAME (video frames)". For each piece fill only the fields of its template, each text with its own entry in "sources"; empty strings and empty lists for every other field. Different pieces never repeat the same text.',
    `Screen language: ${ctx.screenLanguage}. ${WIDTH_NOTE}`,
    `<frames_to_write>\n${ts.map((t) => `piece ${t.index + 1}: template ${t.template}; attacks the ${t.whyKey} line${whyLine(ctx.whys, t.whyKey)}; change "${t.change}"`).join('\n')}\n</frames_to_write>`,
  ];
  if (ts.some((t) => t.template === 'ranking')) lines.push(RANKING_NOTE);
  if (ts.some((t) => t.template === 'call')) lines.push('call: every slide step needs its own sources entry ("slideSteps.0", …) with what or promise.');
  if (ctx.violations?.length) lines.push(`A previous plan broke these rules; make these pieces respect every one that applies:\n${ctx.violations.map((v) => `- ${v}`).join('\n')}`);
  lines.push('Return frames, one entry per piece above.');
  return lines.join('\n\n');
}

/** Resposta do pedido de molduras → detalhe por índice de item (`{ frame }`), pelo número da peça. */
export function framesByIndex(detail: Record<string, unknown> | null, ts: DetailTarget[]): Map<number, Record<string, unknown>> {
  const out = new Map<number, Record<string, unknown>>();
  const list = detail && Array.isArray(detail.frames) ? detail.frames.map(o) : [];
  for (const f of list) {
    const n = typeof f.piece === 'number' ? f.piece - 1 : -1;
    if (ts.some((t) => t.index === n) && !out.has(n)) {
      const { piece: _p, ...frame } = f;
      out.set(n, { frame });
    }
  }
  return out;
}

/** Encaixa a 2ª etapa nos itens crus; alvo sem detalhe (falhou) sai do plano. Devolve o JSON pronto pro parseAutoPlan. */
export function mergeDetails(root: Record<string, unknown>, targets: DetailTarget[], details: Map<number, Record<string, unknown>>): string {
  const items: Record<string, unknown>[] = Array.isArray(root.items) ? root.items.map((x) => ({ ...o(x), params: { ...o(o(x).params) } })) : [];
  const drop = new Set<number>();
  for (const t of targets) {
    const d = details.get(t.index);
    if (!d) {
      drop.add(t.index);
      continue;
    }
    const p = items[t.index].params as Record<string, unknown>;
    if (t.kind === 'STATIC') {
      p.copy = d.copy;
      p.visualV2 = d.visualV2;
    } else if (t.kind === 'CHAT_DM' || t.kind === 'PERSON_MOTION') {
      p.template = d.template;
    } else {
      p.frame = d.frame;
    }
  }
  return JSON.stringify({ ...root, items: items.filter((_, k) => !drop.has(k)) });
}
