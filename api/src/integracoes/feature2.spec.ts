// Feature 2 (variar campeão): I4a + I4b da maquina-ia. Tudo com SDK/fetch falsos, custo zero.
import type { AdLibraryMeta, Measurements, OfferBriefDraft, TeardownSections, TranscriptWord, VariationItemDraft, VariationKind } from './contrato';
import { ApifyAdLibraryService, OffAdLibraryService, adIdOf, mapAdItem } from './adlibrary/ad-library.service';
import { FakeAdLibraryService } from './adlibrary/fake-ad-library.service';
import { CatalogServiceImpl } from './catalogo/catalog.service';
import { splitSourceScenes } from './catalogo/fatiar';
import { ClaudeLiveService, evenly, fallbackCasting, planParams } from './claude/claude.service';
import { TEARDOWN_DIAGNOSIS_SCHEMA, TEARDOWN_FACTS_SCHEMA, planContext } from './claude/prompts-campeao';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './claude/transporte';
import { parseTeardown, snapToSilence } from './claude/validacao-campeao';
import { adLibraryMode } from './integracoes.module';
import { FakeClaudeService, mockTeardown } from './mock/fake-claude.service';
import { FakeGenerationService, mockChampionWords } from './mock/fake-generation.service';
import { PROVIDER_TASK_FINISHED, type ProviderTaskFinishedEvent } from './portas';
import { MemoryCostStore, MemoryTaskStore } from './store/memoria.store';
import { guessLanguage, languageFromOutput, transcriptLanguage } from './wavespeed/idioma';
import { WaveSpeedClient } from './wavespeed/cliente';
import { WaveSpeedGenerationService } from './wavespeed/generation.service';

// ------------------------------------------------------------------ dados de teste

/** Fala com tempo: frases separadas por 0,5 s de silêncio, palavras de 0,3 s com 0,08 s entre elas. */
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
  'If they flip their phone face down, watch this.', // gancho (~3,6 s)
  'Red flag number one: the phone is always locked.',
  'Red flag number two: they leave the room to answer.',
  'Tap the link and check it yourself today.',
]);
const DUR = Math.ceil(WORDS[WORDS.length - 1].endSec + 0.5);

const measurements: Omit<Measurements, 'keyframes'> = {
  durationSec: DUR, width: 1080, height: 1920, fps: 30, hasAudio: true,
  cuts: [{ atSec: 4, kind: 'layout' }],
  segments: [{ startSec: 0, endSec: DUR, bands: [{ y0: 0, y1: 1100, pct: 57, role: 'face' }, { y0: 1100, y1: 1920, pct: 43, role: 'panel' }] }],
  palette: ['#e0192b', '#ffffff', '#111111'],
  silences: [],
};

const adMeta: AdLibraryMeta = {
  status: 'resolved', adArchiveId: '123', pageName: 'Page', startDate: '2026-09-01', endDate: null, isActive: true, daysRunning: 35,
  collationCount: 4, euReach: 1200, primaryText: 'Primary text literal', headline: 'Headline literal', ctaText: 'Learn more', linkUrl: 'https://x.com', fetchedAt: '2026-10-06',
};

const offer: OfferBriefDraft = {
  name: 'Orbit', language: 'en', kind: 'App', what: 'Finds forgotten subscriptions.', audience: 'Couples', promise: 'Save money',
  pains: null, proof: null, offerAndPrice: null, cta: 'Start free', notes: null,
};

const sec = (data: unknown, status: 'ok' | 'na' = 'ok') => ({ status, naReason: status === 'na' ? 'no data' : '', data });

/** Resposta do Claude no formato do TEARDOWN_SCHEMA (sem metaCopy). */
function teardownJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    identification: sec({ summary: '23 s vertical talking head.', signals: ['35 days running (proxy, not performance)'] }),
    transcript: sec({ keywords: [{ sentence: 'If they flip their phone face down, watch this.', keyword: 'phone' }] }),
    hook: sec({ endSec: 3.2, visual: 'Face close-up', onScreenText: '', spoken: 'paraphrase that must be replaced' }),
    structure: sec({ blocks: [
      { label: 'Hook', function: 'hook', startSec: 0, endSec: 3.1, onScreen: 'face' },
      { label: 'Flag 1', function: 'proof', startSec: 3.3, endSec: 8, onScreen: 'face + panel' },
      { label: 'Flag 2', function: 'proof', startSec: 8.1, endSec: 13, onScreen: 'face + panel' },
      { label: 'CTA', function: 'cta', startSec: 13.2, endSec: 99, onScreen: 'face' },
    ] }),
    layout: sec({ summary: 'Split screen.', segments: [{ startSec: 0, endSec: 99, description: 'split' }] }),
    visual: sec({ palette: [{ hex: '#e0192b', role: 'banner' }, { hex: 'red', role: 'bad' }], typography: 'bold sans', captions: 'karaoke', uiElements: 'chat app', person: 'A woman in her 30s, chest up.', broll: 'none', motion: 'hard cuts' }),
    audio: sec({ voice: 'Female voice, warm, 160 wpm.', music: 'none', sfx: 'none' }),
    offerProofCta: sec({ promise: 'p', mechanism: 'm', proof: 'none shown', ctaSpoken: 'Tap the link', ctaOnScreen: '' }),
    whySells: sec({ avatar: 'a', awarenessLevel: 'problem aware', painDesire: 'p', bigIdea: 'b', beliefObjection: 'b', retentionEngine: 'r', verdict: ['1', '2', '3', '4', '5', '6'] }),
    stealVsVary: sec({ steal: ['split layout'], vary: [{ lever: 'hook', idea: 'curiosity' }] }),
    replicationPlan: sec({ suggestions: [{ kind: 'SWAP_AVATAR', lever: 'avatar', idea: 'older woman' }, { kind: 'BOGUS', lever: 'x', idea: 'y' }] }),
    ...over,
  });
}

const usage = (i = 20_000, o = 6000) => [{ model: 'claude-opus-5-5', inputTokens: i, outputTokens: o, cacheWriteTokens: 0, cacheReadTokens: 0 }];

