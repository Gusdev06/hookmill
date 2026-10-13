import { PROVIDER_TASK_FINISHED, type ProviderTaskFinishedEvent } from '../portas';
import { MemoryCostStore, MemoryTaskStore } from '../store/memoria.store';
import { FakeGenerationService, defaultMockDelay, spreadWords } from './fake-generation.service';

function setup() {
  const tasks = new MemoryTaskStore();
  const costs = new MemoryCostStore();
  const events: ProviderTaskFinishedEvent[] = [];
  const bus = { emit: (name: string, p: ProviderTaskFinishedEvent) => (name === PROVIDER_TASK_FINISHED ? events.push(p) : 0) };
  // sem ffprobe em teste (timers falsos): duração desconhecida → fala estimada da cena/take
  const gen = new FakeGenerationService(tasks, costs, bus, { publicApiUrl: 'http://api.local', probeMedia: async () => ({ durationSec: null, hasAudio: true }) });
  return { tasks, costs, events, gen };
}

const scene = {
  workspaceId: 'ws1', sceneId: 'sc1', model: 'kling-3.0', faceImageUrl: 'http://s/face.png',
  speech: 'I found three hundred dollars a month', visualPrompt: 'SOLO SHOT', durationSec: 2.4,
  format: 'VERTICAL_9_16' as const, language: 'en',
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('atraso padrão fica entre 2 e 5 s e é estável por entrada', () => {
  for (const s of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const d = defaultMockDelay(s);
    expect(d).toBeGreaterThanOrEqual(2000);
    expect(d).toBeLessThanOrEqual(5000);
    expect(defaultMockDelay(s)).toBe(d);
  }
});

it('cena SCENES: grava task, termina sozinha em 2-5 s, emite evento, custo zero', async () => {
  const { tasks, costs, events, gen } = setup();
  const sub = await gen.submitSceneVideo(scene);
  expect(sub.estimatedUsd).toBe(0);
  expect(sub.externalId).toMatch(/^mock_/);
  const t = await tasks.get(sub.providerTaskId);
  expect(t).toMatchObject({ status: 'SUBMITTED', kind: 'SCENE_VIDEO', model: 'kwaivgi/kling-v3.0-pro/image-to-video', sceneId: 'sc1' });
  expect(t!.input.durationSec).toBe(3); // 2,4 s → mínimo do Kling

  await jest.advanceTimersByTimeAsync(1999);
  expect(events).toHaveLength(0);
  await jest.advanceTimersByTimeAsync(3001);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ providerTaskId: sub.providerTaskId, kind: 'SCENE_VIDEO', status: 'COMPLETED', errorCode: null, sceneId: 'sc1' });
  expect(events[0].outputUrls[0]).toMatch(/^http:\/\/api\.local\/api\/v1\/mock-media\/video\/[0-9a-f]{16}\.mp4\?format=VERTICAL_9_16&sec=3$/);
  expect((await tasks.get(sub.providerTaskId))!.status).toBe('COMPLETED');
  expect(costs.entries).toEqual([
    expect.objectContaining({ provider: 'WAVESPEED', kind: 'VIDEO', units: 3, unit: 'second', amountUsd: 0, providerTaskId: sub.providerTaskId }),
  ]);
});

it('é determinístico: mesma entrada → mesma URL de saída', async () => {
  const a = setup();
  const b = setup();
  await a.gen.submitSceneVideo(scene);
  await b.gen.submitSceneVideo(scene);
  await jest.advanceTimersByTimeAsync(5000);
  expect(a.events[0].outputUrls).toEqual(b.events[0].outputUrls);
});

