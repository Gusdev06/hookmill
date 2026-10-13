// §13.15 (I6): Trocar avatar com motor Kling/Seedance. Funções puras do catálogo, adapter live (fetch falso) e mock.
import { estimateSwap, fitEngineVoice, planSwapWindows, swapGenSec, swapResolutionFor } from './catalogo/troca-motor';
import { CatalogServiceImpl } from './catalogo/catalog.service';
import { PROVIDER_TASK_FINISHED, type ProviderTaskFinishedEvent } from './portas';
import { MemoryCostStore, MemoryTaskStore } from './store/memoria.store';
import { WaveSpeedClient } from './wavespeed/cliente';
import { WaveSpeedGenerationService } from './wavespeed/generation.service';
import { seedanceSwapAspect, swapScenePrompt } from './wavespeed/prompts-midia';
import { FakeGenerationService } from './mock/fake-generation.service';
import type { TranscriptWord } from './contrato';

/** Palavras de `n` em `n` com vãos dados: [início, fim] relativos ao trecho. */
const w = (pairs: [number, number][]): TranscriptWord[] => pairs.map(([s, e], k) => ({ word: `w${k}`, startSec: s, endSec: e }));
/** Fala contínua a 2,6 palavras/s de `from` a `to`, com pausas (silêncios) nos pontos pedidos. */
function speech(from: number, to: number, pauses: { at: number; len: number }[] = []): TranscriptWord[] {
  const out: [number, number][] = [];
  let t = from;
  while (t + 0.3 < to) {
    const p = pauses.find((x) => t >= x.at && t < x.at + x.len);
    if (p) { t = p.at + p.len; continue; }
    const next = pauses.find((x) => x.at > t && x.at < t + 0.33);
    const end = next ? next.at : t + 0.33;
    out.push([+t.toFixed(3), +end.toFixed(3)]);
    t = next ? next.at + next.len : t + 0.385;
  }
  return w(out);
}

