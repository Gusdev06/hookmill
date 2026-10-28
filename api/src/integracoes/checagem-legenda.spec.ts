// legenda-protegida-v1 (26/10), linha ia: estilo completo da camada `caption` no describeEdit e o `checkCaption` (Haiku
// visão, strict, veredito, custo) + fake [mock:caption-covered]. Sem rede.
import type { TranscriptWord } from './contrato';
import { CAPTION_CHECK, CAPTION_CHECK_SCHEMA, parseCaptionCheck, textOverlap, type CheckCaptionInput } from './claude/checagem-legenda';
import { ClaudeLiveService } from './claude/claude.service';
import { parseEditMap } from './claude/edicao';
import { schemaStats } from './claude/schema-stats';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './claude/transporte';
import { FakeClaudeService } from './mock/fake-claude.service';
import { MemoryCostStore } from './store/memoria.store';

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const FRAMES = [2, 16, 30, 44, 58, 72].map((t) => ({ atSec: t, image: JPG, crop: JPG, expectedText: '我不方便' }));
const INPUT: CheckCaptionInput = { workspaceId: 'w1', renderId: 'r1', variationBatchId: 'b1', creativeId: 'c1', mode: 'avoid', language: 'zh-TW', frames: FRAMES.map((f) => ({ atSec: f.atSec, frameUrl: `https://s/f${f.atSec}.png`, bandUrl: `https://s/b${f.atSec}.png`, expectedWords: ['我不方便'] })) };
const jpgFetch = (async () => new Response(JPG, { status: 200 })) as unknown as typeof fetch;
const row = (frame: number, over: Record<string, unknown> = {}) => ({ frame, captionVisible: true, intact: true, duplicated: false, seen: '我不方便', problem: 'none', reason: '', ...over });

class T implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly body: unknown) {}
  async run(c: ClaudeCall): Promise<ClaudeResult> {
    this.calls.push(c);
    return { text: JSON.stringify(this.body), stopReason: 'end_turn', usage: [{ model: 'claude-haiku-4-5', inputTokens: 5800, outputTokens: 300, cacheWriteTokens: 0, cacheReadTokens: 0 }] };
  }
}

