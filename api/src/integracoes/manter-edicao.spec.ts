// §13 (manter a edição + take contínuo), parte da maquina-ia (I5). Tudo com SDK/fetch falsos, custo zero; o lipsync do
// mock roda o ffmpeg local de verdade (rosto em loop) pra provar que o YuNet terá um rosto parado pra achar.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EditMap, TranscriptWord, VariationItemDraft, VariationKind } from './contrato';
import { TAKE_MAX_SEC } from './contrato';
import { CatalogServiceImpl } from './catalogo/catalog.service';
import { assertTakeDuration, faceAspectFor, sliceTake } from './catalogo/take';
import { ClaudeLiveService } from './claude/claude.service';
import { EDIT_SCHEMA, hookTextSlot, parseEditMap } from './claude/edicao';
import { castingSummary, describeCasting, diverseCasting, ethnicityPool } from './claude/elenco';
import { bodyMarksV2, facePromptV2 } from './wavespeed/prompts-midia';
import { parseTeardown } from './claude/validacao-campeao';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './claude/transporte';
import { FakeClaudeService, mockEditMap, mockTeardown } from './mock/fake-claude.service';
import { FakeGenerationService } from './mock/fake-generation.service';
import { ensureMockLipsync, ensureMockMedia, seedOf, writeMockLipsyncSpec } from './mock/midia';
import { PROVIDER_TASK_FINISHED, type ProviderTaskFinishedEvent } from './portas';
import { MemoryCostStore, MemoryTaskStore } from './store/memoria.store';
import { WaveSpeedClient } from './wavespeed/cliente';
import { WaveSpeedGenerationService } from './wavespeed/generation.service';
import { FfmpegMediaAnalysisService } from '../medicao/media-analysis.service';
import { closeFaceDetector } from '../medicao/rostos';

afterAll(() => closeFaceDetector?.());

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Palavras de 0,3 s com 0,08 s entre elas; 0,5 s de respiro entre frases. */
function speak(sentences: string[], start = 0.2): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let t = start;
  for (const s of sentences) {
    for (const w of s.split(' ')) {
      out.push({ word: w, startSec: r3(t), endSec: r3(t + 0.3) });
      t += 0.38;
    }
    t += 0.5;
  }
  return out;
}

const BLOCKS = [
  { label: 'hook', speech: 'If they flip their phone face down, watch this.' },
  { label: 'flag', speech: 'Red flag number one: the phone is always locked.' },
  { label: 'cta', speech: 'Tap the link and check it yourself today.' },
];
const TAKE_WORDS = speak(BLOCKS.map((b) => b.speech));
const TAKE_DUR = r3(TAKE_WORDS[TAKE_WORDS.length - 1].endSec + 0.4);

// ------------------------------------------------------------------ take: fatiamento, teto, aspecto, estimativa

describe('sliceTake (§13.5)', () => {
  it('fronteira no meio do silêncio entre blocos; 1ª em 0, última no fim do clipe; words relativas à fatia', () => {
    const s = sliceTake({ blocks: BLOCKS, words: TAKE_WORDS, durationSec: TAKE_DUR });
    expect(s.map((x) => x.matched)).toEqual([true, true, true]);
    expect(s[0].takeStartSec).toBe(0);
    expect(s[2].takeEndSec).toBe(TAKE_DUR);
    const lastOfHook = TAKE_WORDS[8]; // "this."
    const firstOfFlag = TAKE_WORDS[9]; // "Red"
    expect(s[0].takeEndSec).toBe(r3((lastOfHook.endSec + firstOfFlag.startSec) / 2));
    expect(s[1].takeStartSec).toBe(s[0].takeEndSec);
    expect(s[1].words[0]).toEqual({ word: 'Red', startSec: r3(firstOfFlag.startSec - s[1].takeStartSec), endSec: r3(firstOfFlag.endSec - s[1].takeStartSec) });
    expect(s.map((x) => x.words.map((w) => w.word).join(' '))).toEqual(BLOCKS.map((b) => b.speech));
    // nenhuma palavra cortada no meio
    for (const x of s.slice(1)) expect(TAKE_WORDS.some((w) => w.startSec < x.takeStartSec && w.endSec > x.takeStartSec)).toBe(false);
  });

  it('Whisper errando palavras (acento, "pra"/"para", palavra trocada) ainda casa; determinístico', () => {
    const noisy = TAKE_WORDS.map((w, i) => (i === 3 ? { ...w, word: 'there' } : i === 9 ? { ...w, word: 'red,' } : i === 12 ? { ...w, word: 'ONE' } : w));
    const a = sliceTake({ blocks: BLOCKS, words: noisy, durationSec: TAKE_DUR });
    expect(a.map((x) => x.words.length)).toEqual([9, 9, 8]);
    expect(sliceTake({ blocks: BLOCKS, words: noisy, durationSec: TAKE_DUR })).toEqual(a);
  });

  it('bloco sem palavra casada = fronteira proporcional aos caracteres, sem invadir palavra casada (matched false)', () => {
    const blocks = [BLOCKS[0], { label: 'ghost', speech: 'zzz qqq www' }, BLOCKS[2]];
    const words = speak([BLOCKS[0].speech, BLOCKS[2].speech]);
    const dur = r3(words[words.length - 1].endSec + 0.4);
    const s = sliceTake({ blocks, words, durationSec: dur });
    expect(s.map((x) => x.matched)).toEqual([true, false, true]);
    expect(s[0].takeEndSec).toBeLessThanOrEqual(s[1].takeEndSec);
    expect(s[0].words.map((w) => w.word).join(' ')).toBe(BLOCKS[0].speech);
    expect(s[2].words.map((w) => w.word).join(' ')).toBe(BLOCKS[2].speech);
    expect(s[2].takeEndSec).toBe(dur);
    expect(() => sliceTake({ blocks: [], words, durationSec: dur })).toThrow(expect.objectContaining({ code: 'INVALID_SCRIPT' }));
  });

  it('teto do Pruna: > 600 s = LIPSYNC_AUDIO_TOO_LONG { durationSec, maxSec: 600 }', () => {
    expect(TAKE_MAX_SEC).toBe(600);
    expect(() => assertTakeDuration(600)).not.toThrow();
    expect(() => assertTakeDuration(600.4)).toThrow(expect.objectContaining({ code: 'LIPSYNC_AUDIO_TOO_LONG', details: { durationSec: 600.4, maxSec: 600 } }));
  });

  it('aspecto do Soul V2 mais perto da região do rosto', () => {
    expect(faceAspectFor(336, 324)).toBe('1:1'); // caixa do zap-working-late
    expect(faceAspectFor(1080, 1920)).toBe('9:16');
    expect(faceAspectFor(1080, 1100)).toBe('1:1');
    expect(faceAspectFor(720, 960)).toBe('3:4');
    expect(faceAspectFor(1000, 700)).toBe('3:2');
    expect(faceAspectFor(0, 10)).toBe('9:16');
  });
});

