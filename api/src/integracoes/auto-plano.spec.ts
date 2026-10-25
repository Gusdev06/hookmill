// Variação automática v1 (I1): planAutoBatch (real com transporte falso + mock determinístico) e estimateAutoAnalysis.
// Nenhuma chamada paga: o SDK nunca é instanciado aqui.
import type { AutoPlanInput, AutoVariationType, AutoVariationTypeWithFrame, Measurements, OfferBriefDraft, TranscriptWord } from './contrato';
import { CatalogServiceImpl } from './catalogo/catalog.service';
import { AUTO_PLAN_SCHEMA, AUTO_PLAN_SYSTEM, AUTO_TYPES, autoPlanContext, autoPlanUserMessage, clip, parseAutoPlan } from './claude/auto-plano';
import { ClaudeLiveService } from './claude/claude.service';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './claude/transporte';
import { FakeClaudeService, mockTeardown } from './mock/fake-claude.service';
import { FRAMES_DETAIL_SCHEMA, STATIC_DETAIL_SCHEMA } from './claude/auto-plano-detalhe';
import { staticCopyLength } from './claude/auto-plano-estatico';
import { MemoryCostStore } from './store/memoria.store';
import { isIntegracaoError } from './erros';

function speak(sentences: string[], start = 0.2): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let t = start;
  for (const s of sentences) {
    for (const w of s.split(' ')) {
      out.push({ word: w, startSec: Math.round(t * 1000) / 1000, endSec: Math.round((t + 0.3) * 1000) / 1000 });
      t += 0.38;
    }
    t += 0.5;
  }
  return out;
}
const WORDS = speak([
  'If your back hurts every morning, watch this.',
  'I tried pillows, stretches and pills and nothing worked.',
  'Then I found this simple routine that takes almost no time.',
  'My neighbor tried it too and she sleeps through the night now.',
  'Tap the link below and start tonight.',
]);
const DUR = Math.ceil(WORDS[WORDS.length - 1].endSec + 0.5);
const M: Omit<Measurements, 'keyframes'> = {
  durationSec: DUR, width: 1080, height: 1920, fps: 30, hasAudio: true, cuts: [{ atSec: 4, kind: 'content' }],
  segments: [], palette: ['#ffffff'], silences: [],
};
const OFFER: OfferBriefDraft = {
  name: 'Calma', language: 'en', kind: 'App', what: 'A short night routine.', audience: 'Adults with back pain', promise: 'Wake up without back pain',
  pains: 'Stiff back every morning', proof: '"I slept the whole night for the first time." Ana, verified buyer', offerAndPrice: '7-day free trial, then $9/month',
  cta: 'Start tonight', notes: null,
};

function input(over: Partial<AutoPlanInput> = {}): AutoPlanInput {
  const teardown = mockTeardown('EN', WORDS, M, null, 8);
  return {
    workspaceId: 'w1', batchId: 'b1', jobId: 'j1', uiLocale: 'EN', screenLanguage: 'en-US', offer: OFFER,
    workspace: { name: 'Calma', industry: 'health', market: 'US' },
    page: { captured: true, text: 'Calma. Sleep better tonight. 7-day free trial.' },
    teardown, transcript: WORDS,
    media: { durationSec: DUR, cuts: 1, silences: [{ startSec: 3.4, endSec: 3.9 }], hasWrittenHook: false, hasEndCard: false },
    keyframes: [{ atSec: 0, reason: 't0', url: 'https://x/0.jpg' }],
    // catálogo dos lotes novos (25/10): CUT, REVIEW, NATIVE_SEARCH, STATIC (2) e FRAME (8); os antigos ficam no allowed
    // pra provar que o plano novo não os usa mais
    allowed: [
      { type: 'CUT', max: 2 }, { type: 'COLD_OPEN', max: 1 }, { type: 'HOOK_TEXT', max: 3 }, { type: 'ENDCARD', max: 1 },
      { type: 'SPLIT_LP', max: 1 }, { type: 'STORY', max: 1 }, { type: 'REVIEW', max: 1 }, { type: 'NATIVE_SEARCH', max: 2 }, { type: 'STATIC', max: 2 },
      { type: 'FRAME' as AutoVariationType, max: 8 },
    ],
    rules: { min: 8, max: 12, minDiversityPct: 40 },
    ...over,
  };
}

