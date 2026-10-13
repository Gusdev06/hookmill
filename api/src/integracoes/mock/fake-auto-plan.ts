// Mock determinístico do planAutoBatch (variacao-auto-v1.md §7.1 e §10). Monta o plano a partir do teardown e do
// Brain, respeitando `allowed`, a contagem e a diversidade, sem inventar número (textos saem do Brain/transcrição).
// Gatilhos nas notes da OFERTA:
//   [mock:auto-fail:planning]  → PROVIDER_ERROR (o Claude "falhou 2x"; o backend vai pra ANALYSIS_FAILED).
//   [mock:auto-plan-invalid]   → as duas chamadas (com ou sem `violations`) devolvem um plano que viola as regras e que
//                                nem o reparo determinístico salva (só HOOK_TEXT, com número inventado) → PLAN_INVALID.
//   [mock:page-403]            → nunca planeja SPLIT_LP (a captura falhou), mesmo se vier em `allowed`.
//   [mock:auto-fail:reading]   → mora no analyzeChampion do FakeClaudeService (falha na leitura).
import type { AutoItemDraft, AutoParamsDraft, AutoPlanDraft, AutoPlanInput, AutoVariationType, BlockFn, BrainField, WhyDraft } from '../contrato';
import { IntegracaoError } from '../erros';
import { AUTO_LIMITS, brainFieldsFilled, clip } from '../claude/auto-plano';

type Lang = 'en' | 'pt';
const DIVERSITY: AutoVariationType[] = ['SPLIT_LP', 'STORY', 'REVIEW', 'STATIC', 'NATIVE_SEARCH'];
const ITERATION: AutoVariationType[] = ['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD'];
const r2 = (n: number) => Math.round(n * 100) / 100;

const UI = {
  EN: {
    hookWhy: 'The opening names the pain in the first seconds.', proofWhy: 'Proof shows up before the ask.', ctaWhy: 'One clear action at the end.',
    fromVideo: 'From the video', keptHook: 'Spoken hook', keptProof: 'Proof moment', keptCta: 'Closing CTA', keptVoice: 'Original voice',
    change: {
      CUT: 'Cut to {n} s, whole blocks', COLD_OPEN: 'Opens on a teaser from {t} s', HOOK_TEXT: 'New written hook: "{x}"', ENDCARD: 'End card ({v}) added',
      SPLIT_LP: 'Landing page on top, video below', STORY: 'Framed as a story', REVIEW: 'Review card above the video', NATIVE_SEARCH: 'Opens on a search for "{x}"', STATIC: 'Still frame at {t} s with headline',
    },
    rationale: { hook: 'Attacks the hook: a new first impression for the same pitch.', proof: 'Attacks the proof: shows it earlier or in a new frame.', cta: 'Attacks the CTA: makes the ask clearer.' },
  },
  PT_BR: {
    hookWhy: 'A abertura nomeia a dor nos primeiros segundos.', proofWhy: 'A prova aparece antes do pedido.', ctaWhy: 'Uma ação clara no final.',
    fromVideo: 'Do vídeo', keptHook: 'Gancho falado', keptProof: 'Momento da prova', keptCta: 'CTA final', keptVoice: 'Voz original',
    change: {
      CUT: 'Corte de {n} s, blocos inteiros', COLD_OPEN: 'Abre com teaser de {t} s', HOOK_TEXT: 'Gancho escrito novo: "{x}"', ENDCARD: 'End card ({v}) no fim',
      SPLIT_LP: 'Página em cima, vídeo embaixo', STORY: 'Enquadrado como story', REVIEW: 'Card de review em cima do vídeo', NATIVE_SEARCH: 'Abre numa busca por "{x}"', STATIC: 'Frame parado em {t} s com headline',
    },
    rationale: { hook: 'Ataca o gancho: primeira impressão nova pro mesmo discurso.', proof: 'Ataca a prova: mostra antes ou num quadro novo.', cta: 'Ataca o CTA: deixa o pedido mais claro.' },
  },
} as const;

const SCREEN = {
  en: { hookPrefix: ['', 'Real talk: ', 'Watch this: '], cta: 'Learn more', search: 'how to ' },
  pt: { hookPrefix: ['', 'Papo reto: ', 'Olha isso: '], cta: 'Saiba mais', search: 'como ' },
} as const;

function fnOf(fn: string): BlockFn {
  const f = fn.toLowerCase();
  if (f === 'hook') return 'hook';
  if (f === 'pain' || f === 'story' || f === 'problem' || f === 'objection') return 'problem';
  if (f === 'mechanism' || f === 'demo') return 'mechanism';
  if (f === 'proof') return 'proof';
  if (f === 'cta' || f === 'offer') return 'cta';
  return 'other';
}

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w)\}/g, (_, k) => v[k] ?? '');
/** Sem dígito nenhum: o mock nunca põe número na tela (regra "nada inventado"). */
const noDigits = (x: string) => x.replace(/[0-9]+[%.,]?[0-9]*/g, '').replace(/\s+/g, ' ').trim();

