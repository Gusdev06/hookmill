import {
  FRAME_FORMATS, LEGACY_STATIC_VISUAL, autoAdName, autoFileName, engineFor, estimateStaticUsd, expectedOutputSec, folderOf, isAssembled, latestByFormat,
  legacySpecOf, mockRenderFail, paramsOf, pieceFormats, pieceFrameOf, pieceOutcome, pieceStatus, renderOrder, screenRefSourceOf, staticFailCode,
  primaryFormatOf, staticLayoutOf, staticNextStep, staticSpecAnyOf, staticSpecOf, suggestedPrimaryTextOf, supportedFormatsOf, textCheckOf,
} from './pecas';
import { withCollisionSuffix } from '../biblioteca/ad-name';

const t = (ms: number) => new Date(1_700_000_000_000 + ms);

describe('peças AUTO: regras puras (variacao-auto-v1)', () => {
  it('ordem da fila (rev. 23/10 §14.2): só o 9:16 de cada peça, na ordem do plano; STATIC = IMAGE_GEN', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ index: 10 - i, id: `p${10 - i}` }));
    const o = renderOrder(items);
    expect(o).toHaveLength(11);
    expect(o.every((x) => x.format === 'VERTICAL_9_16')).toBe(true);
    expect(o.map((x) => x.item.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(o.map((x) => x.seq)).toEqual([...Array(11).keys()]);
    expect(engineFor('STATIC')).toBe('IMAGE_GEN');
    expect(engineFor('CUT')).toBe('REMOTION');
    expect(engineFor(null)).toBe('REMOTION');
  });

  it('status derivado na ordem do §3.2', () => {
    const r = (status: 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED') => ({ format: 'VERTICAL_9_16' as const, status, createdAt: t(0) });
    expect(pieceStatus({ launched: false, leftOutAt: null, creativeState: null, renders: [] })).toBe('planned');
    expect(pieceStatus({ launched: true, leftOutAt: t(1), creativeState: 'RENDER_FAILED', renders: [] })).toBe('left_out');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'APPROVED', renders: [] })).toBe('ready');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'RENDER_FAILED', renders: [] })).toBe('failed');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'RENDERING', renders: [r('RENDERING')] })).toBe('rendering');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'RENDERING', renders: [r('QUEUED')] })).toBe('queued');
  });

  it('desfecho (rev. 23/10): só o 9:16 decide; formato sob demanda na fila ou falho não muda a peça; o mais novo vale', () => {
    const R = (format: any, status: any, ms = 0) => ({ format, status, createdAt: t(ms) });
    expect(pieceOutcome([])).toBeNull();
    expect(pieceOutcome([R('VERTICAL_9_16', 'QUEUED')])).toBeNull();
    expect(pieceOutcome([R('VERTICAL_9_16', 'RENDERING'), R('PORTRAIT_4_5', 'READY')])).toBeNull();
    expect(pieceOutcome([R('VERTICAL_9_16', 'READY')])).toBe('ready');
    expect(pieceOutcome([R('VERTICAL_9_16', 'READY'), R('PORTRAIT_4_5', 'FAILED'), R('SQUARE_1_1', 'QUEUED')])).toBe('ready'); // lote antigo
    expect(pieceOutcome([R('VERTICAL_9_16', 'FAILED')])).toBe('failed');
    expect(pieceOutcome([R('VERTICAL_9_16', 'FAILED'), R('VERTICAL_9_16', 'READY', 5)])).toBe('ready');
    expect(latestByFormat([R('PORTRAIT_4_5', 'READY', 9), R('PORTRAIT_4_5', 'FAILED', 1)]).get('PORTRAIT_4_5')!.status).toBe('READY');
  });

  it('formats[]: sempre os 3 na ordem; none/queued/rendering/ready/failed pelo vigente; requestUsd só em none/failed (STATIC paga)', () => {
    const R = (format: any, status: any, ms = 0, extra: object = {}) => ({ format, status, createdAt: t(ms), progress: 0, errorCode: null, failReason: null, ...extra });
    const v = pieceFormats([R('VERTICAL_9_16', 'READY'), R('PORTRAIT_4_5', 'RENDERING', 1, { progress: 40 })], false, 0.22);
    expect(v).toEqual([
      { format: '9x16', state: 'ready', progress: null, errorCode: null, failReason: null, requestUsd: null },
      { format: '4x5', state: 'rendering', progress: 40, errorCode: null, failReason: null, requestUsd: null },
      { format: '1x1', state: 'none', progress: null, errorCode: null, failReason: null, requestUsd: 0 },
    ]);
    const s = pieceFormats([R('VERTICAL_9_16', 'READY'), R('SQUARE_1_1', 'FAILED', 1, { errorCode: 'SAFETY_BLOCK', failReason: 'no' }), R('PORTRAIT_4_5', 'QUEUED', 2)], true, 0.22);
    expect(s.map((f) => [f.format, f.state, f.requestUsd, f.errorCode])).toEqual([['9x16', 'ready', null, null], ['4x5', 'queued', null, null], ['1x1', 'failed', 0.22, 'SAFETY_BLOCK']]);
    expect(pieceFormats([], true, 0.22).map((f) => f.requestUsd)).toEqual([0.22, 0.22, 0.22]);
    // falho sem código (render antigo) = RENDER_ERROR
    expect(pieceFormats([R('VERTICAL_9_16', 'FAILED')], false, 0.22)[0].errorCode).toBe('RENDER_ERROR');
  });

  it('STATIC: spec do item (plano antigo sem visual = pôster tipográfico), reenvio no máx. 1 (SAFETY_BLOCK → safe), código final, preço', () => {
    const visual = { object: 'A woman, 30s', scene: 'Kitchen table, checking a bill', vibe: 'Warm morning light', style: 'everyday_photo', headlinePlacement: 'top' };
    expect(staticSpecOf({ type: 'STATIC', headline: 'Stop overpaying', refAtSec: 2, visual }, 'en')).toEqual({ headline: 'Stop overpaying', screenLanguage: 'en', visual });
    expect(staticSpecOf({ type: 'STATIC', atSec: 3, headline: 'Proof' }, 'pt-BR')).toEqual({ headline: 'Proof', screenLanguage: 'pt-BR', visual: LEGACY_STATIC_VISUAL });
    expect(LEGACY_STATIC_VISUAL).toEqual({ object: '', scene: '', vibe: '', style: 'ad_graphic', headlinePlacement: 'center' });
    expect(staticNextStep({ code: 'SAFETY_BLOCK', tasks: 1, safe: false })).toEqual({ resend: true, safe: true });
    expect(staticNextStep({ code: 'PROVIDER_TIMEOUT', tasks: 1, safe: false })).toEqual({ resend: true, safe: false });
    expect(staticNextStep({ code: 'DOWNLOAD_INVALID', tasks: 1, safe: true })).toEqual({ resend: true, safe: true });
    expect(staticNextStep({ code: 'SAFETY_BLOCK', tasks: 2, safe: true })).toEqual({ resend: false });
    expect(staticNextStep({ code: 'CANCELLED', tasks: 1, safe: false })).toEqual({ resend: false });
    expect(staticFailCode('SAFETY_BLOCK')).toBe('SAFETY_BLOCK');
    expect(staticFailCode('CANCELLED')).toBe('PROVIDER_ERROR');
    expect(estimateStaticUsd({}, 2)).toBe(0.8); // TRANSIÇÃO: sem estimateStaticImages = US$ 0,40 (2k, D1)
    expect(estimateStaticUsd({ estimateStaticImages: (n: number) => n * 0.3 }, 3)).toBe(0.9);
    expect(estimateStaticUsd({}, 0)).toBe(0);
  });

  it('adName AUTO = CLIENTE_MMDD_CODIGO (UTC do launchedAt), colisão _2; arquivo <adName>_<FMT>.<ext>', () => {
    const base = autoAdName({ shortCode: 'MC', launchedAt: new Date('2026-10-13T23:30:00-03:00'), code: 'CUT-15S' });
    expect(base).toBe('MC_1014_CUT-15S');
    expect(autoAdName({ shortCode: 'MC', launchedAt: new Date('2026-10-13T15:00:00Z'), code: 'CUT-15S' })).toBe('MC_1013_CUT-15S');
    expect(withCollisionSuffix('MC_1013_CUT-15S', ['MC_1013_CUT-15S'])).toBe('MC_1013_CUT-15S_2');
    expect(autoFileName('MC_1013_CUT-15S', 'VERTICAL_9_16', 'video/mp4')).toBe('MC_1013_CUT-15S_9x16.mp4');
    expect(autoFileName('MC_1013_LAYOUT-SPLIT-LP', 'PORTRAIT_4_5', 'video/mp4')).toBe('MC_1013_LAYOUT-SPLIT-LP_4x5.mp4');
    expect(autoFileName('MC_1013_STATIC-F1', 'SQUARE_1_1', 'image/png')).toBe('MC_1013_STATIC-F1_1x1.png');
  });

  it('pasta pelo eixo; gatilhos de mock (render-fail = 1ª do 9:16, format-fail = 1ª do 4:5); duração esperada', () => {
    expect(folderOf('ITERATION')).toBe('1-stretch');
    expect(folderOf('DIVERSITY')).toBe('2-new-audience');
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'STORY', 'VERTICAL_9_16', 1)).toBe(true);
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'STORY', 'VERTICAL_9_16', 2)).toBe(false);
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'STORY', 'PORTRAIT_4_5', 1)).toBe(false);
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'CUT', 'VERTICAL_9_16', 1)).toBe(false);
    expect(mockRenderFail('x [mock:format-fail:CUT]', 'CUT', 'PORTRAIT_4_5', 1)).toBe(true);
    expect(mockRenderFail('x [mock:format-fail:CUT]', 'CUT', 'PORTRAIT_4_5', 2)).toBe(false);
    expect(mockRenderFail('x [mock:format-fail:CUT]', 'CUT', 'SQUARE_1_1', 1)).toBe(false);
    expect(mockRenderFail('x [mock:format-fail:CUT]', 'CUT', 'VERTICAL_9_16', 1)).toBe(false);
    expect(expectedOutputSec('CUT', { targetSec: 15 }, 30)).toBe(15);
    expect(expectedOutputSec('ENDCARD', {}, 30)).toBe(32);
    expect(expectedOutputSec('STORY', {}, 30)).toBe(30);
    expect(expectedOutputSec('STATIC', {}, 30)).toBe(30); // o STATIC não entra no Remotion (conta 60 s fixos no ETA)
  });
});