describe('CatalogService.estimate por take (§13.5)', () => {
  const catalog = new CatalogServiceImpl({ voiceSampleUrl: () => '' });
  const scenes = [
    { index: 0, label: 'hook', startSec: 0, endSec: 3.4, speech: 'one two three four five six seven', visualPrompt: 'SOLO SHOT' },
    { index: 1, label: 'body', startSec: 3.4, endSec: 27, speech: 'x '.repeat(50).trim(), visualPrompt: 'SOLO SHOT' },
  ];
  const base = { engine: 'LIPSYNC' as const, model: 'pruna-lipsync', scenes, format: 'VERTICAL_9_16' as const };

  it('TTS_LIPSYNC: 1 take, um arredondamento só (57 palavras / 2,6 = 21,9 → 22 s; por cena dava 3 + 20 = 23)', () => {
    const r = catalog.estimate(base);
    expect(r.lines).toEqual([
      { kind: 'TTS', units: 133, unit: 'character', unitPriceUsd: 0.00006, amountUsd: 0.008 },
      { kind: 'LIPSYNC', units: 22, unit: 'second', unitPriceUsd: 0.025, amountUsd: 0.55 },
      { kind: 'TRANSCRIBE', units: 22, unit: 'second', unitPriceUsd: 0.002, amountUsd: 0.044 },
    ]);
    const old = catalog.estimate({ ...base, pipelines: ['TTS_LIPSYNC', 'TTS_LIPSYNC'] }); // criativo antigo (leitura)
    expect(old.lines.find((l) => l.kind === 'LIPSYNC')!.units).toBe(23);
    // ritmo medido do campeão muda a duração estimada
    expect(catalog.estimate({ ...base, take: { kind: 'TTS_LIPSYNC', wordsPerSec: 3.8 } }).lines[1].units).toBe(15);
  });

  it('Trocar avatar mantendo a edição = 1 take AUDIO_LIPSYNC (segundos reais da janela) + elenco; ganchos escritos = US$ 0', () => {
    const swap = catalog.estimate({ ...base, pipelines: ['TAKE_SLICE', 'TAKE_SLICE'], take: { kind: 'AUDIO_LIPSYNC', audioSec: 29.3 }, faceCount: 4 });
    expect(swap.lines).toEqual([
      { kind: 'LIPSYNC', units: 30, unit: 'second', unitPriceUsd: 0.025, amountUsd: 0.75 },
      { kind: 'IMAGE', units: 4, unit: 'image', unitPriceUsd: 0.006, amountUsd: 0.024 },
    ]);
    expect(swap.costUsd).toBe(0.774);
    // voz original: nunca avisa gênero da voz do catálogo
    expect(catalog.estimate({ ...base, voiceId: 'Deep_Voice_Man', faceDescription: 'A woman, 30', pipelines: ['TAKE_SLICE', 'TAKE_SLICE'], take: { kind: 'AUDIO_LIPSYNC', audioSec: 10 } }).warnings).toEqual([]);
    expect(catalog.estimate({ ...base, voiceId: 'Deep_Voice_Man', faceDescription: 'A woman, 30', pipelines: ['TAKE_SLICE', 'TAKE_SLICE'] }).warnings).toEqual(['voice_gender_mismatch']);
    const hooks = catalog.estimate({ ...base, scenes: [scenes[0]], pipelines: ['SOURCE_CUT'] });
    expect(hooks).toMatchObject({ costUsd: 0, lines: [] });
    expect(catalog.faceAspectFor(336, 324)).toBe('1:1');
  });
});

// ------------------------------------------------------------------ describeEdit

const GRID = { width: 720, height: 1280, fps: 30, frameCount: 690, durationSec: 23 };
const WORDS = speak(['If they flip their phone face down, watch this.', 'Red flag number one: the phone is always locked.']);

function editJson(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    layers: [
      { kind: 'headline', text: 'HE HIDES HIS PHONE?', startSec: 0, endSec: 23, box: { x: 0.05, y: 0.04, w: 0.9, h: 0.08 }, background: 'solid', backgroundColor: 'ffffff', fontId: 'anton-400', uppercase: true, fontSizeRel: 0.035, color: '#111111', highlightColor: '', strokeColor: '', strokeRel: 0, shadow: false, align: 'center', wordsPerPage: 0 },
      { kind: 'caption', text: '', startSec: 5, endSec: 6, box: { x: 0.1, y: 0.7, w: 0.8, h: 0.07 }, background: 'none', backgroundColor: '', fontId: 'comic-sans', uppercase: true, fontSizeRel: 0.04, color: '#FFFFFF', highlightColor: '#FFD400', strokeColor: '#000000', strokeRel: 0.003, shadow: true, align: 'center', wordsPerPage: 3 },
      { kind: 'text', text: 'no box', startSec: 1, endSec: 2, box: { x: 0.1, y: 0.1, w: 0, h: 0 }, background: 'none', backgroundColor: '', fontId: 'inter-800', uppercase: false, fontSizeRel: 0.03, color: '#fff', highlightColor: '', strokeColor: '', strokeRel: 0, shadow: false, align: 'left', wordsPerPage: 0 },
      { kind: 'headline', text: '', startSec: 0, endSec: 3, box: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 }, background: 'none', backgroundColor: '', fontId: 'inter-800', uppercase: false, fontSizeRel: 0.03, color: '#ffffff', highlightColor: '', strokeColor: '', strokeRel: 0, shadow: false, align: 'left', wordsPerPage: 0 },
    ],
    mainSpeaker: { present: true, box: { x: 0, y: 0.093, w: 0.467, h: 0.253 }, description: 'top-left box of a split screen' },
    otherFaces: [{ startSec: 0, endSec: 23, box: { x: 0, y: 0.35, w: 0.467, h: 0.3 }, where: 'security camera footage below the avatar' }],
    overlaysOverFace: [
      { startSec: 10, endSec: 12, box: { x: 0.05, y: 0.12, w: 0.3, h: 0.15 }, description: 'red arrow sticker' },
      { startSec: 3, endSec: 2, box: { x: 0.05, y: 0.12, w: 0.3, h: 0.15 }, description: 'bad interval' },
      // bug real 06/10: painel vizinho de split screen listado como "por cima do rosto"
      { startSec: 0, endSec: 23, box: { x: 0, y: 0.35, w: 0.467, h: 0.3 }, description: 'split screen with security cam footage' },
      { startSec: 0, endSec: 23, box: { x: 0.467, y: 0.093, w: 0.533, h: 0.56 }, description: 'app screen panel' },
      { startSec: 5, endSec: 6, description: 'emoji without box' },
    ],
    profile: { gender: 'female', ageBand: '25-35', ethnicity: 'Latina', hair: 'long dark wavy hair', clothing: 'grey hoodie', setting: 'bedroom at night', lighting: 'warm lamp from the right', framing: 'chest up, face centered', pose: 'seated, looking into the lens, rose tattoo on the neck' },
    ...over,
  });
}

