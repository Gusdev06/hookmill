// Script das 18 molduras com fakes: nada de banco, Claude nem render. Prova o dry-run (nada chamado), o teto, a flag
// D10, a validação do regras.ts (peça com número inventado sai com motivo), a 2ª fonte e a gravação.
import type { EditMap, FrameTemplateId, TeardownSections, TranscriptWord } from '@maquina/contratos';
import type { AutoPlanInput, OfferBriefDraft } from '../integracoes/contrato';
import type { PlanCtx } from '../iteracao/regras';
import {
  TETO_RERENDER_USD, TETO_USD, executar, executarRerender, planejar, planejarRerender, segmentoDeProva, snapParaDentro,
  type Deps, type EscritorDeTextos, type LoteDados, type PecaPronta,
} from './molduras-todas';

const na = { status: 'na' as const, naReason: 'x', data: null };
const offer: OfferBriefDraft = {
  name: 'Amnayalife', language: 'zh-TW', kind: '線上英文課', what: '線上英文口說課程，教你用英文思考', audience: '上班族',
  promise: '用英文思考，開口更自信', pains: '開會不敢開口；逐字翻譯', proof: '累積 20,000+ 註冊學員；★ 4.9 平均評價',
  offerAndPrice: '免費體驗課：無需信用卡 · 30 分鐘立即體驗', cta: '免費報名體驗課', notes: null,
};
const words: TranscriptWord[] = Array.from({ length: 40 }, (_, k) => ({ word: `w${k}`, startSec: k * 2 + 0.1, endSec: k * 2 + 1.9 }));
const fps = 30;
const editMap = {
  version: 1, width: 720, height: 1280, fps, frameCount: 80 * fps, cells: [], layers: [], overlaysOverFace: [], profile: null,
  faceTrack: [
    { startFrame: 0, endFrame: 3 * fps, faceInRegion: [] },
    { startFrame: 20 * fps, endFrame: 30 * fps, faceInRegion: [] },
  ],
  keepEdit: {} as never,
} as unknown as EditMap;

function ctxBase(): PlanCtx {
  return {
    lang: 'EN', durationSec: 80,
    blocks: [
      { index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 2 },
      { index: 1, label: 'Story', fn: 'story', startSec: 2, endSec: 24 },
      { index: 2, label: 'Mechanism', fn: 'mechanism', startSec: 24, endSec: 70 },
      { index: 3, label: 'CTA', fn: 'cta', startSec: 70, endSec: 80 },
    ],
    hasSpeech: true, words, silences: [], hasWrittenHook: false, hasEndCard: false,
    brain: { what: offer.what, audience: offer.audience, pains: offer.pains, promise: offer.promise, proof: offer.proof, offerAndPrice: offer.offerAndPrice, cta: offer.cta, notes: null },
    spokenCta: null, pageCaptured: false, productPhoto: false, brandTerms: ['Amnaylife', 'Amnayalife'],
    screenLanguage: 'zh-TW', offerName: offer.name, offerKind: offer.kind,
    frame: { brand: { name: 'Amnayalife', handle: '@amnaylife', initials: 'AM', color: '#0008FF' }, faceAtSec: 0.5 },
  };
}

function lote(over: Partial<LoteDados> = {}): LoteDados {
  const ctx = ctxBase();
  const teardown = {
    identification: na, metaCopy: na, transcript: na, hook: na, structure: na, layout: na, visual: na, audio: na, offerProofCta: na, whySells: na,
  } as unknown as TeardownSections;
  const input = {
    workspaceId: 'ws', batchId: 'b', jobId: 'j', uiLocale: 'PT_BR', screenLanguage: 'zh-TW', offer, workspace: { name: 'Amnaylife', industry: null, market: null },
    page: { captured: false, text: null }, teardown, transcript: words,
    media: { durationSec: 80, cuts: 0, silences: [], hasWrittenHook: false, hasEndCard: false }, keyframes: [],
    allowed: [{ type: 'FRAME', max: 18 }], rules: { min: 1, max: 18, minDiversityPct: 40 },
  } as unknown as AutoPlanInput;
  return {
    batchId: 'b', workspaceId: 'ws', offerId: 'o', championId: 'ch', championName: 'Adele', language: 'zh-TW', createdById: 'u',
    offer, ctx, input, editMap, whys: { hook: 'pergunta', proof: 'aluno', cta: 'aula grátis' },
    existentes: [
      { template: 'question_box', code: 'FRAME-QUESTION-BOX', index: 8, render: 'READY' },
      { template: 'read_caption', code: 'FRAME-READ-CAPTION', index: 9, render: 'FAILED' },
    ],
    codigos: ['COLD-OPEN', 'FRAME-QUESTION-BOX', 'FRAME-READ-CAPTION'], maxIndex: 9, renderUsd: 0.04, model: 'claude-opus-5-5',
    ...over,
  };
}

