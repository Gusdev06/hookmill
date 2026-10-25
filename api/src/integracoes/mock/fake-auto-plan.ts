// Mock determinístico do planAutoBatch (variacao-auto-v1.md §7.1 e §10). Monta o plano a partir do teardown e do
// Brain, respeitando `allowed`, a contagem e a diversidade, sem inventar número (textos saem do Brain/transcrição).
// Gatilhos nas notes da OFERTA:
//   [mock:auto-fail:planning]  → PROVIDER_ERROR (o Claude "falhou 2x"; o backend vai pra ANALYSIS_FAILED).
//   [mock:auto-plan-invalid]   → as duas chamadas (com ou sem `violations`) devolvem um plano que viola as regras e que
//                                nem o reparo determinístico salva (só HOOK_TEXT, com número inventado) → PLAN_INVALID.
//   [mock:page-403]            → nunca planeja SPLIT_LP (a captura falhou), mesmo se vier em `allowed`.
//   [mock:auto-fail:reading]   → mora no analyzeChampion do FakeClaudeService (falha na leitura).
// STATIC (25/10, estatico-montado §A2/§A9): anúncio montado V2. Cada texto de tela sai de um campo do Brain (ou da fala),
// com a fonte; bloco sem dado no Brain do fixture é OMITIDO (null/[]), nunca preenchido com frase genérica de promessa.
// 2 conceitos visuais fixos em inglês (emoções diferentes: relief e pride, a peça ataca a prova), refAtSec = frame-chave
// mais perto da prova. Os campos legados `headline` (lead + highlight) e `atSec` vão junto (TRANSIÇÃO do contrato).
// FRAME (25/10 §B2, B1-I): com FRAME em `allowed`, escolhe até 2 templates diferentes entre os permitidos (`allowedFrames`
// do backend, ou o padrão conservador), na ordem FRAME_PICK; textos do Brain/fala com a fonte de cada um.
import type {
  AutoFrameDraft, AutoItemDraft, AutoParamsDraft, AutoVariationTypeWithFrame, BlockFn, BrainField, CopySource, FrameTemplateId, OfferBriefDraft,
  StaticCopy, StaticVisualV2, WhyDraft,
} from '../contrato';
import { IntegracaoError } from '../erros';
import { AUTO_LIMITS, PLAN_TYPES, brainFieldsFilled, clip, type AutoItemDraftWithFrame, type AutoPlanDraftWithFrame } from '../claude/auto-plano';
import { STATIC_V2_LIMITS, staticCopyLength } from '../claude/auto-plano-estatico';
import { FRAME_LIMITS, FRAME_MAX_PER_BATCH, PRICE_RE, allowedFramesOf, cutWidth, frameTextPaths, type AutoPlanInputWithFrame } from '../claude/auto-plano-moldura';
type AutoVariationType = AutoVariationTypeWithFrame;

type Lang = 'en' | 'pt';
const DIVERSITY: AutoVariationType[] = ['SPLIT_LP', 'STORY', 'REVIEW', 'STATIC', 'FRAME', 'NATIVE_SEARCH'];
/** Ordem de escolha das molduras no mock (as 2 primeiras permitidas). */
export const FRAME_PICK: FrameTemplateId[] = [
  'news', 'question_box', 'pov_testimonial', 'meme', 'read_caption', 'direct_offer', 'cinema', 'story', 'post_card', 'ranking', 'call', 'live',
  'split_stack', 'split_torn', 'gossip_page', 'gossip_white', 'gossip_pink', 'call_dialog',
];
const ITERATION: AutoVariationType[] = ['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD'];
const r2 = (n: number) => Math.round(n * 100) / 100;