describe('parseEditMap (visão → grade do campeão)', () => {
  it('fração → px, segundos → frames; legenda pelo tempo da fala; fonte fora do catálogo = padrão; camada sem caixa/texto cai', () => {
    const m = parseEditMap(editJson(), GRID, WORDS);
    expect(m.layers.map((l) => l.id)).toEqual(['headline-1', 'caption-1']);
    const [h, c] = m.layers;
    expect(h).toMatchObject({ kind: 'headline', startFrame: 0, endFrame: 690, box: { x: 36, y: 51, w: 648, h: 102 }, text: 'HE HIDES HIS PHONE?', source: 'vision', wordsPerPage: null });
    expect(h.background).toEqual({ kind: 'solid', color: '#FFFFFF', box: { x: 36, y: 51, w: 648, h: 102 } });
    expect(h.style).toMatchObject({ fontId: 'anton-400', uppercase: true, fontSizePx: 45, color: '#111111', highlightColor: null, strokeColor: null, strokeWidthPx: 0 });
    expect(c).toMatchObject({ kind: 'caption', text: null, wordsPerPage: 3, startFrame: Math.round(WORDS[0].startSec * 30), endFrame: Math.round(WORDS[WORDS.length - 1].endSec * 30) });
    expect(c.background).toEqual({ kind: 'none', color: null, box: null });
    expect(c.style).toMatchObject({ fontId: 'montserrat-800', highlightColor: '#FFD400', strokeColor: '#000000', strokeWidthPx: 4, shadow: true });
    // sem trilha da medição, a região é a caixa do mainSpeaker: o adesivo fica, o painel vizinho cai
    expect(m.overlaysOverFace).toEqual([{ startFrame: 300, endFrame: 360, description: 'red arrow sticker' }]);
    const noSpeaker = parseEditMap(editJson({ mainSpeaker: { present: false, box: { x: 0, y: 0, w: 0, h: 0 }, description: '' } }), GRID, WORDS);
    expect(noSpeaker.overlaysOverFace).toEqual([]); // sem rosto conhecido, nada prova que cobre o rosto
    expect(noSpeaker.mainSpeaker).toBeNull();
  });

  it('overlaysOverFace só com o que cobre o rosto do avatar principal; painel vizinho de split screen cai; outros rostos são informativos', () => {
    const m = parseEditMap(editJson(), GRID, WORDS, editInput.faceTrack);
    expect(m.overlaysOverFace).toEqual([{ startFrame: 300, endFrame: 360, description: 'red arrow sticker' }]);
    expect(m.mainSpeaker).toEqual({ box: { x: 0, y: 119, w: 336, h: 324 }, description: 'top-left box of a split screen' });
    expect(m.otherFaces).toEqual([{ startFrame: 0, endFrame: 690, box: expect.objectContaining({ x: 0, y: 448 }), where: 'security camera footage below the avatar' }]);
  });

  it('perfil genérico: campo com traço identificável (tatuagem) é apagado; sem pessoa = null', () => {
    const m = parseEditMap(editJson(), GRID, WORDS);
    expect(m.profile).toMatchObject({ gender: 'female', ageBand: '25-35', ethnicity: 'Latina', pose: '' });
    const empty = parseEditMap(editJson({ profile: { gender: 'unknown', ageBand: '', ethnicity: '', hair: '', clothing: '', setting: '', lighting: '', framing: '', pose: '' } }), GRID, []);
    expect(empty.profile).toBeNull();
    expect(() => parseEditMap('{oops', GRID, [])).toThrow(expect.objectContaining({ code: 'PROVIDER_ERROR' }));
  });

  it('esquema sem union (limite da saída estruturada)', () => {
    const txt = JSON.stringify(EDIT_SCHEMA);
    expect(txt).not.toContain('anyOf');
    expect(txt).not.toContain('"null"');
  });
});

const usage = (i = 12_000, o = 3000) => [{ model: 'claude-opus-5-5', inputTokens: i, outputTokens: o, cacheWriteTokens: 0, cacheReadTokens: 0 }];
class FakeTransport implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly reply: (call: ClaudeCall) => ClaudeResult) {}
  async run(call: ClaudeCall): Promise<ClaudeResult> {
    this.calls.push(call);
    return this.reply(call);
  }
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const frameFetch = (async (url: string) => (String(url).includes('broken') ? new Response('nope', { status: 404 }) : new Response(JPEG))) as unknown as typeof fetch;

const editInput = {
  workspaceId: 'w', championId: 'c1', jobId: 'j1', video: GRID,
  keyframes: [{ atSec: 0, reason: 't0', url: 'http://s/f0.jpg' }, { atSec: 12, reason: 'cut', url: 'http://s/f1.jpg' }],
  textCrops: [{ atSec: 1, box: { x: 0, y: 40, w: 720, h: 120 }, url: 'http://s/c0.jpg' }, { atSec: 8, box: { x: 0, y: 880, w: 720, h: 110 }, url: 'http://s/broken.jpg' }],
  faceTrack: [{ startFrame: 0, endFrame: 690, region: { x: 0, y: 119, w: 336, h: 324 }, fullFrame: false, faceInRegion: [{ atFrame: 0, box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 } }], facesMax: 1, minScore: 0.92 }],
  transcript: { language: 'en', words: WORDS },
};