class FakeTransport implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly reply: (call: ClaudeCall, n: number) => ClaudeResult | Error | Promise<ClaudeResult | Error>) {}
  async run(call: ClaudeCall): Promise<ClaudeResult> {
    const n = this.calls.push(call) - 1;
    const r = await this.reply(call, n);
    if (r instanceof Error) throw r;
    return r;
  }
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const frameFetch = (async (url: string) => (String(url).includes('broken') ? new Response('nope', { status: 404 }) : new Response(JPEG, { headers: { 'content-type': 'application/octet-stream' } }))) as unknown as typeof fetch;

function teardownOf(words = WORDS): TeardownSections {
  return parseTeardown(teardownJson(), { uiLocale: 'EN', durationSec: DUR, words, adMeta });
}

// ------------------------------------------------------------------ catálogo

describe('splitSourceScenes', () => {
  const blocks = [
    { label: 'hook', startSec: 0, endSec: 3.3 },
    { label: 'body', startSec: 3.3, endSec: DUR },
  ];
  it('corta só no meio do silêncio entre palavras, cobre tudo, palavras relativas à cena e nenhuma perdida', () => {
    const scenes = splitSourceScenes(WORDS, blocks, 30);
    expect(scenes.map((s) => s.label)).toEqual(['hook', 'body']);
    const cut = scenes[0].sourceEndSec;
    // o corte cai num silêncio: nenhuma palavra atravessa
    expect(WORDS.some((w) => w.startSec < cut && w.endSec > cut)).toBe(false);
    expect(scenes[1].sourceStartSec).toBe(cut);
    expect(scenes[0].sourceStartSec).toBe(0);
    expect(scenes[1].sourceEndSec).toBe(DUR);
    expect(scenes.flatMap((s) => s.speech.split(' '))).toEqual(WORDS.map((w) => w.word));
    expect(scenes[1].words[0].startSec).toBeCloseTo(WORDS.find((w) => w.word === scenes[1].words[0].word && w.startSec > cut)!.startSec - cut, 3);
    expect(scenes[0].speech).toBe('If they flip their phone face down, watch this.');
  });

  it('bloco maior que o limite vira 2+ cenas, cada uma ≤ limite e cortada no silêncio', () => {
    const scenes = splitSourceScenes(WORDS, blocks, 8);
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    for (const s of scenes) expect(s.sourceEndSec - s.sourceStartSec).toBeLessThanOrEqual(8 + 1e-6);
    for (const s of scenes.slice(0, -1)) expect(WORDS.some((w) => w.startSec < s.sourceEndSec && w.endSec > s.sourceEndSec)).toBe(false);
    expect(scenes.map((s) => s.index)).toEqual(scenes.map((_, i) => i));
    expect(scenes.flatMap((s) => s.words.map((w) => w.word))).toEqual(WORDS.map((w) => w.word));
  });

  it('determinístico e sem palavras = fronteiras dos blocos', () => {
    expect(splitSourceScenes(WORDS, blocks, 8)).toEqual(splitSourceScenes(WORDS, blocks, 8));
    const s = splitSourceScenes([], [{ label: 'a', startSec: 0, endSec: 4 }, { label: 'b', startSec: 4, endSec: 9 }], 30);
    expect(s.map((x) => [x.sourceStartSec, x.sourceEndSec, x.speech])).toEqual([[0, 4, ''], [4, 9, '']]);
  });
});

describe('CatalogService.estimate com pipelines + estimateAnalysis', () => {
  const catalog = new CatalogServiceImpl({ voiceSampleUrl: () => '' });
  const scenes = [
    { index: 0, label: 'hook', startSec: 0, endSec: 3.4, speech: 'one two three four five six seven', visualPrompt: 'SOLO SHOT' },
    { index: 1, label: 'body', startSec: 3.4, endSec: 27, speech: 'x '.repeat(50).trim(), visualPrompt: 'SOLO SHOT' },
  ];
  const base = { engine: 'LIPSYNC' as const, model: 'pruna-lipsync', scenes, format: 'VERTICAL_9_16' as const };

  it('sem pipelines (lipsync do zero) = 1 take = TAKE_SLICE em todas', () => {
    const v1 = catalog.estimate(base);
    const p = catalog.estimate({ ...base, pipelines: ['TAKE_SLICE', 'TAKE_SLICE'] });
    expect(p.lines).toEqual(v1.lines);
    expect(p.costUsd).toBe(v1.costUsd);
  });

  it('REUSE custa 0; AUDIO_LIPSYNC = só lipsync dos segundos reais do trecho (piso 2 s), sem TTS nem TRANSCRIBE', () => {
    const reuse = catalog.estimate({ ...base, pipelines: ['TTS_LIPSYNC', 'REUSE'] });
    const v1Hook = catalog.estimate({ ...base, scenes: [scenes[0]] });
    expect(reuse.costUsd).toBe(v1Hook.costUsd);
    const audio = catalog.estimate({ ...base, pipelines: ['AUDIO_LIPSYNC', 'AUDIO_LIPSYNC'], audioSecByScene: [1.2, 23.4] });
    expect(audio.lines).toEqual([{ kind: 'LIPSYNC', units: 2 + 24, unit: 'second', unitPriceUsd: 0.025, amountUsd: 0.65 }]);
    expect(catalog.estimate({ ...base, pipelines: ['REUSE', 'SOURCE_CUT'] })).toMatchObject({ costUsd: 0, lines: [], etaSec: 0 });
  });

  it('AUDIO_LIPSYNC não dispara aviso de gênero da voz (a voz é a original); pipelines de tamanho errado = erro', () => {
    const w = catalog.estimate({ ...base, voiceId: 'Deep_Voice_Man', faceDescription: 'A woman, 30', pipelines: ['AUDIO_LIPSYNC', 'AUDIO_LIPSYNC'] });
    expect(w.warnings).toEqual([]);
    const t = catalog.estimate({ ...base, voiceId: 'Deep_Voice_Man', faceDescription: 'A woman, 30', pipelines: ['TTS_LIPSYNC', 'REUSE'] });
    expect(t.warnings).toEqual(['voice_gender_mismatch']);
    expect(() => catalog.estimate({ ...base, pipelines: ['REUSE'] })).toThrow(/pipelines/);
  });

  it('análise de 30 s com 12 frames ≈ US$ 0,45 (Whisper 0,06 + teardown + describeEdit §13.2); cresce com a duração e os frames', () => {
    const a = catalog.estimateAnalysis(30, 12);
    expect(a).toBeGreaterThan(0.35);
    expect(a).toBeLessThan(0.5);
    expect(catalog.estimateAnalysis(120, 16)).toBeGreaterThan(a);
    expect(catalog.estimateAnalysis(30, 40)).toBe(catalog.estimateAnalysis(30, 16)); // teto de 16 frames
  });
});

