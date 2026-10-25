// estatico-montado-e-molduras-v1 B1-I (25/10): FRAME no esquema/prompt do planAutoBatch, leitura dos textos por template,
// STATIC V2 no parse e o fake (2 molduras distintas, textos do Brain com fonte). Nenhuma chamada paga.
import type { AutoPlanInput, OfferBriefDraft, StaticCopy, TranscriptWord } from './contrato';
import { AUTO_PLAN_SCHEMA, AUTO_PLAN_SYSTEM, autoPlanUserMessage, parseAutoPlan, type AutoPlanInputWithFrame } from './claude/auto-plano';
import { staticCopyOf, staticVisualV2Of } from './claude/auto-plano-estatico';
import { FRAME_TEMPLATES, allowedFramesOf, cutWidth, defaultAllowedFrames, frameParamsOf, frameText, frameTextsOf, textWidth } from './claude/auto-plano-moldura';
import { ClaudeLiveService } from './claude/claude.service';
import { FRAMES_DETAIL_SCHEMA, FRAME_DETAIL_SCHEMA, STATIC_DETAIL_SCHEMA, detailTargets, framesByIndex, framesDetailMessage, mergeDetails } from './claude/auto-plano-detalhe';
import { schemaStats } from './claude/schema-stats';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './claude/transporte';
import { FakeClaudeService, mockTeardown } from './mock/fake-claude.service';
import { mockAutoPlan } from './mock/fake-auto-plan';
import { MemoryCostStore } from './store/memoria.store';

const words = (text: string): TranscriptWord[] => text.split(' ').map((w, k) => ({ word: w, startSec: k * 0.4, endSec: k * 0.4 + 0.3 }));
const WORDS = words('If your back hurts every morning watch this. My neighbor tried it and she sleeps through the night now. Tap the link and start tonight.');
const OFFER: OfferBriefDraft = {
  name: 'Calma', language: 'en', kind: 'App', what: 'A short night routine.', audience: 'Adults with back pain', promise: 'Wake up without back pain',
  pains: 'Stiff back every morning', proof: '"I slept the whole night for the first time." Ana', offerAndPrice: 'From $19.90 to $9.90 per month',
  cta: 'Start tonight', notes: null,
};
function input(over: Partial<AutoPlanInputWithFrame> = {}): AutoPlanInputWithFrame {
  return {
    workspaceId: 'w1', batchId: 'b1', jobId: 'j1', uiLocale: 'EN', screenLanguage: 'en-US', offer: OFFER,
    workspace: { name: 'Calma', industry: 'health', market: 'US' }, page: { captured: true, text: 'Calma.' },
    teardown: mockTeardown('EN', WORDS, { durationSec: 12, width: 1080, height: 1920, fps: 30, hasAudio: true, cuts: [], segments: [], palette: [], silences: [] }, null, 4),
    transcript: WORDS, media: { durationSec: 12, cuts: 0, silences: [], hasWrittenHook: false, hasEndCard: false },
    keyframes: [{ atSec: 0, reason: 't0', url: 'https://x/0.jpg' }],
    allowed: [{ type: 'CUT', max: 2 }, { type: 'HOOK_TEXT', max: 3 }, { type: 'STORY', max: 1 }, { type: 'STATIC', max: 2 }, { type: 'FRAME', max: 2 }, { type: 'NATIVE_SEARCH', max: 2 }],
    rules: { min: 8, max: 12, minDiversityPct: 40 },
    ...over,
  };
}
const ctx = (allowedFrames = FRAME_TEMPLATES) => ({ uiLocale: 'EN' as const, durationSec: 12, blockCount: 3, offer: OFFER, pageCaptured: true, allowedFrames });
const why = { text: 'x', source: 'video', brainField: 'none', ref: '' };
const plan = (items: unknown[]) => JSON.stringify({ blocks: [], why: { hook: why, proof: why, cta: why }, kept: [], items });