const DIV: AutoVariationType[] = ['SPLIT_LP', 'STORY', 'REVIEW', 'NATIVE_SEARCH', 'STATIC', 'FRAME' as AutoVariationType];

/** `calls` = só as chamadas do PLANO (1ª etapa); a 2ª etapa (STATIC/FRAME, bug live 25/10) vai pra `details`. */
class FakeTransport implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  details: ClaudeCall[] = [];
  constructor(private readonly reply: (call: ClaudeCall, n: number) => ClaudeResult | Error, private readonly detail: (call: ClaudeCall) => ClaudeResult = () => DETAIL_RES) {}
  async run(call: ClaudeCall): Promise<ClaudeResult> {
    if (call.schema === STATIC_DETAIL_SCHEMA || call.schema === FRAMES_DETAIL_SCHEMA) {
      this.details.push(call);
      return this.detail(call);
    }
    const n = this.calls.push(call) - 1;
    const r = this.reply(call, n);
    if (r instanceof Error) throw r;
    return r;
  }
}
const usage = [{ model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 2000, cacheWriteTokens: 0, cacheReadTokens: 0 }];
const res = (obj: unknown, stopReason = 'end_turn'): ClaudeResult => ({ text: typeof obj === 'string' ? obj : JSON.stringify(obj), stopReason, usage });

