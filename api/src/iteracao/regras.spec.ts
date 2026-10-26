// Regras puras do plano AUTO (variacao-auto-v1 §6): cada linha do §6.1/§6.2, nada inventado, trocas e reparo.
import type { AutoItemDraft, AutoPlanDraft, StaticCopy, StaticVisualV2 } from '../integracoes';
import { regrasDeMidiaFallback } from './portas';
import {
  AXIS_OF, FRAME_CODE, hasQuotableProof, type AllowedType, type PlanCtx, allowedFor, allowedFrameIds, allowedFrames, codeFor, codeLanguageOf, endcardVariants,
  finalizePlan, inventedClaims, inventedNumbers, minDiversity, normalizeText, pricesIn, repairPlan, rulesFor, staticCopyLength, swapsFor,
  validatePlan, buildInsight, fallbackWhy,
} from './regras';

/** rev. 23/10 §14.3: conceito visual do STATIC (em inglês, sem marca, sem texto entre aspas). */
const VIS = { object: 'A tired parent in their 30s, casual clothes', scene: 'Dark bedroom at night, lying awake next to a phone', vibe: 'Quiet blue night light', style: 'everyday_photo' as const, headlinePlacement: 'top' as const };

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


/**
 * Catálogo ANTIGO (até 25/10), só pra exercitar as regras de item dos tipos que saíram (lote antigo continua lendo, e a
 * validação por tipo segue no regras.ts). O `allowedFor` de hoje tem o catálogo novo (testes em "catálogo 25/10").
 */
function legacy(c: PlanCtx): AllowedType[] {
  const short = c.durationSec < 25 || c.blocks.length < 4;
  const r = (type: AllowedType['type'], ok: boolean, reason: AllowedType['blockedReason'], max: number): AllowedType => ({ type, max: ok ? max : 0, blockedReason: ok ? null : reason });
  return [
    r('CUT', !short, 'short_video', 2), r('COLD_OPEN', c.durationSec >= 10 && c.blocks.length >= 2, 'short_video', 1), r('HOOK_TEXT', true, 'no_speech', 3),
    c.hasEndCard ? r('ENDCARD', false, 'has_end_card', 1) : r('ENDCARD', endcardVariants(c).length > 0, 'no_offer', 1),
    r('SPLIT_LP', c.pageCaptured || c.productPhoto, 'no_page', 1), r('STORY', true, 'no_page', 1), r('REVIEW', hasQuotableProof(c), 'no_proof', 1),
    r('NATIVE_SEARCH', c.hasSpeech, 'no_speech', 2), r('STATIC', true, 'no_page', 2), r('FRAME', true, 'no_page', 2),
  ];
}
const allowedMap = (c: PlanCtx) => new Map(legacy(c).map((a) => [a.type, a]));

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
    item({ type: 'STATIC', atSec: 20, refAtSec: 20, headline: 'Sleep in 10 minutes', visual: VIS }),
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

const rulesOf = (c: PlanCtx, d: AutoPlanDraft) => validatePlan(d, c, legacy(c)).map((v) => `${v.item}:${v.rule}`);

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
    expect(Object.entries(AXIS_OF).filter(([, a]) => a === 'ITERATION').map(([t]) => t)).toEqual(['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'HEADLINE']);
  });
});

describe('allowed (§6.1 "entra quando" + D2)', () => {
  it('catálogo 25/10 (Gusta): só CUT, REVIEW, NATIVE_SEARCH, STATIC ≤ 2 e FRAME ≤ 8 entram no allowed', () => {
    expect(allowedFor(ctx()).map((a) => [a.type, a.max])).toEqual([['CUT', 2], ['REVIEW', 1], ['NATIVE_SEARCH', 2], ['STATIC', 2], ['FRAME', 8]]);
    expect(rulesFor(allowedFor(ctx()))).toEqual({ min: 8, max: 12, minDiversityPct: 40 });
    // FRAME nunca passa do nº de templates liberados (todas diferentes)
    const pobre = ctx({ brain: { what: null, audience: null, pains: null, promise: null, proof: null, offerAndPrice: null, cta: null, notes: null }, blocks: ctx().blocks.filter((b) => b.fn !== 'proof') });
    expect(allowedFor(pobre).find((a) => a.type === 'FRAME')!.max).toBe(8); // as 8 "sempre" (sem rosto, sem as de 2 fontes)
    expect(allowedFrameIds(pobre)).toHaveLength(8);
    // vídeo curto, sem fala e sem prova: ainda fecha 8 (STATIC 2 + FRAME 8), diversidade 100 %
    const curto = { ...pobre, durationSec: 8, hasSpeech: false };
    expect(allowedFor(curto).map((a) => [a.type, a.max])).toEqual([['CUT', 0], ['REVIEW', 0], ['NATIVE_SEARCH', 0], ['STATIC', 2], ['FRAME', 8]]);
    expect(rulesFor(allowedFor(curto))).toEqual({ min: 8, max: 12, minDiversityPct: 40 });
    expect(swapsFor(allowedFor(curto)).map((x) => [x.from, x.to])).toEqual([['CUT', 'FRAME'], ['REVIEW', 'FRAME'], ['NATIVE_SEARCH', 'STATIC']]);
  });
  it('lote antigo (catálogo antigo): os 9 + FRAME com os máximos de antes', () => {
    expect(legacy(ctx()).map((a) => [a.type, a.max])).toEqual([
      ['CUT', 2], ['COLD_OPEN', 1], ['HOOK_TEXT', 3], ['ENDCARD', 1], ['SPLIT_LP', 1], ['STORY', 1], ['REVIEW', 1], ['NATIVE_SEARCH', 2], ['STATIC', 2], ['FRAME', 2],
    ]);
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
    const a = legacy(poor);
    // HOOK_TEXT 3 + STORY 1 + STATIC 2 = 6
    expect(rulesFor(a.filter((x) => x.type !== 'FRAME'))).toEqual({ min: 6, max: 12, minDiversityPct: 40 });
    // 25/10: + FRAME 2 (as molduras "sempre" não dependem do Brain) = 8
    expect(rulesFor(a)).toEqual({ min: 8, max: 12, minDiversityPct: 40 });
    // 25/10: o que não entra vira moldura (NATIVE_SEARCH → STATIC)
    expect(swapsFor(a)).toEqual([
      { from: 'CUT', to: 'FRAME', reason: 'short_video' }, { from: 'COLD_OPEN', to: 'FRAME', reason: 'short_video' },
      { from: 'ENDCARD', to: 'FRAME', reason: 'no_offer' }, { from: 'SPLIT_LP', to: 'FRAME', reason: 'no_page' },
      { from: 'REVIEW', to: 'FRAME', reason: 'no_proof' }, { from: 'NATIVE_SEARCH', to: 'STATIC', reason: 'no_speech' },
    ]);
  });

  it('end card no original não vira troca', () => {
    expect(swapsFor(legacy(ctx({ hasEndCard: true })))).toEqual([]);
  });
});