describe('FRAME no esquema e no prompt', () => {
  it('template no plano (string) e textos na 2ª etapa (campos planos sem union); regras por template no sistema; interface fora da IA', () => {
    const params = (AUTO_PLAN_SCHEMA.properties.items as { items: { properties: { params: { properties: Record<string, { type?: string; enum?: string[] }> } } } }).items.properties.params.properties;
    expect(params.template).toMatchObject({ type: 'string' });
    expect(params.frame).toBeUndefined();
    const frame = (FRAME_DETAIL_SCHEMA.properties as Record<string, { properties: Record<string, unknown> }>).frame;
    expect(Object.keys(frame.properties)).toEqual(expect.arrayContaining(['question', 'pov', 'headlineLead', 'headlineHighlight', 'items', 'slideSteps', 'names', 'priceFrom', 'priceTo', 'primaryText', 'sources']));
    expect(JSON.stringify([AUTO_PLAN_SCHEMA, FRAME_DETAIL_SCHEMA, STATIC_DETAIL_SCHEMA])).not.toMatch(/anyOf|oneOf|"null"/);
    expect(AUTO_PLAN_SYSTEM).toContain('FRAME [DIVERSITY]');
    expect(AUTO_PLAN_SYSTEM).toMatch(/Interface words belong to the template and are never written by you/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/At most 8 FRAME pieces per batch, every one with a different template/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/full-width character \(Chinese, Japanese, Korean, full-width punctuation\) counts as 2/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/EVERY item needs its own entry in sources/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/priceTo \(max 16\) copied literally from offerAndPrice/);
    for (const t of FRAME_TEMPLATES) expect(AUTO_PLAN_SYSTEM).toMatch(new RegExp(`\\b${t}\\b[^\\n]*:`));
  });

  it('pedido lista as molduras permitidas só com FRAME em allowed; allowedFrames do backend vence o padrão', () => {
    expect(autoPlanUserMessage(input())).toMatch(/<frames>\nFRAME templates allowed in this batch: question_box, meme, cinema, news, read_caption, live, post_card, story, pov_testimonial, direct_offer, ranking, call, split_stack, split_torn, call_dialog, gossip_page, gossip_white, gossip_pink\./);
    expect(autoPlanUserMessage(input({ allowedFrames: ['news', 'split_stack'] }))).toContain('allowed in this batch: news, split_stack.');
    expect(autoPlanUserMessage(input({ allowedFrames: [] }))).toContain('plan no FRAME piece');
    expect(autoPlanUserMessage(input({ allowed: [{ type: 'STORY', max: 1 }] }))).not.toContain('<frames>');
  });

  it('padrão: sem preço com moeda não há direct_offer; sem prova não há pov_testimonial; as 6 de 2 fontes entram (25/10)', () => {
    const none = defaultAllowedFrames({ ...OFFER, proof: null, offerAndPrice: '7-day trial' }, false);
    expect(none).not.toContain('direct_offer');
    expect(none).not.toContain('pov_testimonial');
    expect(['split_stack', 'split_torn', 'call_dialog', 'gossip_page', 'gossip_white', 'gossip_pink'].every((t) => none.includes(t as never))).toBe(true);
    expect(defaultAllowedFrames({ ...OFFER, offerAndPrice: 'R$ 97,90 à vista' }, false)).toContain('direct_offer');
    expect(allowedFramesOf(input({ allowed: [{ type: 'STORY', max: 1 }] }))).toEqual([]);
  });
});

describe('tamanho dos esquemas (bug live 25/10: "The compiled grammar is too large")', () => {
  // Medido contra a API real com sondas/sonda-schema-plano.ts (25/10, claude-opus-5-5): esquema único de 105
  // propriedades / 247 valores de enum FALHOU; 68 / 69 FALHOU; 55 / 69 COMPILOU; os 3 de hoje (45/69, 37/0, 25/0) compilaram.
  // O fake não compila gramática: este teto é o que impede o bug de voltar. Subir o teto = rodar a sonda antes.
  const CEILING = { properties: 55, enumValues: 80, unions: 0, optional: 0, depth: 5 };
  it.each([['plano', AUTO_PLAN_SCHEMA], ['STATIC (2ª etapa)', STATIC_DETAIL_SCHEMA], ['FRAME (1 moldura)', FRAME_DETAIL_SCHEMA], ['FRAMES (todas, 2ª etapa)', FRAMES_DETAIL_SCHEMA]])('%s fica abaixo do teto medido', (_n, schema) => {
    const st = schemaStats(schema);
    expect(st.properties).toBeLessThanOrEqual(CEILING.properties);
    expect(st.enumValues).toBeLessThanOrEqual(CEILING.enumValues);
    expect(st.unions).toBe(CEILING.unions);
    expect(st.optional).toBe(CEILING.optional);
    expect(st.depth).toBeLessThanOrEqual(CEILING.depth);
  });
  it('schemaStats conta propriedades, enums, uniões, opcionais e profundidade', () => {
    expect(schemaStats({ type: 'object', required: ['a'], properties: { a: { type: 'string', enum: ['x', 'y'] }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] }, c: { type: 'array', items: { type: 'object', required: [], properties: { d: { type: 'string' } } } } } }))
      .toEqual({ properties: 4, enumValues: 2, enums: 1, unions: 1, optional: 3, depth: 2 });
  });
});

