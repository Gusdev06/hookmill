// iterate-v2-quiz-templates-ia F1.1-F1.3 + F1.4 (build): regras puras dos templates grátis CHAT_DM e PERSON_MOTION.
import type { AutoChatDmDraft, AutoPersonMotionDraft, AutoPlanDraft, TemplateSpec, TemplateText } from '../integracoes';
import { buildTemplateInput, TemplateTextOverflowError } from '../render/template';
import type { AutoEditContext } from '../render/auto-edit';
import { regrasDeMidiaFallback } from './portas';
import { type PlanCtx, allowedFor, codeFor, finalizePlan, validatePlan, AXIS_OF } from './regras';
import { chatMaterial, proofProblem, templateRules } from './templates-plano';
import { resultTermIn } from './afirmacoes';

const words = Array.from({ length: 80 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
const face = { width: 720, height: 1280, fps: 30, frameCount: 1200, faceTrack: [{ startFrame: 0, endFrame: 1200, role: 'main', region: { x: 0, y: 0, w: 720, h: 1280 }, faceInRegion: [{ atFrame: 0, box: { x: 0.35, y: 0.2, w: 0.3, h: 0.2 } }] }] };

function ctx(over: Partial<PlanCtx> = {}, tpl: Partial<NonNullable<PlanCtx['templates']>> = {}): PlanCtx {
  return {
    lang: 'EN', durationSec: 40,
    blocks: [
      { index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 4 },
      { index: 1, label: 'Problem', fn: 'problem', startSec: 4, endSec: 14 },
      { index: 2, label: 'Proof', fn: 'proof', startSec: 14, endSec: 30 },
      { index: 3, label: 'CTA', fn: 'cta', startSec: 30, endSec: 40 },
    ],
    hasSpeech: true, words, silences: [], hasWrittenHook: false, hasEndCard: false,
    brain: { what: 'A sleep app', audience: 'Busy parents', pains: 'Waking up tired', promise: 'Sleep better', proof: '20,000+ users\n★ 4.9 average rating', offerAndPrice: null, cta: 'Download now', notes: null },
    spokenCta: 'Download the app', pageCaptured: true, productPhoto: false, brandTerms: ['Sleepio', 'Acme Studio'], screenLanguage: 'en',
    frame: { brand: { name: 'Sleepio', handle: '@acme', initials: 'S', color: '#F2C14E' }, faceAtSec: 1 },
    templates: { enabled: true, faceShare: 1, faceMap: face, source: { width: 720, height: 1280 }, bands: [], ...tpl },
    ...over,
  };
}
const T = (text: string, source: TemplateText['source'] = 'transcript', span = { startSec: 1, endSec: 2 }): TemplateText => ({ text, source, srcSpan: source === 'transcript' ? span : null });

function chat(over: Partial<AutoChatDmDraft> = {}): AutoChatDmDraft {
  return {
    type: 'CHAT_DM', hook: { ...T('Still waking up tired?'), highlight: 'tired' },
    chrome: { typing: 'typing…', inputPlaceholder: 'Message…', profileStatus: 'Active now' },
    messages: [
      { from: 'prospect', kind: 'question', text: T('Hi! I wake up tired every single day, even after eight hours in bed. Is that normal?'), preserves: ['pain'] },
      { from: 'brand', kind: 'answer', text: T('It happens a lot. Long nights do not mean deep sleep.'), preserves: ['pain'] },
      { from: 'brand', kind: 'correction', text: T('What changes'), wrong: [T('Sleeping longer')], right: [T('Sleeping deeper')], preserves: ['mechanism'] },
      { from: 'prospect', kind: 'objection', text: T('I have tried apps before and quit after a week.'), preserves: ['objection'] },
      { from: 'brand', kind: 'answer', text: T('This one is a short routine at night, nothing to track during the day.'), preserves: ['mechanism'] },
      { from: 'brand', kind: 'answer', text: T('You only open it when you go to bed.'), preserves: ['mechanism'] },
      { from: 'brand', kind: 'offer', text: T('Sleep app', 'what'), right: [T('Sleep better', 'promise')], preserves: ['offer', 'cta'] },
    ],
    close: { lines: [T('Sleep better', 'promise'), T('Download now', 'cta')] },
    cta: { button: T('Download now', 'cta'), note: null },
    proof: [{ value: 20000, decimals: 0, prefix: '', suffix: '+', label: 'users', source: 'proof' }],
    ...over,
  };
}
function person(over: Partial<AutoPersonMotionDraft> = {}): AutoPersonMotionDraft {
  return {
    type: 'PERSON_MOTION',
    spans: [{ startSec: 0, endSec: 8, preserves: ['hook'] }, { startSec: 14, endSec: 24, preserves: ['proof'] }, { startSec: 30, endSec: 38, preserves: ['cta'] }],
    beats: [
      { spanIndex: 0, atWord: 0, untilWord: null, kind: 'kinetic', words: [T('Waking up tired?')] },
      { spanIndex: 1, atWord: 28, untilWord: null, kind: 'steps', steps: [T('Go to bed'), T('Short routine'), T('Deep sleep')] },
      { spanIndex: 2, atWord: 60, untilWord: null, kind: 'cta', button: T('Download now', 'cta'), note: null },
    ],
    endCard: { proof: [{ value: 4.9, decimals: 1, prefix: '★', suffix: '', label: 'average rating', source: 'proof' }], cta: { button: T('Download now', 'cta'), note: null } },
    ...over,
  };
}
const plan = (...items: (AutoChatDmDraft | AutoPersonMotionDraft)[]): AutoPlanDraft => ({
  blocks: [{ index: 0, fn: 'hook' }, { index: 1, fn: 'problem' }, { index: 2, fn: 'proof' }, { index: 3, fn: 'cta' }],
  why: { hook: { text: 'h', source: 'video', brainField: null, ref: '' }, proof: { text: 'p', source: 'video', brainField: null, ref: '' }, cta: { text: 'c', source: 'video', brainField: null, ref: '' } },
  kept: [{ label: 'a', blockIndex: 0 }, { label: 'b', blockIndex: 3 }],
  items: items.map((params) => ({ type: params.type, change: 'x', rationale: 'y', whyKey: 'proof' as const, params })),
});
const itemRules = (c: PlanCtx, d: AutoPlanDraft) => validatePlan(d, c, allowedFor(c)).filter((v) => v.item !== null).map((v) => v.rule);

describe('templates grátis: catálogo (F1.1)', () => {
  it('flag desligada = nenhum template no allowed', () => {
    expect(templateRules(ctx({}, { enabled: false }))).toEqual([]);
  });
  it('com fala e rosto: os 2 (máx. 1 cada), DIVERSITY, códigos EN/PT', () => {
    expect(templateRules(ctx())).toEqual([{ type: 'CHAT_DM', max: 1, blockedReason: null }, { type: 'PERSON_MOTION', max: 1, blockedReason: null }]);
    expect(AXIS_OF.CHAT_DM).toBe('DIVERSITY');
    expect(AXIS_OF.PERSON_MOTION).toBe('DIVERSITY');
    expect(codeFor('CHAT_DM', null, 1, 'PT')).toBe('CHAT-DM');
    expect(codeFor('PERSON_MOTION', null, 1, 'EN')).toBe('PERSON-MOTION');
    expect(codeFor('PERSON_MOTION', null, 1, 'PT')).toBe('PESSOA-MOTION');
  });
  it('sem fala = nenhum; sem rosto = só CHAT_DM; curto = PERSON_MOTION short_video; pouco material = CHAT_DM fora', () => {
    expect(templateRules(ctx({ hasSpeech: false })).map((a) => a.blockedReason)).toEqual(['no_speech', 'no_speech']);
    expect(templateRules(ctx({}, { faceShare: 0.2 })).map((a) => a.max)).toEqual([1, 0]);
    expect(templateRules(ctx({}, { faceShare: 0.2 }))[1].blockedReason).toBe('no_face');
    expect(templateRules(ctx({ durationSec: 12 }))[1].blockedReason).toBe('short_video');
    const pobre = ctx({ blocks: [{ index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 40 }], brain: { what: 'x', audience: null, pains: null, promise: null, proof: null, offerAndPrice: null, cta: null, notes: null }, spokenCta: null });
    expect(chatMaterial(pobre)).toBe(0);
    expect(templateRules(pobre)[0]).toEqual({ type: 'CHAT_DM', max: 0, blockedReason: 'no_proof' });
  });
  it('legenda queimada cruzando o rosto em todo o vídeo = PERSON_MOTION burned_captions', () => {
    const band = { x: 0, y: 200, w: 720, h: 400, startSec: 0, endSec: 40 };
    expect(templateRules(ctx({}, { bands: [band] }))[1]).toEqual({ type: 'PERSON_MOTION', max: 0, blockedReason: 'burned_captions' });
  });
});

describe('templates grátis: validação (F1.3)', () => {
  it('roteiros bons passam', () => {
    expect(itemRules(ctx(), plan(chat(), person()))).toEqual([]);
  });
  it('número fora do Brain/fala = invented_number; prova fora do Brain = proof_not_in_brain', () => {
    const c = chat({ close: { lines: [T('Sleep 97% better', 'promise')] } });
    expect(itemRules(ctx(), plan(c))).toContain('invented_number');
    expect(itemRules(ctx(), plan(chat({ proof: [{ value: 50000, decimals: 0, prefix: '', suffix: '+', label: 'users', source: 'proof' }] })))).toContain('proof_not_in_brain');
    expect(proofProblem({ value: 4.9, decimals: 1, prefix: '', suffix: '', label: 'happy clients', source: 'proof' }, ctx())).toMatch(/label/);
    expect(proofProblem({ value: 4.9, decimals: 1, prefix: '★', suffix: '', label: 'average rating', source: 'proof' }, ctx())).toBeNull();
  });
  it('prospect relatando resultado ou com kind de marca = prospect_testimonial', () => {
    expect(resultTermIn('It worked for me, I lost 3 kg', 'en')).toBeTruthy();
    const m = chat().messages.slice();
    m[0] = { ...m[0], text: T('It worked for me, I finally sleep') };
    expect(itemRules(ctx(), plan(chat({ messages: m })))).toContain('prospect_testimonial');
    m[0] = { ...m[0], kind: 'answer', text: T('How does it work?') };
    expect(itemRules(ctx(), plan(chat({ messages: m })))).toContain('prospect_testimonial');
  });
  it('fala sem srcSpan, marca/URL e forma', () => {
    const m = chat().messages.slice();
    m[1] = { ...m[1], text: { text: 'It happens a lot.', source: 'transcript', srcSpan: null } };
    expect(itemRules(ctx(), plan(chat({ messages: m })))).toContain('source_span_missing');
    m[1] = { ...m[1], text: T('Sleepio fixes it, see sleepio.com') };
    expect(itemRules(ctx(), plan(chat({ messages: m })))).toContain('template_has_brand');
    expect(itemRules(ctx(), plan(chat({ messages: chat().messages.slice(0, 3) })))).toContain('template_shape');
  });
  it('PERSON_MOTION: trechos fora de ordem/curtos, gancho fora, cena fora do trecho', () => {
    expect(itemRules(ctx(), plan(person({ spans: [{ startSec: 14, endSec: 20, preserves: [] }, { startSec: 2, endSec: 8, preserves: [] }] })))).toContain('spans_invalid');
    expect(itemRules(ctx(), plan(person({ spans: [{ startSec: 5, endSec: 14, preserves: [] }, { startSec: 14, endSec: 24, preserves: [] }, { startSec: 30, endSec: 38, preserves: [] }] })))).toContain('kept_missing');
    const b = person().beats.slice();
    b[1] = { ...b[1], atWord: 2 };
    expect(itemRules(ctx(), plan(person({ beats: b })))).toContain('beat_out_of_span');
  });
  it('legenda queimada dentro da caixa do rosto nos trechos escolhidos = burned_captions', () => {
    const band = { x: 0, y: 200, w: 720, h: 400, startSec: 0, endSec: 9 };
    expect(itemRules(ctx({}, { bands: [band] }), plan(person()))).toContain('burned_captions');
  });
});

describe('templates grátis: finalização e build (F1.3/F1.4)', () => {
  const actx = (renderId: string): AutoEditContext => ({
    renderId, type: 'CHAT_DM', params: {} as never, language: 'en',
    source: { videoUrl: 'http://x/v.mp4', width: 720, height: 1280, fps: 30, durationSec: 40, hasAudio: true },
    editMap: { ...face, layers: [] } as never, words, silences: [], blocks: [], hookEndSec: null, palette: [], brandName: 'Acme', page: null,
  });
  const finais = finalizePlan(plan(chat(), person()), ctx(), regrasDeMidiaFallback);
  it('finalizePlan grava o TemplateSpec (marca do backend, trechos, fontes)', () => {
    expect(finais.map((f) => [f.code, f.axis])).toEqual([['CHAT-DM', 'DIVERSITY'], ['PERSON-MOTION', 'DIVERSITY']]);
    const c = finais[0].params as Extract<TemplateSpec, { type: 'CHAT_DM' }>;
    expect(c).toMatchObject({ templateId: 'chat-dm', brand: { name: 'Sleepio' }, hook: { highlight: 'tired' } });
    expect(c.sources['messages.0.text']).toBe('transcript');
    const p = finais[1].params as Extract<TemplateSpec, { type: 'PERSON_MOTION' }>;
    expect(p.timeline).toHaveLength(3);
    expect(p.endCard?.proof[0].prefix).toBe(''); // "★" não tem glifo nas fontes: sai (a composição desenha a estrela)
  });
  it('build do chat: agenda medida, 9:16, checkpoints, duração 18-40 s', () => {
    const i = buildTemplateInput(finais[0].params as TemplateSpec, actx('r1'), 'VERTICAL_9_16');
    expect(i).toMatchObject({ kind: 'template', templateId: 'chat-dm', format: 'VERTICAL_9_16', fps: 30 });
    expect(i.durationInFrames / 30).toBeGreaterThanOrEqual(18);
    expect(i.durationInFrames / 30).toBeLessThanOrEqual(40);
    expect(i.checkpoints.length).toBeGreaterThanOrEqual(4);
    if (i.templateId === 'chat-dm') expect(i.props.messages.every((m, k, a) => k === 0 || m.atSec > a[k - 1].atSec)).toBe(true);
  });
  it('build do pessoa + motion: cenas no tempo de saída, caixa do rosto por trecho, só 9:16', () => {
    const i = buildTemplateInput(finais[1].params as TemplateSpec, actx('r2'), 'VERTICAL_9_16');
    if (i.templateId !== 'person-motion') throw new Error('tipo');
    expect(i.props.faceBox.windows).toHaveLength(3);
    expect(i.props.beats.map((b) => b.fromSec)).toEqual([0, 8, 18]);
    expect(i.durationInFrames).toBe(Math.round((8 + 10 + 8 + 3.4) * 30));
    expect(() => buildTemplateInput(finais[1].params as TemplateSpec, actx('r3'), 'SQUARE_1_1')).toThrow(/9:16/);
  });
  it('texto que não cabe = TEMPLATE_TEXT_OVERFLOW', () => {
    const spec = { ...(finais[0].params as Extract<TemplateSpec, { type: 'CHAT_DM' }>) };
    spec.cta = { button: 'Supercalifragilisticexpialidocious-download-now', note: null };
    expect(() => buildTemplateInput(spec, actx('r4'), 'VERTICAL_9_16')).toThrow(TemplateTextOverflowError);
  });
});