// ------------------------------------------------------------------ Claude: teardown

describe('parseTeardown (garantias que não dependem do modelo)', () => {
  it('metaCopy literal da Ad Library; gancho e blocos com a fala literal; blocos contínuos de 0 ao fim, 1º = gancho', () => {
    const t = teardownOf();
    expect(t.metaCopy).toEqual({ status: 'ok', naReason: null, data: { primaryText: 'Primary text literal', headline: 'Headline literal', description: null, button: 'Learn more', link: 'https://x.com' } });
    expect(t.hook.data!.spoken).toBe('If they flip their phone face down, watch this.');
    expect(t.hook.data!.onScreenText).toBeNull();
    expect(WORDS.some((w) => w.startSec < t.hook.data!.endSec && w.endSec > t.hook.data!.endSec)).toBe(false);
    const b = t.structure.data!.blocks;
    expect(b[0].startSec).toBe(0);
    expect(b[0].endSec).toBe(t.hook.data!.endSec);
    for (let i = 1; i < b.length; i++) expect(b[i].startSec).toBe(b[i - 1].endSec);
    expect(b[b.length - 1].endSec).toBe(DUR);
    expect(b.map((x) => x.speech).join(' ')).toBe(WORDS.map((w) => w.word).join(' '));
    expect(t.visual.data!.palette).toEqual([{ hex: '#E0192B', role: 'banner' }]); // "red" não é hex
    expect(t.whySells.data!.verdict).toHaveLength(5);
    expect(t.replicationPlan.data!.suggestions.map((s) => s.kind)).toEqual(['SWAP_AVATAR']);
    expect(t.identification.naReason).toBeNull();
  });

  it('sem fala: transcript e hook "na" com motivo no idioma da interface; sem Ad Library: metaCopy "na"', () => {
    const t = parseTeardown(teardownJson(), { uiLocale: 'PT_BR', durationSec: 20, words: [], adMeta: null });
    expect(t.transcript).toEqual({ status: 'na', naReason: 'Nenhuma fala detectada no vídeo.', data: null });
    expect(t.hook.status).toBe('na');
    expect(t.metaCopy).toMatchObject({ status: 'na', data: null });
    expect(t.metaCopy.naReason).toMatch(/Ad Library/);
  });

  it('seção "na" do modelo vira data null com o motivo; JSON inválido = PROVIDER_ERROR', () => {
    const t = parseTeardown(teardownJson({ audio: sec({ voice: '', music: '', sfx: '' }, 'na') }), { uiLocale: 'EN', durationSec: DUR, words: WORDS, adMeta });
    expect(t.audio).toEqual({ status: 'na', naReason: 'no data', data: null });
    expect(() => parseTeardown('{oops', { uiLocale: 'EN', durationSec: 1, words: [], adMeta: null })).toThrow(expect.objectContaining({ code: 'PROVIDER_ERROR' }));
  });

  it('esquemas sem union (limite de 16) e partidos em fatos (7) + diagnóstico (4): o inteiro estoura a gramática', () => {
    for (const sch of [TEARDOWN_FACTS_SCHEMA, TEARDOWN_DIAGNOSIS_SCHEMA]) {
      const txt = JSON.stringify(sch);
      expect(txt).not.toContain('anyOf');
      expect(txt).not.toContain('"null"');
    }
    expect(TEARDOWN_FACTS_SCHEMA.required).toEqual(['identification', 'transcript', 'hook', 'structure', 'layout', 'visual', 'audio']);
    expect(TEARDOWN_DIAGNOSIS_SCHEMA.required).toEqual(['offerProofCta', 'whySells', 'stealVsVary', 'replicationPlan']);
    expect(snapToSilence(1, [{ word: 'a', startSec: 0, endSec: 0.9 }, { word: 'b', startSec: 1.3, endSec: 2 }])).toBe(1.1);
  });
});