const UI = {
  EN: {
    hookWhy: 'The opening names the pain in the first seconds.', proofWhy: 'Proof shows up before the ask.', ctaWhy: 'One clear action at the end.',
    fromVideo: 'From the video', keptHook: 'Spoken hook', keptProof: 'Proof moment', keptCta: 'Closing CTA', keptVoice: 'Original voice',
    change: {
      CUT: 'Cut to {n} s, whole blocks', COLD_OPEN: 'Opens on a teaser from {t} s', HOOK_TEXT: 'New written hook: "{x}"', ENDCARD: 'End card ({v}) added',
      SPLIT_LP: 'Landing page on top, video below', STORY: 'Framed as a story', REVIEW: 'Review card above the video', NATIVE_SEARCH: 'Opens on a search for "{x}"', STATIC: 'Assembled ad: {x}', FRAME: 'Inside the {x} frame',
    },
    rationale: { hook: 'Attacks the hook: a new first impression for the same pitch.', proof: 'Attacks the proof: shows it earlier or in a new frame.', cta: 'Attacks the CTA: makes the ask clearer.' },
  },
  PT_BR: {
    hookWhy: 'A abertura nomeia a dor nos primeiros segundos.', proofWhy: 'A prova aparece antes do pedido.', ctaWhy: 'Uma ação clara no final.',
    fromVideo: 'Do vídeo', keptHook: 'Gancho falado', keptProof: 'Momento da prova', keptCta: 'CTA final', keptVoice: 'Voz original',
    change: {
      CUT: 'Corte de {n} s, blocos inteiros', COLD_OPEN: 'Abre com teaser de {t} s', HOOK_TEXT: 'Gancho escrito novo: "{x}"', ENDCARD: 'End card ({v}) no fim',
      SPLIT_LP: 'Página em cima, vídeo embaixo', STORY: 'Enquadrado como story', REVIEW: 'Card de review em cima do vídeo', NATIVE_SEARCH: 'Abre numa busca por "{x}"', STATIC: 'Anúncio montado: {x}', FRAME: 'Dentro da moldura {x}',
    },
    rationale: { hook: 'Ataca o gancho: primeira impressão nova pro mesmo discurso.', proof: 'Ataca a prova: mostra antes ou num quadro novo.', cta: 'Ataca o CTA: deixa o pedido mais claro.' },
  },
} as const;

/** Conceitos visuais do STATIC V2 no mock: genéricos, sem pessoa identificável, marca, texto ou aspas; emoções diferentes. */
const STATIC_CONCEPTS: { label: { EN: string; PT_BR: string }; hero: NonNullable<StaticVisualV2['hero']>; mood: string }[] = [
  {
    label: { EN: 'relief, a person on the edge of the bed', PT_BR: 'alívio, pessoa na beira da cama' },
    hero: { person: 'A person in their forties in a plain grey knit sweater', setting: 'sitting on the edge of the bed in a dim bedroom, shoulders relaxed', emotion: 'relief', light: 'warm bedside lamp light from the left' },
    mood: 'intimate, hopeful, late evening',
  },
  {
    label: { EN: 'pride, a person at the kitchen table', PT_BR: 'orgulho, pessoa na mesa da cozinha' },
    hero: { person: 'A person in their thirties in a plain t-shirt', setting: 'sitting at a kitchen table at home in the morning, a mug and a plant beside them', emotion: 'pride', light: 'soft window light from the right, early morning' },
    mood: 'calm, confident, bright morning',
  },
];

const SCREEN = {
  en: { hookPrefix: ['', 'Real talk: ', 'Watch this: '], cta: 'Learn more', search: 'how to ', handwritten: 'Your turn now.', news: 'News', page: 'Daily Buzz', you: 'You', guest: 'Guest' },
  pt: { hookPrefix: ['', 'Papo reto: ', 'Olha isso: '], cta: 'Saiba mais', search: 'como ', handwritten: 'Agora é sua vez.', news: 'Novidade', page: 'Fala Geral', you: 'Você', guest: 'Convidado' },
} as const;

const firstSentence = (x: string | null | undefined) => ((x ?? '').trim().match(/^[^.!?\n]+[.!?]?/) ?? [''])[0].trim();
const unquote = (x: string) => x.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
/** lead + highlight: as últimas 3 palavras (≤ 22) viram o destaque. */
function splitHeadline(t: string): { lead: string; highlight: string } | null {
  const w = t.replace(/[.!?]+$/, '').split(' ').filter(Boolean);
  if (w.length < 3) return null;
  let k = Math.max(1, w.length - 3);
  while (k < w.length - 1 && w.slice(k).join(' ').length > STATIC_V2_LIMITS.highlight) k++;
  const lead = clip(w.slice(0, k).join(' '), STATIC_V2_LIMITS.lead);
  const highlight = clip(w.slice(k).join(' '), STATIC_V2_LIMITS.highlight);
  return lead && highlight ? { lead, highlight } : null;
}
/** Produto pelo `kind` do Brain (dado, não nicho embutido). */
function productKindOf(offer: OfferBriefDraft): StaticVisualV2['product']['kind'] {
  const k = `${offer.kind ?? ''} ${offer.what ?? ''}`.toLowerCase();
  if (/\b(app|aplicativo|software|saas|plataforma|platform|curso|course|online|digital|ebook|e-book)\b/.test(k)) return 'phone_screen';
  if (/\b(produto f[íi]sico|physical|suplemento|supplement|cosm[ée]tico|device|aparelho)\b/.test(k)) return 'physical_product';
  return 'none';
}

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

