// headline-e-legenda-v1 (25/10), linha ia: HEADLINE no planAutoBatch (pedido, leitura, reparo headline_too_long), o
// destaque da headline no describeEdit e o fake ([mock:headline-none] / [mock:headline-over-video]). Sem rede.
import type { AutoPlanInput, DescribeEditInput, OfferBriefDraft, TranscriptWord } from './contrato';
import { AUTO_PLAN_SCHEMA, AUTO_PLAN_SYSTEM, autoPlanUserMessage, headlineParamsOf, headlineRequest, parseAutoPlan, type AutoPlanInputWithFrame } from './claude/auto-plano';
import { parseEditMap } from './claude/edicao';
import { schemaStats } from './claude/schema-stats';
import { mockAutoPlan } from './mock/fake-auto-plan';
import { mockEditMap, mockTeardown } from './mock/fake-claude.service';

const words = (t: string): TranscriptWord[] => t.split(' ').map((w, k) => ({ word: w, startSec: k * 0.4, endSec: k * 0.4 + 0.3 }));
const WORDS = words('If your back hurts every morning watch this. My neighbor tried it and she sleeps through the night now. Tap the link and start tonight.');
const OFFER: OfferBriefDraft = {
  name: 'Calma', language: 'en', kind: 'App', what: 'A short night routine.', audience: 'Adults with back pain', promise: 'Wake up without back pain in the morning',
  pains: 'Your back is stiff every single morning', proof: '"I slept the whole night for the first time." Ana', offerAndPrice: null, cta: 'Start tonight', notes: null,
};
const HL = { mode: 'replace' as const, original: 'STOP WAKING UP SORE', lines: 2, maxChars: 30, hasHighlight: true, language: 'en' };
function input(over: Partial<AutoPlanInputWithFrame> = {}): AutoPlanInputWithFrame {
  return {
    workspaceId: 'w1', batchId: 'b1', jobId: 'j1', uiLocale: 'EN', screenLanguage: 'en-US', offer: OFFER,
    workspace: { name: 'Calma', industry: 'health', market: 'US' }, page: { captured: false, text: null },
    teardown: mockTeardown('EN', WORDS, { durationSec: 12, width: 1080, height: 1920, fps: 30, hasAudio: true, cuts: [], segments: [], palette: [], silences: [] }, null, 4),
    transcript: WORDS, media: { durationSec: 12, cuts: 0, silences: [], hasWrittenHook: true, hasEndCard: false },
    keyframes: [],
    allowed: [{ type: 'HEADLINE', max: 3 }, { type: 'CUT', max: 2 }, { type: 'REVIEW', max: 1 }, { type: 'NATIVE_SEARCH', max: 2 }, { type: 'STATIC', max: 2 }, { type: 'FRAME', max: 8 }],
    rules: { min: 8, max: 12, minDiversityPct: 40 },
    headline: HL,
    ...over,
  };
}
const why = { text: 'x', source: 'video', brainField: 'none', ref: '' };
const plan = (items: unknown[]) => JSON.stringify({ blocks: [], why: { hook: why, proof: why, cta: why }, kept: [], items });
const ctx = (headline: AutoPlanInput['headline'] = HL) => ({ uiLocale: 'EN' as const, durationSec: 12, blockCount: 3, offer: OFFER, pageCaptured: false, headline });

describe('HEADLINE no plano', () => {
  it('esquema e sistema: tipo, texto/destaque/fonte, regras (ângulos, mesma língua, linhas, limite, nada inventado); teto de tamanho', () => {
    const items = AUTO_PLAN_SCHEMA.properties.items as { items: { properties: { type: { enum: string[] }; params: { properties: Record<string, unknown> } } } };
    expect(items.items.properties.type.enum[0]).toBe('HEADLINE');
    expect(Object.keys(items.items.properties.params.properties)).toEqual(expect.arrayContaining(['text', 'highlight', 'textSource']));
    expect(AUTO_PLAN_SYSTEM).toMatch(/write exactly as many HEADLINE pieces as its max \(3 when the champion has a headline, 2 when it has none\)/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/the pain, the promise, the proof/);
    expect(AUTO_PLAN_SYSTEM).toMatch(/Same number of lines as the original and no more characters than its limit/);
    expect(schemaStats(AUTO_PLAN_SCHEMA).properties).toBeLessThanOrEqual(55);
  });

  it('pedido: bloco <headline> com original, linhas, limite, destaque e língua; modo add sem original; reparo headline_too_long', () => {
    const m = autoPlanUserMessage(input());
    expect(m).toContain('<headline mode="replace" pieces="3" lines="2" max_chars="30" highlight="yes" language="en">');
    expect(m).toContain('Original headline: "STOP WAKING UP SORE"');
    expect(m).toContain('Write exactly 3 HEADLINE pieces, each at most 30 characters in 2 line(s), in English (en)');
    expect(headlineRequest(input({ headline: { ...HL, mode: 'add', original: null, lines: 2, maxChars: 60, hasHighlight: false }, allowed: [{ type: 'HEADLINE', max: 2 }] }))).toContain('The champion has no headline');
    expect(headlineRequest(input({ allowed: [{ type: 'CUT', max: 2 }] }))).toBeNull();
    expect(headlineRequest(input({ headline: undefined }))).toBeNull();
    expect(headlineRequest(input({ violations: ['HEADLINE-2: headline_too_long (38 > 30)'] }))).toContain('rewrite them shorter, at most 25 characters');
  });

  it('leitura: texto aparado; destaque só se a original tem e se é trecho literal; fonte; sem `headline` no ctx a peça sai', () => {
    const it = (p: Record<string, unknown>) => ({ type: 'HEADLINE', change: 'New headline', rationale: 'r', whyKey: 'hook', params: p });
    const out = parseAutoPlan(plan([
      it({ text: '"Wake up without back pain"', highlight: 'back pain', textSource: 'promise' }),
      it({ text: 'Your mornings, minus the stiffness', highlight: 'not in the text', textSource: 'bogus' }),
      it({ text: '', highlight: '', textSource: 'pains' }),
    ]), ctx());
    expect(out.items.map((x) => x.params)).toEqual([
      { type: 'HEADLINE', mode: 'replace', text: 'Wake up without back pain', highlight: 'back pain', sources: { text: 'promise', highlight: 'promise' } },
      { type: 'HEADLINE', mode: 'replace', text: 'Your mornings, minus the stiffness', highlight: null, sources: { text: 'generic' } },
    ]);
    expect(headlineParamsOf({ text: 'Sleep through the night', highlight: 'the night' }, { ...HL, hasHighlight: false })!.highlight).toBeNull();
    // comprimento não é cortado (o backend devolve headline_too_long)
    expect(headlineParamsOf({ text: 'x'.repeat(40) }, HL)!.text).toHaveLength(40);
    expect(() => parseAutoPlan(plan([it({ text: 'A', textSource: 'pains' })]), { ...ctx(), headline: undefined })).toThrow(/no usable item/);
  });
});