const DETAIL = {
  copy: { brandLine: 'A short night routine', brandLineSource: 'what', tagline: '', headline: { lead: 'You were not born to wake up', highlight: 'with back pain.' }, headlineSource: 'pains',
    subheadline: '', subheadlineSource: 'none', handwritten: '', benefits: [], trust: [], cta: { main: 'Start tonight', sub: '', subSource: 'none' }, closing: '' },
  visualV2: { hero: { person: 'A woman in her forties', setting: 'sitting on the bed', emotion: 'relief', light: 'warm lamp light' }, product: { kind: 'phone_screen', look: 'tilted', screenTitle: '', screenTitleSource: 'none' }, mood: 'hopeful' },
};
const DETAIL_RES: ClaudeResult = { text: JSON.stringify(DETAIL), stopReason: 'end_turn', usage: [{ model: 'claude-opus-5-5', inputTokens: 100, outputTokens: 100, cacheWriteTokens: 0, cacheReadTokens: 0 }] };
const NO_VISUAL = { object: '', scene: '', vibe: '', style: 'none', headlinePlacement: 'none' };
const EMPTY = { targetSec: 0, blockIndexes: [], teaserStartSec: 0, teaserEndSec: 0, text: '', variant: 'none', headline: '', subline: '', ctaText: '', quote: '', author: '', stars: 0, query: '', refAtSec: -1, visual: NO_VISUAL };
const VISUAL = {
  object: 'A woman in her forties in a grey sweater, sitting up in bed, stretching her arms',
  scene: 'a bright bedroom in the morning, rumpled white sheets, a glass of water on the nightstand',
  vibe: 'relieved and rested, soft window light from the left, early morning',
  style: 'everyday_photo', headlinePlacement: 'top',
};
/** keyframes sem rede: um JPEG mínimo (só a assinatura importa pro imageTypeOf) */
const jpegFetch = (async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), { status: 200, headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
const GOOD = {
  blocks: [{ index: 0, fn: 'hook' }, { index: 1, fn: 'problem' }, { index: 99, fn: 'cta' }],
  why: {
    hook: { text: 'Names the morning pain in the first second.', source: 'brain', brainField: 'pains', ref: 'Stiff back every morning' },
    proof: { text: 'A neighbor story makes it believable.', source: 'brain', brainField: 'notes', ref: 'x' }, // notes vazio → vídeo
    cta: { text: 'One soft ask.', source: 'video', brainField: 'none', ref: 'whatever' },
  },
  kept: [{ label: 'Spoken hook', blockIndex: 0 }, { label: 'spoken hook', blockIndex: 0 }, { label: 'Original voice', blockIndex: -1 }],
  items: [
    { type: 'CUT', change: 'Cut to 15 s', rationale: 'r', whyKey: 'hook', params: { ...EMPTY, targetSec: 15, blockIndexes: [3, 0, 0, 42] } },
    { type: 'ENDCARD', change: 'Offer end card', rationale: 'r', whyKey: 'cta', params: { ...EMPTY, variant: 'offer', headline: 'Calma', subline: '', ctaText: 'Start tonight' } },
    { type: 'REVIEW', change: 'Review card', rationale: 'r', whyKey: 'proof', params: { ...EMPTY, quote: '  "I slept the whole night for the first time."  ', stars: 0 } },
    { type: 'STATIC', change: 'New image: a woman stretching in bed', rationale: 'r', whyKey: 'proof', params: { ...EMPTY, refAtSec: 999, headline: 'Wake up without back pain', visual: { ...VISUAL, object: `  ${VISUAL.object}  ${'very '.repeat(60)}` } } },
    { type: 'SPLIT_LP', change: 'Page on top', rationale: 'r', whyKey: 'cta', params: { ...EMPTY, headline: 'ignored' } },
  ],
};

describe('planAutoBatch real (transporte falso)', () => {
  it('uma chamada: sistema estável, contexto cacheável, esquema, custo no lote; normaliza a saída', async () => {
    const costs = new MemoryCostStore();
    const t = new FakeTransport(() => res(GOOD));
    const svc = new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5', fetchImpl: jpegFetch });
    const stages: string[] = [];
    const out = await svc.planAutoBatch(input(), (s) => stages.push(s));

    expect(stages).toEqual(['planning']);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].system).toBe(AUTO_PLAN_SYSTEM);
    expect(t.calls[0].schema).toBe(AUTO_PLAN_SCHEMA);
    // STATIC em allowed: o frame-chave vai como REFERÊNCIA (imagem com legenda) e o pedido explica
    expect(t.calls[0].images).toHaveLength(1);
    expect(t.calls[0].images![0].caption).toMatch(/^Reference for STATIC only\. Frame at 0 s/);
    expect(t.calls[0].user).toContain('the 1 images attached right before this request are key frames');
    expect(t.calls[0].context).toContain('[proof] "I slept the whole night');
    expect(t.calls[0].context).toContain('[notes] (empty)');
    expect(t.calls[0].user).toContain('Screen language');
    expect(t.calls[0].user).not.toContain('previous plan');

    // 2ª etapa: 1 chamada pro STATIC, mesmo sistema e contexto (cache), esquema pequeno, mesmas imagens de referência
    expect(t.details).toHaveLength(1);
    expect(t.details[0]).toMatchObject({ system: AUTO_PLAN_SYSTEM, context: t.calls[0].context, schema: STATIC_DETAIL_SCHEMA });
    expect(t.details[0].images).toHaveLength(1);
    expect(t.details[0].user).toContain('attacks the proof line ("A neighbor story makes it believable.")');
    // custo: plano 1000 in × 4 + 2000 out × 20 = 0,044; detalhe 100 × 4 + 100 × 20 = 0,0024 (por milhão)
    expect(out.costUsd).toBeCloseTo(0.0464, 6);
    expect(costs.entries.every((e) => e.variationBatchId === 'b1' && e.kind === 'LLM' && e.jobId === 'j1')).toBe(true);
    expect(costs.entries.reduce((a, e) => a + e.amountUsd, 0)).toBeCloseTo(0.0464, 4);

    // porquê: Brain só com campo preenchido
    expect(out.why.hook).toEqual({ text: 'Names the morning pain in the first second.', source: 'brain', brainField: 'pains', ref: 'Stiff back every morning' });
    expect(out.why.proof).toMatchObject({ source: 'video', brainField: null, ref: 'From the video' });
    expect(out.why.cta).toMatchObject({ source: 'video', brainField: null });
    // blocos: um por bloco do teardown; índice fora some; faltando vira 'other'
    const n = input().teardown.structure.data!.blocks.length;
    expect(out.blocks).toHaveLength(n);
    expect(out.blocks[0].fn).toBe('hook');
    expect(out.blocks.slice(2).every((b) => b.fn === 'other')).toBe(true);
    // kept: sem duplicata (caixa), -1 → null
    expect(out.kept).toEqual([{ label: 'Spoken hook', blockIndex: 0 }, { label: 'Original voice', blockIndex: null }]);
    // params por tipo
    expect(out.items.map((x) => x.type)).toEqual(['CUT', 'ENDCARD', 'REVIEW', 'STATIC', 'SPLIT_LP']);
    expect(out.items[0].params).toEqual({ type: 'CUT', targetSec: 15, blockIndexes: [0, 3] });
    expect(out.items[1].params).toEqual({ type: 'ENDCARD', variant: 'offer', headline: 'Calma', subline: null, ctaText: 'Start tonight' });
    expect(out.items[2].params).toEqual({ type: 'REVIEW', quote: '"I slept the whole night for the first time."', author: null, stars: null });
    // STATIC: refAtSec dentro do vídeo, atSec legado = refAtSec; copy/visualV2 da 2ª etapa; headline legado = lead + highlight
    const st = out.items[3].params;
    expect(st).toMatchObject({ type: 'STATIC', layout: 'assembled', atSec: DUR, refAtSec: DUR, headline: 'You were not born to wake up with back pain.' });
    if (st.type !== 'STATIC') throw new Error('not static');
    expect(st.copy).toMatchObject({ brandLine: 'A short night routine', tagline: null, subheadline: null, subheadlineSource: null, cta: { main: 'Start tonight', sub: null } });
    expect(st.visualV2).toMatchObject({ hero: { emotion: 'relief' }, product: { kind: 'phone_screen', screenTitle: null } });
    expect(out.items[4].params).toEqual({ type: 'SPLIT_LP' });
  });

  it('reparo: a 2ª chamada leva as violations no pedido e reaproveita sistema + contexto (cache)', async () => {
    const t = new FakeTransport(() => res(GOOD));
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' });
    await svc.planAutoBatch(input(), () => undefined);
    await svc.planAutoBatch(input({ violations: ['diversity 2/5 < 40%', 'CUT 3 > max 2'] }), () => undefined);
    expect(t.calls[1].system).toBe(t.calls[0].system);
    expect(t.calls[1].context).toBe(t.calls[0].context);
    expect(t.calls[1].user).toContain('- diversity 2/5 < 40%');
    expect(t.calls[1].user).toContain('- CUT 3 > max 2');
  });

  it('resposta inútil tenta 1x de novo (e cobra as duas); recusa e max_tokens não repetem', async () => {
    const costs = new MemoryCostStore();
    const t = new FakeTransport((_, n) => (n === 0 ? res('not json') : res(GOOD)));
    const out = await new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5' }).planAutoBatch(input(), () => undefined);
    expect(t.calls).toHaveLength(2);
    expect(out.costUsd).toBeCloseTo(0.0904, 6);
    // 2ª etapa que falha 2x: a peça STATIC sai, o resto do plano fica
    const badDetail = new FakeTransport(() => res(GOOD), () => res('not json'));
    const lean = await new ClaudeLiveService(badDetail, new MemoryCostStore(), { model: 'm' }).planAutoBatch(input(), () => undefined);
    expect(badDetail.details).toHaveLength(2);
    expect(lean.items.map((x) => x.type)).toEqual(['CUT', 'ENDCARD', 'REVIEW', 'SPLIT_LP']);

    const noItems = new FakeTransport(() => res({ ...GOOD, items: [] }));
    await expect(new ClaudeLiveService(noItems, new MemoryCostStore(), { model: 'm' }).planAutoBatch(input(), () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(noItems.calls).toHaveLength(2);

    const refusal = new FakeTransport(() => res('', 'refusal'));
    await expect(new ClaudeLiveService(refusal, new MemoryCostStore(), { model: 'm' }).planAutoBatch(input(), () => undefined)).rejects.toMatchObject({ code: 'SAFETY_BLOCK' });
    expect(refusal.calls).toHaveLength(1);

    const cut = new FakeTransport(() => res('{"blocks":', 'max_tokens'));
    await expect(new ClaudeLiveService(cut, new MemoryCostStore(), { model: 'm' }).planAutoBatch(input(), () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(cut.calls).toHaveLength(1);
  });

  it('sem STATIC em allowed não manda imagem; frame que não baixa = sem imagem e o pedido avisa', async () => {
    const t = new FakeTransport(() => res(GOOD));
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'm', fetchImpl: jpegFetch }).planAutoBatch(input({ allowed: [{ type: 'CUT', max: 2 }, { type: 'STATIC', max: 0 }] }), () => undefined);
    expect(t.calls[0].images ?? []).toHaveLength(0);
    expect(t.calls[0].user).not.toContain('STATIC is allowed');

    const broken = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const t2 = new FakeTransport(() => res(GOOD));
    await new ClaudeLiveService(t2, new MemoryCostStore(), { model: 'm', fetchImpl: broken }).planAutoBatch(input(), () => undefined);
    expect(t2.calls[0].images ?? []).toHaveLength(0);
    expect(t2.calls[0].user).toContain('no key frame image could be attached');

    // até 4 frames, espalhados no tempo (baixados uma vez por planAutoBatch; a nova tentativa interna reusa)
    const many = Array.from({ length: 8 }, (_, k) => ({ atSec: k * 2, reason: `k${k}`, url: `https://frames.test/${k}.jpg` }));
    const t3 = new FakeTransport(() => res(GOOD));
    await new ClaudeLiveService(t3, new MemoryCostStore(), { model: 'm', fetchImpl: jpegFetch }).planAutoBatch(input({ keyframes: many }), () => undefined);
    expect(t3.calls[0].images).toHaveLength(4);
  });

  it('STATIC: refAtSec -1 = null (atSec legado 0); style/posição fora do enum caem no padrão; plano antigo com atSec é lido', () => {
    const ctx = { uiLocale: 'EN' as const, durationSec: DUR, blockCount: 5, offer: OFFER, pageCaptured: true };
    const one = (params: Record<string, unknown>) => JSON.stringify({ ...GOOD, items: [{ type: 'STATIC', change: 'c', rationale: 'r', whyKey: 'hook', params: { ...EMPTY, headline: 'h', ...params } }] });
    expect(parseAutoPlan(one({ refAtSec: -1, visual: VISUAL }), ctx).items[0].params).toMatchObject({ refAtSec: null, atSec: 0 });
    expect(parseAutoPlan(one({ refAtSec: 3.456, visual: { ...VISUAL, style: 'none', headlinePlacement: 'none' } }), ctx).items[0].params).toMatchObject({
      refAtSec: 3.46, atSec: 3.46, visual: { style: 'everyday_photo', headlinePlacement: 'top' },
    });
    const legacy = JSON.stringify({ ...GOOD, items: [{ type: 'STATIC', change: 'c', rationale: 'r', whyKey: 'hook', params: { headline: 'h', atSec: 2 } }] });
    expect(parseAutoPlan(legacy, ctx).items[0].params).toMatchObject({ refAtSec: 2, atSec: 2, visual: { object: '', scene: '', vibe: '' } });
  });

  it('PT: "Do vídeo" no ref; página não capturada não pode ser citada', () => {
    const json = JSON.stringify({ ...GOOD, why: { ...GOOD.why, hook: { text: 'x', source: 'brain', brainField: 'page', ref: 'p' } } });
    const ctx = { uiLocale: 'PT_BR' as const, durationSec: DUR, blockCount: 5, offer: OFFER, pageCaptured: false };
    expect(parseAutoPlan(json, ctx).why.hook).toEqual({ text: 'x', source: 'video', brainField: null, ref: 'Do vídeo' });
    expect(parseAutoPlan(json, { ...ctx, pageCaptured: true }).why.hook).toMatchObject({ source: 'brain', brainField: 'page' });
  });
});

describe('esquema e prompt do planAutoBatch', () => {
  it('sem union (limite de 16 da saída estruturada), tudo required e sem propriedade extra', () => {
    const txt = JSON.stringify(AUTO_PLAN_SCHEMA);
    expect(txt).not.toMatch(/anyOf|oneOf|"null"/);
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
      }
      Object.values(o).forEach(walk);
    };
    walk(AUTO_PLAN_SCHEMA);
    const types = (AUTO_PLAN_SCHEMA.properties.items as { items: { properties: { type: { enum: string[] } } } }).items.properties.type.enum;
    expect(types).toEqual(['CUT', 'REVIEW', 'NATIVE_SEARCH', 'STATIC', 'FRAME']); // catálogo novo 25/10 (PLAN_TYPES)
  });

  it('sistema não muda por lote (cache) e não nomeia nicho; contexto não leva a pessoa do campeão', () => {
    expect(AUTO_PLAN_SYSTEM).not.toMatch(/Calma|back pain/i);
    const td = input().teardown;
    const withPerson = { ...td, visual: { ...td.visual, status: 'ok' as const, data: { ...td.visual.data!, person: 'PERSON-MARKER woman in her 30s' } } };
    expect(autoPlanContext(input({ teardown: withPerson }))).not.toContain('PERSON-MARKER');
    expect(autoPlanContext(input({ page: { captured: false, text: null } }))).toContain('captured="false"');
    const long = 'x'.repeat(9000);
    expect(autoPlanContext(input({ page: { captured: true, text: long } }))).toContain('x'.repeat(4000) + '\n</page>');
    expect(autoPlanUserMessage(input({ uiLocale: 'PT_BR', screenLanguage: 'pt-BR' }))).toMatch(/Brazilian Portuguese[\s\S]*Portuguese \(pt-BR\)/);
    expect(autoPlanUserMessage(input({ allowed: [{ type: 'STORY', max: 1 }, { type: 'REVIEW', max: 0 }] }))).not.toContain('REVIEW');
  });

  it('regras do STATIC no prompt (V2 §A2): imagem nova, montada em blocos, nada inventado por bloco, frames só como referência', () => {
    expect(AUTO_PLAN_SYSTEM).toContain('a NEW single-image ad');
    expect(AUTO_PLAN_SYSTEM).toContain('assembled direct-response poster');
    expect(AUTO_PLAN_SYSTEM).toMatch(/REFERENCE only[\s\S]*Never copy a frame/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/No data for a block = leave it empty/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/Never write the brand name in any text/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/hook → pain or curiosity, proof → relief or pride, cta → desire/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/Two STATIC pieces in the same batch need different emotions and different headlines/);
    const params = (AUTO_PLAN_SCHEMA.properties.items as { items: { properties: { params: { properties: Record<string, unknown> } } } }).items.properties.params.properties;
    expect(params.visual).toBeUndefined();
    expect(params.copy).toBeUndefined(); // 2ª etapa (bug live 25/10)
    expect(Object.keys(params)).toEqual(expect.arrayContaining(['refAtSec', 'emotion', 'concept', 'template']));
    const detail = STATIC_DETAIL_SCHEMA.properties as Record<string, { properties: Record<string, unknown> }>;
    expect(Object.keys(detail.copy.properties)).toEqual(['brandLine', 'brandLineSource', 'tagline', 'headline', 'headlineSource', 'subheadline', 'subheadlineSource', 'handwritten', 'benefits', 'trust', 'cta', 'closing']);
    expect(Object.keys(detail.visualV2.properties)).toEqual(['hero', 'product', 'mood']);
    expect(params.atSec).toBeUndefined();
  });

  it('clip corta em fronteira de palavra', () => {
    expect(clip('one two three four', 9)).toBe('one two');
    expect(clip('short', 9)).toBe('short');
    expect(clip('supercalifragilistic', 5)).toBe('super');
  });
});