describe('ClaudeLiveService.describeEdit', () => {
  it('frames + recortes em base64, trilha do rosto e catálogo de fontes no contexto; custo no campeão', async () => {
    const t = new FakeTransport(() => ({ text: editJson(), stopReason: 'end_turn', usage: usage() }));
    const costs = new MemoryCostStore();
    const r = await new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5', fetchImpl: frameFetch }).describeEdit(editInput);
    expect(t.calls).toHaveLength(1);
    const c = t.calls[0];
    expect(c.schema).toBe(EDIT_SCHEMA);
    expect(c.images!.map((i) => i.caption)).toEqual(['Frame at 0 s (t0):', 'Frame at 12 s (cut):', 'Frame at 1 s (full-resolution crop of x 0-720, y 40-160 px):']);
    expect(c.user).toContain('1 other image(s) could not be loaded');
    expect(c.context).toContain('face region x 0-336, y 119-443 px');
    expect(c.context).toContain('anton-400');
    expect(c.system).toContain('Never a name');
    expect(r.layers).toHaveLength(2);
    expect(r.costUsd).toBeCloseTo(12_000 * 4e-6 + 3000 * 2e-5, 6);
    expect(costs.entries.every((e) => e.championId === 'c1' && e.jobId === 'j1')).toBe(true);
  });

  it('nenhuma imagem = PROVIDER_ERROR sem gastar; recusa = SAFETY_BLOCK', async () => {
    const t = new FakeTransport(() => ({ text: editJson(), stopReason: 'end_turn', usage: usage() }));
    const none = { ...editInput, keyframes: [{ atSec: 0, reason: 't0', url: 'http://s/broken.jpg' }], textCrops: [] };
    await expect(new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5', fetchImpl: frameFetch }).describeEdit(none)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(t.calls).toHaveLength(0);
    const refuse = new FakeTransport(() => ({ text: '', stopReason: 'refusal', usage: usage(10, 0) }));
    await expect(new ClaudeLiveService(refuse, new MemoryCostStore(), { model: 'claude-opus-5-5', fetchImpl: frameFetch }).describeEdit(editInput)).rejects.toMatchObject({ code: 'SAFETY_BLOCK' });
  });
});

// ------------------------------------------------------------------ plano com perfil e gancho escrito

function editMapOf(): EditMap {
  const d = parseEditMap(editJson(), GRID, WORDS);
  const ok = { available: true, blockers: [] };
  return { version: 1, ...GRID, cells: [], faceTrack: editInput.faceTrack, ...d, keepEdit: { SWAP_AVATAR: ok, NEW_HOOKS: ok } } as EditMap;
}

function teardownOf() {
  const dur = 23;
  return mockTeardown('EN', WORDS, { durationSec: dur, width: 720, height: 1280, fps: 30, hasAudio: true, cuts: [], segments: [], palette: [], silences: [] }, null, 4);
}

type Done = { kind: VariationKind; index: number; draft: VariationItemDraft };
function planCb() {
  const done: Done[] = [];
  const failed: [VariationKind, number, string][] = [];
  const shared: string[] = [];
  return { done, failed, shared, cb: { onSharedCasting: (d: string) => shared.push(d), onItemDone: (kind: VariationKind, index: number, draft: VariationItemDraft) => done.push({ kind, index, draft }), onItemFailed: (kind: VariationKind, index: number, code: string) => failed.push([kind, index, code]) } };
}
const offer = { name: 'Orbit', language: 'en', kind: null, what: null, audience: null, promise: null, pains: null, proof: null, offerAndPrice: null, cta: null, notes: null };

describe('hookTextSlot (§13.4 a)', () => {
  it('camada do gancho = headline/texto visível no início; limite pelo texto original (+20 %) e pela caixa', () => {
    const s = hookTextSlot(editMapOf(), 3.2);
    expect(s).toMatchObject({ original: 'HE HIDES HIS PHONE?', kind: 'headline', uppercase: true });
    expect(s.maxChars).toBeGreaterThanOrEqual(23);
    expect(s.maxChars).toBeLessThanOrEqual(120);
    expect(hookTextSlot(null, 3)).toEqual({ original: null, kind: null, maxChars: 40, uppercase: false });
  });
});

describe('ClaudeLiveService.planVariations (§13)', () => {
  it('hookMode TEXT: só onScreenText (caixa alta como o original), speech = fala original, sem elenco compartilhado; SWAP com perfil', async () => {
    const t = new FakeTransport((c) => {
      if (c.user.includes('WRITTEN-HOOK')) return { text: JSON.stringify({ lever: 'curiosity: question', rationale: 'attacks verdict 1', onScreenText: '“Why is his phone face down?”' }), stopReason: 'end_turn', usage: usage(3000, 300) };
      return { text: JSON.stringify({ lever: 'avatar: another latina', rationale: 'same look, new face', castingDescription: 'A woman, 25-35, Latina, long dark wavy hair, grey hoodie, bedroom at night, warm lamp light, chest up, looking into the lens.' }), stopReason: 'end_turn', usage: usage(3000, 300) };
    });
    const { cb, done, failed, shared } = planCb();
    const teardown = teardownOf();
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'en', offer, teardown, transcript: WORDS, notes: null, avoidLevers: [],
        slots: [{ kind: 'NEW_HOOKS', index: 0 }, { kind: 'NEW_HOOKS', index: 1 }, { kind: 'SWAP_AVATAR', index: 0 }], editMap: editMapOf(), hookMode: 'TEXT', castingStyle: 'MATCH_ORIGINAL' },
      cb,
    );
    expect(failed).toEqual([]);
    expect(shared).toEqual([]); // gancho escrito não gera rosto
    expect(t.calls).toHaveLength(3);
    const hook = done.find((d) => d.kind === 'NEW_HOOKS')!.draft as { hook: { speech: string; onScreenText: string; durationSec: number } };
    const spoken = WORDS.filter((w) => (w.startSec + w.endSec) / 2 < teardown.hook.data!.endSec).map((w) => w.word).join(' ');
    expect(hook.hook).toEqual({ speech: spoken, onScreenText: 'WHY IS HIS PHONE FACE DOWN?', durationSec: Math.round(teardown.hook.data!.endSec * 10) / 10 });
    const hookCall = t.calls.find((c) => c.user.includes('WRITTEN-HOOK'))!;
    expect(hookCall.user).toContain('"HE HIDES HIS PHONE?"');
    expect(hookCall.user).toContain(`"${spoken}"`);
    const castCall = t.calls.find((c) => c.user.includes('SWAP_AVATAR'))!;
    expect(castCall.user).toContain('<original_profile>');
    expect(castCall.user).toContain('Ethnicity (broad): Latina');
    expect(castCall.user).not.toContain('rose tattoo');
  });

  it('texto acima do limite ganha 1 nova tentativa e depois falha o item (nunca corta em silêncio)', async () => {
    const t = new FakeTransport(() => ({ text: JSON.stringify({ lever: 'l', rationale: 'r', onScreenText: 'x'.repeat(200) }), stopReason: 'end_turn', usage: usage(10, 10) }));
    const { cb, failed } = planCb();
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'en', offer, teardown: teardownOf(), transcript: WORDS, notes: null, avoidLevers: [], slots: [{ kind: 'NEW_HOOKS', index: 0 }], editMap: editMapOf(), hookMode: 'TEXT' },
      cb,
    );
    expect(t.calls).toHaveLength(2);
    expect(failed).toEqual([['NEW_HOOKS', 0, 'PROVIDER_ERROR']]);
  });
});