describe('checkCaption', () => {
  it('Haiku sem effort, strict, quadro reduzido + recorte por quadro; ok quando tudo inteiro; custo ~US$ 0,007 no lote', async () => {
    const t = new T({ frames: FRAMES.map((_, k) => row(k + 1)) });
    const costs = new MemoryCostStore();
    const svc = new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5', runFfmpeg: async () => JPG, fetchImpl: jpgFetch });
    const out = await svc.checkCaption(INPUT);
    expect(t.calls[0]).toMatchObject({ model: 'claude-haiku-4-5', effort: null, schema: CAPTION_CHECK_SCHEMA });
    expect(t.calls[0].images!.map((x) => x.caption).slice(0, 2)).toEqual(['Frame 1 (full):', 'Frame 1 (subtitle area):']);
    expect(t.calls[0].images).toHaveLength(12);
    expect(t.calls[0].user).toContain('Expected: the ORIGINAL subtitle of the video, whole and uncovered.');
    expect(t.calls[0].user).toContain('Frame 2 at 16.0 s (full frame, then the subtitle area crop); speech at this moment: "我不方便"');
    expect(out.status).toBe('ok');
    expect(out.frames[0]).toEqual({ atSec: 2, ok: true, covered: false, duplicated: false, seen: '我不方便', problem: null, reason: null });
    expect(out.costUsd).toBeCloseTo(0.0073, 4);
    expect(out.costUsd).toBeLessThanOrEqual(CAPTION_CHECK.estimatedUsd);
    expect(costs.entries.every((e) => e.variationBatchId === 'b1' && e.creativeId === 'c1' && e.kind === 'LLM')).toBe(true);
    expect(schemaStats(CAPTION_CHECK_SCHEMA)).toMatchObject({ unions: 0, optional: 0 });
  });

  it('recorte da faixa opcional por quadro: sem ele vai só o quadro reduzido (e o pedido diz isso)', async () => {
    const t = new T({ frames: FRAMES.map((_, k) => row(k + 1)) });
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5', runFfmpeg: async () => JPG, fetchImpl: jpgFetch });
    await svc.checkCaption({ ...INPUT, frames: INPUT.frames.map((f, k) => (k % 2 ? { ...f, bandUrl: null } : { atSec: f.atSec, frameUrl: f.frameUrl, expectedWords: f.expectedWords })) });
    expect(t.calls[0].images).toHaveLength(6);
    expect(t.calls[0].user).toContain('Frame 1 at 2.0 s (full frame);');
  });

  it('veredito: 1 quadro tampado/cortado/duplicado COM motivo = covered; 1 quadro sem legenda tolera, 2 não; replace confere o texto', () => {
    const v = (rows: unknown[], mode: 'avoid' | 'replace' = 'avoid') => parseCaptionCheck(JSON.stringify({ frames: rows }), { mode, frames: FRAMES });
    const all = FRAMES.map((_, k) => row(k + 1));
    const motivo = 'the title card hides the last two characters';
    expect(v(all).status).toBe('ok');
    expect(v(all.map((r, k) => (k === 2 ? { ...r, intact: false, problem: 'covered', reason: motivo } : r)))).toMatchObject({ status: 'covered', frames: expect.arrayContaining([expect.objectContaining({ atSec: 30, ok: false, problem: 'covered', reason: motivo })]) });
    expect(v(all.map((r, k) => (k === 2 ? { ...r, intact: false, problem: 'cut', reason: 'cut by the right edge' } : r)))).toMatchObject({ status: 'covered', frames: expect.arrayContaining([expect.objectContaining({ problem: 'cut' })]) });
    expect(v(all.map((r, k) => (k === 4 ? { ...r, duplicated: true, problem: 'duplicated', reason: 'old subtitle leaks at the bottom edge' } : r))).status).toBe('covered');
    expect(v(all.map((r, k) => (k === 1 ? { ...r, captionVisible: false, seen: '' } : r))).status).toBe('ok');
    expect(v(all.map((r, k) => (k === 1 || k === 3 ? { ...r, captionVisible: false, seen: '' } : r))).status).toBe('covered');
    expect(v(all.map((r, k) => (k === 0 ? { ...r, seen: 'completely different' } : r)), 'replace').frames[0].problem).toBe('wrong_text');
    expect(v(all.slice(0, 4)).frames[5]).toMatchObject({ ok: false, problem: 'missing' }); // quadro esquecido
    expect(textOverlap('I am not convenient', 'i am NOT convenient!')).toBe(1);
  });

  it('F9 (falso positivo do lote live 27/10): 1 quadro ruim sem motivo não derruba a peça; 2 ruins derrubam', async () => {
    // Haiku mockado: o quadro de 77,39 s veio "não inteiro" lendo a legenda inteira, sem dizer o que tampa
    const lida = '這堂免費公開課會完整解釋 台灣人最常見的英文盲點';
    const frames = [13, 26, 39, 52, 65, 77.39].map((t) => ({ atSec: t, image: JPG, crop: JPG, expectedText: null }));
    const input: CheckCaptionInput = { ...INPUT, frames: frames.map((f) => ({ atSec: f.atSec, frameUrl: `https://s/f${f.atSec}.png`, bandUrl: `https://s/b${f.atSec}.png`, expectedWords: null })) };
    const linhas = frames.map((_, k) => row(k + 1, { seen: lida }));
    const falso = linhas.map((r, k) => (k === 5 ? { ...r, intact: false, problem: 'none', reason: '' } : r));
    const t = new T({ frames: falso });
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5', runFfmpeg: async () => JPG, fetchImpl: jpgFetch });
    const out = await svc.checkCaption(input);
    expect(t.calls[0].schema).toBe(CAPTION_CHECK_SCHEMA);
    expect(out.status).toBe('ok');
    expect(out.frames[5]).toMatchObject({ atSec: 77.39, ok: false, covered: false, problem: 'illegible', reason: null, seen: lida });

    const v = (rows: unknown[]) => parseCaptionCheck(JSON.stringify({ frames: rows }), { mode: 'avoid', frames });
    // "covered" dito sem motivo (ou motivo vazio de conteúdo) em 1 quadro: tolerado
    expect(v(linhas.map((r, k) => (k === 5 ? { ...r, intact: false, problem: 'covered', reason: 'none' } : r))).status).toBe('ok');
    expect(v(linhas.map((r, k) => (k === 5 ? { ...r, intact: false, problem: 'illegible', reason: 'blurry' } : r))).status).toBe('ok');
    // 2 quadros ruins, mesmo sem motivo = covered
    expect(v(linhas.map((r, k) => (k >= 4 ? { ...r, intact: false, problem: 'covered', reason: '' } : r))).status).toBe('covered');
    // o schema pede o motivo (strict: obrigatório)
    expect((CAPTION_CHECK_SCHEMA.properties.frames as { items: { required: string[] } }).items.required).toContain('reason');
  });

  it('fake: ok por padrão; [mock:caption-covered] tampa os quadros do meio; [mock:caption-fail] lança', async () => {
    const f = new FakeClaudeService(new MemoryCostStore(), { model: 'mock', stepMs: 0 });
    expect((await f.checkCaption(INPUT)).status).toBe('ok');
    const c = await f.checkCaption({ ...INPUT, notes: '[mock:caption-covered]' });
    expect(c.status).toBe('covered');
    expect(c.frames.map((x) => x.ok)).toEqual([true, true, false, false, true, true]);
    await expect(f.checkCaption({ ...INPUT, notes: '[mock:caption-fail]' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('describeEdit: estilo completo da legenda (a refeita copia)', () => {
  it('fonte, cor, contorno, caixa alta, destaque, caixa da palavra, tamanho e palavras por página', () => {
    const words: TranscriptWord[] = [{ word: 'and', startSec: 1, endSec: 1.2 }, { word: 'what', startSec: 1.3, endSec: 1.5 }];
    const d = parseEditMap(JSON.stringify({
      layers: [{ kind: 'caption', text: '', startSec: 0, endSec: 10, box: { x: 0.1, y: 0.52, w: 0.8, h: 0.08 }, background: 'none', backgroundColor: '', fontId: 'montserrat-800', uppercase: false, fontSizeRel: 0.03, color: '#FFE082', highlightColor: '#FFFFFF', highlightBoxColor: '#6C22D6', strokeColor: '#000000', strokeRel: 0.002, shadow: true, align: 'center', wordsPerPage: 4 }],
      overlaysOverFace: [], profile: { gender: 'female', ageBand: '25-35', ethnicity: '', hair: '', clothing: '', setting: '', lighting: '', framing: '', pose: '' },
    }), { width: 1080, height: 1920, fps: 30, frameCount: 300, durationSec: 10 }, words, []);
    const c = d.layers[0];
    expect(c.wordsPerPage).toBe(4);
    expect(c.style).toMatchObject({ fontId: 'montserrat-800', uppercase: false, color: '#FFE082', highlightColor: '#FFFFFF', highlightBackground: '#6C22D6', strokeColor: '#000000', strokeWidthPx: 4, shadow: true, fontSizePx: 58, align: 'center' });
  });
});