describe('planSwapWindows (§13.15.2)', () => {
  it('trecho até o limite = 1 janela; genSec (A) ceil(len+0,2) e (B) ceil(len×1,15+0,3)', () => {
    expect(planSwapWindows({ spanSec: 6, words: speech(0.2, 5.8), engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' })).toEqual([{ startSec: 0, endSec: 6, genSec: 7 }]);
    expect(planSwapWindows({ spanSec: 6, words: speech(0.2, 5.8), engine: 'KLING', voiceSource: 'ENGINE_VOICE' })).toEqual([{ startSec: 0, endSec: 6, genSec: 8 }]); // 6×1,15+0,3 = 7,2
    expect(planSwapWindows({ spanSec: 14.5, words: speech(0, 14.5), engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' })).toHaveLength(1);
  });

  it('mínimo do motor: trecho curto paga 3 s no Kling e 4 s no Seedance', () => {
    expect(planSwapWindows({ spanSec: 1.4, words: speech(0.1, 1.3), engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' })[0].genSec).toBe(3);
    expect(planSwapWindows({ spanSec: 1.4, words: speech(0.1, 1.3), engine: 'SEEDANCE', voiceSource: 'CHAMPION_AUDIO' })[0].genSec).toBe(4);
    expect(swapGenSec(2.9, 'SEEDANCE', 'ENGINE_VOICE')).toBe(4); // 2,9×1,15+0,3 = 3,64 → 4
  });

  it('trecho longo corta no meio do MAIOR silêncio dentro de [0,5×limite, limite]', () => {
    // 30 s de fala; silêncios em 9 s (0,3 s), 11 s (0,6 s, o maior na faixa 7,25-14,5) e 16 s (fora da faixa da 1ª janela)
    const words = speech(0.2, 29.8, [{ at: 9, len: 0.3 }, { at: 11, len: 0.6 }, { at: 16, len: 0.9 }, { at: 22, len: 0.5 }]);
    const wins = planSwapWindows({ spanSec: 30, words, engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' });
    expect(wins[0].endSec).toBeCloseTo(11.3, 3); // meio do vão 11,0-11,6
    // contíguas, cobrem tudo, nenhuma janela passa do limite de fonte nem dos 15 s do motor
    expect(wins[0].startSec).toBe(0);
    expect(wins[wins.length - 1].endSec).toBe(30);
    for (let k = 1; k < wins.length; k++) expect(wins[k].startSec).toBe(wins[k - 1].endSec);
    for (const x of wins) {
      expect(x.endSec - x.startSec).toBeLessThanOrEqual(14.5 + 1e-9);
      expect(x.genSec).toBeLessThanOrEqual(15);
    }
    // nenhum corte cai dentro de uma palavra
    for (const x of wins.slice(0, -1)) expect(words.some((p) => p.startSec < x.endSec - 1e-9 && p.endSec > x.endSec + 1e-9)).toBe(false);
  });

  it('(B) usa o limite de 12,5 s; sem silêncio ≥ 0,15 s corta na fronteira de palavra mais perto do limite', () => {
    // fala colada (vão 0) de 0 a 20 s: palavras de 0,4 s
    const words = w(Array.from({ length: 50 }, (_, k) => [k * 0.4, (k + 1) * 0.4] as [number, number]));
    const wins = planSwapWindows({ spanSec: 20, words, engine: 'SEEDANCE', voiceSource: 'ENGINE_VOICE' });
    expect(wins[0].endSec).toBe(12.4); // fronteira ≤ 12,5 mais perto
    expect(wins[1]).toEqual({ startSec: 12.4, endSec: 20, genSec: 10 }); // 7,6×1,15+0,3 = 9,04 → 10
  });

  it('determinístico e sem palavras (trecho mudo) corta no limite', () => {
    const a = planSwapWindows({ spanSec: 31, words: [], engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' });
    expect(a.map((x) => x.endSec)).toEqual([14.5, 29, 31]);
    expect(planSwapWindows({ spanSec: 31, words: [], engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' })).toEqual(a);
    expect(() => planSwapWindows({ spanSec: 0, words: [], engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' })).toThrow();
  });
});

describe('fitEngineVoice (§13.15.3): ratio nas 3 faixas', () => {
  // campeão: trecho de 6 s, fala de 0,5 a 5,5 (5 s), pads 0,5 / 0,5
  const src = w([[0.5, 2], [2.1, 5.5]]);
  const clip = (first: number, speechSec: number) => w([[first, first + speechSec / 2], [first + speechSec / 2 + 0.05, first + speechSec]]);

  it('|f−1| ≤ 0,02 → EXACT (só corte)', () => {
    const r = fitEngineVoice({ sourceWords: src, sourceSec: 6, clipWords: clip(0.8, 5.05), clipSec: 8 });
    expect(r).toMatchObject({ mode: 'EXACT', ratio: 1.01, sourceSec: 5, voiceSec: 5.05 });
    if ('mode' in r) {
      expect(r.cutStartSec).toBeCloseTo(0.8 - 0.5 * 1.01, 3);
      expect(r.cutEndSec).toBeCloseTo(0.8 + 5.05 + 0.5 * 1.01, 3);
    }
  });

  it('≤ 0,08 → STRETCH', () => {
    expect(fitEngineVoice({ sourceWords: src, sourceSec: 6, clipWords: clip(0.8, 5.3), clipSec: 8 })).toMatchObject({ mode: 'STRETCH', ratio: 1.06 });
    expect(fitEngineVoice({ sourceWords: src, sourceSec: 6, clipWords: clip(0.8, 4.65), clipSec: 8 })).toMatchObject({ mode: 'STRETCH', ratio: 0.93 });
  });

  it('> 0,08 → VOICE_FIT_OUT_OF_RANGE com ratio, sourceSec, voiceSec', () => {
    expect(fitEngineVoice({ sourceWords: src, sourceSec: 6, clipWords: clip(0.8, 5.75), clipSec: 8 })).toEqual({ error: 'VOICE_FIT_OUT_OF_RANGE', ratio: 1.15, sourceSec: 5, voiceSec: 5.75 });
    expect(fitEngineVoice({ sourceWords: src, sourceSec: 6, clipWords: [], clipSec: 8 })).toMatchObject({ error: 'VOICE_FIT_OUT_OF_RANGE', ratio: 0 });
  });

  it('corte limitado ao clipe (fala começa colada no início)', () => {
    const r = fitEngineVoice({ sourceWords: src, sourceSec: 6, clipWords: clip(0.2, 5), clipSec: 5.7 });
    expect(r).toMatchObject({ mode: 'STRETCH', cutStartSec: 0, cutEndSec: 5.7 }); // f = 5,7 / 6 = 0,95
  });
});

describe('swapResolutionFor e aspecto do Seedance', () => {
  it('split screen (~336×324) = 480p; tela cheia 720×1280 = 720p', () => {
    expect(swapResolutionFor({ w: 336, h: 324 }, '1:1')).toBe('480p');
    expect(swapResolutionFor({ w: 720, h: 590 }, '4:3')).toBe('720p'); // podcast 108: 425 mil px > 1,1 × 307 mil
    expect(swapResolutionFor({ w: 720, h: 1280 }, '9:16')).toBe('720p');
    expect(swapResolutionFor({ w: 480, h: 640 }, '3:4')).toBe('480p');
  });
  it('aspecto do rosto → aspecto aceito pelo Seedance mais perto', () => {
    expect(seedanceSwapAspect('2:3')).toBe('3:4');
    expect(seedanceSwapAspect('3:2')).toBe('4:3');
    expect(seedanceSwapAspect('9:16')).toBe('9:16');
    expect(seedanceSwapAspect('1:1')).toBe('1:1');
  });
});

describe('estimateSwap (§13.15.5): caso podcast, 4 trechos main de 4, 5, 6 e 7 s, take de 28 s', () => {
  const spans = [4, 5, 6, 7].map((sec) => ({ sec, words: speech(0.3, sec - 0.3) }));
  const base = { spans, takeSec: 28, region: { w: 336, h: 324 }, aspect: '1:1' as const };
  it('Lipsync (Pruna) = 28 s × 0,025', () => {
    expect(estimateSwap({ ...base, engine: 'LIPSYNC', voiceSource: 'CHAMPION_AUDIO' })).toMatchObject({ perItemUsd: 0.7, resolution: null, warnings: [] });
    expect(() => estimateSwap({ ...base, engine: 'LIPSYNC', voiceSource: 'ENGINE_VOICE' })).toThrow();
  });
  it('Kling (A) = 26 s × 0,112 + v2v 22 s × 0,05 ≈ 4,01', () => {
    const q = estimateSwap({ ...base, engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' });
    expect(q.lines).toEqual([
      { kind: 'VIDEO', units: 26, unit: 'second', unitPriceUsd: 0.112, amountUsd: 2.912 },
      { kind: 'LIPSYNC', units: 22, unit: 'second', unitPriceUsd: 0.05, amountUsd: 1.1 },
    ]);
    expect(q).toMatchObject({ perItemUsd: 4.012, resolution: '1080p', warnings: [] });
  });
  it('Kling (B) = 29 s × 0,168 + transcrição; aviso voice_may_vary', () => {
    const q = estimateSwap({ ...base, engine: 'KLING', voiceSource: 'ENGINE_VOICE' });
    expect(q.lines[0]).toMatchObject({ kind: 'VIDEO', units: 29, unitPriceUsd: 0.168 });
    expect(q.lines[1]).toMatchObject({ kind: 'TRANSCRIBE', units: 29 });
    expect(q.perItemUsd).toBeCloseTo(4.93, 2);
    expect(q.warnings).toEqual(['voice_may_vary']);
  });
  it('Seedance (B) sem voice_may_vary (voz consistente na S2)', () => {
    expect(estimateSwap({ ...base, engine: 'SEEDANCE', voiceSource: 'ENGINE_VOICE' }).warnings).toEqual([]);
  });
  it('Seedance 480p (A) 26 s × 0,108 + 1,10; 720p na tela cheia', () => {
    expect(estimateSwap({ ...base, engine: 'SEEDANCE', voiceSource: 'CHAMPION_AUDIO' })).toMatchObject({ perItemUsd: 3.908, resolution: '480p' });
    expect(estimateSwap({ ...base, region: { w: 720, h: 1280 }, aspect: '9:16', engine: 'SEEDANCE', voiceSource: 'CHAMPION_AUDIO' })).toMatchObject({ resolution: '720p', perItemUsd: 7.34 });
  });
  it('trecho abaixo do mínimo do motor avisa short_segment_padded', () => {
    const q = estimateSwap({ ...base, spans: [{ sec: 2.5, words: speech(0.2, 2.3) }], engine: 'SEEDANCE', voiceSource: 'CHAMPION_AUDIO' });
    expect(q.warnings).toEqual(['short_segment_padded']);
    expect(q.lines[0]).toMatchObject({ units: 4 });
  });
  it('o CatalogService expõe as 4 funções', () => {
    const c = new CatalogServiceImpl({ voiceSampleUrl: () => '' });
    expect(c.planSwapWindows({ spanSec: 5, words: [], engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' })).toHaveLength(1);
    expect(c.swapResolutionFor({ w: 336, h: 324 }, '1:1')).toBe('480p');
    expect(c.estimateSwap({ ...base, engine: 'KLING', voiceSource: 'CHAMPION_AUDIO' }).perItemUsd).toBe(4.012);
    expect('error' in c.fitEngineVoice({ sourceWords: [], sourceSec: 1, clipWords: [], clipSec: 1 })).toBe(true);
  });
});

describe('prompt da janela (§13.15.2)', () => {
  it('(A) mudo: tripé, mesma pessoa, sem diálogo', () => {
    const p = swapScenePrompt({ visualPrompt: 'SOLO SHOT, medium close-up, red hair, podcast mic', speech: 'should not appear', language: 'en', sound: false });
    expect(p).toMatch(/Locked-off static camera/);
    expect(p).toMatch(/only person in the shot/);
    expect(p).not.toContain('should not appear');
    expect(p).not.toContain('[Speaker');
    expect(p).not.toMatch(/red hair/); // aparência não é re-descrita
  });
  it('(B) diálogo com o descritor de voz fixo do item', () => {
    const p = swapScenePrompt({ visualPrompt: 'SOLO SHOT', speech: 'You just need his "number".', language: 'en', sound: true, voiceDescriptor: 'woman in her early thirties, warm medium-low voice' });
    expect(p).toContain('[Speaker, woman in her early thirties, warm medium-low voice]: "You just need his ”number”."');
    expect(p).toMatch(/no music/);
  });
});

// ---------------------------------------------------------------- adapter live (fetch falso)
type Call = { url: string; init?: RequestInit };
function live(probe = 4.1) {
  const calls: Call[] = [];
  let n = 0;
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: 200, data: { id: `p${++n}`, status: 'created', outputs: [] } }), { status: 200 });
  }) as unknown as typeof fetch;
  const tasks = new MemoryTaskStore();
  const costs = new MemoryCostStore();
  const events: ProviderTaskFinishedEvent[] = [];
  const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k', fetchImpl: f }), tasks, costs, { emit: (_: string, p: ProviderTaskFinishedEvent) => events.push(p) } as never, {
    webhookUrl: 'https://api.x/api/v1/webhooks/wavespeed', probeSeconds: async () => probe, fetchImpl: f, lookupRetryMs: 0,
  });
  return { svc, calls, tasks, costs, events };
}
const win = { workspaceId: 'w', sceneId: 'sc', faceImageUrl: 'https://cdn.x/face.png', speech: 'You just need his number.', visualPrompt: 'SOLO SHOT, medium close-up', format: 'VERTICAL_9_16' as const, language: 'en' };

describe('GenerationService live: janela e v2v', () => {
  it('Kling (A): sound false, 1080p, 0,112/s, window_index gravado e no evento', async () => {
    const { svc, calls, tasks, costs, events } = live();
    const s = await svc.submitSceneVideo({ ...win, model: 'kling-3.0', durationSec: 5, windowIndex: 0, sound: false, seed: 11 });
    const body = JSON.parse(String(calls[0].init!.body));
    expect(calls[0].url).toContain('/kwaivgi/kling-v3.0-pro/image-to-video?webhook=');
    expect(body).toMatchObject({ duration: 5, sound: false, cfg_scale: 0.5, image: 'https://cdn.x/face.png' });
    expect(body).not.toHaveProperty('seed'); // o schema do Kling não tem seed
    expect(body.prompt).not.toContain('[Speaker');
    expect(s.estimatedUsd).toBeCloseTo(0.56, 4);
    expect((await tasks.get(s.providerTaskId))!.windowIndex).toBe(0);
    await svc.handleWebhook({ id: 'p1', status: 'completed', outputs: ['https://cdn/k.mp4'] });
    expect(events[0]).toMatchObject({ kind: 'SCENE_VIDEO', windowIndex: 0, sceneId: 'sc' });
    expect(costs.entries[0]).toMatchObject({ kind: 'VIDEO', units: 5, amountUsd: 0.56 });
  });

  it('Kling (B): sound true com o descritor de voz, 0,168/s', async () => {
    const { svc, calls } = live();
    const s = await svc.submitSceneVideo({ ...win, model: 'kling-3.0', durationSec: 3, windowIndex: 1, sound: true, voiceDescriptor: 'woman, warm low voice' });
    const body = JSON.parse(String(calls[0].init!.body));
    expect(body.sound).toBe(true);
    expect(body.prompt).toContain('[Speaker, woman, warm low voice]: "You just need his number."');
    expect(s.estimatedUsd).toBeCloseTo(0.504, 4);
  });

  it('Seedance: resolução da região, aspecto mais perto, generate_audio = sound, preço por resolução', async () => {
    const { svc, calls } = live();
    const a = await svc.submitSceneVideo({ ...win, model: 'seedance-2.0', durationSec: 3, windowIndex: 0, sound: false, resolution: '480p', aspectRatio: '2:3' });
    expect(JSON.parse(String(calls[0].init!.body))).toMatchObject({ duration: 4, resolution: '480p', aspect_ratio: '3:4', generate_audio: false });
    expect(a.estimatedUsd).toBeCloseTo(4 * 0.108, 4);
    const b = await svc.submitSceneVideo({ ...win, model: 'seedance-2.0', durationSec: 6, windowIndex: 0, sound: true, resolution: '720p', aspectRatio: '9:16' });
    expect(JSON.parse(String(calls[1].init!.body))).toMatchObject({ resolution: '720p', aspect_ratio: '9:16', generate_audio: true });
    expect(b.estimatedUsd).toBeCloseTo(6 * 0.24, 4);
  });

  it('cena v1 (sem windowIndex) continua igual: som ligado, 0,168/s', async () => {
    const { svc, calls } = live();
    const s = await svc.submitSceneVideo({ ...win, model: 'kling-3.0', durationSec: 3 });
    expect(JSON.parse(String(calls[0].init!.body))).toMatchObject({ sound: true });
    expect(s.estimatedUsd).toBeCloseTo(0.504, 4);
  });

  it('submitLipsyncVideo: sync/lipsync-2 cut_off, kind LIPSYNC_VIDEO, custo = ceil(s do vídeo) × 0,05 (S1: 4,1 s cobrou 5 s)', async () => {
    const { svc, calls, costs, events } = live(4.1);
    const s = await svc.submitLipsyncVideo({ workspaceId: 'w', sceneId: 'sc', videoUrl: 'https://cdn.x/raw.mp4', audioUrl: 'https://cdn.x/slice.wav' });
    expect(calls[0].url).toContain('/sync/lipsync-2?webhook=');
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ video: 'https://cdn.x/raw.mp4', audio: 'https://cdn.x/slice.wav', sync_mode: 'cut_off' });
    expect(s.estimatedUsd).toBeCloseTo(0.25, 4);
    await svc.handleWebhook({ id: 'p1', status: 'completed', outputs: ['https://cdn/l.mp4'] });
    expect(events[0]).toMatchObject({ kind: 'LIPSYNC_VIDEO', sceneId: 'sc', outputUrls: ['https://cdn/l.mp4'] });
    expect(costs.entries[0]).toMatchObject({ kind: 'LIPSYNC', model: 'sync/lipsync-2', units: 5, unit: 'second', amountUsd: 0.25 });
  });
});

// ---------------------------------------------------------------- mock
describe('mock (§13.15.6)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  function mock() {
    const tasks = new MemoryTaskStore();
    const costs = new MemoryCostStore();
    const events: ProviderTaskFinishedEvent[] = [];
    const bus = { emit: (name: string, p: ProviderTaskFinishedEvent) => (name === PROVIDER_TASK_FINISHED ? events.push(p) : 0) };
    const gen = new FakeGenerationService(tasks, costs, bus, { publicApiUrl: 'http://api.local', probeMedia: async () => ({ durationSec: 4.1, hasAudio: false }) });
    return { tasks, costs, events, gen };
  }

  it('janela: clipe = rosto (rota lipsync do mock), window_index no evento; v2v remux', async () => {
    const { gen, events, costs } = mock();
    await gen.submitSceneVideo({ ...win, model: 'kling-3.0', durationSec: 5, windowIndex: 2, sound: false });
    await gen.submitLipsyncVideo({ workspaceId: 'w', sceneId: 'sc', videoUrl: 'http://s/raw.mp4', audioUrl: 'http://s/a.wav' });
    await jest.advanceTimersByTimeAsync(5001);
    expect(events.map((e) => [e.kind, e.windowIndex, /\/mock-media\/lipsync\/[0-9a-f]{16}\.mp4$/.test(e.outputUrls[0])])).toEqual(
      expect.arrayContaining([['SCENE_VIDEO', 2, true], ['LIPSYNC_VIDEO', undefined, true]]),
    );
    expect(costs.entries.find((c) => c.kind === 'LIPSYNC')).toMatchObject({ units: 5, amountUsd: 0 });
  });

  async function transcribeSwap(notes: string | null) {
    const { gen, tasks, events } = mock();
    await gen.submitSceneVideo({ ...win, model: 'kling-3.0', durationSec: 4, windowIndex: 0, sound: true, speech: 'one two three four five', notes });
    await gen.submitSceneVideo({ ...win, model: 'kling-3.0', durationSec: 3, windowIndex: 1, sound: true, speech: 'six seven eight', notes });
    await jest.advanceTimersByTimeAsync(5001);
    const t = await gen.submitTranscribe({ workspaceId: 'w', sceneId: 'sc', mediaUrl: 'http://s/joined.mp4', language: 'en' });
    await jest.advanceTimersByTimeAsync(5001);
    expect(events.some((e) => e.kind === 'TRANSCRIBE')).toBe(true);
    expect(tasks).toBeDefined();
    return gen.parseTranscript(t.providerTaskId);
  }

  it('(B) transcrição da cena = falas das janelas em ordem, deslocadas pela genSec', async () => {
    const { words } = await transcribeSwap(null);
    expect(words.map((x) => x.word)).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']);
    expect(words[0].startSec).toBeCloseTo(0.3, 3);
    expect(words[5].startSec).toBeCloseTo(4.3, 3); // 2ª janela começa em 4 s
  });

  it('[mock:voice-fit-out] = fala 15 % mais lenta (ratio 1,15 no reencaixe); [mock:speech-mismatch] troca metade', async () => {
    const slow = (await transcribeSwap('[mock:voice-fit-out]')).words;
    expect(slow[1].startSec - slow[0].startSec).toBeCloseTo(1.15 / 2.6, 3);
    const src = w([[0.3, 0.6], [0.685, 0.985], [1.07, 1.37], [1.454, 1.754], [1.839, 2.139]]);
    const r = fitEngineVoice({ sourceWords: src, sourceSec: 2.6, clipWords: slow.slice(0, 5), clipSec: 4 });
    expect(r).toMatchObject({ error: 'VOICE_FIT_OUT_OF_RANGE' });
    const bad = (await transcribeSwap('[mock:speech-mismatch]')).words.map((x) => x.word);
    expect(bad.filter((x) => x === 'banana')).toHaveLength(4);
  });
});