/** Textos válidos por template (zh-TW, só com o que está no Brain/fala); `meme` traz um número inventado (77%). */
const TEXTOS: Partial<Record<FrameTemplateId, Record<string, unknown>>> = {
  gossip_page: { headline: '她開會終於*敢開口*了', pageName: '職場八卦', sources: [{ path: 'headline', source: 'pains' }, { path: 'pageName', source: 'generic' }] },
  meme: { pov: '77% 的人開會不敢開口', cta: '免費報名', sources: [{ path: 'pov', source: 'pains' }, { path: 'cta', source: 'cta' }] },
  cinema: { question: '你還在逐字翻譯嗎？', subtitle: '用英文思考，開口更自信', sources: [{ path: 'question', source: 'pains' }, { path: 'subtitle', source: 'promise' }] },
  news: { topic: '英文學習', headlineLead: '上班族開口更自信', headlineHighlight: '用英文思考', dek: '線上英文口說課程，教你用英文思考', cta: '免費報名', sources: [] },
  split_stack: { headline: '逐字翻譯是*問題*', sources: [{ path: 'headline', source: 'pains' }] },
  split_torn: { headline: '用英文思考', sources: [{ path: 'headline', source: 'promise' }] },
  call: { title: 'Amnayalife', slideTitle: '怎麼開始', slideSteps: ['線上英文口說課程', '教你用英文思考', '開口更自信'], sources: [{ path: 'slideSteps.0', source: 'what' }, { path: 'slideSteps.1', source: 'what' }, { path: 'slideSteps.2', source: 'promise' }] },
  call_dialog: { title: '英文口說課', names: ['你', '來賓'], sources: [] },
  ranking: { title: '開會的痛點', items: ['不敢開口', '逐字翻譯', '用英文思考'], sources: [{ path: 'items.0', source: 'pains' }, { path: 'items.1', source: 'pains' }, { path: 'items.2', source: 'promise' }] },
  post_card: { copy: '開會不敢開口？用英文思考，開口更自信', sources: [] },
  story: { question: '你開會敢開口嗎？', headline: '用英文思考', support: '開口更自信', copy: '線上英文口說課程，教你用英文思考', sources: [] },
  read_caption: { headline: '為什麼你*還在*逐字翻譯？', primaryText: '線上英文口說課程，教你用英文思考，開口更自信。免費報名體驗課。', sources: [] },
  pov_testimonial: { pov: '我開會終於敢開口了', cta: '免費報名', sources: [] },
  gossip_white: { headline: '她不再逐字翻譯了', sources: [] },
  gossip_pink: { headline: '她開會敢開口了', sources: [] },
};

function deps(l: LoteDados, over: Partial<Deps> = {}) {
  const chamadas: FrameTemplateId[] = [];
  const gravadas: PecaPronta[][] = [];
  const escritor: EscritorDeTextos = {
    async escrever(alvo) {
      chamadas.push(alvo.template!);
      return { frame: TEXTOS[alvo.template!] ?? {}, costUsd: 0.03 };
    },
  };
  const d: Deps = {
    carregar: async () => l,
    escritor: jest.fn(() => escritor),
    tetoDoWorkspace: jest.fn(async () => undefined),
    gravar: jest.fn(async (_l, ps: PecaPronta[]) => {
      gravadas.push(ps);
      return ps.map((p) => ({ code: p.code, itemId: `i-${p.code}`, creativeId: `c-${p.code}`, renderId: `r-${p.code}` }));
    }),
    log: () => undefined,
    ...over,
  };
  return { d, chamadas, gravadas };
}

