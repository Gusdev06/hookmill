// templates-lista-v1 T-B2 (04/11): allowedFor da lista (ordem do fit), fit da galeria, validação §2.3, finalizePlan §2.4
// (ListSpec, fill), textos editáveis e opções (look/colunas/Fill from Brain), vista `IteratePiece.list`.
import type { AutoListOverlayDraft, AutoPlanDraft, ListTextDraft } from '../integracoes/contrato';
import {
  applyListOptions, applyListTexts, listEditableTexts, listSpecOf, listSpecViolations, listViolations, pieceListOf, quoteOf, type ListSpec,
} from './lista-plano';
import { type PlanCtx, allowedFor, brainPoints, finalizePlan, listCtxOf, listMoments, validatePlan } from './regras';
import { editableTextsOf, restrictToTemplate, templateFitOf } from './templates-lote';
import type { CaptionGuard } from './legenda-protegida';
import { buildTemplateInput, listOverlayPropsOf } from '../render/template';

const FALA = 'Most people wake up tired. They drink coffee all day. They scroll at midnight. Sleep Pocket fixes this. You fall asleep in 10 minutes. You wake up rested. 4000 parents use it. Download it today.';
const words = FALA.split(' ').map((word, i) => ({ word, startSec: 1 + i * 0.55, endSec: 1 + i * 0.55 + 0.45 }));
const idx = (w: string) => words.findIndex((x) => x.word.replace(/[.,]/g, '') === w);
const guard = (bands: { y: number; h: number }[]): CaptionGuard => ({ bands: bands.map((b) => ({ x: 0, w: 1080, startSec: 0, endSec: 30, ...b })), blocked: [], check: () => null });

const ctx = (over: Partial<PlanCtx> = {}): PlanCtx => ({
  lang: 'EN', durationSec: 24,
  blocks: [
    { index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 4 }, { index: 1, label: 'Problem', fn: 'problem', startSec: 4, endSec: 10 },
    { index: 2, label: 'Mechanism', fn: 'mechanism', startSec: 10, endSec: 16 }, { index: 3, label: 'Proof', fn: 'proof', startSec: 16, endSec: 20 },
    { index: 4, label: 'CTA', fn: 'cta', startSec: 20, endSec: 24 },
  ],
  hasSpeech: true, words, silences: [], hasWrittenHook: false, hasEndCard: false,
  brain: {
    what: 'A sleep app with guided sounds.', audience: 'Busy parents', pains: 'Waking up tired. Drinking coffee all day. Scrolling at midnight.',
    promise: 'Fall asleep fast. Wake up rested.', proof: '4000 parents use it. Rated 4.8 stars.', offerAndPrice: '$9.90 per month', cta: 'Download now', notes: null,
  },
  spokenCta: 'Download it today', pageCaptured: false, productPhoto: false, brandTerms: ['Acme', 'Sleep Pocket'],
  offerName: 'Sleep Pocket', screenLanguage: 'en',
  frame: { brand: { name: 'Sleep Pocket', handle: '@acme', initials: 'SP', color: '#7C5CFF' }, faceAtSec: 1 },
  // avatar Pocketwise (spec §3.1): rosto 280-1010, legenda baixa
  listGeom: { source: { width: 1080, height: 1920, durationSec: 24 }, faceSafeBand: { x: 340, y: 280, w: 400, h: 730 }, bands: [{ x: 0, y: 1443, w: 1080, h: 274, startSec: 0, endSec: 24 }] },
  listTemplates: ['versus', 'value-stack'],
  ...over,
});