describe('ClaudeLiveService.analyzeChampion', () => {
  const input = (keyframes = [{ atSec: 0, reason: 't0', url: 'http://s/f0.jpg' }, { atSec: 4, reason: 'cut', url: 'http://s/broken.jpg' }, { atSec: 20, reason: 'end', url: 'http://s/f2.jpg' }]) => ({
    workspaceId: 'w', championId: 'c1', jobId: 'j1', uiLocale: 'PT_BR' as const, offer, transcript: { language: 'en', words: WORDS }, measurements, keyframes, adMeta,
  });

  it('2 chamadas com o mesmo prefixo: fatos com os frames em base64, depois o diagnóstico com os fatos; custo no campeão', async () => {
    const t = new FakeTransport(() => ({ text: teardownJson(), stopReason: 'end_turn', usage: usage() }));
    const costs = new MemoryCostStore();
    const svc = new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5', fetchImpl: frameFetch });
    const stages: string[] = [];
    const r = await svc.analyzeChampion(input(), (s) => stages.push(s));
    expect(stages).toEqual(['diagnosing']);
    const call = t.calls[0];
    expect(call.images!.map((i) => [i.mediaType, i.caption])).toEqual([['image/jpeg', 'Frame at 0 s (t0):'], ['image/jpeg', 'Frame at 20 s (end):']]);
    expect(call.images![0].data).toBe(JPEG.toString('base64'));
    expect(call.user).toContain('1 other frame(s) could not be loaded');
    expect(call.context).toContain('If@0.2');
    expect(call.context).toContain('Days running (proxy, not performance): 35');
    expect(call.context).toContain('Offer name: Orbit');
    expect(call.system).toContain('Brazilian Portuguese');
    expect(call.system).toContain('Never a name, @handle, tattoo');
    expect(call.schema).toBe(TEARDOWN_FACTS_SCHEMA);
    const diag = t.calls[1];
    expect(t.calls).toHaveLength(2);
    expect([diag.system, diag.context]).toEqual([call.system, call.context]); // prefixo igual = cache
    expect(diag.images).toBeUndefined();
    expect(diag.schema).toBe(TEARDOWN_DIAGNOSIS_SCHEMA);
    expect(diag.user).toContain('<facts>');
    expect(r.language).toBe('en');
    expect(r.sections.metaCopy.data!.headline).toBe('Headline literal');
    // 2 × (20k in × 4 + 6k out × 20 por milhão) = 2 × 0,2
    expect(r.costUsd).toBeCloseTo(0.4, 6);
    expect(costs.entries.map((e) => [e.unit, e.championId, e.jobId, e.provider])).toEqual([
      ['ktoken_in', 'c1', 'j1', 'ANTHROPIC'], ['ktoken_out', 'c1', 'j1', 'ANTHROPIC'], ['ktoken_in', 'c1', 'j1', 'ANTHROPIC'], ['ktoken_out', 'c1', 'j1', 'ANTHROPIC'],
    ]);
  });

  it('até 16 frames espalhados; JSON inválido tenta 1 vez de novo (cobra as duas); recusa = SAFETY_BLOCK sem repetir', async () => {
    expect(evenly(Array.from({ length: 40 }, (_, i) => i), 16)).toHaveLength(16);
    expect(evenly([1, 2, 3], 16)).toEqual([1, 2, 3]);
    const t = new FakeTransport((_c, n) => ({ text: n === 0 ? '{"broken' : teardownJson(), stopReason: 'end_turn', usage: usage(1000, 1000) }));
    const costs = new MemoryCostStore();
    const r = await new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5', fetchImpl: frameFetch }).analyzeChampion(input([]), () => undefined);
    expect(t.calls).toHaveLength(3); // fatos, fatos de novo, diagnóstico
    expect(t.calls[0].images).toEqual([]);
    expect(t.calls[0].user).toContain('No frames could be loaded');
    expect(r.costUsd).toBeCloseTo(3 * (0.004 + 0.02), 6);
    const refuse = new FakeTransport(() => ({ text: '', stopReason: 'refusal', usage: usage(10, 0) }));
    await expect(new ClaudeLiveService(refuse, new MemoryCostStore(), { model: 'claude-opus-5-5', fetchImpl: frameFetch }).analyzeChampion(input([]), () => undefined)).rejects.toMatchObject({ code: 'SAFETY_BLOCK' });
    expect(refuse.calls).toHaveLength(1);
    const cut = new FakeTransport(() => ({ text: '{"identification":', stopReason: 'max_tokens', usage: usage(10, 10) }));
    await expect(new ClaudeLiveService(cut, new MemoryCostStore(), { model: 'claude-opus-5-5', fetchImpl: frameFetch }).analyzeChampion(input([]), () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(cut.calls).toHaveLength(1); // corte não repete (só dobraria o gasto)
  });
});

// ------------------------------------------------------------------ Claude: plano

type Done = { kind: VariationKind; index: number; draft: VariationItemDraft };
function planCb() {
  const done: Done[] = [];
  const failed: [VariationKind, number, string][] = [];
  const shared: string[] = [];
  return {
    done, failed, shared,
    cb: {
      onSharedCasting: (d: string) => shared.push(d),
      onItemDone: (kind: VariationKind, index: number, draft: VariationItemDraft) => done.push({ kind, index, draft }),
      onItemFailed: (kind: VariationKind, index: number, code: string) => failed.push([kind, index, code]),
    },
  };
}

describe('ClaudeLiveService.planVariations', () => {
  const teardown = teardownOf();
  const slots: { kind: VariationKind; index: number }[] = [
    { kind: 'NEW_HOOKS', index: 0 }, { kind: 'NEW_HOOKS', index: 1 }, { kind: 'NEW_HOOKS', index: 2 },
    { kind: 'SWAP_AVATAR', index: 0 }, { kind: 'SWAP_AVATAR', index: 1 }, { kind: 'COPY_NEW', index: 0 },
  ];
  const reply = (c: ClaudeCall): ClaudeResult => {
    const u = usage(3000, 500);
    if (c.user.startsWith('Cast ONE person')) return { text: JSON.stringify({ description: 'A woman in her 30s, plain t-shirt, living room, looking at the camera.' }), stopReason: 'end_turn', usage: u };
    if (c.user.includes('SWAP_AVATAR')) return { text: JSON.stringify({ lever: 'avatar: older woman', rationale: 'r', castingDescription: 'A woman in her 50s, cardigan, kitchen, looking at the camera.' }), stopReason: 'end_turn', usage: u };
    return { text: JSON.stringify({ lever: 'curiosity: x', rationale: 'attacks verdict 1', speech: 'Nobody tells you why the phone goes face down.', onScreenText: '' }), stopReason: 'end_turn', usage: u };
  };

  it('um pedido por slot em paralelo + elenco compartilhado; COPY_NEW = KIND_NOT_ENABLED; custo somado e gravado no lote', async () => {
    const t = new FakeTransport(async (c) => {
      await new Promise((r) => setTimeout(r, Math.random() * 5)); // fora de ordem, pra pegar corrida no total
      return reply(c);
    });
    const costs = new MemoryCostStore();
    const { cb, done, failed, shared } = planCb();
    const r = await new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'b1', jobId: 'j1', language: 'en', offer, teardown, transcript: WORDS, slots, avoidLevers: ['pain: x'], notes: 'keep it calm', castingStyle: 'MATCH_ORIGINAL' },
      cb,
    );
    expect(t.calls).toHaveLength(6); // 3 ganchos + 2 elencos + 1 compartilhado
    expect(failed).toEqual([['COPY_NEW', 0, 'KIND_NOT_ENABLED']]);
    expect(shared).toHaveLength(1);
    expect(done.filter((d) => d.kind === 'NEW_HOOKS').map((d) => d.index).sort()).toEqual([0, 1, 2]);
    const hook = done.find((d) => d.kind === 'NEW_HOOKS')!.draft as { hook: { speech: string; onScreenText: string | null; durationSec: number } };
    expect(hook.hook.onScreenText).toBeNull();
    expect(hook.hook.durationSec).toBeGreaterThan(2);
    expect((done.find((d) => d.kind === 'SWAP_AVATAR')!.draft as { castingDescription: string }).castingDescription).toContain('50s');
    // 6 × (3000 × 4 + 500 × 20) / 1e6
    expect(r.costUsd).toBeCloseTo(6 * 0.022, 6);
    expect(costs.entries.every((e) => e.variationBatchId === 'b1' && e.jobId === 'j1')).toBe(true);
    // contexto compartilhado (cacheado) com o corpo literal e o veredito; sem a pessoa do campeão
    const ctx = t.calls[0].context!;
    expect(t.calls.every((c) => c.context === ctx)).toBe(true);
    expect(ctx).toContain('Red flag number one');
    expect(ctx).toContain('keep it calm');
    expect(ctx).not.toContain('A woman in her 30s, chest up');
    // cada gancho com uma alavanca diferente, e respeitando o avoid
    const levers = t.calls.filter((c) => c.user.startsWith('Write NEW_HOOKS')).map((c) => /Lever for this one: ([^:]+)/.exec(c.user)![1]);
    expect(new Set(levers).size).toBe(3);
    expect(t.calls.find((c) => c.user.startsWith('Write NEW_HOOKS'))!.user).toContain('"pain: x"');
    expect(t.calls.find((c) => c.user.includes('SWAP_AVATAR'))!.user).toContain('SAME gender as the voice');
  });

  it('item que falha duas vezes vira onItemFailed; elenco compartilhado que falha cai no texto neutro do gênero da voz', async () => {
    const t = new FakeTransport((c) => (c.user.startsWith('Write NEW_HOOKS variation 2') || c.user.startsWith('Cast ONE') ? { text: '{}', stopReason: 'end_turn', usage: usage(10, 10) } : reply(c)));
    const { cb, done, failed, shared } = planCb();
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'pt-BR', offer, teardown, transcript: WORDS, slots: slots.slice(0, 3), avoidLevers: [], notes: null, castingStyle: 'MATCH_ORIGINAL' },
      cb,
    );
    expect(failed).toEqual([['NEW_HOOKS', 1, 'PROVIDER_ERROR']]);
    expect(done).toHaveLength(2);
    expect(shared).toEqual([fallbackCasting('pt-BR', teardown)]);
    expect(shared[0]).toMatch(/^Uma mulher/); // voz feminina no teardown
  });

  it('gancho comprido demais é recusado pela validação (tenta de novo)', async () => {
    const long = 'word '.repeat(60).trim();
    let first = true;
    const t = new FakeTransport((c) => {
      if (c.user.startsWith('Write NEW_HOOKS') && first) {
        first = false;
        return { text: JSON.stringify({ lever: 'l', rationale: 'r', speech: long, onScreenText: '' }), stopReason: 'end_turn', usage: usage(1, 1) };
      }
      return reply(c);
    });
    const { cb, done } = planCb();
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'en', offer, teardown, transcript: WORDS, slots: [{ kind: 'NEW_HOOKS', index: 0 }], avoidLevers: [], notes: null },
      cb,
    );
    expect(t.calls.filter((c) => c.user.startsWith('Write NEW_HOOKS'))).toHaveLength(2);
    expect(done).toHaveLength(1);
  });

  it('planParams: fim do gancho do teardown, ritmo medido e alvo de palavras do gancho original', () => {
    const p = planParams(teardown, WORDS);
    expect(p.hookEndSec).toBe(teardown.hook.data!.endSec);
    expect(p.targetWords).toBe(9);
    expect(p.wordsPerSec).toBeGreaterThan(2);
    expect(planContext({ offer, teardown, transcript: WORDS, hookEndSec: p.hookEndSec, notes: null })).toContain('<champion_body_literal>\nRed flag number one');
  });
});