describe('HEADLINE no fake', () => {
  it('3 no replace (dor, promessa, prova), diferentes entre si e da original, no limite, com destaque; 2 no add; nenhuma sem `headline`', () => {
    const a = mockAutoPlan(input());
    const hs = a.items.filter((x) => (x.type as string) === 'HEADLINE').map((x) => x.params as { text: string; highlight: string | null; mode: string; sources: Record<string, string> });
    expect(hs).toHaveLength(3);
    expect(new Set(hs.map((h) => h.text.toLowerCase())).size).toBe(3);
    expect(hs.every((h) => h.text.length <= 30 && h.text.toLowerCase() !== HL.original.toLowerCase() && !/\d/.test(h.text))).toBe(true);
    expect(hs.map((h) => h.sources.text)).toEqual(['pains', 'promise', 'proof']);
    expect(hs.every((h) => h.highlight == null || h.text.includes(h.highlight))).toBe(true);
    const add = mockAutoPlan(input({ headline: { ...HL, mode: 'add', original: null, maxChars: 60, hasHighlight: false }, allowed: [{ type: 'HEADLINE', max: 2 }, { type: 'CUT', max: 2 }, { type: 'STATIC', max: 2 }, { type: 'FRAME', max: 8 }] }));
    const ah = add.items.filter((x) => (x.type as string) === 'HEADLINE').map((x) => x.params as { mode: string; highlight: string | null });
    expect(ah).toHaveLength(2);
    expect(ah.every((h) => h.mode === 'add' && h.highlight === null)).toBe(true);
    expect(mockAutoPlan(input({ headline: undefined })).items.some((x) => (x.type as string) === 'HEADLINE')).toBe(false);
  });

  it('lote de 8: a diversidade tira CUT antes de HEADLINE', () => {
    const p = mockAutoPlan(input({ rules: { min: 8, max: 8, minDiversityPct: 40 }, allowed: [{ type: 'HEADLINE', max: 3 }, { type: 'CUT', max: 2 }, { type: 'STATIC', max: 2 }, { type: 'FRAME', max: 8 }] }));
    expect(p.items.filter((x) => (x.type as string) === 'HEADLINE')).toHaveLength(3);
  });
});

describe('describeEdit: estilo da headline', () => {
  const v = { width: 1080, height: 1920, fps: 30, frameCount: 360, durationSec: 12 };
  it('a camada de headline traz fontId, cor, destaque, peso (pela fonte do catálogo), caixa alta e alinhamento', () => {
    const draft = parseEditMap(JSON.stringify({
      layers: [{ kind: 'headline', text: 'STOP WAKING UP SORE', startSec: 0, endSec: 12, box: { x: 0.05, y: 0.05, w: 0.9, h: 0.1 }, background: 'none', backgroundColor: '', fontId: 'montserrat-900', uppercase: true, fontSizeRel: 0.04, color: '#FFFFFF', highlightColor: '#FFD400', strokeColor: '#000000', strokeRel: 0.003, shadow: false, align: 'left', wordsPerPage: 0 }],
      overlaysOverFace: [], profile: { gender: 'female', ageBand: '25-35', ethnicity: '', hair: '', clothing: '', setting: '', lighting: '', framing: '', pose: '' },
    }), v, WORDS, []);
    expect(draft.layers[0].style).toMatchObject({ fontId: 'montserrat-900', uppercase: true, color: '#FFFFFF', highlightColor: '#FFD400', align: 'left', strokeColor: '#000000' });
  });

  it('fake: [mock:headline-none] tira a headline; [mock:headline-over-video] deixa sem fundo o vídeo todo, com destaque', () => {
    const base: DescribeEditInput = { workspaceId: 'w', championId: 'c', jobId: 'j', video: v, keyframes: [], textCrops: [], faceTrack: [], transcript: { language: 'en', words: WORDS } };
    expect(mockEditMap({ ...base, notes: '[mock:headline-none]' }).layers.some((l) => l.kind === 'headline')).toBe(false);
    const over = mockEditMap({ ...base, notes: '[mock:headline-over-video]' }).layers.find((l) => l.kind === 'headline')!;
    expect(over.background.kind).toBe('none');
    expect(over.endFrame).toBe(360);
    expect(over.style.highlightColor).toBe('#FFD400');
    expect(mockEditMap(base).layers.find((l) => l.kind === 'headline')!.background.kind).toBe('solid');
  });
});
