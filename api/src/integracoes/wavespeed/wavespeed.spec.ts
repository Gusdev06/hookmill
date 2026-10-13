import { PROVIDER_TASK_FINISHED, type ProviderTaskFinishedEvent } from '../portas';
import { MemoryCostStore, MemoryTaskStore } from '../store/memoria.store';
import { signWebhook, verifyWebhook } from './assinatura';
import { WaveSpeedClient, WsContentRejected, isContentRefusal } from './cliente';
import { isPublicUrl } from './midia-publica';
import { REJECTED_PREFIX, WaveSpeedGenerationService } from './generation.service';
import { extractWords, finalStatus } from './normalizar';
import { facePrompt, lipsyncPrompt, scenePrompt, whisperLanguage, minimaxLanguage } from './prompts-midia';
import { RECONCILE, Reconciliador } from './reconciliador';

type Call = { url: string; init?: RequestInit };

/** fetch falso: guarda as chamadas e responde pela função. */
function fakeFetch(reply: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    return reply(c);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = (data: Record<string, unknown>) => json(200, { code: 200, message: 'success', data });

describe('WaveSpeedClient', () => {
  it('submit: POST no modelo com Bearer e ?webhook=, lê o envelope', async () => {
    const { f, calls } = fakeFetch(() => envelope({ id: 'p1', status: 'created', outputs: [], urls: { get: 'https://api.wavespeed.ai/api/v3/predictions/p1/result' } }));
    const c = new WaveSpeedClient({ apiKey: 'k', fetchImpl: f });
    const p = await c.submit('openai/gpt-image-2/text-to-image', { prompt: 'x' }, 'https://api.x.com/api/v1/webhooks/wavespeed');
    expect(p).toMatchObject({ id: 'p1', status: 'created' });
    expect(calls[0].url).toBe('https://api.wavespeed.ai/api/v3/openai/gpt-image-2/text-to-image?webhook=https%3A%2F%2Fapi.x.com%2Fapi%2Fv1%2Fwebhooks%2Fwavespeed');
    expect((calls[0].init!.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ prompt: 'x' });
  });

  it('submit: 400 de moderação vira WsContentRejected; 400 comum PROVIDER_ERROR; 401/500/rede PROVIDER_UNAVAILABLE', async () => {
    const run = (r: () => Response) => new WaveSpeedClient({ apiKey: 'k', fetchImpl: fakeFetch(r).f }).submit('m', {});
    await expect(run(() => json(400, { code: 400, message: 'Your request was flagged by our content moderation system' }))).rejects.toBeInstanceOf(WsContentRejected);
    await expect(run(() => json(400, { code: 400, message: 'duration must be integer' }))).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(run(() => json(401, { message: 'invalid key' }))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(run(() => json(500, {}))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(run(() => { throw new TypeError('fetch failed'); })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});

describe('normalização', () => {
  it('status → contrato', () => {
    expect(finalStatus({ status: 'processing', error: null })).toBeNull();
    expect(finalStatus({ status: 'completed', error: null })).toEqual({ status: 'COMPLETED', errorCode: null });
    expect(finalStatus({ status: 'failed', error: 'NSFW content detected' })).toEqual({ status: 'FAILED', errorCode: 'SAFETY_BLOCK' });
    expect(finalStatus({ status: 'failed', error: 'Service is temporarily unavailable' })).toEqual({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' });
    expect(finalStatus({ status: 'timeout', error: null })).toEqual({ status: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT' });
    expect(finalStatus({ status: 'deleted', error: null })).toEqual({ status: 'CANCELLED', errorCode: 'CANCELLED' });
  });

  it('Whisper: palavras com tempo, segmentos ou só texto (formato a confirmar na sonda)', () => {
    const words = extractWords({ text: 'oi tudo', segments: [{ text: 'oi tudo', start: 0, end: 1, words: [{ word: ' oi', start: 0, end: 0.4 }, { word: 'tudo', start: 0.4, end: 1 }] }] }, 9);
    expect(words).toEqual({ source: 'words', words: [{ word: 'oi', startSec: 0, endSec: 0.4 }, { word: 'tudo', startSec: 0.4, endSec: 1 }] });
    const chunks = extractWords(JSON.stringify({ chunks: [{ text: 'hello', timestamp: [0.5, 0.9] }] }), 9);
    expect(chunks.words).toEqual([{ word: 'hello', startSec: 0.5, endSec: 0.9 }]);
    const segs = extractWords({ segments: [{ text: 'a b', start: 2, end: 3 }] }, 9);
    expect(segs).toEqual({ source: 'segments', words: [{ word: 'a', startSec: 2, endSec: 2.5 }, { word: 'b', startSec: 2.5, endSec: 3 }] });
    expect(extractWords('one two three', 3).words.map((w) => w.endSec)).toEqual([1, 2, 3]);
    expect(extractWords(null, 3)).toEqual({ words: [], source: 'none' });
  });

  it('Whisper da WaveSpeed: text_details[].words (formato visto na sonda G3), todos os segmentos', () => {
    const out = {
      text: 'I found three hundred dollars. A month.',
      text_details: [
        { text: 'I found three hundred dollars.', start: 0, end: 2.1, words: [{ word: ' I', start: 0, end: 0.2 }, { word: ' found', start: 0.2, end: 0.6 }, { word: ' dollars.', start: 1.5, end: 2.1 }] },
        { text: 'A month.', start: 2.3, end: 3, words: [{ word: ' A', start: 2.3, end: 2.4 }, { word: ' month.', start: 2.4, end: 3 }] },
      ],
    };
    const r = extractWords(JSON.stringify(out), 9);
    expect(r.source).toBe('words');
    expect(r.words.map((w) => w.word)).toEqual(['I', 'found', 'dollars.', 'A', 'month.']);
    expect(r.words[4]).toEqual({ word: 'month.', startSec: 2.4, endSec: 3 });
  });
});

describe('assinatura do webhook', () => {
  const secret = 'whsec_c2VjcmV0';
  const body = Buffer.from('{"id":"p1","status":"completed"}');
  const now = 1_780_000_000;
  const headers = (sig: string, ts = String(now)) => ({ 'webhook-id': 'evt_1', 'webhook-timestamp': ts, 'webhook-signature': sig });

  it('aceita v3,<hex>, hex puro e lista; chave é o segredo SEM whsec_ e sem base64', () => {
    const hex = signWebhook(secret, 'evt_1', String(now), body);
    expect(hex).toBe(require('node:crypto').createHmac('sha256', 'c2VjcmV0').update(`evt_1.${now}.${body}`).digest('hex'));
    expect(verifyWebhook(headers(`v3,${hex}`), body, secret, now)).toEqual({ ok: true });
    expect(verifyWebhook(headers(hex), body, 'c2VjcmV0', now)).toEqual({ ok: true });
    expect(verifyWebhook(headers(`v1,deadbeef v3,${hex}`), body, secret, now)).toEqual({ ok: true });
  });

  it('rejeita corpo mexido, timestamp velho, sem header, sem segredo', () => {
    const hex = signWebhook(secret, 'evt_1', String(now), body);
    expect(verifyWebhook(headers(`v3,${hex}`), Buffer.from('{"id":"p1","status":"failed"}'), secret, now)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook(headers(`v3,${hex}`), body, secret, now + 301)).toEqual({ ok: false, reason: 'stale' });
    expect(verifyWebhook({}, body, secret, now)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifyWebhook(headers(`v3,${hex}`), body, null, now)).toEqual({ ok: false, reason: 'no_secret' });
  });
});

describe('prompts de mídia (armadilhas do Pruna)', () => {
  it('lipsync: SOLO SHOT, identidade travada, pose em positivo; nada de mão/celular/2ª pessoa vindo do roteiro', () => {
    const p = lipsyncPrompt('SOLO SHOT, woman 30s in kitchen, holds phone at chest height, warm smile, slow push-in, raised eyebrows');
    expect(p).toMatch(/^SOLO SHOT/);
    expect(p).toContain('stays exactly the same person from the first frame to the last');
    expect(p).toContain('warm smile');
    expect(p).toContain('raised eyebrows');
    expect(p).not.toMatch(/phone|kitchen|push-in|chest height|hand(?!s? )/i);
    expect(p).not.toMatch(/\b(no|never|not)\b/i); // só positivo: nada de "no phone", "never raises"
  });

  it('rosto centrado, 1 pessoa, peito pra cima; cena com fala no idioma e identidade travada', () => {
    expect(facePrompt('Uma mulher de 30 anos')).toMatch(/SOLO SHOT of exactly one person: Uma mulher de 30 anos.*face centered/);
    const s = scenePrompt({ visualPrompt: 'SOLO SHOT, medium close-up.', speech: 'Para tudo "agora"', language: 'pt-BR' });
    expect(s).toContain('[Speaker, warm natural voice, speaking Brazilian Portuguese]: "Para tudo ”agora”"');
    expect(s.indexOf('starts talking')).toBeLessThan(s.indexOf('[Speaker')); // ação âncora antes da fala
    expect(scenePrompt({ visualPrompt: 'SOLO SHOT', speech: '', language: 'en' })).toContain('do not speak');
    expect(whisperLanguage('pt-BR')).toBe('pt');
    expect(minimaxLanguage('es-MX')).toBe('Spanish');
    expect(minimaxLanguage('xx')).toBe('auto');
  });
});

describe('WaveSpeedGenerationService', () => {
  function setup(opts: { submit?: (c: Call) => Response; result?: (c: Call) => Response; probe?: number | null; now?: number; forceUpload?: boolean } = {}) {
    const tasks = new MemoryTaskStore();
    const costs = new MemoryCostStore();
    const events: ProviderTaskFinishedEvent[] = [];
    const bus = { emit: (_e: string, p: ProviderTaskFinishedEvent) => events.push(p) };
    let n = 0;
    let up = 0;
    const { f, calls } = fakeFetch((c) => {
      // upload de mídia: POST /media/uploads → instrução de PUT; PUT → 200; GET no S3 local → bytes
      if (c.url.endsWith('/media/uploads')) {
        const k = ++up;
        return envelope({ download_url: `https://ws-cdn.x/up${k}-${JSON.parse(String(c.init!.body)).filename}`, upload: { url: `https://s3.x/put${k}`, method: 'PUT', headers: { 'x-amz-acl': 'private' } } });
      }
      if (c.init?.method === 'PUT') return new Response(null, { status: 200 });
      if (c.url.startsWith('http://localhost:9000/')) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { 'content-type': c.url.includes('.mp3') ? 'audio/mpeg' : 'image/png' } });
      return c.init?.method === 'POST'
        ? (opts.submit ?? (() => envelope({ id: `p${++n}`, status: 'created', outputs: [] })))(c)
        : (opts.result ?? (() => envelope({ id: 'x', status: 'processing', outputs: [] })))(c);
    });
    const clock = { now: opts.now ?? Date.now() };
    const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k', fetchImpl: f }), tasks, costs, { emit: bus.emit } as never, {
      webhookUrl: 'https://api.x/api/v1/webhooks/wavespeed',
      probeSeconds: async () => (opts.probe === undefined ? 7.2 : opts.probe),
      fetchImpl: f,
      now: () => clock.now,
      lookupRetryMs: 0,
      forceUpload: opts.forceUpload,
    });
    return { svc, tasks, costs, events, calls, clock };
  }
  const flush = () => new Promise((r) => setImmediate(r));

  it('rosto saiu da WaveSpeed (06/10): sem cliente Higgsfield, NOT_CONFIGURED e nenhuma chamada', async () => {
    const { svc, calls, tasks } = setup();
    await expect(svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'A woman, 30', language: 'en' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(calls).toHaveLength(0);
    expect(tasks.tasks.size).toBe(0);
  });

  it('cena Kling: duração inteira cobrada, som ligado; Seedance: aspecto e 720p', async () => {
    const { svc, calls } = setup();
    const k = await svc.submitSceneVideo({ workspaceId: 'w', sceneId: 's1', model: 'kling-3.0', faceImageUrl: 'https://cdn.x/face.png', speech: 'oi', visualPrompt: 'SOLO SHOT', durationSec: 8.4, format: 'SQUARE_1_1', language: 'pt-BR' });
    expect(k.estimatedUsd).toBeCloseTo(9 * 0.168, 4);
    const kb = JSON.parse(String(calls[0].init!.body));
    expect(kb).toMatchObject({ duration: 9, sound: true, image: 'https://cdn.x/face.png' }); // sound vem desligado por padrão no Kling
    expect(kb.prompt).toContain('"oi"');
    await svc.submitSceneVideo({ workspaceId: 'w', sceneId: 's2', model: 'seedance-2.0', faceImageUrl: 'https://cdn.x/face.png', speech: 'oi', visualPrompt: 'SOLO SHOT', durationSec: 3, format: 'PORTRAIT_4_5', language: 'en' });
    const sb = JSON.parse(String(calls[1].init!.body));
    expect(sb).toMatchObject({ duration: 4, resolution: '720p', aspect_ratio: '3:4', generate_audio: true });
    expect(sb.prompt).toContain('"oi"');
    await expect(svc.submitSceneVideo({ workspaceId: 'w', sceneId: 's', model: 'pruna-lipsync' } as never)).rejects.toMatchObject({ code: 'INVALID_MODEL' });
  });

  it('webhook: fecha a task, grava custo real por unidade e emite o evento; reentrega é ignorada', async () => {
    const { svc, costs, events } = setup({ probe: 12.3 });
    const s = await svc.submitLipsync({ workspaceId: 'w', sceneId: 's1', faceImageUrl: 'https://cdn.x/face.png', audioUrl: 'https://a.mp3', visualPrompt: 'SOLO SHOT, smile', format: 'VERTICAL_9_16' });
    expect(s.estimatedUsd).toBeCloseTo(13 * 0.025, 4);
    const payload = { id: 'p1', status: 'completed', outputs: ['https://cdn/out.mp4'], urls: { get: 'x' } };
    expect(await svc.handleWebhook(payload)).toBe('processed');
    expect(await svc.handleWebhook(payload)).toBe('duplicate');
    expect(events).toEqual([{ providerTaskId: s.providerTaskId, kind: 'LIPSYNC', status: 'COMPLETED', outputUrls: ['https://cdn/out.mp4'], errorCode: null, sceneId: 's1' }]);
    expect(costs.entries).toEqual([expect.objectContaining({ provider: 'WAVESPEED', kind: 'LIPSYNC', units: 13, unit: 'second', amountUsd: 0.325, providerTaskId: s.providerTaskId })]);
  });

  it('falha de segurança: FAILED + SAFETY_BLOCK, sem custo; concluído sem saída vira PROVIDER_ERROR', async () => {
    const { svc, costs, events } = setup();
    await svc.submitTts({ workspaceId: 'w', sceneId: 's1', voiceId: 'Calm_Woman', text: 'x', language: 'en' });
    await svc.submitTts({ workspaceId: 'w', sceneId: 's2', voiceId: 'Calm_Woman', text: 'y', language: 'en' });
    await svc.handleWebhook({ id: 'p1', status: 'failed', error: 'Content flagged as sensitive' });
    await svc.handleWebhook({ id: 'p2', status: 'completed', outputs: [] });
    expect(events.map((e) => [e.sceneId, e.status, e.errorCode])).toEqual([['s1', 'FAILED', 'SAFETY_BLOCK'], ['s2', 'FAILED', 'PROVIDER_ERROR']]);
    expect(costs.entries).toEqual([]);
  });

  it('submissão recusada por conteúdo: task FAILED/SAFETY_BLOCK pelo mesmo evento, sem custo', async () => {
    const { svc, events, costs } = setup({ submit: () => json(400, { code: 400, message: 'prompt violates our safety policy' }) });
    const s = await svc.submitSceneVideo({ workspaceId: 'w', sceneId: 's1', model: 'kling-3.0', faceImageUrl: 'https://cdn.x/face.png', speech: 'oi', visualPrompt: 'SOLO SHOT', durationSec: 3, format: 'VERTICAL_9_16', language: 'en' });
    expect(s.externalId.startsWith(REJECTED_PREFIX)).toBe(true);
    expect(s.estimatedUsd).toBe(0);
    await flush();
    expect(events).toEqual([expect.objectContaining({ providerTaskId: s.providerTaskId, status: 'FAILED', errorCode: 'SAFETY_BLOCK', sceneId: 's1' })]);
    expect(costs.entries).toEqual([]);
  });

  it('entrada em URL local/privada (S3 em localhost) sobe pela WaveSpeed; o mesmo rosto sobe uma vez só', async () => {
    const { svc, calls } = setup({ probe: 4 });
    const face = 'http://localhost:9000/maquina-anuncios/ws/face.png?X-Amz-Signature=a';
    await svc.submitLipsync({ workspaceId: 'w', sceneId: 's1', faceImageUrl: face, audioUrl: 'http://localhost:9000/maquina-anuncios/ws/voz.mp3?X-Amz-Signature=b', visualPrompt: '', format: 'VERTICAL_9_16' });
    await svc.submitSceneVideo({ workspaceId: 'w', sceneId: 's2', model: 'kling-3.0', faceImageUrl: face.replace('=a', '=c'), speech: 'oi', visualPrompt: 'SOLO SHOT', durationSec: 3, format: 'VERTICAL_9_16', language: 'pt-BR' });
    await svc.submitTranscribe({ workspaceId: 'w', sceneId: 's1', mediaUrl: 'http://10.0.0.5/clip.mp4', language: 'pt-BR' });
    const submits = calls.filter((c) => c.init?.method === 'POST' && !c.url.endsWith('/media/uploads')).map((c) => JSON.parse(String(c.init!.body)));
    expect(submits[0].image).toMatch(/^https:\/\/ws-cdn\.x\/up\d-face\.png$/);
    expect(submits[0].audio).toMatch(/^https:\/\/ws-cdn\.x\/up\d-voz\.mp3$/);
    expect(submits[1].image).toBe(submits[0].image); // URL assinada nova, mesmo objeto: não sobe de novo
    expect(submits[2].video).toMatch(/^https:\/\/ws-cdn\.x\/up\d-clip\.mp4$/);
    expect(calls.filter((c) => c.url.endsWith('/media/uploads'))).toHaveLength(3);
    const put = calls.find((c) => c.init?.method === 'PUT')!;
    expect(put.init!.headers).toEqual({ 'x-amz-acl': 'private' });
    expect(JSON.stringify(submits)).not.toContain('localhost');
  });

  it('URL pública vai direto; PUBLIC_MEDIA=off sobe tudo', async () => {
    const a = setup();
    await a.svc.submitTranscribe({ workspaceId: 'w', sceneId: 's', mediaUrl: 'https://cdn.x/clip.mp4', language: 'en' });
    expect(a.calls.some((c) => c.url.endsWith('/media/uploads'))).toBe(false);
    const b = setup({ forceUpload: true, result: () => new Response(new Uint8Array([9]), { headers: { 'content-type': 'video/mp4' } }) });
    await b.svc.submitTranscribe({ workspaceId: 'w', sceneId: 's', mediaUrl: 'https://cdn.x/clip.mp4', language: 'en' });
    expect(b.calls.some((c) => c.url.endsWith('/media/uploads'))).toBe(true);
    expect(['http://localhost:9000/x', 'http://127.0.0.1/x', 'http://192.168.1.2/x', 'http://minio:9000/x', 'http://nas.local/x', 'http://[::1]/x'].some(isPublicUrl)).toBe(false);
    expect(['https://xyz.supabase.co/storage/v1/s3/x', 'https://d2h7xmz5gqybh9.cloudfront.net/x.png'].every(isPublicUrl)).toBe(true);
  });

  it('URL inválida/local recusada pela WaveSpeed é erro de entrada, NUNCA SAFETY_BLOCK (bug de 05/10)', async () => {
    const msg = 'Invalid image URL: private or local network URLs are not allowed';
    expect(isContentRefusal(msg)).toBe(false);
    expect(finalStatus({ status: 'failed', error: 'Invalid audio URL: private or local network URLs are not allowed' })).toEqual({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' });
    const { svc, events } = setup({ submit: () => json(400, { code: 400, message: msg }) });
    await expect(svc.submitTts({ workspaceId: 'w', sceneId: 's1', voiceId: 'Calm_Woman', text: 'x', language: 'en' })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(events).toEqual([]);
    for (const m of ['Failed to download image', 'Image size is not allowed', 'Prohibited parameter value', 'Request timeout', 'Service is temporarily unavailable'])
      expect(isContentRefusal(m)).toBe(false);
    for (const m of ['Your request was flagged by our content moderation system', 'NSFW content detected', 'prompt violates our safety policy', 'Output blocked: sensitive content'])
      expect(isContentRefusal(m)).toBe(true);
  });

  it('webhook que chega antes do insert espera a task; desconhecido é ignorado', async () => {
    const { svc } = setup();
    expect(await svc.handleWebhook({ id: 'nope', status: 'completed', outputs: ['https://x'] })).toBe('unknown');
  });

  it('transcrição: baixa a saída de texto, normaliza palavras, cobra segundos de mídia; parseWords lê do banco', async () => {
    const whisper = { segments: [{ text: 'Para tudo', start: 0, end: 1, words: [{ word: 'Para', start: 0, end: 0.4 }, { word: 'tudo', start: 0.4, end: 1 }] }] };
    const { svc, costs, events } = setup({
      probe: 8.5,
      result: (c) => (c.url === 'https://cdn/out.json' ? new Response(JSON.stringify(whisper)) : envelope({})),
    });
    const s = await svc.submitTranscribe({ workspaceId: 'w', sceneId: 's1', mediaUrl: 'https://clip.mp4', language: 'pt-BR' });
    await expect(svc.parseWords(s.providerTaskId)).rejects.toMatchObject({ code: 'TASK_NOT_READY' });
    await svc.handleWebhook({ id: 'p1', status: 'completed', outputs: ['https://cdn/out.json'] });
    expect(await svc.parseWords(s.providerTaskId)).toEqual([{ word: 'Para', startSec: 0, endSec: 0.4 }, { word: 'tudo', startSec: 0.4, endSec: 1 }]);
    expect(events[0].outputUrls).toEqual([]); // nada pro storage baixar
    expect(costs.entries[0]).toMatchObject({ kind: 'TRANSCRIBE', units: 9, amountUsd: 0.018 });
  });

  it('TTS: custo por caractere; sem ffprobe o lipsync usa a fala da cena', async () => {
    const { svc, costs } = setup({ probe: null });
    const text = 'Uma frase de teste com oito palavras aqui';
    await svc.submitTts({ workspaceId: 'w', sceneId: 's1', voiceId: 'Calm_Woman', text, language: 'pt-BR' });
    await svc.handleWebhook({ id: 'p1', status: 'completed', outputs: ['https://cdn/a.mp3'] });
    expect(costs.entries[0]).toMatchObject({ kind: 'TTS', units: text.length, unit: 'character', amountUsd: Math.round(text.length * 0.00006 * 1e4) / 1e4 });
    const l = await svc.submitLipsync({ workspaceId: 'w', sceneId: 's1', faceImageUrl: 'https://cdn.x/face.png', audioUrl: 'https://cdn/a.mp3', visualPrompt: '', format: 'VERTICAL_9_16' });
    expect(l.estimatedUsd).toBeCloseTo(4 * 0.025, 4); // 8 palavras / 2,6 = 3,1 s → 4 s
    await expect(svc.submitTts({ workspaceId: 'w', sceneId: 's', voiceId: 'Nope', text: 'x', language: 'en' })).rejects.toMatchObject({ code: 'INVALID_VOICE' });
  });

  it('reconciliador: fecha pelo polling o que terminou, TIMEOUT depois de 30 min, ignora as novas', async () => {
    let status = 'processing';
    const { svc, tasks, events, clock, calls } = setup({ result: () => envelope({ id: 'p1', status, outputs: status === 'completed' ? ['https://cdn/a.mp3'] : [] }) });
    const t0 = clock.now;
    await svc.submitTts({ workspaceId: 'w', sceneId: 's1', voiceId: 'Calm_Woman', text: 'x', language: 'en' });
    expect(await svc.reconcile({ minAgeMs: 600_000, timeoutMs: RECONCILE.timeoutMs })).toBe(0); // nova demais
    expect(calls.filter((c) => !c.init?.method)).toHaveLength(0);
    clock.now = t0 + 11 * 60_000;
    expect(await svc.reconcile({ minAgeMs: 600_000, timeoutMs: RECONCILE.timeoutMs })).toBe(0); // ainda rodando
    status = 'completed';
    expect(await svc.reconcile({ minAgeMs: 600_000, timeoutMs: RECONCILE.timeoutMs })).toBe(1);
    expect(events[0]).toMatchObject({ status: 'COMPLETED', outputUrls: ['https://cdn/a.mp3'] });

    status = 'processing';
    await svc.submitTts({ workspaceId: 'w', sceneId: 's2', voiceId: 'Calm_Woman', text: 'y', language: 'en' });
    clock.now += 31 * 60_000;
    expect(await svc.reconcile({ minAgeMs: 600_000, timeoutMs: RECONCILE.timeoutMs })).toBe(1);
    expect(events[1]).toMatchObject({ sceneId: 's2', status: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT' });
    expect([...tasks.polled.values()].length).toBe(2);
  });

  it('Reconciliador: intervalo depende do webhook e não sobrepõe rodadas', async () => {
    const gen = { reconcile: jest.fn(() => new Promise<number>((r) => setTimeout(() => r(1), 5))) };
    const r = new Reconciliador(gen as never, false);
    expect(r.schedule).toEqual(RECONCILE.pollingOnly);
    expect(new Reconciliador(gen as never, true).schedule).toEqual(RECONCILE.withWebhooks);
    const [a, b] = await Promise.all([r.tick(), r.tick()]);
    expect([a, b]).toEqual([1, 0]);
    expect(gen.reconcile).toHaveBeenCalledTimes(1);
  });
});

it('evento interno tem o nome do contrato', () => {
  expect(PROVIDER_TASK_FINISHED).toBe('provider.task.finished');
});