// ------------------------------------------------------------------ mocks

describe('FakeClaudeService (feature 2)', () => {
  const svc = new FakeClaudeService(new MemoryCostStore(), { model: 'm', stepMs: 0 });
  it('analyzeChampion determinístico, 12 seções; gatilho [mock:analysis-fail]; sem fala = na', async () => {
    const i = { workspaceId: 'w', championId: 'c', jobId: 'j', uiLocale: 'EN' as const, offer, transcript: { language: 'en', words: WORDS }, measurements, keyframes: [], adMeta: null };
    const a = await svc.analyzeChampion(i, () => undefined);
    const b = await svc.analyzeChampion(i, () => undefined);
    expect(a).toEqual(b);
    expect(Object.keys(a.sections)).toHaveLength(12);
    expect(a.sections.layout.data!.summary).toMatch(/Split/);
    expect(a.sections.structure.data!.blocks.map((x) => x.speech).join(' ')).toBe(WORDS.map((w) => w.word).join(' '));
    await expect(svc.analyzeChampion({ ...i, offer: { ...offer, notes: '[mock:analysis-fail]' } }, () => undefined)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    const silent = await svc.analyzeChampion({ ...i, transcript: { language: 'en', words: [] } }, () => undefined);
    expect(silent.sections.hook.status).toBe('na');
    expect(mockTeardown('PT_BR', [], measurements, null, 0).transcript.naReason).toMatch(/fala/);
  });

  it('planVariations: gatilhos de falha, KIND_NOT_ENABLED, elenco compartilhado só com NEW_HOOKS', async () => {
    const teardown = teardownOf();
    const { cb, done, failed, shared } = planCb();
    await svc.planVariations(
      { workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'pt-BR', offer, teardown, transcript: WORDS, notes: '[mock:fail-item:NEW_HOOKS:1]',
        slots: [{ kind: 'NEW_HOOKS', index: 0 }, { kind: 'NEW_HOOKS', index: 1 }, { kind: 'SWAP_AVATAR', index: 0 }, { kind: 'SWAP_AVATAR', index: 1 }, { kind: 'REMIX_EDIT', index: 0 }], avoidLevers: [] },
      cb,
    );
    expect(failed.sort()).toEqual([['NEW_HOOKS', 1, 'PROVIDER_ERROR'], ['REMIX_EDIT', 0, 'KIND_NOT_ENABLED']]);
    expect(shared[0]).toMatch(/^Uma mulher/);
    const casts = done.filter((d) => d.kind === 'SWAP_AVATAR').map((d) => (d.draft as { castingDescription: string }).castingDescription);
    expect(new Set(casts).size).toBe(2);
    const all = planCb();
    await svc.planVariations({ workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'en', offer, teardown, transcript: WORDS, notes: '[mock:fail-all]', slots: [{ kind: 'SWAP_AVATAR', index: 0 }], avoidLevers: [] }, all.cb);
    expect(all.failed).toEqual([['SWAP_AVATAR', 0, 'PROVIDER_ERROR']]);
    expect(all.shared).toEqual([]);
  });
});

// ------------------------------------------------------------------ transcrição do campeão

describe('submitTranscribe do campeão + parseTranscript', () => {
  it('live: language=auto sem idioma, task e evento com championId, idioma detectado pelo texto', async () => {
    const tasks = new MemoryTaskStore();
    const costs = new MemoryCostStore();
    const events: ProviderTaskFinishedEvent[] = [];
    const bodies: unknown[] = [];
    const whisper = { text_details: [{ words: [{ word: 'Você', start: 0, end: 0.4 }, { word: 'não', start: 0.4, end: 0.7 }, { word: 'sabe', start: 0.7, end: 1 }, { word: 'que', start: 1, end: 1.2 }, { word: 'isso', start: 1.2, end: 1.5 }] }] };
    const f = (async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ code: 200, data: { id: 'p1', status: 'created', outputs: [] } }));
      }
      return new Response(JSON.stringify(whisper));
    }) as unknown as typeof fetch;
    const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k', fetchImpl: f }), tasks, costs, { emit: (_e: string, p: ProviderTaskFinishedEvent) => events.push(p) } as never, {
      webhookUrl: null, probeSeconds: async () => 30.2, fetchImpl: f,
    });
    const s = await svc.submitTranscribe({ workspaceId: 'w', championId: 'c1', mediaUrl: 'https://cdn.x/a.m4a' });
    expect(bodies[0]).toMatchObject({ language: 'auto', enable_timestamps: true, video: 'https://cdn.x/a.m4a' });
    expect(s.estimatedUsd).toBeCloseTo(31 * 0.002, 4);
    expect(await tasks.get(s.providerTaskId)).toMatchObject({ championId: 'c1', sceneId: null });
    await svc.handleWebhook({ id: 'p1', status: 'completed', outputs: ['https://cdn/out.json'] });
    expect(events[0]).toMatchObject({ championId: 'c1', kind: 'TRANSCRIBE', status: 'COMPLETED' });
    expect(events[0].sceneId).toBeUndefined();
    const tr = await svc.parseTranscript(s.providerTaskId);
    expect(tr.language).toBe('pt-BR');
    expect(tr.words.map((w) => w.word).join(' ')).toBe('Você não sabe que isso');
    expect(await svc.parseWords(s.providerTaskId)).toEqual(tr.words); // v1 continua igual
    expect(costs.entries[0]).toMatchObject({ kind: 'TRANSCRIBE', units: 31, providerTaskId: s.providerTaskId });
    await expect(svc.submitTranscribe({ workspaceId: 'w', mediaUrl: 'x' })).rejects.toThrow(/exactly one/);
  });

  it('idioma: campo da saída > pedido > palpite pelo texto > en', () => {
    expect(languageFromOutput({ prediction: { detected_language: 'spanish' } })).toBe('es');
    expect(languageFromOutput('{"language":"fr"}')).toBe('fr');
    expect(languageFromOutput({ language: 'auto' })).toBeNull();
    expect(transcriptLanguage({ raw: { language: 'de' }, requested: 'en', text: 'você não' })).toBe('de');
    expect(transcriptLanguage({ requested: 'pt', text: '' })).toBe('pt-BR');
    expect(guessLanguage('If they flip their phone face down, watch this and the rest')).toBe('en');
    expect(guessLanguage('Si te cansaste de intentar sin resultado, escucha esto que es para ti')).toBe('es');
    expect(transcriptLanguage({ text: 'hm' })).toBe('en');
  });

  it('mock: duração e trilha de áudio da própria mídia; sem áudio = 0 palavras; evento com championId', async () => {
    jest.useFakeTimers();
    try {
      const tasks = new MemoryTaskStore();
      const events: ProviderTaskFinishedEvent[] = [];
      const bus = { emit: (n: string, p: ProviderTaskFinishedEvent) => (n === PROVIDER_TASK_FINISHED ? events.push(p) : 0) };
      const gen = new FakeGenerationService(tasks, new MemoryCostStore(), bus, {
        publicApiUrl: 'http://api', delayMs: () => 10,
        probeMedia: async (url) => ({ durationSec: 21.5, hasAudio: !url.includes('mute') }),
      });
      const a = await gen.submitTranscribe({ workspaceId: 'w', championId: 'c1', mediaUrl: 'http://s/a.m4a', language: 'pt' });
      const b = await gen.submitTranscribe({ workspaceId: 'w', championId: 'c2', mediaUrl: 'http://s/mute.mp4' });
      await jest.advanceTimersByTimeAsync(50);
      const ta = await gen.parseTranscript(a.providerTaskId);
      expect(ta.language).toBe('pt-BR');
      expect(ta.words.length).toBeGreaterThan(20);
      expect(ta.words[ta.words.length - 1].endSec).toBeLessThan(21.5);
      expect(ta.words[0].word).toBe('Ninguém');
      expect((await gen.parseTranscript(b.providerTaskId)).words).toEqual([]);
      expect(events.map((e) => e.championId).sort()).toEqual(['c1', 'c2']);
      expect(mockChampionWords('en', 20)).toEqual(mockChampionWords('en', 20));
      gen.dispose();
    } finally {
      jest.useRealTimers();
    }
  });
});