describe('validatePlan (§6.1 + §6.2)', () => {
  it('plano bom: nenhuma violação', () => {
    expect(rulesOf(ctx(), draft())).toEqual([]);
  });

  it('§6.2.1 contagem: < 8 e > 12', () => {
    expect(rulesOf(ctx(), draft(goodItems().slice(4)))).toContain('null:count_low');
    const many = [...goodItems(), item({ type: 'STATIC', atSec: 5, refAtSec: 5, headline: 'Busy parents', visual: VIS }), item({ type: 'NATIVE_SEARCH', query: 'sleep tips for parents' })];
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
      [10, { type: 'STATIC', atSec: 20, refAtSec: 20, headline: '60 nights free', visual: VIS }],
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

describe('STATIC no GPT Image 2 (rev. 23/10 §14.3)', () => {
  const st = (over: Record<string, unknown>) => {
    const items = goodItems();
    items[10] = item({ type: 'STATIC', atSec: 20, refAtSec: 20, headline: 'Sleep in 10 minutes', visual: VIS, ...over } as AutoItemDraft['params']);
    return rulesOf(ctx(), draft(items)).filter((r) => r.startsWith('10:'));
  };
  it('visual obrigatório com object/scene/vibe; limites 220/220/140; style e posição válidos', () => {
    expect(st({})).toEqual([]);
    expect(st({ visual: undefined })).toEqual(['10:static_visual_missing']);
    expect(st({ visual: { ...VIS, scene: '  ' } })).toEqual(['10:static_visual_missing']);
    expect(st({ visual: { ...VIS, style: 'watercolor' } })).toEqual(['10:static_visual_missing']);
    expect(st({ visual: { ...VIS, object: 'x'.repeat(221) } })).toEqual(['10:text_too_long']);
    expect(st({ visual: { ...VIS, vibe: 'x'.repeat(141) } })).toEqual(['10:text_too_long']);
    expect(st({ headline: 'x'.repeat(51) })).toEqual(['10:text_too_long']);
  });
  it('sem texto entre aspas nem marca no visual (palavra inteira); refAtSec null ou dentro do vídeo; headline sem número inventado', () => {
    expect(st({ visual: { ...VIS, scene: 'Phone screen reading "sleep now"' } })).toEqual(['10:static_visual_has_text']);
    expect(st({ visual: { ...VIS, scene: 'Phone with the “Sleepio” app open' } })).toEqual(['10:static_visual_has_text', '10:static_visual_has_brand']);
    expect(st({ visual: { ...VIS, object: 'A parent holding a Sleepio mug' } })).toEqual(['10:static_visual_has_brand']);
    expect(st({ visual: { ...VIS, object: 'A sleepiolike pillow' } })).toEqual([]); // não é a palavra da marca
    expect(st({ refAtSec: null })).toEqual([]);
    expect(st({ refAtSec: 31 })).toEqual(['10:static_out_of_range']);
    expect(st({ headline: '97% sleep better' })).toEqual(['10:invented_number']);
  });
  it('duplicado = mesma headline normalizada (não o frame); FinalParams = { type, headline, refAtSec, visual }', () => {
    const items = [...goodItems(), item({ type: 'STATIC', atSec: 3, refAtSec: 3, headline: 'sleep in 10 minutes!', visual: { ...VIS, scene: 'Other scene' } })];
    expect(rulesOf(ctx(), draft(items))).toContain('11:duplicate');
    const other = [...goodItems(), item({ type: 'STATIC', atSec: 20, refAtSec: 20, headline: 'Busy parents', visual: VIS })];
    expect(rulesOf(ctx(), draft(other))).not.toContain('11:duplicate');
    const out = finalizePlan(draft(), ctx(), regrasDeMidiaFallback);
    expect(out[10].params).toEqual({ type: 'STATIC', headline: 'Sleep in 10 minutes', refAtSec: 20, visual: VIS });
    const legacy = goodItems();
    legacy[10] = item({ type: 'STATIC', atSec: 7.25, headline: ' Busy parents ', visual: VIS });
    expect(finalizePlan(draft(legacy), ctx(), regrasDeMidiaFallback)[10].params).toEqual({ type: 'STATIC', headline: 'Busy parents', refAtSec: 7.25, visual: VIS });
  });
});

describe('repairPlan (§6.3.2)', () => {
  const fb = { why: fallbackWhy({ hookSpoken: 'w0 w1', proof: 'p', cta: 'c' }, 'From the video'), kept: [{ label: 'Spoken hook', blockIndex: 0 }, { label: 'CTA', blockIndex: 4 }] };

  it('tira as peças que violam e mantém o resto na ordem', () => {
    const items = goodItems();
    items[2] = item({ type: 'HOOK_TEXT', text: '97% of parents' });
    items[8] = item({ type: 'REVIEW', quote: 'made up quote here', author: null, stars: null });
    const r = repairPlan(draft(items), ctx(), legacy(ctx()), fb);
    expect(r.ok).toBe(true);
    expect(r.removed.map((x) => [x.index, x.type])).toEqual([[2, 'HOOK_TEXT'], [8, 'REVIEW']]);
    expect(r.draft.items.map((i) => i.type)).toEqual(['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'ENDCARD', 'HOOK_TEXT', 'SPLIT_LP', 'STORY', 'NATIVE_SEARCH', 'STATIC']);
    expect(validatePlan(r.draft, ctx(), legacy(ctx())).filter((v) => v.item !== null)).toEqual([]);
  });

  it('diversidade < 40 %: tira ITERATION da última pra primeira', () => {
    const items = goodItems().filter((it) => !['STORY', 'STATIC'].includes(it.type)); // 9 peças, 3 DIVERSITY
    const r = repairPlan(draft(items), ctx(), legacy(ctx()), fb);
    // precisa de 3 ≥ ceil(0,4 n): n ≤ 7 → tira os 2 últimos ITERATION (HOOK-TEXT "30 second", ENDCARD)
    expect(r.ok).toBe(true);
    expect(r.draft.items.map((i) => i.type)).toEqual(['CUT', 'COLD_OPEN', 'HOOK_TEXT', 'HOOK_TEXT', 'SPLIT_LP', 'REVIEW', 'NATIVE_SEARCH']);
  });

  it('acima de 12: tira ITERATION do fim', () => {
    const many = [...goodItems(), item({ type: 'STATIC', atSec: 5, refAtSec: 5, headline: 'Busy parents', visual: VIS }), item({ type: 'NATIVE_SEARCH', query: 'sleep tips for parents' })];
    const r = repairPlan(draft(many), ctx(), legacy(ctx()), fb);
    expect(r.draft.items).toHaveLength(12);
    expect(r.draft.items.filter((i) => i.type === 'HOOK_TEXT')).toHaveLength(2);
  });

  it('abaixo do piso (4) = não fecha (vira PLAN_INVALID)', () => {
    const items = [item({ type: 'STORY' }), item({ type: 'HOOK_TEXT', text: '97% agree' }), item({ type: 'STATIC', atSec: 3, refAtSec: 3, headline: 'Busy parents', visual: VIS })];
    expect(repairPlan(draft(items), ctx(), legacy(ctx()), fb).ok).toBe(false);
  });

  it('porquê e kept incompletos são completados pelo vídeo', () => {
    const d = draft(goodItems(), { kept: [], why: { ...draft().why, proof: { text: '', source: 'brain', brainField: 'proof', ref: '' } } });
    const r = repairPlan(d, ctx(), legacy(ctx()), fb);
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

// ───────── 25/10 estatico-montado-e-molduras-v1 ─────────

const VIS2: StaticVisualV2 = {
  hero: { person: 'A tired parent in their 30s, casual clothes', setting: 'Dark bedroom at night', emotion: 'pain', light: 'Soft blue night light' },
  product: { kind: 'phone_screen', look: 'Calm dark interface with a progress ring', screenTitle: 'A sleep app', screenTitleSource: 'what' },
  mood: 'Intimate, hopeful, late evening',
};
function copyV2(over: Partial<StaticCopy> = {}): StaticCopy {
  return {
    brandLine: 'A sleep app', brandLineSource: 'what',
    tagline: 'Less noise. More rest.',
    headline: { lead: 'You can fall asleep', highlight: 'in 10 minutes' }, headlineSource: 'promise',
    subheadline: 'Sleep in 10 minutes, even with no time.', subheadlineSource: 'promise',
    handwritten: 'Your nights back.',
    benefits: [
      { icon: 'moon', title: 'Sleep in 10 minutes', line: 'A short routine before bed', source: 'promise' },
      { icon: 'clock', title: 'No time needed', line: 'Made for busy parents', source: 'pains' },
      { icon: 'star', title: 'Real parents', line: 'Ana finally sleeps', source: 'proof' },
    ],
    trust: [],
    cta: { main: 'Download now', sub: '7-day trial', subSource: 'offerAndPrice' },
    closing: 'Rest is not a luxury.',
    ...over,
  };
}
const staticV2 = (copy: Partial<StaticCopy> = {}, visual: Partial<StaticVisualV2> = {}) =>
  ({ type: 'STATIC', atSec: 20, refAtSec: 20, headline: 'legacy', layout: 'assembled', copy: copyV2(copy), visualV2: { ...VIS2, ...visual } }) as AutoItemDraft['params'];

describe('afirmações (§A3.2 item 2, afirmacoes.ts)', () => {
  it('termo de afirmação sem a mesma família no Brain/fala = inventado; com ela = ok', () => {
    const pt = ctx({ screenLanguage: 'pt-BR', brain: { ...ctx().brain, offerAndPrice: 'R$ 29,90 por mês', proof: null } });
    expect(inventedClaims('Comece grátis', pt)).toEqual(['grátis']);
    const trial = ctx({ screenLanguage: 'pt-BR', brain: { ...ctx().brain, offerAndPrice: 'Teste grátis de 7 dias, depois R$ 29,90' } });
    expect(inventedClaims('7 dias grátis', trial)).toEqual([]);
    expect(inventedClaims('Durma melhor hoje', pt)).toEqual([]); // comparativo, não superlativo
    expect(inventedClaims('O melhor app de sono', pt)).toEqual(['o melhor']);
    expect(inventedClaims('Sem risco nenhum', pt)).toEqual(['sem risco']);
  });
  it('en/es e famílias: garantia, autoridade, plataforma, desconto, nº 1', () => {
    const en = ctx({ screenLanguage: 'en-US' });
    expect(inventedClaims('Money-back guarantee', en)).toEqual([]); // o proof fala de garantia
    expect(inventedClaims('Clinically proven', en)).toEqual(['clinically']);
    expect(inventedClaims('On iOS and Android', en)).toEqual(['ios']);
    expect(inventedClaims('50% off today', en)).toEqual(['%']);
    expect(inventedClaims('The #1 sleep app', en)).toEqual(['#1']);
    expect(inventedClaims('Free for 7 days', en)).toEqual([]); // "trial" no offerAndPrice sustenta a família
    const es = ctx({ screenLanguage: 'es-MX', brain: { ...ctx().brain, offerAndPrice: '$9.99 al mes' } });
    expect(inventedClaims('Prueba gratis', es)).toEqual(['gratis']);
    expect(inventedClaims('Free trial', ctx({ screenLanguage: 'de-DE' }))).toEqual([]); // outro idioma: só a regra de número
  });
});

describe('STATIC V2 "anúncio montado" (§A3)', () => {
  const run = (params: AutoItemDraft['params'], c: PlanCtx = ctx()) => {
    const items = goodItems();
    items[10] = item(params);
    return validatePlan(draft(items), c, legacy(c)).filter((v) => v.item === 10).map((v) => `${v.rule}${v.block ? `@${v.block}` : ''}`);
  };
  it('copy + visual V2 bom: nenhuma violação (o headline legado ≤ 50 não conta no V2)', () => {
    expect(run(staticV2())).toEqual([]);
    expect(staticCopyLength(copyV2())).toBeLessThan(420);
  });
  it('nada inventado por bloco: número e afirmação em qualquer texto do copy e no screenTitle', () => {
    expect(run(staticV2({ subheadline: 'Clinically proven to work.' }))).toEqual(['invented_claim@subheadline']);
    expect(run(staticV2({ cta: { main: 'Start free', sub: null, subSource: null } }))).toEqual([]); // trial no Brain
    // "%" é termo de afirmação (família desconto, §A3.2): número inventado com % dispara as duas
    expect(run(staticV2({ tagline: '97% sleep better' }))).toEqual(['invented_number@tagline', 'invented_claim@tagline']);
    // (a fala do fixture tem w0…w59: números até 59 "estão na transcrição")
    expect(run(staticV2({}, { product: { ...VIS2.product, screenTitle: 'Plan of 91 days' } }))).toEqual(['invented_number@screenTitle']);
    const noTrial = ctx({ brain: { ...ctx().brain, offerAndPrice: '$9.99/month' } });
    expect(run(staticV2({ cta: { main: 'Download now', sub: '75 days free', subSource: 'offerAndPrice' } }), noTrial)).toEqual(['invented_number@cta.sub', 'invented_claim@cta.sub']);
  });
  it('unsupported_source: fonte vazia no Brain, fora da tabela §A3.1, ou generic onde não pode', () => {
    expect(run(staticV2({ brandLineSource: 'pains' }))).toEqual(['unsupported_source@brandLine']);
    const noProof = ctx({ brain: { ...ctx().brain, proof: null } });
    expect(run(staticV2({ subheadlineSource: 'proof' }), noProof)).toEqual(['unsupported_source@subheadline', 'unsupported_source@benefits.2']);
    expect(run(staticV2({ headlineSource: 'generic' }))).toEqual(['static_headline_unsupported@headline']);
    expect(run(staticV2({ benefits: copyV2().benefits.map((b, k) => (k === 1 ? { ...b, source: 'generic' as const } : b)) }))).toEqual(['unsupported_source@benefits.1']);
    expect(run(staticV2({ cta: { main: 'Download now', sub: '7-day trial', subSource: 'cta' } }), ctx({ brain: { ...ctx().brain, cta: null } }))).toEqual(['unsupported_source@cta.sub']);
    expect(run(staticV2({}, { product: { ...VIS2.product, screenTitleSource: 'kind' } }))).toEqual(['unsupported_source@screenTitle']); // kind vazio
    expect(run(staticV2({}, { product: { ...VIS2.product, screenTitleSource: 'kind' } }), ctx({ offerKind: 'Subscription app' }))).toEqual([]);
  });
  it('contagens e tamanhos: cards 0/3-5, confiança 0/3, palavras do manuscrito, soma ≤ 420', () => {
    expect(run(staticV2({ benefits: copyV2().benefits.slice(0, 2) }))).toEqual(['static_count@benefits']);
    expect(run(staticV2({ trust: [{ icon: 'shield', text: 'Money-back guarantee', source: 'proof' }, { icon: 'check', text: 'Busy parents', source: 'what' }] }))).toEqual(['static_count@trust']);
    expect(run(staticV2({ handwritten: 'Your nights are back again now' }))).toEqual(['text_too_long@handwritten']);
    expect(run(staticV2({ headline: { lead: 'x'.repeat(46), highlight: 'y' } }))).toEqual(['text_too_long@headline']);
    const long = 'Sleep in 10 minutes, even with no time and.'.slice(0, 40);
    const many = copyV2({ benefits: Array.from({ length: 5 }, (_, k) => ({ icon: 'moon' as const, title: `Sleep in 10 minutes ${k}`.slice(0, 24), line: long, source: 'promise' as const })), subheadline: 'x'.repeat(88) });
    expect(staticCopyLength(many)).toBeGreaterThan(420);
    expect(run(staticV2(many)).filter((r) => r.startsWith('static_copy_too_long'))).toEqual(['static_copy_too_long@*total']);
  });
  it('visual V2: sem aspas, sem marca; marca no copy só no bloco da marca', () => {
    expect(run(staticV2({}, { hero: { ...VIS2.hero!, person: 'A parent holding a mug that says "sleep"' } }))).toEqual(['static_visual_has_text']);
    expect(run(staticV2({}, { mood: 'Sleepio blue, calm' }))).toEqual(['static_visual_has_brand']);
    expect(run(staticV2({}, { hero: null }))).toEqual([]); // sem pessoa
    expect(run(staticV2({}, { mood: '' }))).toEqual(['static_visual_missing']);
    expect(run(staticV2({ benefits: copyV2().benefits.map((b, k) => (k === 0 ? { ...b, title: 'Sleepio works' } : b)) }))).toEqual(['static_copy_has_brand@benefits.0']);
  });
  it('duplicado = mesma headline (lead + highlight) normalizada', () => {
    const items = [...goodItems().slice(0, 10), item(staticV2()), item(staticV2({ closing: 'Other closing.' }))];
    expect(rulesOf(ctx(), draft(items))).toContain('11:duplicate');
  });
  it('reparo: apaga o bloco opcional que violou (null/[]); headline errada tira a peça; soma > 420 corta na ordem', () => {
    const fb = { why: fallbackWhy({ hookSpoken: 'h', proof: 'p', cta: 'c' }, 'From the video'), kept: [{ label: 'Hook', blockIndex: 0 }, { label: 'CTA', blockIndex: 4 }] };
    const items = goodItems();
    items[10] = item(staticV2({
      subheadline: 'Clinically proven to work.', brandLineSource: 'pains',
      benefits: copyV2().benefits.map((b, k) => (k === 1 ? { ...b, title: '97% sleep better' } : b)),
      trust: [{ icon: 'shield', text: 'Doctor approved', source: 'proof' }, { icon: 'check', text: 'Busy parents', source: 'what' }, { icon: 'star', text: 'Real parents', source: 'proof' }],
    }));
    const r = repairPlan(draft(items), ctx(), legacy(ctx()), fb);
    expect(r.removed).toEqual([]);
    const p = r.draft.items[10].params as { copy: StaticCopy };
    expect(p.copy.subheadline).toBeNull();
    expect(p.copy.subheadlineSource).toBeNull();
    expect(p.copy.brandLine).toBeNull();
    expect(p.copy.benefits).toEqual([]); // 3 → 2 não fecha: o bloco some
    expect(p.copy.trust).toEqual([]);
    expect(p.copy.headline).toEqual(copyV2().headline);
    expect(validatePlan(r.draft, ctx(), legacy(ctx())).filter((v) => v.item !== null)).toEqual([]);

    const badHead = goodItems();
    badHead[10] = item(staticV2({ headline: { lead: 'Sleep in 75 minutes', highlight: 'tonight' } }));
    expect(repairPlan(draft(badHead), ctx(), legacy(ctx()), fb).removed.map((x) => [x.index, x.rules])).toEqual([[10, ['invented_number']]]);

    const tooLong = goodItems();
    const long = copyV2({
      benefits: Array.from({ length: 5 }, (_, k) => ({ icon: 'moon' as const, title: `Sleep in 10 minutes ${k}`.slice(0, 24), line: 'A short routine before bed, every night', source: 'promise' as const })),
      subheadline: 'Sleep in 10 minutes. ' + 'Made for busy parents who have no time at all, every single night.'.slice(0, 68),
    });
    tooLong[10] = item(staticV2(long));
    const t = repairPlan(draft(tooLong), ctx(), legacy(ctx()), fb);
    const tc = (t.draft.items[10].params as { copy: StaticCopy }).copy;
    expect(staticCopyLength(tc)).toBeLessThanOrEqual(420);
    expect(tc.closing).toBeNull();
    expect(t.removed).toEqual([]);
  });
  it('finalizePlan: params assembled com headline = lead + highlight, copy aparado e visual V2', () => {
    const items = goodItems();
    items[10] = item(staticV2({ tagline: '  Less noise. More rest.  ', closing: '   ' }));
    const out = finalizePlan(draft(items), ctx(), regrasDeMidiaFallback)[10];
    expect(out.code).toBe('STATIC-F1');
    expect(out.params).toMatchObject({ type: 'STATIC', layout: 'assembled', headline: 'You can fall asleep in 10 minutes', refAtSec: 20, visual: VIS2 });
    const p = out.params as { copy: StaticCopy };
    expect(p.copy.tagline).toBe('Less noise. More rest.');
    expect(p.copy.closing).toBeNull();
  });
});

describe('molduras FRAME (§B2/§B5)', () => {
  const frame = (template: string, texts: unknown, sources: Record<string, string> = {}) =>
    ({ type: 'FRAME', template, texts, sources }) as unknown as AutoItemDraft['params'];
  const frameItem = (p: AutoItemDraft['params']) => ({ ...item(p), type: 'FRAME' }) as unknown as AutoItemDraft;
  const NEWS = { topic: 'Sleep', headline: { lead: 'Busy parents fall asleep', highlight: 'in 10 minutes' }, dek: 'A short routine before bed', cta: 'Download now' };
  const run = (p: AutoItemDraft['params'], c: PlanCtx = ctx()) => {
    const items = [...goodItems(), frameItem(p)];
    return validatePlan(draft(items), c, allowedFor(c)).filter((v) => v.item === 11).map((v) => v.rule);
  };

  it('allowedFrames: sem rosto = as 12 de 1 fonte (B2 = no_face); com rosto = as 18; prova, preço e dado do Brain', () => {
    const a = allowedFrames(ctx());
    expect(a.filter((f) => f.allowed).map((f) => f.template).sort()).toEqual(
      ['call', 'cinema', 'direct_offer', 'live', 'meme', 'news', 'post_card', 'pov_testimonial', 'question_box', 'ranking', 'read_caption', 'story'],
    );
    expect(a.filter((f) => !f.allowed).every((f) => f.blockedReason === 'no_face')).toBe(true); // ctx() sem faceTrack
    // 25/10: B2 liberado com rosto no campeão; FRAME continua ≤ 8 por lote
    const comRosto = ctx({ frame: { brand: { name: 'x', handle: '@x', initials: 'X', color: '#FF8A3D' }, faceAtSec: 1 } });
    expect(allowedFrameIds(comRosto)).toHaveLength(18);
    expect(allowedFor(comRosto).find((x) => x.type === 'FRAME')!.max).toBe(8);
    const noPrice = ctx({ brain: { ...ctx().brain, offerAndPrice: '7-day trial' } });
    expect(allowedFrames(noPrice).find((f) => f.template === 'direct_offer')).toEqual({ template: 'direct_offer', allowed: false, blockedReason: 'no_price' });
    const noProof = ctx({ brain: { ...ctx().brain, proof: null }, blocks: ctx().blocks.filter((b) => b.fn !== 'proof') });
    expect(allowedFrames(noProof).find((f) => f.template === 'pov_testimonial')!.blockedReason).toBe('no_proof');
    expect(allowedFrames(ctx({ brain: { ...ctx().brain, proof: null } })).find((f) => f.template === 'pov_testimonial')!.allowed).toBe(true); // bloco de prova no teardown
    expect(allowedFrameIds(ctx())).toHaveLength(12);
    expect(pricesIn('De R$ 197 por R$ 97,90')).toEqual([{ digits: '197', currency: 'BRL' }, { digits: '9790', currency: 'BRL' }]);
  });

  it('moldura boa: nenhuma violação; código FRAME-<ID> / MOLDURA-<ID-PT>', () => {
    expect(run(frame('news', NEWS))).toEqual([]);
    expect(run(frame('live', {}))).toEqual([]);
    expect(codeFor('FRAME', 'news', 1, 'EN')).toBe('FRAME-NEWS');
    expect(codeFor('FRAME', 'news', 1, 'PT')).toBe('MOLDURA-NOTICIA');
    expect(codeFor('FRAME', 'read_caption', 1, 'PT')).toBe('MOLDURA-LEIA-A-LEGENDA');
    expect(new Set(Object.values(FRAME_CODE.EN)).size).toBe(18);
    expect(new Set(Object.values(FRAME_CODE.PT)).size).toBe(18);
  });

  it('limites por template (asteriscos não contam), obrigatórios e destaque único', () => {
    expect(run(frame('question_box', { question: `*${'x'.repeat(70)}*` }))).toEqual([]);
    expect(run(frame('question_box', { question: 'x'.repeat(71) }))).toEqual(['text_too_long']);
    expect(run(frame('meme', { pov: 'You finally sleep', cta: '' }))).toEqual(['text_empty']);
    expect(run(frame('cinema', { question: '*Tired* every *morning*?', subtitle: 'Sleep in 10 minutes' }))).toEqual(['frame_highlight_invalid']);
    expect(run(frame('call', { title: 'A sleep app', slideTitle: 'How it works', slideSteps: ['Open the app', 'Press play'] }, { 'slideSteps.0': 'what', 'slideSteps.1': 'what' }))).toEqual(['frame_count']);
  });

  it('nada inventado: "Experts reveal" sem prova que diga isso; número fora do Brain', () => {
    expect(run(frame('news', { ...NEWS, headline: { lead: 'Experts reveal the trick', highlight: 'for parents' } }))).toEqual(['invented_claim']);
    expect(run(frame('post_card', { copy: '97 parents sleep better' }))).toEqual(['invented_number']);
    expect(run(frame('post_card', { copy: 'The #1 app for parents' }))).toEqual(['invented_claim']);
  });

  it('ranking/call cobram a fonte de cada item (aceitas: pains/what/promise/proof; what/promise)', () => {
    const items = ['No time', 'Busy nights', 'Tired mornings'];
    expect(run(frame('ranking', { title: 'Why parents', items }))).toEqual(['unsupported_source', 'unsupported_source', 'unsupported_source']);
    expect(run(frame('ranking', { title: 'Why parents', items }, { 'items.0': 'pains', 'items.1': 'pains', 'items.2': 'promise' }))).toEqual([]);
    expect(run(frame('ranking', { title: 'Why parents', items }, { 'items.0': 'pains', 'items.1': 'notes', 'items.2': 'promise' }))).toEqual(['unsupported_source']);
    expect(run(frame('ranking', { title: 'Why parents', items: items.slice(0, 2) }, { 'items.0': 'pains', 'items.1': 'pains' }))).toEqual(['frame_count']);
    expect(run(frame('post_card', { copy: 'Sleep in 10 minutes' }, { copy: 'audience' }), ctx({ brain: { ...ctx().brain, audience: null } }))).toEqual(['unsupported_source']);
  });

  it('§B5 preço literal: to no offerAndPrice; from só com 2 preços no Brain', () => {
    const offer = (price: { from: string | null; to: string }) => frame('direct_offer', { promise: 'Sleep in 10 minutes', price, cta: 'Download now' });
    expect(run(offer({ from: null, to: '$9.99' }))).toEqual([]);
    expect(run(offer({ from: null, to: '$4.99' }))).toEqual(['invented_number', 'price_not_in_brain']);
    expect(run(offer({ from: null, to: '9.99' }))).toEqual(['price_not_in_brain']); // sem moeda
    expect(run(offer({ from: '$9.99', to: '$9.99' }))).toEqual(['price_from_invalid']); // 1 preço só no Brain
    const two = ctx({ brain: { ...ctx().brain, offerAndPrice: 'From $19.99 to $9.99/month' } });
    expect(run(offer({ from: '$19.99', to: '$9.99' }), two)).toEqual([]);
    expect(run(offer({ from: '$9.99', to: '$9.99' }), two)).toEqual(['price_from_invalid']);
    expect(run(offer({ from: null, to: '$9.99' }), ctx({ brain: { ...ctx().brain, offerAndPrice: '7-day trial' } }))).toEqual(['frame_not_allowed']);
  });

  it('B2 fora da B1; máx. 2 por lote, de templates diferentes (D10)', () => {
    expect(run(frame('split_stack', { headline: 'Two sides' }))).toEqual(['frame_not_allowed']);
    const base = goodItems().slice(0, 9);
    const twoSame = [...base, frameItem(frame('news', NEWS)), frameItem(frame('news', { ...NEWS, dek: 'Another one' }))];
    expect(rulesOf(ctx(), draft(twoSame))).toContain('10:duplicate');
    const three = [...base, frameItem(frame('news', NEWS)), frameItem(frame('live', {})), frameItem(frame('post_card', { copy: 'Sleep in 10 minutes' }))];
    expect(rulesOf(ctx(), draft(three))).toContain('11:over_max');
    expect(AXIS_OF.FRAME).toBe('DIVERSITY');
  });

  it('finalizePlan: FrameSpec (marca e rosto do backend, primaryText da read_caption)', () => {
    const brand = { name: 'Sleepio', handle: '@acmestudio', initials: 'S', color: '#FF8A3D' };
    const c = ctx({ frame: { brand, faceAtSec: 1.5 }, screenLanguage: 'en' });
    const items = [...goodItems().slice(0, 10), frameItem(frame('read_caption', { headline: ' Read the caption ', primaryText: ' The full story. ' }, { headline: 'promise' })), frameItem(frame('question_box', { question: 'Tired every morning?' }))];
    const out = finalizePlan(draft(items), c, regrasDeMidiaFallback);
    expect(out[10]).toMatchObject({ type: 'FRAME', code: 'FRAME-READ-CAPTION', axis: 'DIVERSITY' });
    expect(out[10].params).toEqual({
      type: 'FRAME', template: 'read_caption', texts: { headline: 'Read the caption', primaryText: 'The full story.' }, sources: { headline: 'promise' },
      screenLanguage: 'en', brand, faceAtSec: null, second: null, suggestedPrimaryText: 'The full story.',
    });
    expect(out[11].params).toMatchObject({ template: 'question_box', faceAtSec: 1.5, suggestedPrimaryText: null });
    // sem ctx.frame: marca pelo brandTerms (oferta = 2º, handle = workspace)
    const fb = finalizePlan(draft(items), ctx(), regrasDeMidiaFallback)[11].params as { brand: unknown };
    expect(fb.brand).toEqual({ name: 'Acme Studio', handle: '@sleepio', initials: 'AS', color: '#FF8A3D' });
  });
});

describe('catálogo 25/10 no validatePlan (lote novo)', () => {
  it('CUT ×2 + STATIC ×2 + 8 molduras distintas fecha; tipo que saiu = type_not_allowed; 9ª moldura = over_max; repetida = duplicate', () => {
    const c = ctx({ frame: { brand: { name: 'Acme', handle: '@sleepio', initials: 'A', color: '#FF8A3D' }, faceAtSec: 1 } });
    const fr = (template: string, texts: unknown, sources: Record<string, string> = {}) => ({ ...item({ type: 'FRAME', template, texts, sources } as unknown as AutoItemDraft['params']), type: 'FRAME' }) as unknown as AutoItemDraft;
    const frames = [
      fr('question_box', { question: 'Tired every morning?' }), fr('meme', { pov: 'you finally sleep', cta: 'Download now' }),
      fr('cinema', { question: 'What if you slept tonight?', subtitle: 'Sleep in 10 minutes' }), fr('live', {}),
      fr('post_card', { copy: 'Sleep in 10 minutes' }), fr('read_caption', { headline: 'Read the caption', primaryText: 'Sleep in 10 minutes.' }),
      fr('split_stack', { headline: 'Busy parents sleep' }), fr('gossip_white', { headline: 'Parents are sleeping again' }),
    ];
    const base = [goodItems()[0], item({ type: 'CUT', targetSec: 20, blockIndexes: [0, 3, 4] }), goodItems()[10], item({ type: 'STATIC', atSec: 5, refAtSec: 5, headline: 'Busy parents', visual: VIS })];
    const ok = validatePlan(draft([...base, ...frames]), c, allowedFor(c));
    expect(ok.filter((v) => v.item !== null).map((v) => `${v.item}:${v.rule}`)).toEqual([]);
    expect(ok.filter((v) => v.item === null).map((v) => v.rule)).toEqual([]); // 12 peças, diversidade 10/12
    const comHook = validatePlan(draft([...base.slice(0, 3), item({ type: 'HOOK_TEXT', text: 'Tired?' }), ...frames]), c, allowedFor(c));
    expect(comHook.map((v) => `${v.item}:${v.rule}`)).toContain('3:type_not_allowed');
    const nove = validatePlan(draft([...base.slice(0, 3), ...frames, fr('news', { topic: 'Sleep', headline: { lead: 'Parents sleep', highlight: 'in 10 minutes' }, dek: 'A short routine', cta: 'Download now' })]), c, allowedFor(c));
    expect(nove.map((v) => `${v.item}:${v.rule}`)).toContain('11:over_max');
    const rep = validatePlan(draft([...base, ...frames.slice(0, 7), fr('meme', { pov: 'another one', cta: 'Download now' })]), c, allowedFor(c));
    expect(rep.map((v) => `${v.item}:${v.rule}`)).toContain('11:duplicate');
  });
});

describe('HEADLINE (headline-e-legenda-v1)', () => {
  const H = (over = {}) => ({ mode: 'replace' as const, original: 'Tired every morning?', lines: 1, maxChars: 24, hasHighlight: true, language: 'en', blockedReason: null, format: 'VERTICAL_9_16' as const, ...over });
  const hd = (text: string, over: Record<string, unknown> = {}) => ({ ...item({ type: 'HEADLINE', mode: 'replace', text, highlight: null, sources: {}, ...over } as unknown as AutoItemDraft['params']), type: 'HEADLINE' }) as unknown as AutoItemDraft;
  const run = (its: AutoItemDraft[], c: PlanCtx) => validatePlan(draft([...goodItems().slice(9), ...its]), c, allowedFor(c)).filter((v) => v.item !== null && v.item >= 2).map((v) => `${v.item}:${v.rule}`);
  it('allowed: replace = 3, add = 2, bloqueado com motivo; sem info = fora da lista; código HEADLINE-<n>', () => {
    expect(allowedFor(ctx({ headline: H() }))[0]).toEqual({ type: 'HEADLINE', max: 3, blockedReason: null });
    expect(allowedFor(ctx({ headline: H({ mode: 'add', original: null }) }))[0]).toEqual({ type: 'HEADLINE', max: 2, blockedReason: null });
    expect(allowedFor(ctx({ headline: H({ blockedReason: 'headline_over_face' }) }))[0]).toEqual({ type: 'HEADLINE', max: 0, blockedReason: 'headline_over_face' });
    expect(allowedFor(ctx()).some((a) => a.type === 'HEADLINE')).toBe(false);
    expect([codeFor('HEADLINE', null, 1, 'EN'), codeFor('HEADLINE', null, 3, 'PT')]).toEqual(['HEADLINE-1', 'HEADLINE-3']);
    expect(AXIS_OF.HEADLINE).toBe('ITERATION');
  });
  it('validação: limite, destaque, diferente da original e entre si, nada inventado, modo', () => {
    const c = ctx({ headline: H() });
    expect(run([hd('Sleep in 10 minutes'), hd('Busy parents sleep too'), hd('Ana finally sleeps')], c)).toEqual([]);
    expect(run([hd('x'.repeat(25))], c)).toEqual(['2:headline_too_long']);
    expect(run([hd('tired every morning')], c)).toEqual(['2:headline_same_as_original']);
    expect(run([hd('Sleep in 10 minutes'), hd('sleep in 10 minutes!')], c)).toEqual(['3:duplicate']);
    expect(run([hd('Sleep in 75 minutes')], c)).toEqual(['2:invented_number']);
    expect(run([hd('Sleep in 10 minutes', { highlight: '10 hours' })], c)).toEqual(['2:headline_highlight']);
    expect(run([hd('Sleep in 10 minutes', { mode: 'add' })], c)).toEqual(['2:headline_mode']);
    expect(run([hd('Sleep in 10 minutes', { highlight: '10 minutes' })], ctx({ headline: H({ hasHighlight: false }) }))).toEqual(['2:headline_highlight']);
  });
  it('reparo tira CUT antes de HEADLINE; finalize grava modo, idioma, original e o aspecto', () => {
    const c = ctx({ headline: H() });
    const fb = { why: fallbackWhy({ hookSpoken: 'h', proof: 'p', cta: 'c' }, 'v'), kept: [{ label: 'Hook', blockIndex: 0 }, { label: 'CTA', blockIndex: 4 }] };
    // 8 peças: 3 HEADLINE + 2 CUT (ITERATION 5) + 3 STATIC/NS (DIVERSITY 3 < 4)
    const its = [hd('Sleep in 10 minutes'), hd('Busy parents sleep too'), hd('Ana finally sleeps'), goodItems()[0], item({ type: 'CUT', targetSec: 20, blockIndexes: [0, 3, 4] }), goodItems()[9], goodItems()[10], item({ type: 'NATIVE_SEARCH', query: 'sleep tips for parents' })];
    const r = repairPlan(draft(its), c, allowedFor(c), fb);
    expect(r.draft.items.filter((x) => (x.type as string) === 'HEADLINE')).toHaveLength(3);
    expect(r.draft.items.filter((x) => x.type === 'CUT')).toHaveLength(1);
    const out = finalizePlan(draft([hd(' Sleep  in 10 minutes ')]), c, regrasDeMidiaFallback)[0];
    expect(out).toMatchObject({ code: 'HEADLINE-1', axis: 'ITERATION', params: { type: 'HEADLINE', mode: 'replace', text: 'Sleep in 10 minutes', language: 'en', original: 'Tired every morning?', format: 'VERTICAL_9_16' } });
  });
});

// tipos só pra o compilador conferir o shape do allowed no teste
export type _A = AllowedType;