describe('mock (§13)', () => {
  it('describeEdit determinístico: 1 headline sólida + rodapé; karaokê queimado só com [mock:burned-captions] (26/10); sem fala, sem legenda', async () => {
    const svc = new FakeClaudeService(new MemoryCostStore(), { model: 'claude-opus-5-5', stepMs: 0 });
    expect((await svc.describeEdit(editInput)).layers.map((l) => [l.kind, l.background.kind])).toEqual([['headline', 'solid'], ['text', 'solid']]);
    const a = await svc.describeEdit({ ...editInput, notes: '[mock:burned-captions]' });
    expect(a.layers.map((l) => [l.kind, l.background.kind])).toEqual([['headline', 'solid'], ['text', 'solid'], ['caption', 'none']]);
    // na grade da fixture de painéis (720×960): faixa do topo 0-119, rodapé 840-960, karaokê fora do rosto
    const fx = await svc.describeEdit({ ...editInput, notes: '[mock:burned-captions]', video: { width: 720, height: 960, fps: 30, frameCount: 450, durationSec: 15 } });
    expect(fx.layers[0].box).toEqual({ x: 0, y: 0, w: 720, h: 119 });
    expect(fx.layers[0].background.color).toBe('#D40F0F');
    expect(fx.layers[1].box).toEqual({ x: 0, y: 840, w: 720, h: 120 });
    const face = editInput.faceTrack[0].region;
    for (const l of fx.layers) {
      const b = l.box;
      const inter = Math.max(0, Math.min(b.x + b.w, face.x + face.w) - Math.max(b.x, face.x)) * Math.max(0, Math.min(b.y + b.h, face.y + face.h) - Math.max(b.y, face.y));
      expect([l.id, inter]).toEqual([l.id, 0]); // nenhuma camada cruza a região do rosto sem gatilho
    }
    expect(await svc.describeEdit({ ...editInput, notes: '[mock:burned-captions]' })).toEqual(a);
    expect(a.costUsd).toBe(0);
    expect(mockEditMap({ ...editInput, notes: '[mock:burned-captions]', transcript: { language: 'pt-BR', words: [] } }).layers.map((l) => l.kind)).toEqual(['headline', 'text']);
  });

  it('gatilhos nas notes do campeão (nomes do mock do web): keep-straddle, keep-overlay, hook-over-video', () => {
    const face = editInput.faceTrack[0].region;
    const plain = mockEditMap(editInput);
    expect(plain.overlaysOverFace).toEqual([]);
    const s = mockEditMap({ ...editInput, notes: 'x [mock:keep-straddle]' });
    const cap = s.layers.find((l) => l.kind === 'caption')!.box;
    expect(cap.y).toBeLessThan(face.y + face.h); // metade dentro
    expect(cap.y + cap.h).toBeGreaterThan(face.y + face.h); // metade fora
    expect(cap.x).toBeLessThan(face.x + face.w);
    expect(cap.x + cap.w).toBeGreaterThan(face.x + face.w);
    const o = mockEditMap({ ...editInput, notes: '[mock:keep-overlay]' });
    expect(o.overlaysOverFace).toEqual([{ startFrame: 230, endFrame: 460, description: expect.any(String) }]);
    const h = mockEditMap({ ...editInput, notes: '[mock:hook-over-video]' });
    expect(h.layers[0]).toMatchObject({ kind: 'headline', startFrame: 0, endFrame: 90, background: { kind: 'none', color: null, box: null } });
    expect(plain.layers[0].background.kind).toBe('solid');
  });

  it('planVariations TEXT + perfil no mock: speech original, texto dentro do limite, elenco a partir do perfil, sem elenco compartilhado', async () => {
    const svc = new FakeClaudeService(new MemoryCostStore(), { model: 'claude-opus-5-5', stepMs: 0 });
    const { cb, done, shared } = planCb();
    const editMap = editMapOf();
    await svc.planVariations({ workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'en', offer, teardown: teardownOf(), transcript: WORDS, notes: null, avoidLevers: [], slots: [{ kind: 'NEW_HOOKS', index: 0 }, { kind: 'SWAP_AVATAR', index: 0 }, { kind: 'SWAP_AVATAR', index: 1 }], editMap, hookMode: 'TEXT', castingStyle: 'MATCH_ORIGINAL' }, cb);
    expect(shared).toEqual([]);
    const h = done.find((d) => d.kind === 'NEW_HOOKS')!.draft as { hook: { speech: string; onScreenText: string } };
    expect(h.hook.speech).toBe(WORDS.filter((w) => (w.startSec + w.endSec) / 2 < teardownOf().hook.data!.endSec).map((w) => w.word).join(' '));
    expect(h.hook.onScreenText).toBe(h.hook.onScreenText.toUpperCase());
    const casts = done.filter((d) => d.kind === 'SWAP_AVATAR').map((d) => (d.draft as { castingDescription: string }).castingDescription);
    expect(casts[0]).toMatch(/^A woman, 25-35, Latina/);
    expect(casts[0]).not.toBe(casts[1]);
  });
});

// ------------------------------------------------------------------ §13.13 elenco diverso