it('cadeia LIPSYNC: TTS → lipsync → transcrição com tempos por palavra', async () => {
  const { events, gen, costs } = setup();
  const text = 'one two three four five six seven eight nine ten eleven twelve thirteen';
  const tts = await gen.submitTts({ workspaceId: 'ws1', sceneId: 'sc2', voiceId: 'Calm_Woman', text, language: 'en' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(events[0]).toMatchObject({ providerTaskId: tts.providerTaskId, kind: 'TTS', status: 'COMPLETED' });
  expect(events[0].outputUrls[0]).toMatch(/\/audio\/[0-9a-f]{16}\.wav\?sec=5$/); // 13 palavras / 2,6 = 5 s

  await gen.submitLipsync({ workspaceId: 'ws1', sceneId: 'sc2', faceImageUrl: 'f', audioUrl: events[0].outputUrls[0], visualPrompt: 'SOLO SHOT', format: 'PORTRAIT_4_5' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(events[1]).toMatchObject({ kind: 'LIPSYNC', status: 'COMPLETED' });
  expect(events[1].outputUrls[0]).toMatch(/\/mock-media\/lipsync\/[0-9a-f]{16}\.mp4$/); // §13.8: rosto em loop

  const tr = await gen.submitTranscribe({ workspaceId: 'ws1', sceneId: 'sc2', mediaUrl: events[1].outputUrls[0], language: 'en' });
  await expect(gen.parseWords(tr.providerTaskId)).rejects.toMatchObject({ code: 'TASK_NOT_READY' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(events[2]).toMatchObject({ kind: 'TRANSCRIBE', status: 'COMPLETED', outputUrls: [] });
  const w = await gen.parseWords(tr.providerTaskId);
  expect(w.map((x) => x.word).join(' ')).toBe(text);
  expect(w[0].startSec).toBe(0);
  expect(w[w.length - 1].endSec).toBe(5);
  expect(costs.entries.map((c) => [c.kind, c.amountUsd])).toEqual([['TTS', 0], ['LIPSYNC', 0], ['TRANSCRIBE', 0]]);
});

it('rosto: FACE_IMAGE com PNG sintético', async () => {
  const { events, gen } = setup();
  await gen.submitFace({ workspaceId: 'ws1', faceId: 'f1', description: 'woman 30s', language: 'en' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(events[0]).toMatchObject({ kind: 'FACE_IMAGE', status: 'COMPLETED', faceId: 'f1' });
  expect(events[0].outputUrls[0]).toMatch(/\/face\/[0-9a-f]{16}\.png/);
});

it.each([
  ['SAFETY_BLOCK', 'FAILED'],
  ['PROVIDER_ERROR', 'FAILED'],
  ['PROVIDER_TIMEOUT', 'TIMEOUT'],
  ['CANCELLED', 'CANCELLED'],
])('gatilho [mock:%s] termina como %s sem saída', async (code, status) => {
  const { events, gen, tasks } = setup();
  const sub = await gen.submitFace({ workspaceId: 'ws1', faceId: 'f1', description: `x [mock:${code}]`, language: 'en' });
  await jest.advanceTimersByTimeAsync(5000);
  expect(events[0]).toMatchObject({ status, errorCode: code, outputUrls: [] });
  expect((await tasks.get(sub.providerTaskId))!.errorCode).toBe(code);
});

it('rejeita modelo/voz desconhecidos antes de gravar task', async () => {
  const { gen, tasks } = setup();
  await expect(gen.submitSceneVideo({ ...scene, model: 'pruna-lipsync' })).rejects.toMatchObject({ code: 'INVALID_MODEL' });
  await expect(gen.submitTts({ workspaceId: 'w', sceneId: 's', voiceId: 'Nope', text: 'a', language: 'en' })).rejects.toMatchObject({ code: 'INVALID_VOICE' });
  expect(tasks.tasks.size).toBe(0);
});

it('retoma no boot as tasks mock que ficaram SUBMITTED, sem duplicar evento', async () => {
  const { tasks, costs, events } = setup();
  const busA = { emit: () => 0 };
  const crashed = new FakeGenerationService(tasks, costs, busA, { publicApiUrl: 'http://api.local' });
  await crashed.submitFace({ workspaceId: 'ws1', faceId: 'f9', description: 'x', language: 'en' });
  crashed.dispose(); // "API caiu" antes do timer

  const bus = { emit: (_n: string, p: ProviderTaskFinishedEvent) => events.push(p) };
  const fresh = new FakeGenerationService(tasks, costs, bus, { publicApiUrl: 'http://api.local' });
  expect(await fresh.resumePending()).toBe(1);
  expect(await fresh.resumePending()).toBe(1); // ainda SUBMITTED: agenda de novo, mas só um termina
  await jest.advanceTimersByTimeAsync(5000);
  expect(events).toHaveLength(1);
  expect(costs.entries).toHaveLength(1);
});

it('spreadWords distribui na duração', () => {
  expect(spreadWords('a b', 2)).toEqual([
    { word: 'a', startSec: 0, endSec: 1 },
    { word: 'b', startSec: 1, endSec: 2 },
  ]);
  expect(spreadWords('  ', 3)).toEqual([]);
});
