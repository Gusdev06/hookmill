// templates-creditos-v1 §2/§6/A7: allowed restrito ao template, fit (as regras do plano) e textos editáveis.
import type { FrameTemplateId } from '@maquina/contratos';
import { type AllowedType, type PlanCtx, allowedFor, pickedMissing, templateOnlyTypesOf, validatePlan } from './regras';
import type { CaptionGuard } from './legenda-protegida';
import { applyTexts, batchFitOf, captionBlockedForTemplate, editableTextsOf, restrictToTemplate, selectionFitOf, skippedOf, templateFitOf } from './templates-lote';

const words = Array.from({ length: 60 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
function ctx(over: Partial<PlanCtx> = {}): PlanCtx {
  return {
    lang: 'EN', durationSec: 30,
    blocks: [
      { index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 3 }, { index: 1, label: 'Problem', fn: 'problem', startSec: 3, endSec: 10 },
      { index: 2, label: 'Body', fn: 'body', startSec: 10, endSec: 18 }, { index: 3, label: 'Proof', fn: 'proof', startSec: 18, endSec: 25 },
      { index: 4, label: 'CTA', fn: 'cta', startSec: 25, endSec: 30 },
    ],
    hasSpeech: true, words, silences: [], hasWrittenHook: false, hasEndCard: false,
    brain: { what: 'A sleep app', audience: 'Busy parents', pains: 'No time', promise: 'Sleep better', proof: '"I finally sleep through the night" - Ana', offerAndPrice: 'Trial, then $9.99/month', cta: 'Download now', notes: null },
    spokenCta: 'Download the app', pageCaptured: true, productPhoto: false, brandTerms: ['Sleepio'],
    frame: { brand: { name: 'Sleepio', handle: '@sleepio', initials: 'S', color: '#F2C14E' }, faceAtSec: 1 },
    ...over,
  };
}
const guard = (blocked: { type: string; template: FrameTemplateId | null }[]): CaptionGuard => ({
  bands: [{ x: 0, y: 1000, w: 1080, h: 200, startSec: 0, endSec: 30 }],
  blocked: blocked.map((b) => ({ ...b, type: b.type as never, reason: 'face_cut' as const })),
  check: () => null,
});
const T = (internalKey: string, autoType: string | null, frameId: string | null = null, pack = false) => ({ internalKey, autoType, frameId, pack });

describe('lote de template (templates-creditos-v1)', () => {
  it('restringe o allowed às chaves: moldura só a do template; STATIC limitado a 1', () => {
    const c = ctx();
    const r = restrictToTemplate(c, allowedFor(c), { keys: ['FRAME:news'] });
    expect(r.allowed).toEqual([{ type: 'FRAME', max: 1, blockedReason: null }]);
    expect(r.frames).toEqual(['news']);
    const s = restrictToTemplate(c, allowedFor(c), { keys: ['STATIC'], max: { STATIC: 1 } });
    expect(s.allowed).toEqual([{ type: 'STATIC', max: 1, blockedReason: null }]);
  });

  it('fit: ok · soft só pela legenda · hard por rosto, fala, vídeo curto, preço', () => {
    expect(templateFitOf(ctx(), T('FRAME:news', 'FRAME', 'news'))).toEqual({ level: 'ok', reason: null });
    // moldura de 2 fontes sem rosto no campeão = hard no_face
    expect(templateFitOf(ctx({ frame: { brand: ctx().frame!.brand, faceAtSec: null } }), T('FRAME:split_stack', 'FRAME', 'split_stack'))).toEqual({ level: 'hard', reason: 'no_face' });
    expect(templateFitOf(ctx({ hasSpeech: false }), T('NATIVE_SEARCH', 'NATIVE_SEARCH'))).toEqual({ level: 'hard', reason: 'no_speech' });
    expect(templateFitOf(ctx({ durationSec: 12 }), T('CUT', 'CUT'))).toEqual({ level: 'hard', reason: 'short_video' });
    expect(templateFitOf(ctx({ brain: { ...ctx().brain, offerAndPrice: null } }), T('FRAME:direct_offer', 'FRAME', 'direct_offer'))).toEqual({ level: 'hard', reason: 'no_price' });
    expect(templateFitOf(ctx({ caption: guard([{ type: 'FRAME', template: 'news' }]) }), T('FRAME:news', 'FRAME', 'news'))).toEqual({ level: 'soft', reason: 'burned_captions' });
    expect(templateFitOf(ctx({ caption: guard([{ type: 'NATIVE_SEARCH', template: null }]) }), T('NATIVE_SEARCH', 'NATIVE_SEARCH'))).toEqual({ level: 'soft', reason: 'burned_captions' });
    // Headline sem informação do campeão = não cabe
    expect(templateFitOf(ctx(), T('HEADLINE', 'HEADLINE')).level).toBe('hard');
  });

  it('fit da IA (F3.3) e do pack', () => {
    expect(templateFitOf(ctx({ frame: { brand: ctx().frame!.brand, faceAtSec: null } }), T('AVATAR_FACE', 'AVATAR_FACE'))).toEqual({ level: 'hard', reason: 'no_face' });
    expect(templateFitOf(ctx({ brain: { ...ctx().brain, audience: null } }), T('AVATAR_PERSONA', 'AVATAR_PERSONA'))).toEqual({ level: 'hard', reason: 'no_audience' });
    expect(templateFitOf(ctx(), T('REMIX_DISCOVERY', 'REMIX_DISCOVERY')).level).toBe('ok');
    expect(templateFitOf(ctx(), T('PACK', null, null, true), ['FRAME:news', 'CUT'])).toEqual({ level: 'ok', reason: null });
    const all: AllowedType[] = [{ type: 'FRAME', max: 0, blockedReason: 'burned_captions' }, { type: 'CUT', max: 0, blockedReason: 'short_video' }];
    expect(batchFitOf(all, true)).toEqual({ level: 'soft', reason: 'burned_captions' });
  });

  it('captionBlocked do lote só com as chaves do template', () => {
    const list = [{ type: 'FRAME' as const, template: 'news' as FrameTemplateId }, { type: 'FRAME' as const, template: 'meme' as FrameTemplateId }, { type: 'CUT' as const, template: null }];
    expect(captionBlockedForTemplate(list, ['FRAME:news'])).toEqual([list[0]]);
  });

  it('textos editáveis: FRAME pelos campos do §B2, HEADLINE pelo texto; o resto não edita', () => {
    const frame = { type: 'FRAME', template: 'ranking', texts: { title: 'Top 3', items: ['A', 'B', 'C'] }, sources: { 'items.0': 'pains' } };
    const t = editableTextsOf('FRAME', frame);
    expect(t.map((x) => x.path)).toEqual(['title', 'items.0', 'items.1', 'items.2']);
    expect(t[1]).toMatchObject({ maxChars: 28, source: 'pains' });
    expect(editableTextsOf('HEADLINE', { mode: 'replace', original: 'Sleep in 7 nights', text: 'New one' })[0]).toMatchObject({ path: 'text', maxChars: 20 });
    expect(editableTextsOf('CUT', { targetSec: 15 })).toEqual([]);
    const a = applyTexts('FRAME', frame, [{ path: 'items.1', value: '  Bee  ' }]);
    expect((a.params.texts as { items: string[] }).items).toEqual(['A', 'Bee', 'C']);
    expect(frame.texts.items[1]).toBe('B'); // não muta a entrada
    expect(applyTexts('FRAME', frame, [{ path: 'brand.name', value: 'x' }]).unknownPaths).toEqual(['brand.name']);
    const h = applyTexts('HEADLINE', { mode: 'replace', text: 'Sleep *deep* now', highlight: 'deep' }, [{ path: 'text', value: 'Sleep now' }]);
    expect(h.params).toMatchObject({ text: 'Sleep now', highlight: null });
  });

  // A6 (01/11): COLD_OPEN e ENDCARD só no lote de template; o Iterate normal segue sem eles (25/10)
  it('A6: COLD_OPEN/ENDCARD fora do allowedFor normal; entram só com a chave do template', () => {
    const types = (c: PlanCtx) => allowedFor(c).map((a) => a.type);
    expect(types(ctx())).not.toEqual(expect.arrayContaining(['COLD_OPEN']));
    expect(types(ctx())).not.toContain('ENDCARD');
    expect(templateOnlyTypesOf(['FRAME:news', 'COLD_OPEN', 'CUT'])).toEqual(['COLD_OPEN']);
    const c = ctx({ templateOnlyTypes: ['COLD_OPEN', 'ENDCARD'] });
    expect(allowedFor(c).filter((a) => a.type === 'COLD_OPEN' || a.type === 'ENDCARD')).toEqual([
      { type: 'COLD_OPEN', max: 1, blockedReason: null }, { type: 'ENDCARD', max: 1, blockedReason: null },
    ]);
    expect(restrictToTemplate(c, allowedFor(c), { keys: ['COLD_OPEN'] }).allowed).toEqual([{ type: 'COLD_OPEN', max: 1, blockedReason: null }]);
  });

  it('A6 fit: cold open (≥ 10 s e ≥ 2 blocos) e end card (sem end card no original; Brain ou CTA falado)', () => {
    const co = T('COLD_OPEN', 'COLD_OPEN');
    const ec = T('ENDCARD', 'ENDCARD');
    expect(templateFitOf(ctx(), co)).toEqual({ level: 'ok', reason: null });
    expect(templateFitOf(ctx({ durationSec: 9 }), co)).toEqual({ level: 'hard', reason: 'short_video' });
    expect(templateFitOf(ctx({ blocks: ctx().blocks.slice(0, 1) }), co)).toEqual({ level: 'hard', reason: 'short_video' });
    expect(templateFitOf(ctx({ caption: guard([{ type: 'COLD_OPEN', template: null }]) }), co)).toEqual({ level: 'soft', reason: 'burned_captions' });
    expect(templateFitOf(ctx(), ec)).toEqual({ level: 'ok', reason: null });
    expect(templateFitOf(ctx({ hasEndCard: true }), ec)).toEqual({ level: 'hard', reason: 'has_end_card' });
    const noBrain = { ...ctx().brain, offerAndPrice: null, cta: null };
    expect(templateFitOf(ctx({ brain: noBrain, spokenCta: null }), ec)).toEqual({ level: 'hard', reason: 'no_offer' });
    expect(templateFitOf(ctx({ brain: noBrain }), ec)).toEqual({ level: 'ok', reason: null }); // só o CTA falado = variante cta
    // pack: as chaves do pack liberam os dois
    expect(templateFitOf(ctx({ durationSec: 9, hasEndCard: true }), T('PACK', null, null, true), ['COLD_OPEN', 'ENDCARD'])).toEqual({ level: 'hard', reason: 'short_video' });
  });

  it('A6 validação: teaser fora da janela e variante sem dado no Brain viram violação', () => {
    const c = ctx({ templateOnlyTypes: ['COLD_OPEN', 'ENDCARD'], brain: { ...ctx().brain, offerAndPrice: null } });
    const allowed = restrictToTemplate(c, allowedFor(c), { keys: ['COLD_OPEN', 'ENDCARD'] }).allowed;
    const why = { text: 'x', source: 'video' as const, brainField: null, ref: 'From the video' };
    const draft = {
      blocks: c.blocks.map((b) => ({ index: b.index, fn: 'other' as const })), why: { hook: why, proof: why, cta: why },
      kept: [{ label: 'Spoken hook', blockIndex: 0 }, { label: 'Voice', blockIndex: null }],
      items: [
        { type: 'COLD_OPEN' as const, change: 'Teaser', rationale: 'r', whyKey: 'proof' as const, params: { type: 'COLD_OPEN' as const, teaserStartSec: 2, teaserEndSec: 4 } },
        { type: 'ENDCARD' as const, change: 'End card', rationale: 'r', whyKey: 'cta' as const, params: { type: 'ENDCARD' as const, variant: 'offer' as const, headline: 'Sleep better', subline: null, ctaText: 'Download' } },
      ],
    };
    const rules = validatePlan(draft, { ...c, candidatePlan: true, planRules: { min: 1, max: 2 } }, allowed).map((v) => v.rule);
    expect(rules).toEqual(expect.arrayContaining(['cold_open_window', 'endcard_variant_unavailable']));
    const ok = { ...draft, items: [
      { ...draft.items[0], params: { type: 'COLD_OPEN' as const, teaserStartSec: 18.2, teaserEndSec: 20.6 } },
      { ...draft.items[1], params: { ...draft.items[1].params, variant: 'cta' as const } },
    ] };
    expect(validatePlan(ok, { ...c, candidatePlan: true, planRules: { min: 1, max: 2 } }, allowed)).toEqual([]);
  });
});

// templates-multi-v1 (04/11): vários templates marcados num lote só
describe('lote de seleção (templates-multi-v1)', () => {
  it('restringe às chaves marcadas: molduras marcadas que passam + max por tipo', () => {
    const c = ctx();
    const r = restrictToTemplate(c, allowedFor(c), { keys: ['FRAME:news', 'FRAME:meme', 'HEADLINE', 'STATIC'], max: { HEADLINE: 3, STATIC: 1 } });
    expect(r.frames.sort()).toEqual(['meme', 'news']);
    expect(r.allowed.find((a) => a.type === 'FRAME')?.max).toBe(2);
    expect(r.allowed.find((a) => a.type === 'STATIC')?.max).toBe(1);
    expect(r.allowed.map((a) => a.type)).not.toContain('CUT');
  });

  it('fit da seleção: unknown sem leitura · hard se algum (o 1º) · soft · ok', () => {
    const ok = { level: 'ok' as const, reason: null };
    const soft = { level: 'soft' as const, reason: 'burned_captions' };
    expect(selectionFitOf([ok, { level: 'hard', reason: 'no_price' }], false)).toEqual({ level: 'unknown', reason: 'not_read' });
    expect(selectionFitOf([ok, soft, { level: 'hard', reason: 'no_price' }, { level: 'hard', reason: 'no_face' }], true)).toEqual({ level: 'hard', reason: 'no_price' });
    expect(selectionFitOf([ok, soft], true)).toEqual(soft);
    expect(selectionFitOf([ok, ok], true)).toEqual(ok);
  });

  it('skipped: hard do Reading com o motivo; cabia sem peça = not_planned; sem fits = nada', () => {
    const sel = { slugs: ['news', 'offer', 'headline', 'cuts'], keys: ['FRAME:news', 'FRAME:direct_offer', 'HEADLINE', 'CUT'] };
    const fits = { news: { level: 'ok' as const, reason: null }, offer: { level: 'hard' as const, reason: 'no_price' }, headline: { level: 'soft' as const, reason: 'burned_captions' }, cuts: { level: 'ok' as const, reason: null } };
    expect(skippedOf({ ...sel, fits }, new Set(['FRAME:news', 'HEADLINE']))).toEqual([{ slug: 'offer', reason: 'no_price' }, { slug: 'cuts', reason: 'not_planned' }]);
    expect(skippedOf(sel, new Set())).toEqual([]);
  });

  it('picked_missing: chave marcada sem peça (FRAME pela moldura); fora do validatePlan', () => {
    const draft = { items: [
      { type: 'FRAME', params: { type: 'FRAME', template: 'news' } }, { type: 'HEADLINE', params: { type: 'HEADLINE' } },
    ] } as never;
    const v = pickedMissing(draft, ['FRAME:news', 'FRAME:meme', 'HEADLINE', 'CUT']);
    expect(v.map((x) => [x.item, x.rule])).toEqual([[null, 'picked_missing'], [null, 'picked_missing']]);
    expect(v[0].detail).toContain('meme');
    expect(v[1].detail).toContain('CUT');
    expect(pickedMissing(draft, [])).toEqual([]);
  });
});