describe('elenco diverso (§13.13)', () => {
  const AXES = ['ethnicity', 'age', 'hair', 'eyes', 'piercing', 'setting'] as const;

  it('eixos sorteados pelo lote: 5 posições sem repetir eixo, sem a etnia do original, estável por lote', () => {
    for (const batchId of ['b1', 'lote-xyz', 'cm9q2a', 'z']) {
      for (const gender of ['female', 'male'] as const) {
        const cs = [0, 1, 2, 3, 4].map((position) => diverseCasting({ batchId, position, gender, originalEthnicity: 'White' }));
        for (const ax of AXES) expect(new Set(cs.map((c) => c[ax].en)).size).toBe(5);
        expect(cs.every((c) => !/white|european/i.test(c.ethnicity.en))).toBe(true);
        expect(cs.every((c) => c.gender === gender)).toBe(true);
        expect(new Set(cs.map((c) => c.clothing.en)).size).toBeGreaterThanOrEqual(4);
        for (const c of cs) if (/upper arm/.test(c.tattoo.en)) expect(/tank|sleeveless/.test(c.clothing.en)).toBe(true);
        expect(diverseCasting({ batchId, position: 3, gender, originalEthnicity: 'White' })).toEqual(cs[3]);
      }
    }
    // tons de pele alternados: as 3 primeiras posições cobrem claro, médio e escuro
    const TONE = (e: string) => (/^(White|East Asian|Middle Eastern)/.test(e) ? 0 : /^(Black|Pacific)/.test(e) ? 2 : 1);
    for (let n = 0; n < 50; n++) expect(new Set([0, 1, 2].map((position) => TONE(diverseCasting({ batchId: `t${n}`, position, gender: 'female', originalEthnicity: 'White' }).ethnicity.en))).size).toBe(3);
    // plausibilidade: crespo/tranças e olho claro só onde a etnia sorteada comporta (100 lotes × 5 posições)
    for (let n = 0; n < 100; n++) for (const gender of ['female', 'male'] as const) for (let position = 0; position < 5; position++) {
      const c = diverseCasting({ batchId: `x${n}`, position, gender });
      if (/coils|braids|twists|afro/.test(c.hair.en)) expect(/^(Black|Latino|Pacific)/.test(c.ethnicity.en)).toBe(true);
      if (/green|blue/.test(c.eyes.en)) expect(/^(White|Latino|Middle Eastern)/.test(c.ethnicity.en)).toBe(true);
    }
    const a = [1, 2, 3].map((p) => castingSummary(diverseCasting({ batchId: 'A', position: p, gender: 'male' })));
    const b = [1, 2, 3].map((p) => castingSummary(diverseCasting({ batchId: 'B', position: p, gender: 'male' })));
    expect(a).not.toEqual(b);
    // elencos prontos citados no lever saem do sorteio
    expect(ethnicityPool('Latina', ['avatar: Black woman, 20s', 'avatar: East Asian man']).map((e) => e.en.split(',')[0]))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/^(Black|Latino|East Asian)/)]));
  });

  it('live: DIVERSE manda restrição explícita por elenco (posição 0 = compartilhado), gênero = castingGender, luz/enquadramento do original', async () => {
    const t = new FakeTransport((c) => {
      if (c.user.includes('Cast ONE person')) return { text: JSON.stringify({ description: 'A man of South Asian descent, about 28, shaved head, hazel eyes, small nose stud, stubble, olive hoodie, kitchen, warm lamp, chest up, looking into the lens.' }), stopReason: 'end_turn', usage: usage(3000, 300) };
      if (c.user.includes('SWAP_AVATAR')) return { text: JSON.stringify({ lever: 'avatar: different man', rationale: 'new face', castingDescription: 'A man, Black, about 42, short twists, dark brown eyes, neck tattoo, septum ring, full beard, black turtleneck, home office, warm lamp, chest up, looking into the lens.' }), stopReason: 'end_turn', usage: usage(3000, 300) };
      return { text: JSON.stringify({ lever: 'pain: x', rationale: 'r', speech: 'If you are tired of this, watch.', onScreenText: '' }), stopReason: 'end_turn', usage: usage(3000, 300) };
    });
    const { cb, done, failed, shared } = planCb();
    const slots = [{ kind: 'NEW_HOOKS' as const, index: 0 }, { kind: 'SWAP_AVATAR' as const, index: 0 }, { kind: 'SWAP_AVATAR' as const, index: 1 }, { kind: 'SWAP_AVATAR' as const, index: 2 }];
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'lote-1', jobId: 'j', language: 'en', offer, teardown: teardownOf(), transcript: WORDS, notes: null, avoidLevers: [], slots, editMap: editMapOf(), castingStyle: 'DIVERSE', castingGender: 'male' },
      cb,
    );
    expect(failed).toEqual([]);
    expect(shared).toHaveLength(1);
    expect(done.filter((d) => d.kind === 'SWAP_AVATAR')).toHaveLength(3);
    const castCalls = t.calls.filter((c) => c.user.includes('<casting_constraints>'));
    expect(castCalls).toHaveLength(4);
    const eth = castCalls.map((c) => /Apparent ethnicity: (.*)/.exec(c.user)![1]);
    expect(new Set(eth).size).toBe(4);
    expect(eth.every((e) => !/latin/i.test(e))).toBe(true); // original = Latina
    for (const c of castCalls) {
      expect(c.user).toContain('Gender: man (required');
      expect(c.user).toContain('Lighting: warm lamp from the right');
      expect(c.user).toContain('Framing: chest up, face centered');
      expect(c.user).not.toContain('<original_profile>');
      expect(c.user).not.toContain('rose tattoo'); // nunca a marca da pessoa do campeão
    }
    const swap0 = castCalls.find((c) => c.user.includes('variation 1 of 3'))!;
    const sharedCall = castCalls.find((c) => c.user.includes('Cast ONE person'))!;
    expect(swap0.user).toContain(`Apparent ethnicity: ${diverseCasting({ batchId: 'lote-1', position: 1, gender: 'male', originalEthnicity: 'Latina' }).ethnicity.en}`);
    expect(sharedCall.user).toContain(`Apparent ethnicity: ${diverseCasting({ batchId: 'lote-1', position: 0, gender: 'male', originalEthnicity: 'Latina' }).ethnicity.en}`);
    expect((swap0.user.match(/^- /gm) ?? []).length).toBe(3); // os outros 3 do lote (compartilhado + 2 SWAP)
  });

  it('live: castingStyle ausente = DIVERSE; descrição "parecida com alguém" ganha 1 nova tentativa e falha o item', async () => {
    const t = new FakeTransport(() => ({ text: JSON.stringify({ lever: 'avatar: x', rationale: 'r', castingDescription: 'A woman who looks like a famous singer, about 30, braids, green eyes, kitchen, chest up.' }), stopReason: 'end_turn', usage: usage(10, 10) }));
    const { cb, failed } = planCb();
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'en', offer, teardown: teardownOf(), transcript: WORDS, notes: null, avoidLevers: [], slots: [{ kind: 'SWAP_AVATAR', index: 0 }], editMap: editMapOf(), hookMode: 'TEXT' },
      cb,
    );
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0].user).toContain('<casting_constraints>');
    expect(failed).toEqual([['SWAP_AVATAR', 0, 'PROVIDER_ERROR']]);
  });

  it('live: MATCH_ORIGINAL + castingGender troca o gênero do perfil', async () => {
    const t = new FakeTransport(() => ({ text: JSON.stringify({ lever: 'avatar: x', rationale: 'r', castingDescription: 'A man, 25-35, Latino, long dark wavy hair, grey hoodie, bedroom, chest up.' }), stopReason: 'end_turn', usage: usage(10, 10) }));
    const { cb } = planCb();
    await new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' }).planVariations(
      { workspaceId: 'w', batchId: 'b', jobId: 'j', language: 'en', offer, teardown: teardownOf(), transcript: WORDS, notes: null, avoidLevers: [], slots: [{ kind: 'SWAP_AVATAR', index: 0 }], editMap: editMapOf(), hookMode: 'TEXT', castingStyle: 'MATCH_ORIGINAL', castingGender: 'male' },
      cb,
    );
    expect(t.calls[0].user).toContain('<original_profile>');
    expect(t.calls[0].user).toContain('Gender: male');
  });

  it('mock: DIVERSE (padrão) dá elencos todos diferentes, no gênero pedido, iguais aos eixos do serviço real', async () => {
    const svc = new FakeClaudeService(new MemoryCostStore(), { model: 'claude-opus-5-5', stepMs: 0 });
    const { cb, done, shared } = planCb();
    await svc.planVariations({ workspaceId: 'w', batchId: 'lote-9', jobId: 'j', language: 'pt-BR', offer, teardown: teardownOf(), transcript: WORDS, notes: null, avoidLevers: [], slots: [{ kind: 'NEW_HOOKS', index: 0 }, ...[0, 1, 2, 3].map((index) => ({ kind: 'SWAP_AVATAR' as const, index }))], editMap: editMapOf(), castingGender: 'male' }, cb);
    const casts = [...shared, ...done.filter((d) => d.kind === 'SWAP_AVATAR').map((d) => (d.draft as { castingDescription: string }).castingDescription)];
    expect(casts).toHaveLength(5);
    expect(new Set(casts).size).toBe(5);
    expect(casts.every((c) => c.startsWith('Um homem'))).toBe(true);
    const c1 = diverseCasting({ batchId: 'lote-9', position: 1, gender: 'male', originalEthnicity: 'Latina' });
    expect(casts).toContain(describeCasting(c1, 'pt', { ...editMapOf().profile!, gender: 'male' }));
  });

  it('facePromptV2: tatuagem/piercing realistas só quando a descrição tem; negação não conta', () => {
    const withMarks = facePromptV2('A woman, East Asian, about 28, a fine-line botanical tattoo on the side of the neck, a thin silver septum ring');
    expect(withMarks).toContain('real healed ink');
    expect(withMarks).toContain('real metal jewelry');
    const none = facePromptV2('A man, White, about 40, no visible tattoos, no piercings, black turtleneck');
    expect(none).not.toContain('real healed ink');
    expect(none).not.toContain('real metal jewelry');
    expect(bodyMarksV2('Uma mulher, tatuagem floral no braço, sem piercing')).toHaveLength(1);
    expect(bodyMarksV2('Um homem, sem tatuagem visível, argola fina prateada no septo')).toEqual([expect.stringContaining('metal jewelry')]);
  });
});