describe('largura CJK e molduras em lote (25/10)', () => {
  it('largura cheia conta 2: corte por caractere no CJK, por palavra no latino; o parser aplica nos limites', () => {
    expect(textWidth('一個字abc')).toBe(9);
    expect(cutWidth('一個字的差別，主管對你的印象全變了', 10)).toBe('一個字的差');
    expect(cutWidth('one two three', 9)).toBe('one two');
    const q = frameTextsOf('question_box', { question: '跟外國同事說「我不方便」，講 I\'m not convenient 有錯嗎？跟外國同事說我不方便' }, OFFER) as { question: string };
    expect(textWidth(q.question)).toBeLessThanOrEqual(70);
  });
  it('todas as molduras num pedido só, com a nota de fonte do ranking; resposta casada pelo número da peça', () => {
    const ts = detailTargets({ items: [
      { type: 'FRAME', change: 'r', rationale: 'x', whyKey: 'proof', params: { template: 'ranking' } },
      { type: 'CUT', change: 'c', rationale: 'x', whyKey: 'hook', params: {} },
      { type: 'FRAME', change: 'n', rationale: 'x', whyKey: 'hook', params: { template: 'news' } },
    ] }, ['ranking', 'news']);
    const msg = framesDetailMessage(ts, { screenLanguage: 'Chinese (zh-TW)', whys: { proof: 'p' } });
    expect(msg).toContain('piece 1: template ranking');
    expect(msg).toContain('piece 3: template news');
    expect(msg).toContain('every item needs its own sources entry ("items.0", "items.1", …) with pains, what, promise or proof');
    expect(msg).toContain('counts as 2');
    const got = framesByIndex({ frames: [{ piece: 3, topic: 't' }, { piece: 2, topic: 'x' }, { piece: 1, title: 'r' }] }, ts);
    expect([...got.entries()]).toEqual([[2, { frame: { topic: 't' } }], [0, { frame: { title: 'r' } }]]);
    expect(schemaStats(FRAMES_DETAIL_SCHEMA).properties).toBeLessThanOrEqual(55);
  });
});

describe('2ª etapa do plano (STATIC/FRAME)', () => {
  const raw = { items: [
    { type: 'STATIC', change: 'c1', rationale: 'r', whyKey: 'proof', params: { concept: 'a person in bed', emotion: 'relief', refAtSec: 0 } },
    { type: 'FRAME', change: 'news', rationale: 'r', whyKey: 'hook', params: { template: 'news' } },
    { type: 'FRAME', change: 'live', rationale: 'r', whyKey: 'hook', params: { template: 'live' } },
    { type: 'FRAME', change: 'x', rationale: 'r', whyKey: 'hook', params: { template: 'split_stack' } },
    { type: 'STORY', change: 'story', rationale: 'r', whyKey: 'hook', params: {} },
  ] };
  it('alvos: todo STATIC e FRAME permitida com texto (live dispensa); falhou = a peça sai; o resto fica', () => {
    const tg = detailTargets(raw, ['news', 'live']);
    expect(tg.map((t) => [t.index, t.kind, t.template, t.emotion])).toEqual([[0, 'STATIC', null, 'relief'], [1, 'FRAME', 'news', null]]);
    const merged = JSON.parse(mergeDetails(raw, tg, new Map([[1, { frame: { topic: 't' } }]])));
    expect(merged.items.map((x: { change: string }) => x.change)).toEqual(['news', 'live', 'x', 'story']);
    expect(merged.items[0].params.frame).toEqual({ topic: 't' });
  });
});