const t = (text: string, source: ListTextDraft['source'], field: string | null, anchor: number | null): ListTextDraft => ({ text, source, field: field as ListTextDraft['field'], anchorWordIndex: anchor });
const versus = (over: Partial<AutoListOverlayDraft> = {}): AutoListOverlayDraft => ({
  type: 'LIST_OVERLAY', templateId: 'versus', order: 'by_speech',
  heads: { bad: t('Other ways', 'generic', null, null), good: t('Sleep Pocket', 'brain', 'name', null) },
  title: null,
  lines: [
    { ...t('Wake up tired', 'both', 'pains', idx('wake')), side: 'bad', kind: 'item' },
    { ...t('Coffee all day', 'both', 'pains', idx('coffee')), side: 'bad', kind: 'item' },
    { ...t('Scroll at midnight', 'transcript', null, idx('scroll')), side: 'bad', kind: 'item' },
    { ...t('Asleep in 10 minutes', 'transcript', null, idx('asleep')), side: 'good', kind: 'item' },
    { ...t('Wake up rested', 'both', 'promise', idx('rested')), side: 'good', kind: 'item' },
    { ...t('4000 parents use it', 'both', 'proof', idx('4000')), side: 'good', kind: 'item' },
  ],
  ...over,
});
const stack = (over: Partial<AutoListOverlayDraft> = {}): AutoListOverlayDraft => ({
  type: 'LIST_OVERLAY', templateId: 'value-stack', order: 'by_speech', heads: null,
  title: t('What you get', 'generic', null, null),
  lines: [
    { ...t('Fall asleep in 10 minutes', 'transcript', null, idx('asleep')), side: null, kind: 'item' },
    { ...t('Wake up rested', 'both', 'promise', idx('rested')), side: null, kind: 'item' },
    { ...t('4000 parents use it', 'both', 'proof', idx('4000')), side: null, kind: 'proof' },
    { ...t('$9.90 per month', 'brain', 'offerAndPrice', null), side: null, kind: 'price' },
    { ...t('Download it today', 'transcript', null, idx('Download')), side: null, kind: 'cta' },
  ],
  ...over,
});
const rules = (v: { rule: string }[]) => v.map((x) => x.rule);
/** campeão 1:1 (no 9:16 o `top` encolhe demais: escala < 0,6) */
const square = (bands: CaptionGuard['bands']): NonNullable<PlanCtx['listGeom']> => ({ source: { width: 1080, height: 1080, durationSec: 24 }, faceSafeBand: { x: 340, y: 100, w: 400, h: 400 }, bands });

describe('allowedFor da lista (§1): ordem no_speech → short_video → no_list → sem lugar', () => {
  const list = (c: PlanCtx) => allowedFor(c).filter((a) => a.type === 'LIST_OVERLAY');
  it('1 AllowedType por template liberado, max 1, com templateId', () => {
    expect(list(ctx())).toEqual([
      { type: 'LIST_OVERLAY', templateId: 'versus', max: 1, blockedReason: null },
      { type: 'LIST_OVERLAY', templateId: 'value-stack', max: 1, blockedReason: null },
    ]);
    expect(list(ctx({ listTemplates: ['value-stack'] })).map((a) => a.templateId)).toEqual(['value-stack']);
    expect(list(ctx({ listTemplates: [] }))).toEqual([]); // Iterate normal
  });
  it('no_speech primeiro, depois short_video (< 12 s de fala)', () => {
    expect(list(ctx({ hasSpeech: false, words: [] }))[0].blockedReason).toBe('no_speech');
    expect(list(ctx({ words: words.slice(0, 15) }))[0].blockedReason).toBe('short_video');
  });
  it('no_list: < 2 momentos na fala E Brain sem 3 pontos', () => {
    const thin = ctx({ blocks: [{ index: 0, label: 'All', fn: 'hook', startSec: 0, endSec: 24 }], spokenCta: null, brain: { ...ctx().brain, pains: null, promise: 'Sleep', what: null, proof: null } });
    expect(listMoments(thin)).toBe(0);
    expect(brainPoints(thin, 'versus')).toBe(0);
    expect(list(thin).map((a) => a.blockedReason)).toEqual(['no_list', 'no_list']);
    // a fala tem lista (blocos problem/mechanism/proof + CTA falado): cabe mesmo com o Brain vazio
    expect(listMoments(ctx())).toBe(4);
    // Brain com pontos (≥ 3) salva um vídeo sem blocos de lista
    expect(list({ ...thin, brain: ctx().brain }).map((a) => a.blockedReason)).toEqual([null, null]);
  });
  it('lugar: com a guarda ligada a legenda conta; burned_captions só quando a causa é ela; no_room = rosto ocupa o quadro', () => {
    // campeão 1:1 com legenda cobrindo o quadro: no 9:16 não cabe com ela, cabe sem ela → burned_captions (soft)
    expect(list(ctx({ caption: guard([{ y: 0, h: 1080 }]), listGeom: square(guard([{ y: 0, h: 1080 }]).bands) }))[0].blockedReason).toBe('burned_captions');
    // guarda desligada (lote de template / Gerar mesmo assim): a legenda não conta
    expect(list(ctx({ caption: null, listGeom: square(guard([{ y: 0, h: 1080 }]).bands) }))[0].blockedReason).toBeNull();
    // rosto ocupando o quadro, sem legenda → no_room (hard); com legenda também no_room (sem ela também não caberia)
    const faceAll = { ...square([]), faceSafeBand: { x: 0, y: 0, w: 1080, h: 1080 } };
    expect(list(ctx({ listGeom: faceAll }))[0].blockedReason).toBe('no_room');
    expect(list(ctx({ caption: guard([{ y: 900, h: 100 }]), listGeom: { ...faceAll, bands: guard([{ y: 900, h: 100 }]).bands } }))[0].blockedReason).toBe('no_room');
    // gatilho de QA [mock:list-no-room]
    expect(list(ctx({ listGeom: { ...ctx().listGeom!, mockNoRoom: true } }))[0].blockedReason).toBe('no_room');
  });
  it('listCtxOf (ctx.list do contrato): maxPairs 4 só com zona ≥ 480 px', () => {
    expect(listCtxOf(ctx({ caption: guard([{ y: 1443, h: 274 }]) })).versus?.maxPairs).toBe(3); // zona 383 do Pocketwise
    expect(listCtxOf(ctx({ listGeom: { ...ctx().listGeom!, bands: [] } })).versus?.maxPairs).toBe(4);
  });
});