// ------------------------------------------------------------------ geração: take, seed, teto

function genSetup(probe: number | null) {
  const tasks = new MemoryTaskStore();
  const costs = new MemoryCostStore();
  const events: ProviderTaskFinishedEvent[] = [];
  const bus = { emit: (n: string, p: ProviderTaskFinishedEvent) => (n === PROVIDER_TASK_FINISHED ? events.push(p) : 0) };
  const gen = new FakeGenerationService(tasks, costs, bus, { publicApiUrl: 'http://api.local', delayMs: () => 0, probeMedia: async () => ({ durationSec: probe, hasAudio: true }) });
  return { tasks, costs, events, gen };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('FakeGenerationService com take (§13.5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mock-take-'));
  beforeAll(() => (process.env.INTEGRACOES_MOCK_MEDIA_DIR = dir));
  afterAll(() => {
    delete process.env.INTEGRACOES_MOCK_MEDIA_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('TTS do texto inteiro → 1 LIPSYNC (seed, takeId no evento) → TRANSCRIBE do take com o texto do TTS', async () => {
    const { tasks, events, gen, costs } = genSetup(null);
    const text = BLOCKS.map((b) => b.speech).join(' ');
    await gen.submitTts({ workspaceId: 'w', takeId: 't1', voiceId: 'Calm_Woman', text, language: 'en' });
    await tick();
    const lip = await gen.submitLipsync({ workspaceId: 'w', takeId: 't1', faceImageUrl: 'http://s/face.png', audioUrl: events[0].outputUrls[0], visualPrompt: 'SOLO SHOT', format: 'VERTICAL_9_16', seed: 9 });
    expect((await tasks.get(lip.providerTaskId))!.input).toMatchObject({ seed: 9 });
    await tick();
    expect(events[1]).toMatchObject({ kind: 'LIPSYNC', status: 'COMPLETED', takeId: 't1' });
    expect(events[1].outputUrls[0]).toMatch(/\/mock-media\/lipsync\/[0-9a-f]{16}\.mp4$/);
    const tr = await gen.submitTranscribe({ workspaceId: 'w', takeId: 't1', mediaUrl: events[1].outputUrls[0], language: 'en' });
    await tick();
    expect(events[2]).toMatchObject({ kind: 'TRANSCRIBE', takeId: 't1' });
    expect((await gen.parseWords(tr.providerTaskId)).map((w) => w.word).join(' ')).toBe(text);
    expect(costs.entries.map((c) => c.kind)).toEqual(['TTS', 'LIPSYNC', 'TRANSCRIBE']);
    expect([...tasks.tasks.values()].every((t) => t.takeId === 't1' && t.sceneId === null)).toBe(true);
  });

  it('áudio > 600 s = LIPSYNC_AUDIO_TOO_LONG antes de gravar task; TTS > 10 mil caracteres = INVALID_SCRIPT; um alvo só', async () => {
    const { tasks, gen } = genSetup(601);
    await expect(gen.submitLipsync({ workspaceId: 'w', takeId: 't1', faceImageUrl: 'f', audioUrl: 'a', visualPrompt: '', format: 'VERTICAL_9_16' })).rejects.toMatchObject({ code: 'LIPSYNC_AUDIO_TOO_LONG', details: { durationSec: 601, maxSec: 600 } });
    await expect(gen.submitTts({ workspaceId: 'w', takeId: 't1', voiceId: 'Calm_Woman', text: 'a'.repeat(10_001), language: 'en' })).rejects.toMatchObject({ code: 'INVALID_SCRIPT' });
    await expect(gen.submitTts({ workspaceId: 'w', takeId: 't1', sceneId: 's1', voiceId: 'Calm_Woman', text: 'a', language: 'en' })).rejects.toThrow(/exactly one/);
    expect(tasks.tasks.size).toBe(0);
  });

  it('clipe do lipsync mock = a imagem do rosto em loop pela duração do áudio + cauda, 24 fps, com o áudio enviado', async () => {
    const face = await ensureMockMedia({ kind: 'face', seed: seedOf('rosto') });
    const audio = await ensureMockMedia({ kind: 'audio', seed: seedOf('fala'), sec: 3 });
    const seed = seedOf('lip');
    writeMockLipsyncSpec(seed, { faceUrl: face.path, audioUrl: audio.path, sec: 3 });
    const f = await ensureMockLipsync(seed);
    const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', f.path]).toString());
    const v = p.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect(v).toMatchObject({ width: 720, height: 1280, r_frame_rate: '24/1' });
    expect(p.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);
    expect(Number(p.format.duration)).toBeCloseTo(3.2, 1);
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', f.path, '-f', 'null', '-']); // decodifica inteiro
    await expect(ensureMockLipsync(seedOf('nunca-gravado'))).rejects.toThrow('unknown lipsync');
  }, 60_000);

  it('QA PC-01/02: rosto padrão do mock é foto real e o clipe do lipsync tem 1 rosto ≥ 0,8 (YuNet da medição) em TODO frame', async () => {
    delete process.env.INTEGRACOES_MOCK_FACES_DIR;
    const face = await ensureMockMedia({ kind: 'face', seed: seedOf('rosto-yunet') });
    const audio = await ensureMockMedia({ kind: 'audio', seed: seedOf('fala-yunet'), sec: 2 });
    const seed = seedOf('lip-yunet');
    writeMockLipsyncSpec(seed, { faceUrl: face.path, audioUrl: audio.path, sec: 2 });
    const clip = await ensureMockLipsync(seed);
    const med = new FfmpegMediaAnalysisService();
    const still = await med.detectFaces(face.path);
    expect(still[0].faces.filter((x) => x.score >= 0.8)).toHaveLength(1);
    const samples = await med.detectFaces(clip.path, 24, { minScore: 0.5 });
    expect(samples.length).toBeGreaterThanOrEqual(48); // 2,2 s a 24 fps
    for (const sm of samples) expect([sm.frame, sm.faces.filter((x) => x.score >= 0.8).length, sm.faces.length]).toEqual([sm.frame, 1, 1]);
    // rosto enviado inalcançável também cai no rosto padrão
    const seed2 = seedOf('lip-yunet-sem-rosto');
    writeMockLipsyncSpec(seed2, { faceUrl: join(dir, 'nao-existe.png'), audioUrl: audio.path, sec: 2 });
    const s2 = await med.detectFaces((await ensureMockLipsync(seed2)).path, 2);
    expect(s2.every((x) => x.faces.filter((y) => y.score >= 0.8).length === 1)).toBe(true);
  }, 120_000);
});