export function mockAutoPlan(i: AutoPlanInput): AutoPlanDraft {
  const notes = i.offer.notes ?? '';
  if (notes.includes('[mock:auto-fail:planning]')) throw new IntegracaoError('PROVIDER_ERROR', 'mock auto plan failure');
  const ui = UI[i.uiLocale];
  const lang: Lang = i.screenLanguage.toLowerCase().startsWith('pt') ? 'pt' : 'en';
  const scr = SCREEN[lang];
  const t = i.teardown;
  const tb = t.structure.status === 'ok' && t.structure.data ? t.structure.data.blocks : [];
  const blocks = tb.map((b, index) => ({ index, fn: index === 0 ? ('hook' as BlockFn) : fnOf(b.function) }));
  const brain = brainFieldsFilled(i.offer, i.page.captured);
  const dur = i.media.durationSec;
  const hookSpoken = t.hook.status === 'ok' && t.hook.data ? t.hook.data.spoken : i.transcript.slice(0, 8).map((w) => w.word).join(' ');

  const whyOf = (text: string, field: BrainField | null): WhyDraft =>
    field && brain.has(field)
      ? { text, source: 'brain', brainField: field, ref: clip(((field === 'page' ? i.page.text : i.offer[field as Exclude<BrainField, 'page'>]) ?? '').trim(), AUTO_LIMITS.whyRef) }
      : { text, source: 'video', brainField: null, ref: ui.fromVideo };
  const why = {
    hook: whyOf(ui.hookWhy, brain.has('pains') ? 'pains' : 'audience'),
    proof: whyOf(ui.proofWhy, 'proof'),
    cta: whyOf(ui.ctaWhy, brain.has('offerAndPrice') ? 'offerAndPrice' : 'cta'),
  };

  const proofIdx = blocks.find((b) => b.fn === 'proof')?.index ?? null;
  const ctaIdx = [...blocks].reverse().find((b) => b.fn === 'cta')?.index ?? null;
  const kept: AutoPlanDraft['kept'] = [{ label: ui.keptHook, blockIndex: blocks.length ? 0 : null }];
  if (proofIdx != null) kept.push({ label: ui.keptProof, blockIndex: proofIdx });
  if (ctaIdx != null) kept.push({ label: ui.keptCta, blockIndex: ctaIdx });
  if (kept.length < 2) kept.push({ label: ui.keptVoice, blockIndex: null });

  // [mock:auto-plan-invalid]: só HOOK_TEXT, com número inventado e zero diversidade (as duas chamadas)
  if (notes.includes('[mock:auto-plan-invalid]')) {
    const items: AutoItemDraft[] = Array.from({ length: 12 }, (_, k) => ({
      type: 'HOOK_TEXT', change: fill(ui.change.HOOK_TEXT, { x: `${97 - k}%` }), rationale: ui.rationale.hook, whyKey: 'hook',
      params: { type: 'HOOK_TEXT', text: `${97 - k}% ${lang === 'pt' ? 'em 3 dias' : 'in 3 days'}` },
    }));
    return { blocks, why, kept, items };
  }

  const max = new Map(i.allowed.map((a) => [a.type, a.max]));
  if (notes.includes('[mock:page-403]') || !i.page.captured) max.delete('SPLIT_LP');
  const used = new Map<AutoVariationType, number>();
  const can = (ty: AutoVariationType) => (used.get(ty) ?? 0) < (max.get(ty) ?? 0);
  const order: AutoVariationType[] = [];
  const target = Math.min(i.rules.max, Math.max(i.rules.min, 10));
  // 1ª passada: um de cada tipo (diversidade primeiro); depois repetições na mesma ordem até o alvo
  for (let pass = 0; pass < 3 && order.length < target; pass++) {
    for (const ty of [...DIVERSITY, ...ITERATION]) {
      if (order.length >= target) break;
      if (can(ty)) {
        order.push(ty);
        used.set(ty, (used.get(ty) ?? 0) + 1);
      }
    }
  }
  // diversidade ≥ minDiversityPct: tira ITERATION do fim enquanto faltar e sobrar acima do mínimo
  const divCount = () => order.filter((ty) => DIVERSITY.includes(ty)).length;
  while (order.length > i.rules.min && divCount() < Math.ceil((order.length * i.rules.minDiversityPct) / 100)) {
    const last = order.map((ty, k) => [ty, k] as const).reverse().find(([ty]) => ITERATION.includes(ty));
    if (!last) break;
    order.splice(last[1], 1);
  }
  // tipos em ordem estável do plano: o mock agrupa por tipo (ITERATION primeiro, como a tela)
  const plan = [...ITERATION, ...DIVERSITY].flatMap((ty) => order.filter((x) => x === ty));

  const nth = new Map<AutoVariationType, number>();
  const promise = noDigits(i.offer.promise ?? '') || noDigits(hookSpoken);
  const items = plan.map((type): AutoItemDraft => {
    const k = nth.get(type) ?? 0;
    nth.set(type, k + 1);
    const params = paramsFor(type, k);
    const v: Record<string, string> = {};
    if (params.type === 'CUT') v.n = String(params.targetSec);
    if (params.type === 'COLD_OPEN') v.t = String(params.teaserStartSec);
    if (params.type === 'STATIC') v.t = String(params.atSec);
    if (params.type === 'HOOK_TEXT') v.x = clip(params.text, 40);
    if (params.type === 'NATIVE_SEARCH') v.x = clip(params.query, 40);
    if (params.type === 'ENDCARD') v.v = params.variant;
    const whyKey = type === 'ENDCARD' ? 'cta' : type === 'REVIEW' || type === 'COLD_OPEN' || type === 'STATIC' ? 'proof' : 'hook';
    return { type, change: clip(fill(ui.change[type], v), AUTO_LIMITS.change), rationale: ui.rationale[whyKey], whyKey, params };
  });
  return { blocks, why, kept, items };

  function paramsFor(type: AutoVariationType, k: number): AutoParamsDraft {
    switch (type) {
      case 'CUT': {
        const targetSec = k === 0 ? 15 : 20;
        const must = [...new Set([0, ...kept.map((x) => x.blockIndex).filter((x): x is number => x != null)])].filter((x) => x < tb.length);
        const idx = new Set(must);
        let total = must.reduce((acc, b) => acc + (tb[b].endSec - tb[b].startSec), 0);
        for (let b = 0; b < tb.length; b++) {
          const len = tb[b].endSec - tb[b].startSec;
          if (!idx.has(b) && total + len <= targetSec) {
            idx.add(b);
            total += len;
          }
        }
        return { type, targetSec, blockIndexes: [...idx].sort((x, y) => x - y) };
      }
      case 'COLD_OPEN': {
        const from = proofIdx != null ? tb[proofIdx] : null;
        const start = r2(Math.max(5, from ? from.startSec : dur * 0.6));
        const end = r2(Math.min(start + 2.5, from ? Math.max(from.endSec, start + 1.5) : dur, dur));
        return { type, teaserStartSec: start, teaserEndSec: end };
      }
      case 'HOOK_TEXT':
        return { type, text: clip(`${scr.hookPrefix[k % scr.hookPrefix.length]}${promise}`, AUTO_LIMITS.hookText) };
      case 'ENDCARD': {
        const variant = brain.has('offerAndPrice') ? 'offer' : 'cta';
        const ctaSrc = noDigits(i.offer.cta ?? '') || noDigits(t.offerProofCta.data?.ctaSpoken ?? '') || scr.cta;
        return { type, variant, headline: clip(noDigits(i.offer.name), AUTO_LIMITS.endHeadline), subline: variant === 'offer' ? clip(noDigits(i.offer.offerAndPrice ?? ''), AUTO_LIMITS.endSubline) || null : null, ctaText: clip(ctaSrc, AUTO_LIMITS.endCta) };
      }
      case 'REVIEW': {
        // 1ª frase do proof, literal (substring exata)
        const proof = (i.offer.proof ?? '').trim();
        const m = proof.match(/^[^.!?\n]+[.!?]?/);
        return { type, quote: (m ? m[0] : proof).trim(), author: null, stars: null };
      }
      case 'NATIVE_SEARCH': {
        const words = noDigits(hookSpoken).split(' ').filter((w) => w && w.toLowerCase() !== i.offer.name.toLowerCase()).slice(0, 6 + k);
        return { type, query: clip(`${scr.search}${words.join(' ').toLowerCase().replace(/[.!?,]+$/, '')}`, AUTO_LIMITS.query) };
      }
      case 'STATIC': {
        const at = proofIdx != null ? (tb[proofIdx].startSec + tb[proofIdx].endSec) / 2 : dur / 2;
        return { type, atSec: r2(Math.min(dur, at + k * 2)), headline: clip(promise, AUTO_LIMITS.staticHeadline) };
      }
      case 'SPLIT_LP':
        return { type: 'SPLIT_LP' };
      case 'STORY':
        return { type: 'STORY' };
    }
  }
}