describe('fit da galeria (templateFitOf) pela chave LIST_OVERLAY:<id>', () => {
  const row = (id: string) => ({ internalKey: `LIST_OVERLAY:${id}`, autoType: 'LIST_OVERLAY', frameId: null, pack: false });
  it('ok / short_video hard / no_list hard / burned_captions soft / no_room hard', () => {
    const base = ctx({ listTemplates: null });
    expect(templateFitOf(base, row('versus'))).toEqual({ level: 'ok', reason: null });
    expect(templateFitOf({ ...base, hasSpeech: false }, row('versus'))).toEqual({ level: 'hard', reason: 'no_speech' });
    expect(templateFitOf({ ...base, words: words.slice(0, 10) }, row('value-stack'))).toEqual({ level: 'hard', reason: 'short_video' });
    const thin = { ...base, blocks: [{ index: 0, label: 'All', fn: 'hook', startSec: 0, endSec: 24 }], spokenCta: null, brain: { ...base.brain, pains: null, what: null, proof: null } };
    expect(templateFitOf(thin, row('versus'))).toEqual({ level: 'hard', reason: 'no_list' });
    expect(templateFitOf({ ...base, caption: guard([{ y: 0, h: 1080 }]), listGeom: square(guard([{ y: 0, h: 1080 }]).bands) }, row('versus'))).toEqual({ level: 'soft', reason: 'burned_captions' });
    expect(templateFitOf({ ...base, listGeom: { ...square([]), faceSafeBand: { x: 0, y: 0, w: 1080, h: 1080 } } }, row('versus'))).toEqual({ level: 'hard', reason: 'no_room' });
  });
  it('restrictToTemplate deixa só o template da chave', () => {
    const r = restrictToTemplate(ctx(), allowedFor(ctx()), { keys: ['LIST_OVERLAY:value-stack'] });
    expect(r.allowed.map((a) => a.templateId)).toEqual(['value-stack']);
  });
});