export function mockAutoPlan(i: AutoPlanInputWithFrame): AutoPlanDraftWithFrame {
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
  const kept: AutoPlanDraftWithFrame['kept'] = [{ label: ui.keptHook, blockIndex: blocks.length ? 0 : null }];
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
  // 25/10 (decisão do Gusta): lote novo só com CUT, REVIEW, NATIVE_SEARCH, STATIC e FRAME (até 8, templates diferentes)
  for (const ty of [...max.keys()]) if (!PLAN_TYPES.includes(ty)) max.delete(ty);
  const frames = FRAME_PICK.filter((f) => allowedFramesOf(i).includes(f));
  if (max.has('FRAME')) max.set('FRAME', Math.min(max.get('FRAME') ?? 0, FRAME_MAX_PER_BATCH, frames.length));
  const used = new Map<AutoVariationType, number>();
  const can = (ty: AutoVariationType) => (used.get(ty) ?? 0) < (max.get(ty) ?? 0);
  const order: AutoVariationType[] = [];
  const target = Math.min(i.rules.max, Math.max(i.rules.min, 10));
  // 1ª passada: um de cada tipo (diversidade primeiro); depois repetições na mesma ordem até o alvo
  for (let pass = 0; pass < 10 && order.length < target; pass++) {
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
  const items = plan.map((type): AutoItemDraftWithFrame => {
    const k = nth.get(type) ?? 0;
    nth.set(type, k + 1);
    if (type === 'FRAME') {
      const params = frameFor(frames[k]);
      return { type, change: clip(fill(ui.change.FRAME, { x: params.template }), AUTO_LIMITS.change), rationale: ui.rationale.hook, whyKey: 'hook', params };
    }
    const params = paramsFor(type, k);
    const v: Record<string, string> = {};
    if (params.type === 'CUT') v.n = String(params.targetSec);
    if (params.type === 'COLD_OPEN') v.t = String(params.teaserStartSec);
    if (params.type === 'STATIC') v.x = STATIC_CONCEPTS[k % STATIC_CONCEPTS.length].label[i.uiLocale];
    // (FRAME já saiu acima)
    if (params.type === 'HOOK_TEXT') v.x = clip(params.text, 40);
    if (params.type === 'NATIVE_SEARCH') v.x = clip(params.query, 40);
    if (params.type === 'ENDCARD') v.v = params.variant;
    const whyKey = type === 'ENDCARD' ? 'cta' : type === 'REVIEW' || type === 'COLD_OPEN' || type === 'STATIC' ? 'proof' : 'hook';
    return { type, change: clip(fill(ui.change[type], v), AUTO_LIMITS.change), rationale: ui.rationale[whyKey], whyKey, params };
  });
  return { blocks, why, kept, items };

  function paramsFor(type: Exclude<AutoVariationType, 'FRAME'>, k: number): AutoParamsDraft {
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
        // referência: o frame-chave mais perto do momento da prova (ou do meio); sem frames = nenhuma
        const at = proofIdx != null ? (tb[proofIdx].startSec + tb[proofIdx].endSec) / 2 : dur / 2;
        const ref = [...i.keyframes].sort((a, b) => Math.abs(a.atSec - at) - Math.abs(b.atSec - at))[0];
        const refAtSec = ref ? r2(Math.min(dur, ref.atSec)) : null;
        const copy = staticCopyFor(k);
        const c = STATIC_CONCEPTS[k % STATIC_CONCEPTS.length];
        const kind = productKindOf(i.offer);
        const visualV2: StaticVisualV2 = {
          hero: { ...c.hero },
          product: {
            kind,
            look: kind === 'none' ? null : kind === 'physical_product' ? 'a simple package on a soft surface, no readable label' : 'dark mode interface with a progress ring and a few simple rows',
            screenTitle: kind === 'phone_screen' || kind === 'laptop_screen' ? clip(i.offer.name, STATIC_V2_LIMITS.screenTitle) : null,
            screenTitleSource: kind === 'phone_screen' || kind === 'laptop_screen' ? 'name' : null,
          },
          mood: c.mood,
        };
        return { type, atSec: refAtSec ?? 0, headline: `${copy.headline.lead} ${copy.headline.highlight}`, refAtSec, layout: 'assembled', copy, visualV2 };
      }
      case 'SPLIT_LP':
        return { type: 'SPLIT_LP' };
      case 'STORY':
        return { type: 'STORY' };
    }
  }

  /** Textos do STATIC só do Brain/fala, com a fonte; bloco sem dado = omitido. A 2ª peça usa a dor (headline diferente). */
  function staticCopyFor(k: number): StaticCopy {
    const L = STATIC_V2_LIMITS;
    const o = i.offer;
    const head = (k === 0 ? [['promise', o.promise], ['pains', o.pains]] : [['pains', o.pains], ['promise', o.promise]]) as [CopySource, string | null][];
    let headline: { lead: string; highlight: string } | null = null;
    let headlineSource: CopySource = 'transcript';
    for (const [src, txt] of [...head, ['transcript', hookSpoken] as [CopySource, string]]) {
      headline = splitHeadline(unquote(firstSentence(txt)));
      if (headline) { headlineSource = src; break; }
    }
    const brandLine = brain.has('what') ? clip(firstSentence(o.what), L.brandLine) || null : null;
    const subheadline = brain.has('what') ? clip(unquote(o.what!), L.subheadline) || null : null;
    // benefícios: 1 por campo preenchido (título = começo da frase, linha = o resto); < 3 campos = sem cards
    const fields = (['what', 'promise', 'pains', 'proof', 'offerAndPrice'] as const).filter((f) => brain.has(f));
    const icons = ['check', 'heart', 'target', 'star', 'gift'] as const;
    const benefits = fields.length >= L.benefitsMin
      ? fields.slice(0, L.benefitsMax).map((f, n) => {
        const sent = unquote(firstSentence(o[f]));
        const title = clip(sent, L.benefitTitle);
        const line = clip(sent.slice(title.length).trim() || sent, L.benefitLine);
        return { icon: icons[n], title, line, source: f as CopySource };
      })
      : [];
    const trustFields = (['proof', 'offerAndPrice', 'what'] as const).filter((f) => brain.has(f));
    const trust = trustFields.length === L.trustCount
      ? trustFields.map((f, n) => ({ icon: (['shield', 'money', 'check'] as const)[n], text: clip(unquote(firstSentence(o[f])), L.trust), source: f as CopySource }))
      : [];
    const ctaSub = brain.has('offerAndPrice') ? clip(unquote(firstSentence(o.offerAndPrice)), L.ctaSub) || null : null;
    const copy: StaticCopy = {
      brandLine, brandLineSource: brandLine ? 'what' : null,
      tagline: brain.has('pains') && k === 0 ? clip(unquote(firstSentence(o.pains)), L.tagline) || null : null,
      headline: headline ?? { lead: clip(noDigits(o.name), L.lead), highlight: '' }, headlineSource,
      subheadline, subheadlineSource: subheadline ? 'what' : null,
      handwritten: k === 0 ? scr.handwritten : null,
      benefits, trust,
      cta: { main: clip(unquote(o.cta ?? '') || scr.cta, L.ctaMain), sub: ctaSub, subSource: ctaSub ? 'offerAndPrice' : null },
      closing: null,
    };
    // soma ≤ 420: tira o opcional mais longo primeiro
    while (staticCopyLength(copy) > L.copyTotal) {
      if (copy.subheadline) { copy.subheadline = null; copy.subheadlineSource = null; } else if (copy.benefits.length > 3) copy.benefits = copy.benefits.slice(0, 3);
      else if (copy.trust.length) copy.trust = [];
      else if (copy.benefits.length) copy.benefits = [];
      else break;
    }
    return copy;
  }

  /** Moldura com textos do Brain/fala (fonte por caminho). */
  function frameFor(template: FrameTemplateId): AutoFrameDraft {
    const F = FRAME_LIMITS;
    const o = i.offer;
    const hook = unquote(hookSpoken);
    const promise = unquote(firstSentence(o.promise)) || hook;
    const promiseSrc: CopySource = brain.has('promise') ? 'promise' : 'transcript';
    const cta = cutWidth(unquote(o.cta ?? '') || scr.cta, F.cta);
    const ctaSrc: CopySource = brain.has('cta') ? 'cta' : 'generic';
    const sentences = (['what', 'promise', 'pains', 'proof'] as const).filter((f) => brain.has(f)).map((f) => [f, unquote(firstSentence(o[f]))] as const);
    const mk = <K extends FrameTemplateId>(t: K, texts: AutoFrameDraft['texts'], src: Record<string, CopySource>): AutoFrameDraft => {
      const paths = new Set(frameTextPaths(texts as Record<string, unknown>));
      return { type: 'FRAME', template: t, texts, sources: Object.fromEntries(Object.entries(src).filter(([p]) => paths.has(p))) } as AutoFrameDraft;
    };
    switch (template) {
      case 'question_box': return mk(template, { question: cutWidth(hook, F.question) }, { question: 'transcript' });
      case 'meme': return mk(template, { pov: cutWidth(unquote(firstSentence(o.pains)) || hook, F.meme_pov), cta }, { pov: brain.has('pains') ? 'pains' : 'transcript', cta: ctaSrc });
      case 'cinema': return mk(template, { question: cutWidth(hook, F.cinema_question), subtitle: cutWidth(promise, F.subtitle) }, { question: 'transcript', subtitle: promiseSrc });
      case 'news': {
        const h = splitHeadline(promise) ?? { lead: cutWidth(promise, F.lead), highlight: cutWidth(noDigits(o.name), F.highlight) };
        const topic = cutWidth(unquote(o.kind ?? '') || scr.news, F.topic);
        return mk(template, { topic, headline: { lead: cutWidth(h.lead, F.lead), highlight: cutWidth(h.highlight, F.highlight) }, dek: cutWidth(unquote(firstSentence(o.what)) || hook, F.dek), cta },
          { topic: o.kind ? 'kind' : 'generic', 'headline.lead': promiseSrc, 'headline.highlight': promiseSrc, dek: brain.has('what') ? 'what' : 'transcript', cta: ctaSrc });
      }
      case 'read_caption': return mk(template, { headline: cutWidth(promise, F.read_headline), primaryText: cutWidth(sentences.map(([, t]) => t).join(' ') || hook, F.primaryText) }, { headline: promiseSrc, primaryText: brain.has('what') ? 'what' : 'transcript' });
      case 'pov_testimonial': return mk(template, { pov: cutWidth(unquote(firstSentence(o.proof)) || hook, F.pov_testimonial), cta }, { pov: brain.has('proof') ? 'proof' : 'transcript', cta: ctaSrc });
      case 'direct_offer': {
        const prices = (o.offerAndPrice ?? '').match(new RegExp(PRICE_RE.source, 'gi')) ?? [];
        // o match pega símbolo + 1º dígito; o preço literal é o trecho do Brain até o fim do número
        const lit = (m: string) => { const at = (o.offerAndPrice ?? '').indexOf(m); return ((o.offerAndPrice ?? '').slice(at).match(/^\S*\s?[\d.,]+\d|^\S*\s?\d+/) ?? [m])[0].slice(0, F.price); };
        return mk(template, { promise: cutWidth(promise, F.promise), price: { from: prices.length >= 2 ? lit(prices[0]!) : null, to: lit(prices[prices.length - 1] ?? '') }, cta },
          { promise: promiseSrc, 'price.to': 'offerAndPrice', 'price.from': 'offerAndPrice', cta: ctaSrc });
      }
      case 'live': return mk(template, {}, {});
      case 'ranking': return mk(template, { title: cutWidth(promise, F.ranking_title), items: sentences.slice(0, F.ranking_max).map(([, t]) => cutWidth(t, F.ranking_item)) },
        { title: promiseSrc, ...Object.fromEntries(sentences.map(([f], n) => [`items.${n}`, f as CopySource])) });
      case 'post_card': return mk(template, { copy: cutWidth(hook, F.post_copy) }, { copy: 'transcript' });
      case 'story': return mk(template, { question: cutWidth(hook, F.story_question), headline: cutWidth(promise, F.story_headline), support: cutWidth(unquote(firstSentence(o.what)) || promise, F.story_support), copy: cutWidth(sentences.map(([, t]) => t).join(' ') || hook, F.story_copy) },
        { question: 'transcript', headline: promiseSrc, support: brain.has('what') ? 'what' : promiseSrc, copy: brain.has('what') ? 'what' : 'transcript' });
      case 'call': return mk(template, { title: cutWidth(noDigits(o.name), F.call_title), slideTitle: cutWidth(unquote(firstSentence(o.what)) || promise, F.slide_title), slideSteps: sentences.slice(0, 3).map(([, t]) => cutWidth(t, F.slide_step)) },
        { title: 'name', slideTitle: brain.has('what') ? 'what' : promiseSrc, ...Object.fromEntries(sentences.slice(0, 3).map(([f], n) => [`slideSteps.${n}`, f as CopySource])) });
      case 'split_stack': case 'split_torn': return mk(template, { headline: cutWidth(promise, F.split_headline) }, { headline: promiseSrc });
      case 'gossip_page': return mk(template, { headline: cutWidth(hook, F.gossip_headline), pageName: scr.page }, { headline: 'transcript', pageName: 'generic' });
      case 'gossip_white': case 'gossip_pink': return mk(template, { headline: cutWidth(hook, F.gossip_headline) }, { headline: 'transcript' });
      case 'call_dialog': return mk(template, { title: cutWidth(noDigits(o.name), F.call_title), names: [scr.you, scr.guest] }, { title: 'name', 'names.0': 'generic', 'names.1': 'generic' });
    }
  }
}
