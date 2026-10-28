// Validação do JSON que o Claude devolve. A saída estruturada já garante a FORMA; aqui ficam as regras
// que o schema não expressa (tempos, primeiro bloco = gancho, textos vazios) e a normalização final.
import type { BriefField, OfferBriefDraft, PageRole, ResultType, ScriptBlockDraft, ScriptDraft } from '../contrato';
import { IntegracaoError } from '../erros';

function parseJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* cai no erro abaixo */
  }
  throw new IntegracaoError('PROVIDER_ERROR', 'claude returned invalid JSON');
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** pt → pt-BR (o produto é brasileiro na origem); o resto passa como veio se parecer BCP 47. */
export function normalizeLanguage(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().replace('_', '-') : '';
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(s)) return 'en';
  const [lang, ...rest] = s.split('-');
  const l = lang.toLowerCase();
  if (l === 'pt' && !rest.length) return 'pt-BR';
  return [l, ...rest.map((r) => (r.length === 2 ? r.toUpperCase() : r))].join('-');
}

export function parseBrief(text: string): OfferBriefDraft {
  return parseBriefFull(text).brief;
}

export interface BriefSource { role: PageRole; imageIndex?: number }
export interface ParsedBrief {
  brief: OfferBriefDraft;
  /** §5: de onde saiu cada campo preenchido (papel da página e, se veio de imagem, o nº dela) */
  sources: Partial<Record<BriefField, BriefSource[]>>;
  /** §5: o que o modelo viu em cada imagem (≤ 40 palavras) */
  imageNotes: { index: number; text: string }[];
  /** resultado-v1 (A2/A3): ramo, mercado e resultado sugeridos; null = o modelo não soube */
  business: BusinessGuess;
}
export interface BusinessGuess { industry: string | null; market: string | null; resultType: ResultType | null }
const RESULT_GUESSES = new Set<string>(['PURCHASE', 'LEAD', 'MESSAGE', 'APPOINTMENT', 'SIGNUP', 'SUBSCRIPTION', 'APP_INSTALL', 'OTHER']);
/** Texto curto ou null: corta em `max` e descarta "unknown"/"n/a". */
function shortText(v: unknown, max: number): string | null {
  const t = str(v);
  if (!t || /^(?:unknown|n\/a|none|null|-)$/i.test(t)) return null;
  return t.slice(0, max);
}

const ROLES = new Set<string>(['main', 'checkout', 'pricing', 'about', 'faq', 'testimonials', 'terms', 'thankyou', 'other', 'quiz_step', 'offer']);
const FIELDS: BriefField[] = ['name', 'kind', 'what', 'audience', 'promise', 'pains', 'proof', 'offerAndPrice', 'cta', 'notes'];

/** Briefing + sources + imageNotes. Tolerante: sources/imageNotes ausentes ou fora do formato viram vazios. */
export function parseBriefFull(text: string): ParsedBrief {
  const o = parseJson(text);
  const brief = briefOf(o);
  const sources: ParsedBrief['sources'] = {};
  const rawSources = o.sources && typeof o.sources === 'object' ? (o.sources as Record<string, unknown>) : {};
  for (const f of FIELDS) {
    const list = Array.isArray(rawSources[f]) ? (rawSources[f] as unknown[]) : [];
    const out: BriefSource[] = [];
    for (const s of list) {
      if (!s || typeof s !== 'object') continue;
      const { role, imageIndex } = s as { role?: unknown; imageIndex?: unknown };
      if (typeof role !== 'string' || !ROLES.has(role)) continue;
      const idx = typeof imageIndex === 'number' && Number.isInteger(imageIndex) && imageIndex > 0 ? imageIndex : undefined;
      if (!out.some((x) => x.role === role && x.imageIndex === idx)) out.push(idx ? { role: role as PageRole, imageIndex: idx } : { role: role as PageRole });
    }
    if (out.length && brief[f] != null) sources[f] = out;
  }
  const imageNotes: ParsedBrief['imageNotes'] = [];
  for (const n of Array.isArray(o.imageNotes) ? (o.imageNotes as unknown[]) : []) {
    if (!n || typeof n !== 'object') continue;
    const { index, text: t } = n as { index?: unknown; text?: unknown };
    if (typeof index === 'number' && Number.isInteger(index) && index > 0 && typeof t === 'string' && t.trim()) imageNotes.push({ index, text: t.trim().split(/\s+/).slice(0, 60).join(' ') });
  }
  const business: BusinessGuess = {
    industry: shortText(o.industry, 80),
    market: shortText(o.market, 80),
    resultType: typeof o.resultType === 'string' && RESULT_GUESSES.has(o.resultType) ? (o.resultType as ResultType) : null,
  };
  return { brief, sources, imageNotes, business };
}

function briefOf(o: Record<string, unknown>): OfferBriefDraft {
  const name = str(o.name);
  if (!name) throw new IntegracaoError('PAGE_UNREADABLE', 'no offer found on the page');
  return {
    name: name.slice(0, 120),
    language: normalizeLanguage(o.language),
    kind: str(o.kind),
    what: str(o.what),
    audience: str(o.audience),
    promise: str(o.promise),
    pains: str(o.pains),
    proof: str(o.proof),
    offerAndPrice: str(o.offerAndPrice),
    cta: str(o.cta),
    notes: str(o.notes),
  };
}

export const SCRIPT_LIMITS = { minTotalSec: 10, maxTotalSec: 90, minBlockSec: 1, maxBlockSec: 30 };

/** Converte {label, durationSec} em blocos com início/fim contínuos a partir de 0. */
export function parseScript(text: string): ScriptDraft {
  const o = parseJson(text);
  const angle = str(o.angle);
  const rationale = str(o.rationale);
  const raw = Array.isArray(o.blocks) ? (o.blocks as Record<string, unknown>[]) : [];
  if (!angle || !rationale || raw.length < 2) throw new IntegracaoError('INVALID_SCRIPT', 'script missing angle, rationale or blocks');

  let at = 0;
  const blocks: ScriptBlockDraft[] = raw.map((b, i) => {
    const d = Math.round(Number(b.durationSec));
    const speech = str(b.speech);
    const visual = str(b.visualPrompt);
    if (!Number.isFinite(d) || d < SCRIPT_LIMITS.minBlockSec || d > SCRIPT_LIMITS.maxBlockSec) throw new IntegracaoError('INVALID_SCRIPT', `block ${i} has duration ${b.durationSec}`);
    if (!speech) throw new IntegracaoError('INVALID_SCRIPT', `block ${i} has no speech`);
    const label = i === 0 ? 'hook' : (str(b.label) ?? 'block');
    const visualPrompt = visual ? (/^solo shot/i.test(visual) ? visual : `SOLO SHOT, ${visual}`) : 'SOLO SHOT, medium close-up, the same person talks to the camera, natural light';
    const block = { label, startSec: at, endSec: at + d, speech, visualPrompt };
    at += d;
    return block;
  });
  if (at < SCRIPT_LIMITS.minTotalSec || at > SCRIPT_LIMITS.maxTotalSec) throw new IntegracaoError('INVALID_SCRIPT', `script lasts ${at}s`);
  return { angle: angle.slice(0, 80), rationale, durationSec: at, blocks };
}

export function parseFace(text: string): string {
  const o = parseJson(text);
  const d = str(o.description);
  if (!d || d.length < 10) throw new IntegracaoError('PROVIDER_ERROR', 'empty face description');
  return d.slice(0, 600); // limite do POST /faces/generate (10-600)
}