describe('validação §2.3', () => {
  it('Versus e Value stack limpos passam', () => {
    expect(listViolations(versus(), 0, ctx())).toEqual([]);
    expect(listViolations(stack(), 0, ctx())).toEqual([]);
  });
  it('forma e quantidades', () => {
    expect(rules(listViolations(versus({ lines: versus().lines.slice(0, 5) }), 0, ctx()))).toContain('template_shape'); // bad ≠ good
    expect(rules(listViolations(versus({ lines: versus().lines.filter((l) => l.text !== 'Scroll at midnight' && l.text !== '4000 parents use it') }), 0, ctx()))).toContain('template_shape'); // 2 pares
    expect(rules(listViolations(versus({ heads: null }), 0, ctx()))).toContain('template_shape');
    expect(rules(listViolations(stack({ lines: stack().lines.slice(0, 4) }), 0, ctx()))).toContain('template_shape'); // sem cta
    expect(rules(listViolations(stack({ title: null }), 0, ctx()))).toContain('template_shape');
  });
  it('limites: text_too_long (não corta)', () => {
    const lines = versus().lines.map((l, k) => (k === 0 ? { ...l, text: 'Wake up tired every single morning' } : l));
    expect(rules(listViolations(versus({ lines }), 0, ctx()))).toContain('text_too_long');
  });
  it('fonte: transcript sem âncora = source_span_missing; generic fora do lugar e campo errado = source_invalid', () => {
    const noAnchor = versus().lines.map((l, k) => (k === 2 ? { ...l, anchorWordIndex: null } : l));
    expect(rules(listViolations(versus({ lines: noAnchor }), 0, ctx()))).toContain('source_span_missing');
    const generic = versus().lines.map((l, k) => (k === 0 ? { ...l, source: 'generic' as const } : l));
    expect(rules(listViolations(versus({ lines: generic }), 0, ctx()))).toContain('source_invalid');
    const wrongField = versus().lines.map((l, k) => (k === 0 ? { ...l, field: 'proof' as const } : l));
    expect(rules(listViolations(versus({ lines: wrongField }), 0, ctx()))).toContain('source_invalid');
  });
  it('nada inventado: número fora da fala/Brain, prova e preço literais', () => {
    const inv = versus().lines.map((l, k) => (k === 3 ? { ...l, text: 'Asleep in 97% less time' } : l));
    expect(rules(listViolations(versus({ lines: inv }), 0, ctx()))).toContain('invented_number');
    const price = stack().lines.map((l) => (l.kind === 'price' ? { ...l, text: '$7.90 per month' } : l));
    expect(rules(listViolations(stack({ lines: price }), 0, ctx()))).toEqual(expect.arrayContaining(['price_not_in_brain', 'invented_number']));
    const noPrice = ctx({ brain: { ...ctx().brain, offerAndPrice: null } });
    expect(rules(listViolations(stack(), 0, noPrice))).toContain('price_not_in_brain');
    const proof = stack().lines.map((l) => (l.kind === 'proof' ? { ...l, text: '4.8 stars', source: 'brain' as const, anchorWordIndex: null } : l));
    expect(rules(listViolations(stack({ lines: proof }), 0, ctx()))).not.toContain('proof_not_in_brain');
  });
  it('marca/URL fora do cabeçalho bom = template_has_brand; âncoras fora de ordem = anchor_order', () => {
    const brand = stack().lines.map((l, k) => (k === 0 ? { ...l, text: 'Acme fixes your sleep' } : l));
    expect(rules(listViolations(stack({ lines: brand }), 0, ctx()))).toContain('template_has_brand');
    const swapped = [...stack().lines];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    expect(rules(listViolations(stack({ lines: swapped }), 0, ctx()))).toContain('anchor_order');
  });
  it('validatePlan: template não liberado = type_not_allowed; repetido = duplicate', () => {
    const plan = (items: AutoListOverlayDraft[]): AutoPlanDraft => ({
      blocks: [], kept: [], why: { hook: { text: 'h', source: 'video', brainField: null, ref: 'x' }, proof: { text: 'p', source: 'video', brainField: null, ref: 'x' }, cta: { text: 'c', source: 'video', brainField: null, ref: 'x' } },
      items: items.map((params) => ({ type: 'LIST_OVERLAY', change: 'x', rationale: 'y', whyKey: 'proof', params })),
    });
    const c = ctx({ planRules: { min: 1, max: 2 } });
    const allowed = allowedFor({ ...c, listTemplates: ['versus'] });
    expect(validatePlan(plan([stack()]), c, allowed).filter((v) => v.item !== null).map((v) => v.rule)).toEqual(['type_not_allowed']);
    const both = allowedFor(c);
    expect(validatePlan(plan([versus(), stack()]), c, both).filter((v) => v.item !== null)).toEqual([]);
    expect(validatePlan(plan([versus(), versus()]), c, both).filter((v) => v.item !== null).map((v) => v.rule)).toContain('duplicate');
  });
});