describe('planAutoBatch mock (§10)', () => {
  const fake = () => new FakeClaudeService(new MemoryCostStore(), { model: 'mock', stepMs: 0 });

  function checkRules(i: AutoPlanInput, items: { type: AutoVariationTypeWithFrame; params: { type: string } }[]) {
    const max = new Map(i.allowed.map((a) => [a.type, a.max]));
    const count = new Map<string, number>();
    for (const it of items) {
      expect(it.params.type).toBe(it.type);
      count.set(it.type, (count.get(it.type) ?? 0) + 1);
    }
    for (const [ty, c] of count) expect(c).toBeLessThanOrEqual(max.get(ty as AutoVariationTypeWithFrame) ?? 0);
    const div = items.filter((x) => (DIV as readonly AutoVariationTypeWithFrame[]).includes(x.type)).length;
    expect(div).toBeGreaterThanOrEqual(Math.ceil(items.length * 0.4));
  }

  it('determinístico, 8-12 peças, regras de contagem e diversidade, sem número inventado na tela', async () => {
    const i = input();
    const a = await fake().planAutoBatch(i, () => undefined);
    const b = await fake().planAutoBatch(i, () => undefined);
    expect(a).toEqual(b);
    expect(a.costUsd).toBe(0);
    expect(a.items.length).toBeGreaterThanOrEqual(8);
    expect(a.items.length).toBeLessThanOrEqual(12);
    checkRules(i, a.items);
    expect(a.items.every((x) => ['CUT', 'REVIEW', 'NATIVE_SEARCH', 'STATIC', 'FRAME'].includes(x.type))).toBe(true); // catálogo novo
    const fr = a.items.filter((x) => (x.type as string) === 'FRAME').map((x) => (x.params as unknown as { template: string }).template);
    expect(fr.length).toBeGreaterThanOrEqual(3);
    expect(new Set(fr).size).toBe(fr.length); // templates diferentes
    expect(a.why.hook.source).toBe('brain');
    expect(a.kept.length).toBeGreaterThanOrEqual(2);
    expect(a.kept.length).toBeLessThanOrEqual(4);
    for (const it of a.items) {
      const p = it.params as Record<string, unknown>;
      for (const k of ['text', 'headline', 'query']) if (typeof p[k] === 'string') expect(p[k]).not.toMatch(/\d/);
      if (it.params.type === 'REVIEW') expect(OFFER.proof).toContain(it.params.quote);
      if (it.params.type === 'CUT') expect(it.params.blockIndexes[0]).toBe(0);
      if (it.params.type === 'COLD_OPEN') expect(it.params.teaserStartSec).toBeGreaterThanOrEqual(5);
    }
    // STATIC V2 (§A2): copy por bloco com fonte, visual v2 em inglês sem aspas nem marca, emoções e headlines diferentes
    const statics = a.items.filter((x) => x.params.type === 'STATIC').map((x) => x.params as Extract<typeof x.params, { type: 'STATIC' }>);
    expect(statics).toHaveLength(2);
    for (const st of statics) {
      expect(st.layout).toBe('assembled');
      expect(st.copy!.headline.lead && st.copy!.headline.highlight).toBeTruthy();
      expect(st.headline).toBe(`${st.copy!.headline.lead} ${st.copy!.headline.highlight}`); // legado da TRANSIÇÃO
      expect(['promise', 'pains', 'transcript']).toContain(st.copy!.headlineSource);
      expect(JSON.stringify([st.visualV2!.hero, st.visualV2!.mood, st.visualV2!.product.look])).not.toMatch(/[“”]|\\"|Calma/); // screenTitle pode vir do name (§A3.1)
      expect(JSON.stringify([st.copy!.benefits, st.copy!.trust, st.copy!.subheadline])).not.toContain('Calma');
      expect(st.refAtSec).toBe(0); // único frame-chave do input
      expect(staticCopyLength(st.copy!)).toBeLessThanOrEqual(420);
    }
    expect(statics[0].headline.toLowerCase()).not.toBe(statics[1].headline.toLowerCase());
    expect(statics[0].visualV2!.hero!.emotion).not.toBe(statics[1].visualV2!.hero!.emotion);
    expect(a.items.find((x) => x.type === 'STATIC')!.change).toMatch(/^Assembled ad: /);
  });

  it('sem Brain e sem página: lote menor, mas nunca abaixo das regras de diversidade', async () => {
    const i = input({
      offer: { ...OFFER, proof: null, offerAndPrice: null, pains: null, audience: null, promise: null, cta: null },
      page: { captured: false, text: null },
      allowed: [{ type: 'CUT', max: 1 }, { type: 'HOOK_TEXT', max: 3 }, { type: 'ENDCARD', max: 1 }, { type: 'STORY', max: 1 }, { type: 'STATIC', max: 2 }, { type: 'NATIVE_SEARCH', max: 2 }, { type: 'SPLIT_LP', max: 1 }],
    });
    const out = await fake().planAutoBatch(i, () => undefined);
    checkRules(i, out.items);
    expect(out.items.some((x) => x.type === 'SPLIT_LP')).toBe(false);
    expect(out.why.proof).toMatchObject({ source: 'video', brainField: null });
  });

  it('[mock:page-403] tira SPLIT_LP; [mock:auto-fail:planning] falha; [mock:auto-plan-invalid] viola nas duas chamadas', async () => {
    const page403 = await fake().planAutoBatch(input({ offer: { ...OFFER, notes: '[mock:page-403]' } }), () => undefined);
    expect(page403.items.some((x) => x.type === 'SPLIT_LP')).toBe(false);

    await expect(fake().planAutoBatch(input({ offer: { ...OFFER, notes: '[mock:auto-fail:planning]' } }), () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });

    for (const violations of [undefined, ['HOOK_TEXT 12 > max 3']]) {
      const bad = await fake().planAutoBatch(input({ offer: { ...OFFER, notes: '[mock:auto-plan-invalid]' }, violations }), () => undefined);
      expect(bad.items.every((x) => x.type === 'HOOK_TEXT')).toBe(true);
      expect(bad.items.length).toBe(12);
      expect(bad.items.every((x) => x.params.type === 'HOOK_TEXT' && /\d/.test(x.params.text))).toBe(true);
    }
  });

  it('[mock:auto-fail:reading] derruba o analyzeChampion', async () => {
    const err = await fake()
      .analyzeChampion({ workspaceId: 'w', championId: 'c', jobId: 'j', uiLocale: 'EN', offer: { ...OFFER, notes: '[mock:auto-fail:reading]' }, transcript: { language: 'en', words: WORDS }, measurements: M, keyframes: [], adMeta: null }, () => undefined)
      .catch((e) => e);
    expect(isIntegracaoError(err) && err.code).toBe('PROVIDER_ERROR');
  });
});

describe('estimateAutoAnalysis', () => {
  const catalog = new CatalogServiceImpl({ voiceSampleUrl: () => '' });
  it('= análise do campeão + plano; planOnly = só o plano; cresce com a duração', () => {
    const full = catalog.estimateAutoAnalysis(30);
    const plan = catalog.estimateAutoAnalysis(30, { planOnly: true });
    expect(full).toBeCloseTo(catalog.estimateAnalysis(30, 12) + plan, 3);
    expect(plan).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(0.06); // o mockup dizia ~US$ 0,06 (placeholder; §9)
    expect(catalog.estimateAutoAnalysis(120)).toBeGreaterThan(full);
    expect(catalog.estimateAutoAnalysis(30, { keyframeCount: 16 })).toBeGreaterThan(full);
    // rev. 23/10: o plano conta as 4 imagens de referência do STATIC (4 × 1600 tokens × US$ 4/M = 0,0256)
    const noRefs = ((7000 + 30 * 25) * 4 + 6000 * 20) / 1e6;
    // 25/10: + 2ª etapa: 2 STATIC (4000 × 4 + (8000 + 750) × 0,2 + 2500 × 20) + 1 de molduras ((10000 + 750) × 4 + 4000 × 20), por milhão
    const details = (2 * (4000 * 4 + 8750 * 0.2 + 2500 * 20) + (10750 * 4 + 4000 * 20)) / 1e6;
    expect(plan).toBeCloseTo(noRefs + 0.0256 + details, 4);
  });
});