describe('dev/molduras-todas', () => {
  it('segmentoDeProva: história depois do gancho; com rosto = só o trecho com rosto, bordas no vão entre palavras', () => {
    const ctx = ctxBase();
    expect(segmentoDeProva(ctx.blocks, editMap, words, { comRosto: false })).toEqual({ startSec: 2, endSec: 24, bloco: 'Story (story)' });
    const r = segmentoDeProva(ctx.blocks, editMap, words, { comRosto: true })!;
    expect(r.startSec).toBeGreaterThanOrEqual(20);
    expect(r.endSec).toBeLessThanOrEqual(24);
    expect(r.endSec - r.startSec).toBeGreaterThanOrEqual(3);
    // bloco proof ganha da história
    const comProva = [...ctx.blocks, { index: 4, label: 'Prova', fn: 'proof', startSec: 40, endSec: 50 }];
    expect(segmentoDeProva(comProva, editMap, [], { comRosto: false })?.bloco).toBe('Prova (proof)');
    // sem trecho ≥ 3 s com rosto
    expect(segmentoDeProva(ctx.blocks, { ...editMap, faceTrack: [] } as EditMap, words, { comRosto: true })).toBeNull();
    expect(snapParaDentro({ startSec: 20.5, endSec: 25.5 }, words)).toEqual({ startSec: 22, endSec: 24 }); // palavras em [2k+0,1, 2k+1,9]: vão em 2k
  });

  it('planejar: 18 linhas, pula o que já existe e o bloqueado pelo Brain, refaz a que falhou com código novo', () => {
    const ls = planejar(lote());
    expect(ls).toHaveLength(18);
    const by = Object.fromEntries(ls.map((l) => [l.template, l]));
    expect(by.question_box.acao).toBe('pular');
    expect(by.direct_offer).toMatchObject({ acao: 'pular', motivo: expect.stringContaining('no_price') });
    expect(by.read_caption).toMatchObject({ acao: 'criar', code: 'FRAME-READ-CAPTION-2' });
    for (const t of ['split_stack', 'split_torn', 'gossip_page', 'gossip_white', 'gossip_pink', 'call_dialog'] as const) expect(by[t].second?.kind).toBe('champion_segment');
    expect(by.call.second).toBeNull();
    expect(by.gossip_page.faceAtSec).toBe(0.5);
    expect(by.call_dialog.faceAtSec).toBeNull();
    const codes = ls.filter((l) => l.code).map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('dry-run: estima e não chama nada', async () => {
    const { d, chamadas } = deps(lote());
    const r = await executar(d, { yes: false, ignorarD10: false });
    expect(r.executado).toBe(false);
    expect(r.estimativa.renders).toBe(16);
    expect(r.estimativa.chamadas).toBe(15); // live não tem texto
    expect(r.estimativa.totalUsd).toBeGreaterThan(0);
    expect(chamadas).toEqual([]);
    expect(d.escritor).not.toHaveBeenCalled();
    expect(d.gravar).not.toHaveBeenCalled();
    expect(d.tetoDoWorkspace).not.toHaveBeenCalled();
  });

  it('--yes sem --ignorar-d10 não roda', async () => {
    const { d, chamadas } = deps(lote());
    await expect(executar(d, { yes: true, ignorarD10: false })).rejects.toThrow('--ignorar-d10');
    expect(chamadas).toEqual([]);
  });

  it('--yes acima do teto não chama o Claude', async () => {
    const { d, chamadas } = deps(lote({ renderUsd: TETO_USD }));
    await expect(executar(d, { yes: true, ignorarD10: true })).rejects.toThrow('teto');
    expect(chamadas).toEqual([]);
    expect(d.gravar).not.toHaveBeenCalled();
  });

  it('--yes: textos pela porta, validação do regras.ts, FrameSpec com 2ª fonte e gravação', async () => {
    const { d, chamadas, gravadas } = deps(lote());
    const r = await executar(d, { yes: true, ignorarD10: true });
    expect(d.tetoDoWorkspace).toHaveBeenCalledWith('ws', r.estimativa.totalUsd);
    expect(chamadas).toHaveLength(15);
    expect(r.gastoClaudeUsd).toBeCloseTo(0.45, 4);
    // número inventado: sai com o motivo da validação
    expect(r.fora).toEqual([{ template: 'meme', motivo: expect.stringContaining('invented_number') }]);
    const ps = gravadas[0];
    expect(ps.map((p) => p.template)).not.toContain('meme');
    expect(ps).toHaveLength(15);
    expect(ps.map((p) => p.index)).toEqual(Array.from({ length: 15 }, (_, k) => 10 + k));
    const gossip = ps.find((p) => p.template === 'gossip_page')!;
    expect(gossip.params).toMatchObject({ type: 'FRAME', template: 'gossip_page', faceAtSec: 0.5, screenLanguage: 'zh-TW', second: { kind: 'champion_segment' } });
    expect(ps.find((p) => p.template === 'live')!.params.texts).toEqual({});
    expect(ps.find((p) => p.template === 'read_caption')!).toMatchObject({ code: 'FRAME-READ-CAPTION-2', params: { suggestedPrimaryText: expect.any(String) } });
    expect(r.criadas).toHaveLength(15);
  });

  it('--rerender (25/10): re-render das FRAME do lote com teto de US$ 2; render no ar e sem criativo pulam; dry-run não grava', async () => {
    const existentes = [
      { template: 'news' as const, code: 'FRAME-NEWS', index: 1, render: 'READY' as const, itemId: 'i1', creativeId: 'c1', creativeState: 'APPROVED' },
      { template: 'split_stack' as const, code: 'FRAME-SPLIT-STACK', index: 2, render: 'FAILED' as const, itemId: 'i2', creativeId: 'c2', creativeState: 'RENDER_FAILED' },
      { template: 'meme' as const, code: 'FRAME-MEME', index: 3, render: 'RENDERING' as const, itemId: 'i3', creativeId: 'c3', creativeState: 'RENDERING' },
      { template: 'cinema' as const, code: 'FRAME-CINEMA', index: 4, render: null, itemId: 'i4', creativeId: null, creativeState: null },
    ];
    const l = lote({ existentes, renderUsd: 0.05 });
    const p = planejarRerender(l);
    expect(p.linhas.map((x) => [x.code, x.acao, x.duasFontes])).toEqual([
      ['FRAME-NEWS', 'refazer', false], ['FRAME-SPLIT-STACK', 'refazer', true], ['FRAME-MEME', 'pular', false], ['FRAME-CINEMA', 'pular', false],
    ]);
    // 2 renders × 0,05 + trilha nova do lote (trechos × 0,013 + até 2 imagens × 0,22); com a trilha gravada, só os renders
    expect(p.usd).toBe(Math.round((0.1 + p.trechos * 0.013 + 0.44) * 10_000) / 10_000);
    expect(p.trechos).toBeGreaterThan(10); // 80 s de vídeo em trechos de 2-5 s
    expect(planejarRerender(lote({ existentes, renderUsd: 0.05, trilhaSalva: true })).usd).toBe(0.1);
    expect(planejarRerender(lote({ existentes, renderUsd: 0.05, trilhaSalva: true }), { novaTrilha: true }).usd).toBe(p.usd);
    // --so-duas-fontes: só as 6 de 2 fontes (aqui, o split_stack)
    expect(planejarRerender(lote({ existentes, renderUsd: 0.05 }), { soDuasFontes: true }).linhas.map((x) => x.code)).toEqual(['FRAME-SPLIT-STACK']);
    const rerenderizar = jest.fn(async () => [{ code: 'FRAME-NEWS', renderId: 'r1' }]);
    const { d } = deps(l, { rerenderizar });
    expect((await executarRerender(d, { yes: false, ignorarD10: false, rerender: true })).enfileirados).toEqual([]);
    expect(rerenderizar).not.toHaveBeenCalled();
    await executarRerender(d, { yes: true, ignorarD10: false, rerender: true });
    expect(rerenderizar).toHaveBeenCalledWith(l, p.linhas.filter((x) => x.acao === 'refazer'), { novaTrilha: false, semImagem: false });
    const caro = lote({ existentes, renderUsd: TETO_RERENDER_USD });
    await expect(executarRerender(deps(caro, { rerenderizar }).d, { yes: true, ignorarD10: false, rerender: true })).rejects.toThrow(/teto/);
  });
});