describe('finalizePlan §2.4 (ListSpec) e fill', () => {
  const fin = (p: AutoListOverlayDraft, c = ctx()) => finalizePlan({ blocks: [], kept: [], why: {} as never, items: [{ type: 'LIST_OVERLAY', change: 'x', rationale: 'y', whyKey: 'proof', params: p }] }, c, { snapSpans: (s) => s })[0];
  it('código, âncora → segundo (−0,10 s), citação, ids, look ink, 2 colunas, placement nos 3 formatos', () => {
    const f = fin(versus());
    expect(f.code).toBe('VERSUS');
    const s = f.params as ListSpec;
    expect(s.lines.map((l) => l.id)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6']);
    expect(s.lines[0].atSec).toBeCloseTo(words[idx('wake')].startSec - 0.1, 3);
    expect(s.lines[0].quote).toBe('Most people wake up tired.');
    expect(s).toMatchObject({ look: 'ink', columns: 2, fill: null, templateId: 'versus', brand: { color: '#7C5CFF' } });
    expect(s.placement.map((x) => x.format)).toEqual(['9x16', '4x5', '1x1']);
    expect(s.placement[0]).toMatchObject({ mode: 'body', supported: true });
    expect(fin(stack()).code).toBe('VALUE-STACK');
    expect((fin(stack()).params as ListSpec).columns).toBeNull();
  });
  it('< 2 âncoras = fill pending e linhas sem âncora marcadas fromFill', () => {
    const thin = versus({ lines: versus().lines.map((l, k) => (k === 0 ? l : { ...l, source: 'brain' as const, field: l.side === 'bad' ? 'pains' as const : 'promise' as const, anchorWordIndex: null })) });
    const s = fin(thin).params as ListSpec;
    expect(s.fill).toBe('pending');
    expect(s.lines.filter((l) => l.fromFill).map((l) => l.id)).toEqual(['l2', 'l3', 'l4', 'l5', 'l6']);
    expect(pieceListOf(s as never)?.fill).toBe('pending');
  });
  it('quoteOf corta em 120 com …', () => {
    const long = Array.from({ length: 60 }, (_, i) => ({ word: `palavra${i}`, startSec: i, endSec: i + 0.5 }));
    expect(quoteOf(long, 3)!.length).toBe(120);
    expect(quoteOf(long, null)).toBeNull();
  });
});

describe('Plan: textos, opções e vista (§5)', () => {
  const spec = () => listSpecOf(versus(), ctx(), ctx().frame!.brand);
  it('caminhos list.heads.bad|good e list.lines.<id> (Versus); list.title (Stack)', () => {
    expect(listEditableTexts(spec()).map((x) => x.path)).toEqual(['list.heads.bad', 'list.heads.good', 'list.lines.l1', 'list.lines.l2', 'list.lines.l3', 'list.lines.l4', 'list.lines.l5', 'list.lines.l6']);
    expect(editableTextsOf('LIST_OVERLAY', listSpecOf(stack(), ctx(), ctx().frame!.brand) as never).map((x) => x.path)[0]).toBe('list.title');
  });
  it('editar e revalidar: preço/número inventado = violação no caminho da vista', () => {
    const r = applyListTexts(spec(), [{ path: 'list.lines.l4', value: 'Asleep in 97% less time' }]);
    expect(r.unknownPaths).toEqual([]);
    expect(listSpecViolations(r.params, ctx())).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'list.lines.l4', rule: 'invented_number' })]));
    expect(applyListTexts(spec(), [{ path: 'list.title', value: 'x' }]).unknownPaths).toEqual(['list.title']);
    expect(listSpecViolations(applyListTexts(spec(), [{ path: 'list.lines.l1', value: 'Always tired' }]).params, ctx())).toEqual([]);
  });
  it('opções: look, colunas (só Versus) e Fill from Brain', () => {
    const a = applyListOptions(spec(), { look: 'paper', columns: 1 }, ctx());
    expect(a.error).toBeNull();
    expect(a.params).toMatchObject({ look: 'paper', columns: 1 });
    expect(pieceListOf(a.params as never)?.mode).toBe('one-col');
    expect(applyListOptions(listSpecOf(stack(), ctx(), ctx().frame!.brand), { columns: 2 }, ctx()).error).toEqual({ code: 'EDIT_NOT_SUPPORTED', reason: 'columns_versus_only' });
    const pending = { ...spec(), fill: 'pending' as const };
    expect(applyListOptions(pending, { acceptFill: true }, ctx()).params.fill).toBe('accepted');
  });
  it('vista: placement só dos formatos com lugar', () => {
    const v = pieceListOf(spec() as never)!;
    expect(v.heads?.good).toEqual({ text: 'Sleep Pocket', maxChars: 14, source: 'brain', field: 'name' });
    expect(v.lines[0]).toMatchObject({ id: 'l1', maxChars: 24, quote: 'Most people wake up tired.', fromFill: false });
    expect(v.placement.every((p) => ['body', 'top', 'side'].includes(p.mode))).toBe(true);
    expect(v.preview).toBeNull();
  });
});