// ------------------------------------------------------------------ Ad Library

describe('AdLibraryService', () => {
  const item = {
    ad_archive_id: '987', page_name: 'Some Page', start_date: Date.parse('2026-09-01T00:00:00Z') / 1000, end_date: null, is_active: true, collation_count: 3,
    aaa_info: { eu_total_reach: 5000 },
    snapshot: { body: { text: 'Primary' }, title: 'Head', cta_text: 'Learn more', link_url: 'https://dest.x', videos: [{ video_hd_url: 'https://fbcdn/v.mp4', video_preview_image_url: 'https://fbcdn/p.jpg' }] },
  };
  type Call = { url: string; init?: RequestInit };
  function apify(routes: (c: Call) => Response | undefined) {
    const calls: Call[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const c = { url: String(url), init };
      calls.push(c);
      const r = routes(c);
      if (r) return r;
      if (c.url.includes('/users/me/limits')) return Response.json({ data: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 1.2 }, monthlyUsageCycle: { endAt: '2026-10-18T23:59:59.999Z' } } });
      if (c.url.includes('/acts/')) return Response.json({ data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1' } });
      if (c.url.includes('/actor-runs/run1')) return Response.json({ data: { id: 'run1', status: 'SUCCEEDED', defaultDatasetId: 'ds1', usageTotalUsd: 0.0071 } });
      if (c.url.includes('/datasets/ds1/items')) return Response.json([item]);
      return new Response('?', { status: 404 });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const now = Date.parse('2026-10-06T12:00:00Z');
  const req = { workspaceId: 'w', championId: 'c', jobId: 'j', url: 'https://www.facebook.com/ads/library/?id=987&country=ALL' };

  it('resolve: roda o actor do ad-radar (512 MB, 1 anúncio), lê o dataset, mapeia os metadados e grava o custo real', async () => {
    const { f, calls } = apify(() => undefined);
    const costs = new MemoryCostStore();
    const svc = new ApifyAdLibraryService(costs, { token: 'tok', fetchImpl: f, now: () => now, sleep: async () => undefined });
    const r = await svc.resolve(req);
    expect(r).toMatchObject({
      adArchiveId: '987', pageName: 'Some Page', startDate: '2026-09-01', isActive: true, daysRunning: 35, collationCount: 3, euReach: 5000,
      primaryText: 'Primary', headline: 'Head', ctaText: 'Learn more', linkUrl: 'https://dest.x', videoUrl: 'https://fbcdn/v.mp4', posterUrl: 'https://fbcdn/p.jpg', costUsd: 0.0071,
    });
    const start = calls.find((c) => c.url.includes('/acts/'))!;
    expect(start.url).toContain('/acts/curious_coder~facebook-ads-library-scraper/runs?memory=512&waitForFinish=60&token=tok');
    expect(JSON.parse(String(start.init!.body))).toEqual({ urls: [{ url: 'https://www.facebook.com/ads/library/?id=987' }], count: 1, scrapeAdDetails: true });
    expect(costs.entries).toEqual([expect.objectContaining({ provider: 'APIFY', kind: 'SCRAPE', units: 1, unit: 'call', amountUsd: 0.0071, championId: 'c', jobId: 'j' })]);
  });

  it('status: sem token = not_configured; teto do mês = quota com o dia da volta; cacheado 10 min', async () => {
    expect(await new ApifyAdLibraryService(new MemoryCostStore(), { token: '' }).status()).toEqual({ available: false, reason: 'not_configured', retryAfter: null });
    await expect(new ApifyAdLibraryService(new MemoryCostStore(), { token: '' }).resolve(req)).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'not_configured', retryAfter: null } });
    let t = now;
    const { f, calls } = apify((c) => (c.url.includes('/limits') ? Response.json({ data: { limits: { maxMonthlyUsageUsd: 5 }, current: { monthlyUsageUsd: 5 }, monthlyUsageCycle: { endAt: '2026-10-18T23:59:59.999Z' } } }) : undefined));
    const svc = new ApifyAdLibraryService(new MemoryCostStore(), { token: 'tok', fetchImpl: f, now: () => t });
    expect(await svc.status()).toEqual({ available: false, reason: 'quota', retryAfter: '2026-10-19' });
    await expect(svc.resolve(req)).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'quota', retryAfter: '2026-10-19' } });
    expect(calls.filter((c) => c.url.includes('/limits'))).toHaveLength(1);
    expect(calls.some((c) => c.url.includes('/acts/'))).toBe(false); // teto: nem tenta rodar
    t += 601_000;
    await svc.status();
    expect(calls.filter((c) => c.url.includes('/limits'))).toHaveLength(2);
  });

  it('402 no start = quota; run FAILED = provider_error (cobra o que gastou); sem vídeo = AD_HAS_NO_VIDEO; fora do dataset = AD_NOT_FOUND', async () => {
    const q = apify((c) => (c.url.includes('/acts/') ? new Response('{"error":{"type":"monthly-usage-hard-limit-exceeded"}}', { status: 402 }) : undefined));
    await expect(new ApifyAdLibraryService(new MemoryCostStore(), { token: 't', fetchImpl: q.f, now: () => now }).resolve(req)).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'quota' } });
    const failed = apify((c) => (c.url.includes('/actor-runs/run1') ? Response.json({ data: { id: 'run1', status: 'FAILED', defaultDatasetId: 'ds1', usageTotalUsd: 0.002 } }) : undefined));
    const costs = new MemoryCostStore();
    await expect(new ApifyAdLibraryService(costs, { token: 't', fetchImpl: failed.f, now: () => now }).resolve(req)).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'provider_error' } });
    expect(costs.entries[0].amountUsd).toBe(0.002);
    const novideo = apify((c) => (c.url.includes('/datasets/') ? Response.json([{ ...item, snapshot: { ...item.snapshot, videos: [] } }]) : undefined));
    await expect(new ApifyAdLibraryService(new MemoryCostStore(), { token: 't', fetchImpl: novideo.f, now: () => now }).resolve(req)).rejects.toMatchObject({ code: 'AD_HAS_NO_VIDEO', details: { meta: expect.objectContaining({ headline: 'Head' }) } });
    const other = apify((c) => (c.url.includes('/datasets/') ? Response.json([{ ...item, ad_archive_id: '1' }]) : undefined));
    await expect(new ApifyAdLibraryService(new MemoryCostStore(), { token: 't', fetchImpl: other.f, now: () => now }).resolve(req)).rejects.toMatchObject({ code: 'AD_NOT_FOUND' });
  });

  it('run que não termina em 180 s é abortado e falha explícito', async () => {
    let t = now;
    const slow = apify((c) => (c.url.includes('/actor-runs/run1') && !c.url.includes('abort') ? (((t += 61_000), Response.json({ data: { id: 'run1', status: 'RUNNING', defaultDatasetId: 'ds1', usageTotalUsd: 0.01 } }))) : undefined));
    await expect(new ApifyAdLibraryService(new MemoryCostStore(), { token: 't', fetchImpl: slow.f, now: () => t }).resolve(req)).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE' });
    expect(slow.calls.some((c) => c.url.includes('/actor-runs/run1/abort'))).toBe(true);
  });

  it('carrossel com vídeo no card e helpers', () => {
    const m = mapAdItem({ ad_archive_id: 5, snapshot: { cards: [{ title: 'T', body: 'B', video_sd_url: 'https://v.sd' }] } }, now);
    expect(m).toMatchObject({ adArchiveId: '5', headline: 'T', primaryText: 'B', videoUrl: 'https://v.sd', daysRunning: null });
    expect(adIdOf('https://www.facebook.com/ads/library/?active_status=all&id=42')).toBe('42');
    expect(adIdOf('https://x.com')).toBeNull();
  });

  it('mock (§4.6) e off', async () => {
    const costs = new MemoryCostStore();
    const fake = new FakeAdLibraryService(costs, { publicApiUrl: 'http://api', stepMs: 0 });
    await expect(fake.resolve({ ...req, url: 'https://www.facebook.com/ads/library/?id=1&mock-ad-unavailable' })).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'quota', retryAfter: '2026-10-19' } });
    await expect(fake.resolve({ ...req, url: 'https://www.facebook.com/ads/library/?id=1&x=mock-ad-notfound' })).rejects.toMatchObject({ code: 'AD_NOT_FOUND' });
    await expect(fake.resolve({ ...req, url: 'https://www.facebook.com/ads/library/?id=1&x=mock-ad-novideo' })).rejects.toMatchObject({ code: 'AD_HAS_NO_VIDEO' });
    const ok = await fake.resolve(req);
    expect(ok.videoUrl).toMatch(/^http:\/\/api\/api\/v1\/mock-media\/video\/[0-9a-f]{16}\.mp4\?format=VERTICAL_9_16&sec=20$/);
    expect(ok).toMatchObject({ adArchiveId: '987', costUsd: 0 });
    expect(costs.entries.every((e) => e.provider === 'APIFY' && e.amountUsd === 0)).toBe(true);
    expect(await new OffAdLibraryService().status()).toEqual({ available: false, reason: 'not_configured', retryAfter: null });
    await expect(new OffAdLibraryService().resolve()).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE' });
    expect(adLibraryMode(undefined, 'mock')).toBe('mock');
    expect(adLibraryMode('', 'live')).toBe('live');
    expect(adLibraryMode('OFF', 'live')).toBe('off');
    expect(adLibraryMode('mock', 'live')).toBe('mock');
  });
});