describe('FRAME na leitura do plano', () => {
  it('news: textos, destaque com *, fontes só de caminhos que existem; template fora das permitidas sai', () => {
    const item = (template: string, frame: Record<string, unknown>) => ({ type: 'FRAME', change: 'Inside a news frame', rationale: 'r', whyKey: 'hook', params: { template, frame } });
    const out = parseAutoPlan(plan([
      item('news', { topic: 'Health', headlineLead: 'Wake up *without* back pain', headlineHighlight: 'in one routine', dek: 'A short night routine.', cta: 'Start tonight', sources: [{ path: 'headline.lead', source: 'promise' }, { path: 'nope', source: 'what' }, { path: 'dek', source: 'bogus' }] }),
      item('split_stack', { headline: 'x' }),
    ]), ctx(['news', 'question_box']));
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ type: 'FRAME', params: { type: 'FRAME', template: 'news', texts: { topic: 'Health', headline: { lead: 'Wake up *without* back pain', highlight: 'in one routine' }, dek: 'A short night routine.', cta: 'Start tonight' }, sources: { 'headline.lead': 'promise' } } });
  });

  it('formas por template: POV sem prefixo, ranking 3-5, call com 3 passos, direct_offer com from só se o Brain tem 2 preços, live vazio', () => {
    const f = (template: string, frame: Record<string, unknown>, offer = OFFER) => frameParamsOf({ template, frame }, FRAME_TEMPLATES, offer);
    expect(f('meme', { pov: 'POV: your back wakes you up', cta: 'Start tonight' })!.texts).toEqual({ pov: 'your back wakes you up', cta: 'Start tonight' });
    expect(f('ranking', { title: 'Top', items: ['a', 'b'] })).toBeNull();
    expect((f('ranking', { title: 'Top', items: ['a', 'b', 'c', 'd', 'e', 'f'] })!.texts as { items: string[] }).items).toHaveLength(5);
    expect(f('call', { title: 'Calma', slideTitle: 'How it works', slideSteps: ['one', 'two'] })).toBeNull();
    expect(f('direct_offer', { promise: 'Wake up without pain', priceFrom: '$19.90', priceTo: '$9.90', cta: 'Start' })!.texts).toEqual({ promise: 'Wake up without pain', price: { from: '$19.90', to: '$9.90' }, cta: 'Start' });
    expect((f('direct_offer', { promise: 'p', priceFrom: '$19.90', priceTo: '$9.90', cta: 'c' }, { ...OFFER, offerAndPrice: 'Only $9.90' })!.texts as { price: { from: string | null } }).price.from).toBeNull();
    expect(f('live', {})!.texts).toEqual({});
    expect(f('call_dialog', { title: 'Talk', names: ['You', 'Physio', 'x'] })!.texts).toEqual({ title: 'Talk', names: ['You', 'Physio'] });
    expect(f('question_box', { question: '' })).toBeNull();
  });

  it('frameText: 1 destaque só, asteriscos fora do limite, acima do limite corta sem destaque', () => {
    expect(frameText('a *b* c *d*', 50)).toBe('a *b* c d');
    expect(frameText('*abcde*', 5)).toBe('*abcde*');
    expect(frameText('one *two three* four', 9)).toBe('one two');
  });

  it('FRAME sem allowedFrames no ctx (o live sem FRAME em allowed) nunca passa', () => {
    const out = parseAutoPlan(plan([{ type: 'FRAME', change: 'c', rationale: 'r', whyKey: 'hook', params: { template: 'live', frame: {} } }, { type: 'STORY', change: 'c', rationale: 'r', whyKey: 'hook', params: {} }]),
      { uiLocale: 'EN', durationSec: 12, blockCount: 3, offer: OFFER, pageCaptured: true });
    expect(out.items.map((x) => x.type)).toEqual(['STORY']);
  });

  it('live: planAutoBatch passa as molduras permitidas pro parse e devolve a peça FRAME', async () => {
    class T implements ClaudeTransport {
      calls: ClaudeCall[] = [];
      async run(c: ClaudeCall): Promise<ClaudeResult> {
        this.calls.push(c);
        return { text: plan([{ type: 'FRAME', change: 'Live frame', rationale: 'r', whyKey: 'hook', params: { template: 'live', frame: {} } }]), stopReason: 'end_turn', usage: [{ model: 'claude-opus-5-5', inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 }] };
      }
    }
    const t = new T();
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5', fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch });
    const out = await svc.planAutoBatch(input() as unknown as AutoPlanInput, () => undefined);
    expect(out.items).toEqual([expect.objectContaining({ type: 'FRAME', params: { type: 'FRAME', template: 'live', texts: {}, sources: {} } })]);
    expect(t.calls[0].user).toContain('<frames>');
  });
});