describe('buildTemplateInput da lista (render, §3.1)', () => {
  const actx = (editMap: unknown = null) => ({
    renderId: 'r1', type: 'LIST_OVERLAY', params: {} as never, language: 'en', editMap: editMap as never, words, silences: [], blocks: [], hookEndSec: null,
    palette: [], brandName: 'Acme', page: null,
    source: { videoUrl: 'https://x/v.mp4', width: 1080, height: 1920, fps: 30, durationSec: 24, hasAudio: true },
  }) as unknown as Parameters<typeof buildTemplateInput>[1];
  it('versus 9:16 e value-stack 1:1 passam no schema da composição, com checkpoints e o vídeo inteiro', () => {
    const v = buildTemplateInput(listSpecOf(versus(), ctx(), ctx().frame!.brand), actx(), 'VERTICAL_9_16') as unknown as { kind: string; templateId: string; durationInFrames: number; checkpoints: unknown[]; props: { mode: string; heads: unknown } };
    expect(v).toMatchObject({ kind: 'template', templateId: 'versus', durationInFrames: 720 });
    expect(v.props.mode).toBe('two-col');
    expect(v.checkpoints).toHaveLength(3);
    const s = buildTemplateInput(listSpecOf(stack(), ctx(), ctx().frame!.brand), actx(), 'SQUARE_1_1') as unknown as { templateId: string; props: { mode: string } };
    expect(s).toMatchObject({ templateId: 'value-stack', props: { mode: 'stack' } });
    // 1:1 Versus = 1 coluna, sem cabeçalho
    const sq = buildTemplateInput(listSpecOf(versus(), ctx(), ctx().frame!.brand), actx(), 'SQUARE_1_1') as unknown as { props: { mode: string; heads: unknown } };
    expect(sq.props).toMatchObject({ mode: 'one-col', heads: null });
  });
  it('a prévia (listOverlayPropsOf) é o mesmo cálculo', () => {
    const r = listOverlayPropsOf(listSpecOf(versus(), ctx(), ctx().frame!.brand), actx(), 'VERTICAL_9_16');
    expect(r.placement.mode).not.toBe('none');
    expect(r.props?.lines).toHaveLength(6);
  });
});