// ------------------------------------------------------------------ custo por dono (Prisma, banco falso)

describe('PrismaCostStore: dono do custo', () => {
  it('TRANSCRIBE do campeão → championId; rosto de elenco → lote do elenco; explícito passa direto', async () => {
    const { PrismaCostStore } = await import('./store/prisma.store');
    const created: Record<string, unknown>[] = [];
    const tasks: Record<string, { sceneId: string | null; faceId: string | null; championId: string | null }> = {
      t1: { sceneId: null, faceId: null, championId: 'c1' },
      t2: { sceneId: null, faceId: 'f1', championId: null },
    };
    const db = {
      costEntry: { create: async ({ data }: { data: Record<string, unknown> }) => created.push(data) },
      providerTask: { findUnique: async ({ where }: { where: { id: string } }) => tasks[where.id] ?? null },
      face: { findUnique: async () => ({ creativeId: null, castingId: 'cast1' }) },
      variationCasting: { findUnique: async () => ({ batchId: 'b1' }) },
      scene: { findUnique: async () => null },
    };
    const store = new PrismaCostStore(db as never);
    const base = { workspaceId: 'w', provider: 'WAVESPEED' as const, kind: 'TRANSCRIBE' as const, model: 'm', units: 1, unit: 'second' as const, amountUsd: 0.1 };
    await store.record({ ...base, providerTaskId: 't1' });
    await store.record({ ...base, kind: 'IMAGE', provider: 'HIGGSFIELD', providerTaskId: 't2' });
    await store.record({ ...base, provider: 'ANTHROPIC', kind: 'LLM', variationBatchId: 'b9' });
    expect(created.map((c) => [c.creativeId, c.championId, c.variationBatchId])).toEqual([[null, 'c1', null], [null, null, 'b1'], [null, null, 'b9']]);
  });
});