describe('WaveSpeedGenerationService com take (§13.5) e rosto no aspecto da região (§13.3)', () => {
  function setup(probe: number) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let n = 0;
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} });
      return new Response(JSON.stringify({ code: 200, data: { id: `p${++n}`, status: 'created', outputs: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const tasks = new MemoryTaskStore();
    const events: ProviderTaskFinishedEvent[] = [];
    const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k', fetchImpl: f }), tasks, new MemoryCostStore(), { emit: (_: string, p: ProviderTaskFinishedEvent) => events.push(p) } as never, {
      webhookUrl: null, probeSeconds: async () => probe, fetchImpl: f, lookupRetryMs: 0,
    });
    return { svc, calls, tasks, events };
  }

  it('lipsync do take: seed do backend, takeId na task, estimativa = ceil(s do áudio inteiro) × 0,025', async () => {
    const { svc, calls, tasks } = setup(29.3);
    const s = await svc.submitLipsync({ workspaceId: 'w', takeId: 't1', faceImageUrl: 'https://cdn.x/face.png', audioUrl: 'https://cdn.x/a.m4a', visualPrompt: 'SOLO SHOT', format: 'VERTICAL_9_16', seed: 8 });
    expect(calls[0].url).toContain('pruna-ai/p-video/avatar');
    expect(calls[0].body).toMatchObject({ seed: 8, resolution: '720p' });
    expect(s.estimatedUsd).toBe(0.75);
    expect((await tasks.get(s.providerTaskId))!).toMatchObject({ takeId: 't1', sceneId: null });
    const d = await svc.submitLipsync({ workspaceId: 'w', sceneId: 's1', faceImageUrl: 'https://cdn.x/face.png', audioUrl: 'https://cdn.x/a.m4a', visualPrompt: 'SOLO SHOT', format: 'VERTICAL_9_16' });
    expect(calls[1].body).toMatchObject({ seed: 7 });
    expect(d.estimatedUsd).toBe(0.75);
  });

  it('áudio > 600 s: erro explícito antes de qualquer chamada paga', async () => {
    const { svc, calls, tasks } = setup(612);
    await expect(svc.submitLipsync({ workspaceId: 'w', takeId: 't1', faceImageUrl: 'https://cdn.x/face.png', audioUrl: 'https://cdn.x/a.m4a', visualPrompt: '', format: 'VERTICAL_9_16' })).rejects.toMatchObject({ code: 'LIPSYNC_AUDIO_TOO_LONG' });
    expect(calls).toHaveLength(0);
    expect(tasks.tasks.size).toBe(0);
  });

  it('Soul V2 no aspecto pedido; prompt deixa de dizer "Vertical" no quadrado', async () => {
    const hfCalls: Record<string, unknown>[] = [];
    const hf = { submit: async (_e: string, body: Record<string, unknown>) => { hfCalls.push(body); return { requestId: `r${hfCalls.length}`, status: 'queued', images: [], error: null, raw: {} }; } };
    const tasks = new MemoryTaskStore();
    const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k' }), tasks, new MemoryCostStore(), { emit: () => 0 } as never, { webhookUrl: null, higgsfield: hf as never });
    await svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'A woman, 30, Latina', language: 'en', aspectRatio: '1:1' });
    await svc.submitFace({ workspaceId: 'w', faceId: 'f2', description: 'A woman, 30, Latina', language: 'en' });
    expect(hfCalls[0]).toMatchObject({ aspect_ratio: '1:1', resolution: '1080p' });
    expect(String(hfCalls[0].prompt)).toMatch(/^Square smartphone photo\./);
    expect(hfCalls[1]).toMatchObject({ aspect_ratio: '9:16' });
    expect(String(hfCalls[1].prompt)).toMatch(/^Vertical smartphone photo\./);
  });
});

// garante que o tipo do teardown usado acima é o do contrato (evita teste verde com dado fora de forma)
void parseTeardown;
