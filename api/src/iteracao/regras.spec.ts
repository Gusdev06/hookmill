// Regras puras do plano AUTO (variacao-auto-v1 §6): cada linha do §6.1/§6.2, nada inventado, trocas e reparo.
import type { AutoItemDraft, AutoPlanDraft } from '../integracoes';
import { regrasDeMidiaFallback } from './portas';
import {
  AXIS_OF, type AllowedType, type PlanCtx, allowedFor, codeFor, codeLanguageOf, endcardVariants, finalizePlan, inventedNumbers,
  minDiversity, normalizeText, repairPlan, rulesFor, swapsFor, validatePlan, buildInsight, fallbackWhy,
} from './regras';

const words = Array.from({ length: 60 }, (_, i) => ({ word: i === 10 ? '30' : `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));

function ctx(over: Partial<PlanCtx> = {}): PlanCtx {
  return {
    lang: 'EN',
    durationSec: 30,
    blocks: [
      { index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 3 },
      { index: 1, label: 'Problem', fn: 'problem', startSec: 3, endSec: 10 },
      { index: 2, label: 'Mechanism', fn: 'body', startSec: 10, endSec: 18 },
      { index: 3, label: 'Proof', fn: 'proof', startSec: 18, endSec: 25 },
      { index: 4, label: 'CTA', fn: 'cta', startSec: 25, endSec: 30 },
    ],
    hasSpeech: true,
    words,
    silences: [],
    hasWrittenHook: false,
    hasEndCard: false,
    brain: {
      what: 'A sleep app', audience: 'Busy parents', pains: 'No time', promise: 'Sleep in 10 minutes',
      proof: '"I finally sleep through the night" - Ana, 5 stars. Money-back guarantee.', offerAndPrice: '7-day trial, then $9.99/month',
      cta: 'Download now', notes: null,
    },
    spokenCta: 'Download the app',
    pageCaptured: true,
    productPhoto: false,
    brandTerms: ['Sleepio', 'Acme Studio'],
    ...over,
  };
}

const allowedMap = (c: PlanCtx) => new Map(allowedFor(c).map((a) => [a.type, a]));

const item = (params: AutoItemDraft['params'], over: Partial<AutoItemDraft> = {}): AutoItemDraft =>
  ({ type: params.type, change: 'One thing changes', rationale: 'Attacks the hook', whyKey: 'hook', params, ...over });

/** Plano válido de 11 peças: 6 ITERATION + 5 DIVERSITY. */
function goodItems(): AutoItemDraft[] {
  return [
    item({ type: 'CUT', targetSec: 15, blockIndexes: [0, 3, 4] }),
    item({ type: 'COLD_OPEN', teaserStartSec: 19, teaserEndSec: 21.5 }),
    item({ type: 'HOOK_TEXT', text: 'Tired every morning?' }),
    item({ type: 'HOOK_TEXT', text: 'Sleep in 10 minutes' }),
    item({ type: 'ENDCARD', variant: 'price', headline: '$9.99/month', subline: '7-day trial', ctaText: 'Download now' }),
    item({ type: 'HOOK_TEXT', text: 'The 30 second trick' }),
    item({ type: 'SPLIT_LP' }),
    item({ type: 'STORY' }),
    item({ type: 'REVIEW', quote: 'I finally sleep through the night', author: 'Ana', stars: 5 }),
    item({ type: 'NATIVE_SEARCH', query: 'how to fall asleep fast' }),
    item({ type: 'STATIC', atSec: 20, headline: 'Sleep in 10 minutes' }),
  ];
}

function draft(items = goodItems(), over: Partial<AutoPlanDraft> = {}): AutoPlanDraft {
  return {
    blocks: [{ index: 0, fn: 'hook' }, { index: 1, fn: 'problem' }, { index: 2, fn: 'mechanism' }, { index: 3, fn: 'proof' }, { index: 4, fn: 'cta' }],
    why: {
      hook: { text: 'Names the pain in 2 seconds', source: 'brain', brainField: 'pains', ref: 'No time' },
      proof: { text: 'A real parent says it worked', source: 'brain', brainField: 'proof', ref: 'Ana' },
      cta: { text: 'Low-risk trial', source: 'brain', brainField: 'offerAndPrice', ref: '7-day trial' },
    },
    kept: [{ label: 'Spoken hook', blockIndex: 0 }, { label: 'Proof moment', blockIndex: 3 }],
    items,
    ...over,
  };
}

const rulesOf = (c: PlanCtx, d: AutoPlanDraft) => validatePlan(d, c, allowedFor(c)).map((v) => `${v.item}:${v.rule}`);

describe('codeFor (§6.1): a única tabela EN/PT', () => {
  it.each([
    ['CUT', 15, 1, 'CUT-15S', 'CORTE-15S'], ['CUT', 20, 2, 'CUT-20S', 'CORTE-20S'],
    ['COLD_OPEN', null, 1, 'COLD-OPEN', 'COLD-OPEN'],
    ['HOOK_TEXT', null, 1, 'HOOK-TEXT-2', 'GANCHO-TEXTO-2'], ['HOOK_TEXT', null, 2, 'HOOK-TEXT-3', 'GANCHO-TEXTO-3'], ['HOOK_TEXT', null, 3, 'HOOK-TEXT-4', 'GANCHO-TEXTO-4'],
    ['ENDCARD', 'offer', 1, 'ENDCARD-OFFER', 'ENDCARD-OFERTA'], ['ENDCARD', 'guarantee', 1, 'ENDCARD-GUARANTEE', 'ENDCARD-GARANTIA'],
    ['ENDCARD', 'price', 1, 'ENDCARD-PRICE', 'ENDCARD-PRECO'], ['ENDCARD', 'cta', 1, 'ENDCARD-CTA', 'ENDCARD-CTA'],
    ['SPLIT_LP', null, 1, 'LAYOUT-SPLIT-LP', 'LAYOUT-SPLIT-LP'], ['STORY', null, 1, 'LAYOUT-STORY', 'LAYOUT-STORY'], ['REVIEW', null, 1, 'LAYOUT-REVIEW', 'LAYOUT-REVIEW'],
    ['NATIVE_SEARCH', null, 1, 'NATIVE-SEARCH', 'NATIVO-BUSCA'], ['NATIVE_SEARCH', null, 2, 'NATIVE-SEARCH-2', 'NATIVO-BUSCA-2'],
    ['STATIC', null, 1, 'STATIC-F1', 'ESTATICO-F1'], ['STATIC', null, 2, 'STATIC-F2', 'ESTATICO-F2'],
  ] as const)('%s %s #%s → %s / %s', (type, variant, n, en, pt) => {
    expect(codeFor(type, variant, n, 'EN')).toBe(en);
    expect(codeFor(type, variant, n, 'PT')).toBe(pt);
  });

  it('idioma do código: oferta pt* = PT; qualquer outro = EN', () => {
    expect(codeLanguageOf('pt-BR')).toBe('PT');
    expect(codeLanguageOf('pt')).toBe('PT');
    expect(codeLanguageOf('PT-pt')).toBe('PT');
    expect(codeLanguageOf('en')).toBe('EN');
    expect(codeLanguageOf('es')).toBe('EN');
  });

  it('eixo fixo por tipo', () => {
    expect(Object.entries(AXIS_OF).filter(([, a]) => a === 'ITERATION').map(([t]) => t)).toEqual(['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD']);
  });
});

describe('allowed (§6.1 "entra quando" + D2)', () => {
  it('contexto completo: todos os 9, com os máximos da D2', () => {
    expect(allowedFor(ctx()).map((a) => [a.type, a.max])).toEqual([
      ['CUT', 2], ['COLD_OPEN', 1], ['HOOK_TEXT', 3], ['ENDCARD', 1], ['SPLIT_LP', 1], ['STORY', 1], ['REVIEW', 1], ['NATIVE_SEARCH', 2], ['STATIC', 2],
    ]);
    expect(rulesFor(allowedFor(ctx()))).toEqual({ min: 8, max: 12, minDiversityPct: 40 });
  });

  it('CUT: vídeo < 25 s ou < 4 blocos = fora (short_video)', () => {
    expect(allowedMap(ctx({ durationSec: 24 })).get('CUT')).toEqual({ type: 'CUT', max: 0, blockedReason: 'short_video' });
    expect(allowedMap(ctx({ blocks: ctx().blocks.slice(0, 3) })).get('CUT')!.max).toBe(0);
  });

  it('COLD_OPEN: precisa de vídeo com espaço depois de 0:05', () => {
    expect(allowedMap(ctx({ durationSec: 9 })).get('COLD_OPEN')!.max).toBe(0);
  });

  it('ENDCARD: original com end card = fora (sem troca); sem Brain e sem CTA falado = no_offer', () => {
    expect(allowedMap(ctx({ hasEndCard: true })).get('ENDCARD')).toEqual({ type: 'ENDCARD', max: 0, blockedReason: 'has_end_card' });
    const empty = ctx({ brain: { what: null, audience: null, pains: null, promise: null, proof: null, offerAndPrice: null, cta: null, notes: null }, spokenCta: null });
    expect(allowedMap(empty).get('ENDCARD')!.blockedReason).toBe('no_offer');
    expect(endcardVariants(ctx())).toEqual(['offer', 'guarantee', 'price', 'cta']);
    // sem Brain mas com o CTA falado: -CTA
    expect(endcardVariants({ ...empty, spokenCta: 'Tap the link' })).toEqual(['cta']);
  });

  it('SPLIT_LP: página capturada OU foto do produto (D4); senão no_page', () => {
    expect(allowedMap(ctx({ pageCaptured: false })).get('SPLIT_LP')!.blockedReason).toBe('no_page');
    expect(allowedMap(ctx({ pageCaptured: false, productPhoto: true })).get('SPLIT_LP')!.max).toBe(1);
  });

  it('REVIEW: só com depoimento citável no Brain › Proof', () => {
    expect(allowedMap(ctx({ brain: { ...ctx().brain, proof: null } })).get('REVIEW')!.blockedReason).toBe('no_proof');
    expect(allowedMap(ctx({ brain: { ...ctx().brain, proof: '4.8' } })).get('REVIEW')!.max).toBe(0);
  });

  it('NATIVE_SEARCH: precisa de fala (no_speech); STORY, STATIC e HOOK_TEXT sempre', () => {
    const m = allowedMap(ctx({ hasSpeech: false }));
    expect(m.get('NATIVE_SEARCH')!.blockedReason).toBe('no_speech');
    expect([m.get('STORY')!.max, m.get('STATIC')!.max, m.get('HOOK_TEXT')!.max]).toEqual([1, 2, 3]);
  });

  it('D2: sem Brain e vídeo curto, o piso cai pra o que os tipos fecham (nunca < 4)', () => {
    const poor = ctx({
      durationSec: 8, blocks: ctx().blocks.slice(0, 2), hasSpeech: false, pageCaptured: false, spokenCta: null,
      brain: { what: null, audience: null, pains: null, promise: null, proof: null, offerAndPrice: null, cta: null, notes: null },
    });
    const a = allowedFor(poor);
    // HOOK_TEXT 3 + STORY 1 + STATIC 2 = 6
    expect(rulesFor(a)).toEqual({ min: 6, max: 12, minDiversityPct: 40 });
    expect(swapsFor(a)).toEqual([
      { from: 'CUT', to: 'HOOK_TEXT', reason: 'short_video' }, { from: 'COLD_OPEN', to: 'HOOK_TEXT', reason: 'short_video' },
      { from: 'ENDCARD', to: 'HOOK_TEXT', reason: 'no_offer' }, { from: 'SPLIT_LP', to: 'STORY', reason: 'no_page' },
      { from: 'REVIEW', to: 'STATIC', reason: 'no_proof' }, { from: 'NATIVE_SEARCH', to: 'STATIC', reason: 'no_speech' },
    ]);
  });

  it('end card no original não vira troca', () => {
    expect(swapsFor(allowedFor(ctx({ hasEndCard: true })))).toEqual([]);
  });
});

describe('validatePlan (§6.1 + §6.2)', () => {
  it('plano bom: nenhuma violação', () => {
    expect(rulesOf(ctx(), draft())).toEqual([]);
  });

  it('§6.2.1 contagem: < 8 e > 12', () => {
    expect(rulesOf(ctx(), draft(goodItems().slice(4)))).toContain('null:count_low');
    const many = [...goodItems(), item({ type: 'STATIC', atSec: 5, headline: 'Busy parents' }), item({ type: 'NATIVE_SEARCH', query: 'sleep tips for parents' })];
    expect(many).toHaveLength(13);
    expect(rulesOf(ctx(), draft(many))).toContain('null:count_high');
  });

  it('§6.2.1 diversidade ≥ 40 % arredondando pra cima (8 → 4, 11 → 5)', () => {
    expect([minDiversity(8), minDiversity(10), minDiversity(11), minDiversity(12)]).toEqual([4, 4, 5, 5]);
    const items = goodItems().filter((it) => it.type !== 'STORY'); // 10 peças, 4 DIVERSITY = ok
    expect(rulesOf(ctx(), draft(items))).toEqual([]);
    const fewer = items.filter((it) => it.type !== 'STATIC'); // 9 peças, 3 DIVERSITY < 4
    expect(rulesOf(ctx(), draft(fewer))).toContain('null:diversity');
  });

  it('tipo bloqueado no contexto e acima do máximo (HOOK-TEXT ≤ 3, STATIC ≤ 2)', () => {
    expect(rulesOf(ctx({ pageCaptured: false }), draft())).toContain('6:type_not_allowed');
    const four = [...goodItems(), item({ type: 'HOOK_TEXT', text: 'One more hook' })];
    expect(rulesOf(ctx(), draft(four))).toContain('11:over_max');
  });

  it('repetição tem que mudar o conteúdo (D2)', () => {
    const items = goodItems();
    items[3] = item({ type: 'HOOK_TEXT', text: 'tired every morning' });
    expect(rulesOf(ctx(), draft(items))).toContain('3:duplicate');
  });

  it('§6.2.2 uma variável por peça: params do tipo da peça', () => {
    const items = goodItems();
    items[2] = { ...items[2], params: { type: 'STORY' } };
    expect(rulesOf(ctx(), draft(items))).toContain('2:params_mismatch');
  });

  it('§6.2.3 CUT nunca tira o gancho nem um bloco kept; cabe no alvo; tem que cortar algo', () => {
    const noHook = goodItems();
    noHook[0] = item({ type: 'CUT', targetSec: 15, blockIndexes: [3, 4] });
    expect(rulesOf(ctx(), draft(noHook))).toContain('0:cut_drops_kept');
    const noKept = goodItems();
    noKept[0] = item({ type: 'CUT', targetSec: 15, blockIndexes: [0, 1, 4] }); // tira o bloco 3 (kept)
    expect(rulesOf(ctx(), draft(noKept))).toContain('0:cut_drops_kept');
    const long = goodItems();
    long[0] = item({ type: 'CUT', targetSec: 15, blockIndexes: [0, 1, 3, 4] }); // 22 s
    expect(rulesOf(ctx(), draft(long))).toContain('0:cut_too_long');
    const twenty = goodItems();
    twenty.splice(1, 0, item({ type: 'CUT', targetSec: 20, blockIndexes: [0, 1, 3, 4] }));
    expect(rulesOf(ctx(), draft(twenty)).filter((r) => r.startsWith('1:'))).toEqual(['1:cut_too_long']); // 22 s > 21,5
    const bad = goodItems();
    bad[0] = item({ type: 'CUT', targetSec: 15, blockIndexes: [4, 0] });
    expect(rulesOf(ctx(), draft(bad))).toContain('0:cut_blocks_invalid');
  });

  it('COLD-OPEN: teaser de 1,5-3,5 s depois de 0:05', () => {
    const early = goodItems();
    early[1] = item({ type: 'COLD_OPEN', teaserStartSec: 2, teaserEndSec: 4 });
    expect(rulesOf(ctx(), draft(early))).toContain('1:cold_open_window');
    const long = goodItems();
    long[1] = item({ type: 'COLD_OPEN', teaserStartSec: 10, teaserEndSec: 15 });
    expect(rulesOf(ctx(), draft(long))).toContain('1:cold_open_window');
  });

  it('§6.2.5 nada inventado: número no texto de tela tem que estar no Brain ou na transcrição', () => {
    expect(inventedNumbers('Sleep in 10 minutes', ctx())).toEqual([]);
    expect(inventedNumbers('The 30 second trick', ctx())).toEqual([]); // "30" está na fala
    expect(inventedNumbers('Only $9.99', ctx())).toEqual([]);
    expect(inventedNumbers('97% of parents', ctx())).toEqual(['97']);
    expect(inventedNumbers('60 nights free', ctx())).toEqual(['60']);
    for (const [i, params] of [
      [2, { type: 'HOOK_TEXT', text: '97% of parents agree' }],
      [4, { type: 'ENDCARD', variant: 'price', headline: 'Only $4.99', subline: null, ctaText: 'Download now' }],
      [9, { type: 'NATIVE_SEARCH', query: 'sleep in 75 minutes' }],
      [10, { type: 'STATIC', atSec: 20, headline: '60 nights free' }],
    ] as [number, AutoItemDraft['params']][]) {
      const items = goodItems();
      items[i] = item(params);
      expect(rulesOf(ctx(), draft(items))).toContain(`${i}:invented_number`);
    }
  });

  it('§6.2.5 REVIEW: citação literal (caixa, espaço e pontuação normalizados); autor e estrelas só se estiverem lá', () => {
    expect(normalizeText('  "I finally  SLEEP, through the night!" ')).toBe('i finally sleep through the night');
    const ok = goodItems();
    ok[8] = item({ type: 'REVIEW', quote: 'i finally sleep — through the night', author: null, stars: null });
    expect(rulesOf(ctx(), draft(ok))).toEqual([]);
    const para = goodItems();
    para[8] = item({ type: 'REVIEW', quote: 'I sleep through every night now', author: 'Ana', stars: 5 });
    expect(rulesOf(ctx(), draft(para))).toContain('8:review_not_literal');
    const author = goodItems();
    author[8] = item({ type: 'REVIEW', quote: 'I finally sleep through the night', author: 'Maria', stars: null });
    expect(rulesOf(ctx(), draft(author))).toContain('8:review_author_invented');
    const stars = goodItems();
    stars[8] = item({ type: 'REVIEW', quote: 'I finally sleep through the night', author: null, stars: 4 });
    expect(rulesOf(ctx(), draft(stars))).toContain('8:review_stars_invented');
  });

  it('ENDCARD: variante sem dado no Brain; limites de texto', () => {
    const noPrice = ctx({ brain: { ...ctx().brain, offerAndPrice: null } });
    expect(rulesOf(noPrice, draft())).toContain('4:endcard_variant_unavailable');
    const long = goodItems();
    long[4] = item({ type: 'ENDCARD', variant: 'cta', headline: 'x'.repeat(41), subline: null, ctaText: 'Download now' });
    expect(rulesOf(ctx(), draft(long))).toContain('4:text_too_long');
  });

  it('NATIVE-SEARCH sem marca; textos de tela com limite', () => {
    const brand = goodItems();
    brand[9] = item({ type: 'NATIVE_SEARCH', query: 'is sleepio worth it' });
    expect(rulesOf(ctx(), draft(brand))).toContain('9:search_has_brand');
    const hook = goodItems();
    hook[2] = item({ type: 'HOOK_TEXT', text: 'y'.repeat(61) });
    expect(rulesOf(ctx(), draft(hook))).toContain('2:text_too_long');
  });

  it('porquê com as 3 linhas e kept 2-4', () => {
    const d = draft(goodItems(), { kept: [{ label: 'x', blockIndex: 0 }] });
    expect(rulesOf(ctx(), d)).toContain('null:kept_count');
    const w = draft(goodItems(), { why: { ...draft().why, cta: { text: '', source: 'video', brainField: null, ref: '' } } });
    expect(rulesOf(ctx(), w)).toContain('null:why_incomplete');
  });
});

describe('repairPlan (§6.3.2)', () => {
  const fb = { why: fallbackWhy({ hookSpoken: 'w0 w1', proof: 'p', cta: 'c' }, 'From the video'), kept: [{ label: 'Spoken hook', blockIndex: 0 }, { label: 'CTA', blockIndex: 4 }] };

  it('tira as peças que violam e mantém o resto na ordem', () => {
    const items = goodItems();
    items[2] = item({ type: 'HOOK_TEXT', text: '97% of parents' });
    items[8] = item({ type: 'REVIEW', quote: 'made up quote here', author: null, stars: null });
    const r = repairPlan(draft(items), ctx(), allowedFor(ctx()), fb);
    expect(r.ok).toBe(true);
    expect(r.removed.map((x) => [x.index, x.type])).toEqual([[2, 'HOOK_TEXT'], [8, 'REVIEW']]);
    expect(r.draft.items.map((i) => i.type)).toEqual(['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'HOOK_TEXT', 'SPLIT_LP', 'STORY', 'NATIVE_SEARCH', 'STATIC']);
    expect(validatePlan(r.draft, ctx(), allowedFor(ctx())).filter((v) => v.item !== null)).toEqual([]);
  });

  it('diversidade < 40 %: tira ITERATION da última pra primeira', () => {
    const items = goodItems().filter((it) => !['STORY', 'STATIC'].includes(it.type)); // 9 peças, 3 DIVERSITY
    const r = repairPlan(draft(items), ctx(), allowedFor(ctx()), fb);
    // precisa de 3 ≥ ceil(0,4 n): n ≤ 7 → tira os 2 últimos ITERATION (HOOK-TEXT "30 second", ENDCARD)
    expect(r.ok).toBe(true);
    expect(r.draft.items.map((i) => i.type)).toEqual(['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'HOOK_TEXT', 'SPLIT_LP', 'REVIEW', 'NATIVE_SEARCH']);
  });

  it('acima de 12: tira ITERATION do fim', () => {
    const many = [...goodItems(), item({ type: 'STATIC', atSec: 5, headline: 'Busy parents' }), item({ type: 'NATIVE_SEARCH', query: 'sleep tips for parents' })];
    const r = repairPlan(draft(many), ctx(), allowedFor(ctx()), fb);
    expect(r.draft.items).toHaveLength(12);
    expect(r.draft.items.filter((i) => i.type === 'HOOK_TEXT')).toHaveLength(2);
  });

  it('abaixo do piso (4) = não fecha (vira PLAN_INVALID)', () => {
    const items = [item({ type: 'STORY' }), item({ type: 'HOOK_TEXT', text: '97% agree' }), item({ type: 'STATIC', atSec: 3, headline: 'Busy parents' })];
    expect(repairPlan(draft(items), ctx(), allowedFor(ctx()), fb).ok).toBe(false);
  });

  it('porquê e kept incompletos são completados pelo vídeo', () => {
    const d = draft(goodItems(), { kept: [], why: { ...draft().why, proof: { text: '', source: 'brain', brainField: 'proof', ref: '' } } });
    const r = repairPlan(d, ctx(), allowedFor(ctx()), fb);
    expect(r.draft.why.proof).toEqual({ text: 'p', source: 'video', brainField: null, ref: 'From the video' });
    expect(r.draft.kept.map((k) => k.label)).toEqual(['Spoken hook', 'CTA']);
  });
});

describe('finalizePlan e insight', () => {
  it('código com sufixo de repetição, eixo, tempos encaixados fora das palavras, textos cortados', () => {
    const items = goodItems();
    items[2] = { ...items[2], change: 'c'.repeat(120) };
    const out = finalizePlan(draft(items), ctx(), regrasDeMidiaFallback);
    expect(out.map((i) => i.code)).toEqual([
      'CUT-15S', 'COLD-OPEN', 'HOOK-TEXT-2', 'HOOK-TEXT-3', 'ENDCARD-PRICE', 'HOOK-TEXT-4', 'LAYOUT-SPLIT-LP', 'LAYOUT-STORY', 'LAYOUT-REVIEW', 'NATIVE-SEARCH', 'STATIC-F1',
    ]);
    expect(new Set(out.map((i) => i.code)).size).toBe(out.length);
    expect(out.map((i) => i.index)).toEqual(out.map((_, k) => k));
    expect(out[2].change.length).toBeLessThanOrEqual(90);
    expect(out[0].params).toMatchObject({ type: 'CUT', timeline: [{ startSec: 0, endSec: 3 }, { startSec: 18, endSec: 30 }] });
    // teaser 19 → 21,5: 19 está dentro da palavra 38 (19-19,4)? não; 21,5 fica no vão entre palavras → segue igual ou no meio do silêncio
    const co = out[1].params as { teaserStartSec: number; teaserEndSec: number };
    for (const t of [co.teaserStartSec, co.teaserEndSec]) expect(words.some((w) => t > w.startSec + 0.01 && t < w.endSec - 0.01)).toBe(false);
    expect(out[2].params).toEqual({ type: 'HOOK_TEXT', text: 'Tired every morning?', endSec: 3 });
    expect(out[6].params).toEqual({ type: 'SPLIT_LP', source: 'page' });
    expect(finalizePlan(draft(), ctx({ lang: 'PT' }), regrasDeMidiaFallback).map((i) => i.code).slice(0, 5)).toEqual(['CORTE-15S', 'COLD-OPEN', 'GANCHO-TEXTO-2', 'GANCHO-TEXTO-3', 'ENDCARD-PRECO']);
  });

  it('borda dentro de palavra vai pro silêncio entre palavras', () => {
    const [s] = regrasDeMidiaFallback.snapSpans([{ startSec: 5.1, endSec: 7.3 }], words, []);
    expect(s).toEqual({ startSec: 4.95, endSec: 7.45 });
  });

  it('insight: porquê só cita o Brain quando o campo existe; blocos com função e kept; smallBatch', () => {
    const c = ctx({ brain: { ...ctx().brain, pains: null } });
    const ins = buildInsight(draft(), c, { brainEmpty: false, shortVideo: false, pageCaptured: true }, [], 'From the video', 7);
    expect(ins.why.map((w) => [w.key, w.refSource, w.brainField])).toEqual([['hook', 'video', null], ['proof', 'brain', 'proof'], ['cta', 'brain', 'offerAndPrice']]);
    expect(ins.why[0].ref).toBe('From the video');
    expect(ins.blocks.map((b) => [b.fn, b.kept])).toEqual([['hook', true], ['problem', false], ['mechanism', false], ['proof', true], ['cta', false]]);
    expect(ins.flags).toEqual({ brainEmpty: false, shortVideo: false, pageCaptured: true, metaConnected: false, smallBatch: true });
  });
});

// tipos só pra o compilador conferir o shape do allowed no teste
export type _A = AllowedType;