describe('25/10 estatico-montado-e-molduras-v1: spec por layout (§A5), textCheck (§A6) e molduras (§B2/§B4)', () => {
  const visual = { object: 'A woman, 30s', scene: 'Kitchen table', vibe: 'Warm light', style: 'everyday_photo', headlinePlacement: 'top' };
  const copy = { headline: { lead: 'Você dorme', highlight: 'de novo' }, cta: { main: 'Comece', sub: null, subSource: null } };
  const visualV2 = { hero: null, product: { kind: 'phone_screen', look: null, screenTitle: null, screenTitleSource: null }, mood: 'calm' };
  const v2 = { brandName: 'Sono Já', palette: { background: '#1A0D05', accent: '#FF8A3D' }, screenRefUrl: 'https://x/page.png' };

  it('layout pela forma do params: copy = assembled; visual.object = photo_headline; sem visual = poster (nunca replaneja)', () => {
    expect(staticLayoutOf({ type: 'STATIC', layout: 'assembled', copy, visualV2 })).toBe('assembled');
    expect(staticLayoutOf({ type: 'STATIC', headline: 'x', visual })).toBe('photo_headline');
    expect(staticLayoutOf({ type: 'STATIC', atSec: 3, headline: 'x' })).toBe('poster');
    expect(staticLayoutOf({ type: 'STATIC', headline: 'x', visual: LEGACY_STATIC_VISUAL })).toBe('poster');
    const a = staticSpecAnyOf({ type: 'STATIC', layout: 'assembled', copy, visualV2 }, 'pt-BR', v2);
    expect(a).toEqual({ layout: 'assembled', screenLanguage: 'pt-BR', brandName: 'Sono Já', palette: v2.palette, copy, visual: visualV2, screenRefUrl: 'https://x/page.png' });
    expect(isAssembled(a)).toBe(true);
    expect(legacySpecOf(a)).toEqual({ headline: 'Você dorme de novo', screenLanguage: 'pt-BR', visual: LEGACY_STATIC_VISUAL });
    // sem device (kind none) = sem referência
    expect((staticSpecAnyOf({ copy, visualV2: { ...visualV2, product: { ...visualV2.product, kind: 'none' } } }, 'pt-BR', v2) as { screenRefUrl: unknown }).screenRefUrl).toBeNull();
    expect(staticSpecAnyOf({ headline: 'x', visual }, 'en', v2)).toEqual({ headline: 'x', screenLanguage: 'en', visual, layout: 'photo_headline' });
    expect(staticSpecAnyOf({ headline: 'x' }, 'en', v2)).toEqual({ headline: 'x', screenLanguage: 'en', visual: LEGACY_STATIC_VISUAL, layout: 'poster' });
  });

  it('D4: referência da tela = captura (tela) › foto; produto físico = foto › captura; sem device = nenhuma', () => {
    expect(screenRefSourceOf('phone_screen', { page: true, photo: true })).toBe('page');
    expect(screenRefSourceOf('laptop_screen', { page: false, photo: true })).toBe('photo');
    expect(screenRefSourceOf('physical_product', { page: true, photo: true })).toBe('photo');
    expect(screenRefSourceOf('physical_product', { page: true, photo: false })).toBe('page');
    expect(screenRefSourceOf('none', { page: true, photo: true })).toBeNull();
    expect(screenRefSourceOf('phone_screen', { page: false, photo: false })).toBeNull();
  });

  it('textCheck da vista: só render assembled com veredito gravado', () => {
    expect(textCheckOf({ spec: { layout: 'assembled' }, textCheck: { status: 'mismatch', items: [{ expected: 'volta', seen: 'vólta', critical: false }] } }))
      .toEqual({ status: 'mismatch', items: [{ expected: 'volta', seen: 'vólta', critical: false }], extraText: [] });
    expect(textCheckOf({ spec: { layout: 'assembled' } })).toBeNull();
    expect(textCheckOf({ spec: { layout: 'photo_headline' }, textCheck: { status: 'ok', items: [] } })).toBeNull();
    expect(textCheckOf(null)).toBeNull();
  });

  it('molduras: formatos suportados (§B4), supported na vista, frame/primaryText da peça, gatilho frame-fail', () => {
    const params = { type: 'FRAME', template: 'read_caption', texts: {}, suggestedPrimaryText: ' Leia tudo. ', second: null };
    expect(supportedFormatsOf('FRAME', params)).toEqual(FRAME_FORMATS.read_caption);
    expect(supportedFormatsOf('STORY', {})).toBeUndefined();
    expect(Object.keys(FRAME_FORMATS)).toHaveLength(18);
    const f = pieceFormats([], false, 0.22, ['9x16', '4x5']);
    expect(f.map((x) => [x.format, x.supported])).toEqual([['9x16', true], ['4x5', true], ['1x1', false]]);
    expect(pieceFormats([], false, 0.22)[0]).not.toHaveProperty('supported');
    expect(pieceFrameOf(params)).toEqual({ template: 'read_caption', second: null, canSwapBroll: false });
    expect(pieceFrameOf({ template: 'split_stack', second: { kind: 'stock_broll', provenance: { provider: 'pexels' } } })).toMatchObject({ second: { kind: 'stock_broll' }, canSwapBroll: true });
    expect(pieceFrameOf({ type: 'STORY' })).toBeNull();
    expect(suggestedPrimaryTextOf(params)).toBe('Leia tudo.');
    expect(suggestedPrimaryTextOf({ ...params, template: 'news' })).toBeNull();
    expect(paramsOf({ params })).toBe(params);
    expect(paramsOf(null)).toBeNull();
    expect(mockRenderFail('x [mock:frame-fail:news]', 'FRAME', 'VERTICAL_9_16', 1, 'news')).toBe(true);
    expect(mockRenderFail('x [mock:frame-fail:news]', 'FRAME', 'VERTICAL_9_16', 2, 'news')).toBe(false);
    expect(mockRenderFail('x [mock:frame-fail:news]', 'FRAME', 'VERTICAL_9_16', 1, 'meme')).toBe(false);
    expect(engineFor('FRAME')).toBe('REMOTION');
  });

  it('HEADLINE: só no aspecto do campeão; a peça decide por ele', () => {
    const params = { type: 'HEADLINE', format: 'PORTRAIT_4_5' };
    expect(supportedFormatsOf('HEADLINE', params)).toEqual(['4x5']);
    expect(primaryFormatOf('HEADLINE', params)).toBe('PORTRAIT_4_5');
    expect(primaryFormatOf('CUT', params)).toBe('VERTICAL_9_16');
    const R = (format: any, status: any) => ({ format, status, createdAt: new Date(0) });
    expect(pieceOutcome([R('PORTRAIT_4_5', 'READY')], 'PORTRAIT_4_5')).toBe('ready');
    expect(pieceOutcome([R('PORTRAIT_4_5', 'READY')])).toBeNull();
  });
});
