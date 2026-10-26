// legenda-protegida-v1 §2.3/§3 no plano: `burned_captions` no allowed, na validação (texto real) e no insight.
import type { AutoItemDraft, AutoPlanDraft } from '../integracoes';
import { frameTextsSchemas } from '@maquina/video';
import type { EditMap, FrameTemplateId } from '@maquina/contratos';
import { captionBlockedOf } from './plano-auto.service';
import { amostrasDoTemplate, captionGuardOf, textosDeAmostra, type CaptionGuard, type CaptionGuardSource } from './legenda-protegida';
import { FRAME_TEMPLATE_IDS, allowedFor, allowedFrames, repairPlan, swapsFor, validatePlan, type PlanCtx } from './regras';

const words = Array.from({ length: 60 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
const brand = { name: 'Sleepio', handle: '@sleepio', initials: 'S', color: '#5B4BF5' };

function ctx(over: Partial<PlanCtx> = {}): PlanCtx {
  return {
    lang: 'EN', durationSec: 30,
    blocks: [
      { index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 3 },
      { index: 1, label: 'Problem', fn: 'problem', startSec: 3, endSec: 10 },
      { index: 2, label: 'Mechanism', fn: 'body', startSec: 10, endSec: 18 },
      { index: 3, label: 'Proof', fn: 'proof', startSec: 18, endSec: 25 },
      { index: 4, label: 'CTA', fn: 'cta', startSec: 25, endSec: 30 },
    ],
    hasSpeech: true, words, silences: [], hasWrittenHook: false, hasEndCard: false,
    brain: {
      what: 'A sleep app', audience: 'Busy parents', pains: 'No time', promise: 'Sleep in 10 minutes',
      proof: '"I finally sleep through the night" - Ana, 5 stars.', offerAndPrice: '7-day trial, then $9.99/month', cta: 'Download now', notes: null,
    },
    spokenCta: 'Download the app', pageCaptured: true, productPhoto: false, brandTerms: ['Sleepio'],
    frame: { brand, faceAtSec: 1 },
    ...over,
  };
}

/** Guarda falsa: bloqueia os templates/tipos dados; o `check` bloqueia ranking com 5 itens (texto real). */
function fakeGuard(blocked: { type: string; template: FrameTemplateId | null }[]): CaptionGuard {
  return {
    bands: [{ x: 0, y: 1000, w: 1080, h: 200, startSec: 0, endSec: 30 }],
    blocked: blocked.map((b) => ({ ...b, type: b.type as never, reason: 'face_cut' as const })),
    check: (it) => {
      const p = it.params as { template?: string; texts?: { items?: string[] } };
      if (it.type === 'NATIVE_SEARCH') return 'face_cut';
      if (p.template === 'ranking' && (p.texts?.items?.length ?? 0) === 5) return 'face_cut';
      return blocked.some((b) => b.template === p.template) ? 'face_cut' : null;
    },
  };
}

describe('allowed com burned_captions (§2.3)', () => {
  it('sem guarda (ou guarda vazia) = como antes', () => {
    expect(allowedFor(ctx({ caption: null })).every((a) => a.blockedReason !== 'burned_captions')).toBe(true);
    expect(allowedFrames(ctx({ caption: { bands: [], blocked: [], check: () => null } })).every((f) => f.blockedReason !== 'burned_captions')).toBe(true);
  });

  it('tipo e moldura bloqueados saem com o motivo; o que outra regra já tirou mantém o motivo dela', () => {
    const c = ctx({ caption: fakeGuard([{ type: 'NATIVE_SEARCH', template: null }, { type: 'FRAME', template: 'post_card' }, { type: 'FRAME', template: 'direct_offer' }]) });
    const a = allowedFor(c);
    expect(a.find((x) => x.type === 'NATIVE_SEARCH')).toMatchObject({ max: 0, blockedReason: 'burned_captions' });
    expect(a.find((x) => x.type === 'CUT')).toMatchObject({ blockedReason: null });
    const f = allowedFrames(c);
    expect(f.find((x) => x.template === 'post_card')).toMatchObject({ allowed: false, blockedReason: 'burned_captions' });
    // sem preço no Brain: direct_offer sai por no_price (a outra regra vem antes)
    const sem = ctx({ brain: { ...c.brain, offerAndPrice: 'Trial' }, caption: c.caption });
    expect(allowedFrames(sem).find((x) => x.template === 'direct_offer')).toMatchObject({ blockedReason: 'no_price' });
    // FRAME max = templates que sobraram
    expect(a.find((x) => x.type === 'FRAME')!.max).toBe(Math.min(8, f.filter((x) => x.allowed).length));
    // burned_captions não vira troca (vai no insight.captionBlocked)
    expect(swapsFor(a).some((s) => s.from === 'NATIVE_SEARCH')).toBe(false);
  });

  it('HEADLINE coberto pela guarda sai com burned_captions; bloqueio próprio do HEADLINE vem antes', () => {
    const headline = { mode: 'replace' as const, original: 'Old', lines: 1, maxChars: 40, hasHighlight: false, language: 'en', blockedReason: null, format: null };
    const g = fakeGuard([{ type: 'HEADLINE', template: null }]);
    expect(allowedFor(ctx({ headline, caption: g }))[0]).toMatchObject({ type: 'HEADLINE', max: 0, blockedReason: 'burned_captions' });
    expect(allowedFor(ctx({ headline: { ...headline, blockedReason: 'headline_over_face' }, caption: g }))[0]).toMatchObject({ blockedReason: 'headline_over_face' });
  });

  it('insight.captionBlocked: tipos e molduras do allowed + o que o reparo tirou pela validação', () => {
    const c = ctx({ caption: fakeGuard([{ type: 'NATIVE_SEARCH', template: null }, { type: 'FRAME', template: 'story' }]) });
    const out = captionBlockedOf(c, allowedFor(c), [{ type: 'FRAME', template: 'ranking' }]);
    expect(out.captionBlocked).toEqual([
      { type: 'NATIVE_SEARCH', template: null, reason: 'burned_captions' },
      { type: 'FRAME', template: 'story', reason: 'burned_captions' },
      { type: 'FRAME', template: 'ranking', reason: 'burned_captions' },
    ]);
    expect(captionBlockedOf(ctx(), allowedFor(ctx()))).toEqual({});
  });
});

describe('validação com o texto real (§3: a mesma conta do build)', () => {
  const item = (params: unknown, type = (params as { type: string }).type): AutoItemDraft =>
    ({ type, change: 'One thing changes', rationale: 'r', whyKey: 'hook', params } as unknown as AutoItemDraft);
  const ranking = (n: number) => item({ type: 'FRAME', template: 'ranking', texts: { title: 'Top sleep fixes', items: ['No time', 'Sleep in 10 minutes', 'A sleep app', 'Busy parents', 'Download now'].slice(0, n) }, sources: { title: 'promise', 'items.0': 'pains', 'items.1': 'promise', 'items.2': 'what', 'items.3': 'what', 'items.4': 'what' } });
  const draft = (items: AutoItemDraft[]): AutoPlanDraft => ({
    blocks: [{ index: 0, fn: 'hook' }, { index: 1, fn: 'problem' }, { index: 2, fn: 'mechanism' }, { index: 3, fn: 'proof' }, { index: 4, fn: 'cta' }],
    why: { hook: { text: 'h', source: 'brain', brainField: 'pains', ref: 'No time' }, proof: { text: 'p', source: 'brain', brainField: 'proof', ref: 'Ana' }, cta: { text: 'c', source: 'brain', brainField: 'offerAndPrice', ref: 'trial' } },
    kept: [{ label: 'Hook', blockIndex: 0 }, { label: 'Proof', blockIndex: 3 }],
    items,
  });

  it('ranking com 5 itens tampa (o de 4 não): violação burned_captions só no de 5, e o reparo tira ele', () => {
    const c = ctx({ caption: fakeGuard([]) });
    const allowed = allowedFor(c);
    const d = draft([ranking(5), ranking(4)]);
    const v = validatePlan(d, c, allowed).filter((x) => x.rule === 'burned_captions');
    expect(v.map((x) => x.item)).toEqual([0]);
    expect(v[0].detail).toContain('ranking');
    const r = repairPlan(d, c, allowed, { why: d.why, kept: d.kept });
    expect(r.removed.find((x) => x.index === 0)?.rules).toContain('burned_captions');
  });

  it('sem faixa protegida a validação não chama a guarda', () => {
    const check = jest.fn(() => 'face_cut' as const);
    const c = ctx({ caption: { bands: [], blocked: [], check } });
    validatePlan(draft([ranking(5)]), c, allowedFor(c));
    expect(check).not.toHaveBeenCalled();
  });
});

describe('amostras e guarda real (builders do maquina-video)', () => {
  it('as amostras de todo template passam no schema de textos da moldura (pt e zh)', () => {
    for (const lang of ['pt', 'zh-TW']) {
      for (const t of FRAME_TEMPLATE_IDS) {
        for (const texts of amostrasDoTemplate(t, lang)) {
          const r = (frameTextsSchemas as Record<string, { safeParse: (x: unknown) => { success: boolean } }>)[t].safeParse(texts);
          expect({ t, lang, ok: r.success }).toEqual({ t, lang, ok: true });
        }
      }
    }
    expect(amostrasDoTemplate('ranking', 'en').map((x) => (x.items as string[]).length)).toEqual([3, 4, 5]);
    expect(textosDeAmostra('live', 'en')).toEqual({});
  });

  const src = (m: EditMap | null): CaptionGuardSource => ({
    editMap: m, source: { width: 1080, height: 1920, fps: 30, durationSec: 30, hasAudio: true }, words, silences: [],
    blocks: [{ index: 0, startSec: 0, endSec: 10 }, { index: 1, startSec: 10, endSec: 20 }, { index: 2, startSec: 20, endSec: 30 }],
    hookEndSec: 3, palette: ['#111111', '#eeeeee'], brandName: 'Acme', language: 'pt', brandColor: null,
  });
  const mapa = (caption: { x: number; y: number; w: number; h: number }): EditMap => ({
    version: 1, width: 1080, height: 1920, fps: 30, frameCount: 900, cells: [], overlaysOverFace: false, profile: null,
    faceTrack: [{ startFrame: 0, endFrame: 900, region: { x: 0, y: 0, w: 1080, h: 1920 }, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.25, w: 0.4, h: 0.3 } }] }],
    layers: [{ box: caption, startFrame: 0, endFrame: 900, kind: 'caption', style: { fontSizePx: 60, lineHeight: 1.15 } }],
  } as unknown as EditMap);
  const opts = { templates: FRAME_TEMPLATE_IDS, frame: { brand, screenLanguage: 'pt', faceAtSec: 1 }, headline: null };

  it('sem faixa = nada bloqueado e o check sempre passa', () => {
    const g = captionGuardOf(src(null), [], opts);
    expect(g.blocked).toEqual([]);
    expect(g.check({ type: 'NATIVE_SEARCH', params: { type: 'NATIVE_SEARCH', query: 'x' } })).toBeNull();
  });

  it('com legenda queimada: o que a guarda bloqueia no allowed, o check com a mesma amostra também bloqueia', () => {
    const { faixasProtegidasDe } = jest.requireActual('@maquina/video') as typeof import('@maquina/video');
    const m = mapa({ x: 90, y: 1050, w: 900, h: 90 });
    const bands = faixasProtegidasDe(m as never, { width: 1080, height: 1920 });
    expect(bands.length).toBe(1);
    const g = captionGuardOf(src(m), bands, opts);
    expect(g.bands).toBe(bands);
    expect(g.blocked.length).toBeGreaterThan(0);
    for (const b of g.blocked.filter((x) => x.type === 'FRAME')) {
      const params = { template: b.template, texts: amostrasDoTemplate(b.template!, 'pt')[1] ?? amostrasDoTemplate(b.template!, 'pt')[0], screenLanguage: 'pt', brand, faceAtSec: 1, second: null, suggestedPrimaryText: null };
      expect({ t: b.template, r: g.check({ type: 'FRAME', params }) }).toEqual({ t: b.template, r: expect.stringMatching(/face_cut|no_room/) });
    }
  });
});