describe('STATIC V2 na leitura do plano', () => {
  it('copy: vazio vira null, contagens 0/3-5 e 0/3, palavras demais somem, fonte inválida vira generic; legado headline/atSec', () => {
    const c = staticCopyOf({
      brandLine: '', brandLineSource: 'what', tagline: 'Less pain.', headline: { lead: 'You were not born to wake up', highlight: 'in pain.' }, headlineSource: 'bogus',
      subheadline: 'Ten minutes before bed.', subheadlineSource: 'none', handwritten: 'one two three four five six', closing: 'Your body thanks you.',
      benefits: [{ icon: 'moon', title: 'a', line: 'b', source: 'what' }, { icon: 'x', title: 'c', line: 'd', source: 'promise' }],
      trust: [{ icon: 'shield', text: 'a', source: 'proof' }, { icon: 'lock', text: 'b', source: 'what' }, { icon: 'star', text: 'c', source: 'notes' }, { icon: 'star', text: 'd', source: 'notes' }],
      cta: { main: 'Start tonight', sub: '', subSource: 'offerAndPrice' },
    });
    expect(c).toMatchObject({ brandLine: null, brandLineSource: null, tagline: 'Less pain.', headlineSource: 'generic', subheadlineSource: 'generic', handwritten: null, closing: 'Your body thanks you.', benefits: [], cta: { main: 'Start tonight', sub: null, subSource: null } });
    expect(c.trust.map((x) => x.text)).toEqual(['a', 'b', 'c']);
    const v = staticVisualV2Of({ hero: { person: '', setting: 's', emotion: 'pain', light: 'l' }, product: { kind: 'physical_product', look: 'a jar', screenTitle: 'Title', screenTitleSource: 'what' }, mood: 'calm' });
    expect(v).toEqual({ hero: null, product: { kind: 'physical_product', look: 'a jar', screenTitle: null, screenTitleSource: null }, mood: 'calm' });
    const out = parseAutoPlan(plan([{ type: 'STATIC', change: 'Assembled ad', rationale: 'r', whyKey: 'proof', params: { refAtSec: 0, copy: { headline: { lead: 'You were not born', highlight: 'in pain.' }, headlineSource: 'pains' }, visualV2: { hero: { person: 'A person', setting: 's', emotion: 'relief', light: 'l' }, product: { kind: 'none' }, mood: 'm' } } }]), ctx());
    expect(out.items[0].params).toMatchObject({ type: 'STATIC', layout: 'assembled', headline: 'You were not born in pain.', atSec: 0, refAtSec: 0, copy: { headlineSource: 'pains', benefits: [], trust: [] }, visualV2: { hero: { emotion: 'relief' } } });
  });
});

describe('FRAME no mock', () => {
  it('2 molduras de templates diferentes entre as permitidas, textos do Brain com fonte; sem FRAME em allowed = nenhuma', async () => {
    const out = mockAutoPlan(input());
    const frames = out.items.filter((x) => x.type === 'FRAME').map((x) => x.params as Extract<typeof x.params, { type: 'FRAME' }>);
    expect(frames.map((f) => f.template)).toEqual(['news', 'question_box']);
    expect(frames[0].texts).toMatchObject({ topic: 'App', dek: 'A short night routine.', cta: 'Start tonight' });
    expect(frames[0].sources).toMatchObject({ topic: 'kind', dek: 'what', cta: 'cta', 'headline.lead': 'promise' });
    expect(frames[1].sources).toEqual({ question: 'transcript' });
    expect(mockAutoPlan(input({ allowed: [{ type: 'STORY', max: 1 }, { type: 'STATIC', max: 2 }, { type: 'CUT', max: 2 }] })).items.some((x) => x.type === 'FRAME')).toBe(false);
    const only = mockAutoPlan(input({ allowedFrames: ['direct_offer', 'live'] })).items.filter((x) => x.type === 'FRAME').map((x) => x.params as Extract<typeof x.params, { type: 'FRAME' }>);
    expect(only.map((f) => f.template)).toEqual(['direct_offer', 'live']);
    expect(only[0].texts).toMatchObject({ price: { from: '$19.90', to: '$9.90' } });
    // o FakeClaudeService repassa (TRANSIÇÃO: cast)
    const fake = new FakeClaudeService(new MemoryCostStore(), { model: 'mock', stepMs: 0 });
    expect((await fake.planAutoBatch(input() as unknown as AutoPlanInput, () => undefined)).items.filter((x) => (x.type as string) === 'FRAME')).toHaveLength(2);
  });

  it('STATIC V2 do mock omite bloco sem dado no Brain (sem prova/preço/dor: sem trust, sem cta.sub, sem tagline)', () => {
    const lean = mockAutoPlan(input({ offer: { ...OFFER, proof: null, offerAndPrice: null, pains: null, cta: null } }));
    const st = lean.items.find((x) => x.type === 'STATIC')!.params as unknown as { copy: StaticCopy };
    expect(st.copy.trust).toEqual([]);
    expect(st.copy.cta).toEqual({ main: 'Learn more', sub: null, subSource: null });
    expect(st.copy.tagline).toBeNull();
    expect(st.copy.benefits).toEqual([]); // só what + promise preenchidos: < 3
    expect(st.copy.headlineSource).toBe('promise');
  });
});
