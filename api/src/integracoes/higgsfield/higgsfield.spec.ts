import { IntegracaoError } from '../erros';
import { MemoryCostStore, MemoryTaskStore } from '../store/memoria.store';
import type { ProviderTaskFinishedEvent } from '../portas';
import { WaveSpeedClient } from '../wavespeed/cliente';
import { REJECTED_PREFIX, WaveSpeedGenerationService } from '../wavespeed/generation.service';
import { RECONCILE, Reconciliador } from '../wavespeed/reconciliador';
import {
  IDENTITY_LOCK_V2,
  SLOP_WORDS,
  facePrompt,
  facePromptV2,
  lipsyncPrompt,
  lipsyncPromptV2,
  mediaPromptVersion,
  mediaPrompts,
  physicalExpressions,
  scenePrompt,
  scenePromptV2,
  scrubSlop,
} from '../wavespeed/prompts-midia';
import { HIGGSFIELD_BASE, HfContentRejected, HiggsfieldClient, hfFinalStatus } from './cliente';

type Call = { url: string; init?: RequestInit };
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
const queued = (id: string) => json(200, { status: 'queued', request_id: id, status_url: `${HIGGSFIELD_BASE}/requests/${id}/status`, cancel_url: `${HIGGSFIELD_BASE}/requests/${id}/cancel` });

describe('HiggsfieldClient', () => {
  it('submit: POST no endpoint do Soul V2 com "Key id:secret", Idempotency-Key e o corpo', async () => {
    const { f, calls } = fakeFetch(() => queued('r1'));
    const c = new HiggsfieldClient({ keyId: 'kid', keySecret: 'ksec', fetchImpl: f });
    const r = await c.submit('higgsfield-ai/soul/v2/standard', { prompt: 'x', aspect_ratio: '9:16', resolution: '1080p', batch_size: 1 }, 'idem-1');
    expect(r).toMatchObject({ requestId: 'r1', status: 'queued', images: [] });
    expect(calls[0].url).toBe('https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard');
    const h = calls[0].init!.headers as Record<string, string>;
    expect(h.authorization).toBe('Key kid:ksec');
    expect(h['idempotency-key']).toBe('idem-1');
    expect(JSON.parse(String(calls[0].init!.body))).toEqual({ prompt: 'x', aspect_ratio: '9:16', resolution: '1080p', batch_size: 1 });
  });

  it('sem chave: NOT_CONFIGURED na construção (nunca cai no mock)', () => {
    expect(() => new HiggsfieldClient({ keyId: '', keySecret: 's' })).toThrow(IntegracaoError);
    expect(() => new HiggsfieldClient({ keyId: 'k', keySecret: '' })).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
  });

  it('submit: 422 de conteúdo → HfContentRejected; 400 comum PROVIDER_ERROR; 401/402/500/rede PROVIDER_UNAVAILABLE', async () => {
    const run = (r: () => Response) => new HiggsfieldClient({ keyId: 'k', keySecret: 's', fetchImpl: fakeFetch(r).f }).submit('e', { prompt: 'x', aspect_ratio: '9:16', resolution: '1080p', batch_size: 1 }, 'i');
    await expect(run(() => json(422, { detail: 'Prompt flagged by content moderation' }))).rejects.toBeInstanceOf(HfContentRejected);
    await expect(run(() => json(400, { detail: 'aspect_ratio must be one of ...' }))).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(run(() => json(401, { detail: 'invalid credentials' }))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(run(() => json(402, { detail: 'not enough credits' }))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(run(() => json(500, {}))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(run(() => { throw new TypeError('fetch failed'); })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('status: GET /requests/{id}/status, lê images[].url; 404 TASK_NOT_FOUND', async () => {
    const { f, calls } = fakeFetch((c) => (c.url.includes('/nope/') ? json(404, { detail: 'not found' }) : json(200, { status: 'completed', request_id: 'r1', images: [{ url: 'https://cdn.hf/a.png' }] })));
    const c = new HiggsfieldClient({ keyId: 'k', keySecret: 's', fetchImpl: f });
    expect(await c.status('r1')).toMatchObject({ requestId: 'r1', status: 'completed', images: ['https://cdn.hf/a.png'] });
    expect(calls[0].url).toBe('https://api.higgsfield.ai/requests/r1/status');
    expect((calls[0].init!.headers as Record<string, string>).authorization).toBe('Key k:s');
    await expect(c.status('nope')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });

  it('status → contrato: nsfw é SAFETY_BLOCK, failed PROVIDER_ERROR, canceled CANCELLED, fila/rodando = null', () => {
    expect(hfFinalStatus({ status: 'queued', error: null })).toBeNull();
    expect(hfFinalStatus({ status: 'in_progress', error: null })).toBeNull();
    expect(hfFinalStatus({ status: 'completed', error: null })).toEqual({ status: 'COMPLETED', errorCode: null });
    expect(hfFinalStatus({ status: 'nsfw', error: null })).toEqual({ status: 'FAILED', errorCode: 'SAFETY_BLOCK' });
    expect(hfFinalStatus({ status: 'failed', error: 'internal error' })).toEqual({ status: 'FAILED', errorCode: 'PROVIDER_ERROR' });
    expect(hfFinalStatus({ status: 'canceled', error: null })).toEqual({ status: 'CANCELLED', errorCode: 'CANCELLED' });
  });
});

describe('rosto pela Higgsfield (GenerationService)', () => {
  function setup(o: { submit?: () => Response; status?: (id: string) => Response; promptVersion?: 'v1' | 'v2'; noHf?: boolean } = {}) {
    const tasks = new MemoryTaskStore();
    const costs = new MemoryCostStore();
    const events: ProviderTaskFinishedEvent[] = [];
    let n = 0;
    const hf = fakeFetch((c) => {
      if (c.init?.method === 'POST') return (o.submit ?? (() => queued(`r${++n}`)))();
      const id = c.url.split('/requests/')[1].split('/')[0];
      return (o.status ?? ((rid: string) => json(200, { status: 'in_progress', request_id: rid })))(id);
    });
    const ws = fakeFetch(() => json(500, {}));
    const clock = { now: Date.now() };
    const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k', fetchImpl: ws.f }), tasks, costs, { emit: (_e: string, p: ProviderTaskFinishedEvent) => events.push(p) } as never, {
      webhookUrl: null,
      probeSeconds: async () => 5,
      now: () => clock.now,
      lookupRetryMs: 0,
      higgsfield: o.noHf ? null : new HiggsfieldClient({ keyId: 'kid', keySecret: 'ksec', fetchImpl: hf.f }),
      promptVersion: o.promptVersion,
    });
    return { svc, tasks, costs, events, hf: hf.calls, ws: ws.calls, clock };
  }
  const flush = () => new Promise((r) => setImmediate(r));
  const fast = (svc: WaveSpeedGenerationService) => svc.reconcile({ minAgeMs: RECONCILE.higgsfield.minAgeMs, timeoutMs: RECONCILE.higgsfield.timeoutMs, provider: 'HIGGSFIELD' });

  it('submitFace: Soul V2 1080p 9:16 batch 1, task HIGGSFIELD gravada antes de responder, estimativa 0,006, nada na WaveSpeed', async () => {
    const { svc, tasks, hf, ws } = setup();
    const s = await svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'A woman, 30', language: 'en' });
    expect(s).toMatchObject({ externalId: 'r1', estimatedUsd: 0.006 });
    expect(await tasks.get(s.providerTaskId)).toMatchObject({ provider: 'HIGGSFIELD', kind: 'FACE_IMAGE', status: 'SUBMITTED', faceId: 'f1', model: 'higgsfield-ai/soul/v2/standard' });
    const body = JSON.parse(String(hf[0].init!.body));
    expect(body).toEqual({ prompt: facePromptV2('A woman, 30'), aspect_ratio: '9:16', resolution: '1080p', batch_size: 1 });
    expect((await tasks.get(s.providerTaskId))!.input).toMatchObject({ promptVersion: 'v2' });
    expect(ws).toHaveLength(0);
  });

  it('polling: completed fecha com a URL, custo 0,006 HIGGSFIELD/IMAGE e evento; repetir não duplica', async () => {
    let status = 'in_progress';
    const { svc, costs, events, clock } = setup({ status: (id) => json(200, { status, request_id: id, images: status === 'completed' ? [{ url: 'https://cdn.hf/f1.png' }] : [] }) });
    const s = await svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'x', language: 'en' });
    expect(await fast(svc)).toBe(0); // nova demais
    clock.now += 6_000;
    expect(await fast(svc)).toBe(0); // rodando
    status = 'completed';
    expect(await fast(svc)).toBe(1);
    expect(await fast(svc)).toBe(0);
    expect(events).toEqual([{ providerTaskId: s.providerTaskId, kind: 'FACE_IMAGE', status: 'COMPLETED', outputUrls: ['https://cdn.hf/f1.png'], errorCode: null, faceId: 'f1' }]);
    expect(costs.entries).toEqual([{ workspaceId: 'w', provider: 'HIGGSFIELD', kind: 'IMAGE', model: 'higgsfield-ai/soul/v2/standard', units: 1, unit: 'image', amountUsd: 0.006, providerTaskId: s.providerTaskId }]);
  });

  it('polling: nsfw → SAFETY_BLOCK, failed → PROVIDER_ERROR, completed sem imagem → PROVIDER_ERROR, todos sem custo', async () => {
    const reply: Record<string, unknown> = { r1: { status: 'nsfw' }, r2: { status: 'failed', error: 'generation failed' }, r3: { status: 'completed', images: [] } };
    const { svc, costs, events, clock } = setup({ status: (id) => json(200, { request_id: id, ...(reply[id] as object) }) });
    for (const f of ['f1', 'f2', 'f3']) await svc.submitFace({ workspaceId: 'w', faceId: f, description: 'x', language: 'en' });
    clock.now += 6_000;
    expect(await fast(svc)).toBe(3);
    expect(events.map((e) => [e.faceId, e.status, e.errorCode])).toEqual([['f1', 'FAILED', 'SAFETY_BLOCK'], ['f2', 'FAILED', 'PROVIDER_ERROR'], ['f3', 'FAILED', 'PROVIDER_ERROR']]);
    expect(costs.entries).toEqual([]);
  });

  it('polling: passou de 10 min sem terminar → TIMEOUT/PROVIDER_TIMEOUT; 404 depois do prazo → PROVIDER_ERROR', async () => {
    const { svc, events, clock } = setup({ status: (id) => (id === 'r2' ? json(404, {}) : json(200, { status: 'queued', request_id: id })) });
    await svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'x', language: 'en' });
    await svc.submitFace({ workspaceId: 'w', faceId: 'f2', description: 'y', language: 'en' });
    clock.now += 11 * 60_000;
    expect(await fast(svc)).toBe(2);
    expect(events.map((e) => [e.faceId, e.status, e.errorCode])).toEqual([['f1', 'TIMEOUT', 'PROVIDER_TIMEOUT'], ['f2', 'FAILED', 'PROVIDER_ERROR']]);
  });

  it('laço rápido só olha HIGGSFIELD; o reconciliador geral consulta cada task no provedor certo', async () => {
    const { svc, hf, ws, clock } = setup({ status: (id) => json(200, { status: 'completed', request_id: id, images: [{ url: 'https://cdn.hf/x.png' }] }) });
    await svc.submitTts({ workspaceId: 'w', sceneId: 's1', voiceId: 'Calm_Woman', text: 'oi', language: 'pt-BR' }).catch(() => undefined); // WaveSpeed 500: não cria task
    await svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'x', language: 'en' });
    clock.now += 11 * 60_000;
    expect(await svc.reconcile({ minAgeMs: 600_000, timeoutMs: RECONCILE.timeoutMs })).toBe(1);
    expect(hf.filter((c) => !c.init?.method)).toHaveLength(1);
    expect(ws.filter((c) => !c.init?.method)).toHaveLength(0);
  });

  it('sem chave da Higgsfield: submitFace NOT_CONFIGURED', async () => {
    const { svc } = setup({ noHf: true });
    await expect(svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'x', language: 'en' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('recusa de conteúdo na submissão: task FAILED/SAFETY_BLOCK pelo evento, sem custo; 503 vira PROVIDER_UNAVAILABLE', async () => {
    const a = setup({ submit: () => json(422, { detail: 'nsfw prompt detected' }) });
    const s = await a.svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'x', language: 'en' });
    expect(s.externalId.startsWith(REJECTED_PREFIX)).toBe(true);
    await flush();
    expect(a.events).toEqual([expect.objectContaining({ faceId: 'f1', status: 'FAILED', errorCode: 'SAFETY_BLOCK' })]);
    expect((await a.tasks.get(s.providerTaskId))!.provider).toBe('HIGGSFIELD');
    expect(a.costs.entries).toEqual([]);
    const b = setup({ submit: () => json(503, { detail: 'busy' }) });
    await expect(b.svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'x', language: 'en' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('MEDIA_PROMPTS=v1 manda o facePrompt V1 e registra a versão na task', async () => {
    const { svc, hf, tasks } = setup({ promptVersion: 'v1' });
    const s = await svc.submitFace({ workspaceId: 'w', faceId: 'f1', description: 'A man, 40', language: 'en' });
    expect(JSON.parse(String(hf[0].init!.body)).prompt).toBe(facePrompt('A man, 40'));
    expect((await tasks.get(s.providerTaskId))!.input).toMatchObject({ promptVersion: 'v1' });
  });

  it('Reconciliador do rosto: 5 s, provider HIGGSFIELD, timeout 10 min', async () => {
    const gen = { reconcile: jest.fn(async () => 0) };
    const r = new Reconciliador(gen, true, 'HIGGSFIELD');
    expect(r.schedule).toEqual({ everyMs: 5_000, minAgeMs: 5_000 });
    await r.tick();
    expect(gen.reconcile).toHaveBeenCalledWith({ minAgeMs: 5_000, timeoutMs: 600_000, provider: 'HIGGSFIELD' });
  });
});

describe('prompts V2 (regras da skill higgsfield-ai-prompt, lado a lado com a V1)', () => {
  const slop = new RegExp(`\\b(${SLOP_WORDS.join('|')})\\b`, 'i');
  const dirty = 'SOLO SHOT, stunning cinematic medium close-up, she wears a red shirt, blonde hair, natural light, warm smile, nods, slow push-in, 4K high quality';

  it('padrão é V2 desde 06/10 (sem env); só "v1" explícito volta pra V1', () => {
    expect(mediaPromptVersion(undefined)).toBe('v2');
    expect(mediaPromptVersion('')).toBe('v2');
    expect(mediaPromptVersion('V2')).toBe('v2');
    expect(mediaPromptVersion('v3')).toBe('v2');
    expect(mediaPromptVersion('V1')).toBe('v1');
    expect(mediaPrompts().face).toBe(facePromptV2);
    expect(mediaPrompts().lipsync).toBe(lipsyncPromptV2);
    expect(mediaPrompts().scene).toBe(scenePromptV2);
    expect(mediaPrompts('v1').lipsync).toBe(lipsyncPrompt);
    expect(mediaPrompts('v1').scene).toBe(scenePrompt);
  });

  it('nenhum prompt V2 tem palavra de slop, mesmo com entrada suja', () => {
    for (const p of [facePromptV2(`A stunning woman, 30, beautiful, ${dirty}`), scenePromptV2({ visualPrompt: dirty, speech: 'oi', language: 'pt-BR' }), lipsyncPromptV2(dirty)]) expect(p).not.toMatch(slop);
    expect(scrubSlop('stunning, cinematic close-up, 4K')).toBe('close-up');
  });

  it('rosto V2: descrição longa, realismo lisonjeiro em positivo, luz nomeada, braços em pose positiva', () => {
    const p = facePromptV2('A woman in her 30s, plain grey t-shirt, bright living room');
    expect(p).toContain('SOLO SHOT of exactly one person: A woman in her 30s, plain grey t-shirt, bright living room.');
    expect(p).toMatch(/fine, even, matte skin/);
    expect(p).toMatch(/soft window light from the left, late afternoon/);
    expect(p).toMatch(/arms rest down along the body, below the bottom edge of the frame/);
    expect(p).not.toMatch(/\b(acne|pores?|blemish\w*|rough|phone|hands?)\b/i); // positivo, sem citar o proibido
    expect(p.length).toBeGreaterThan(facePrompt('x').length);
  });

  it('lipsync V2: câmera estática ou dolly in lento, sem movimento de cabeça, expressão física, trava curta', () => {
    const p = lipsyncPromptV2(dirty);
    expect(p).not.toMatch(/head movement|\bhead\b|\bnod\w*|\btilt\w*|\blean\w*/i);
    expect(lipsyncPrompt(dirty)).toMatch(/natural head movement/); // a V1 segue igual
    expect(p).toContain('slow dolly in');
    expect(lipsyncPromptV2('SOLO SHOT, serious, leans in')).toMatch(/static camera.*brows drawn slightly together, lips pressed/);
    expect(p).toContain(IDENTITY_LOCK_V2);
    expect(p).toContain('eyebrows lift, half smile');
    expect(p).not.toMatch(/\b(red shirt|blonde|hair)\b/i);
    expect(p).not.toMatch(/\b(phone|hold\w*)\b/i);
    expect(lipsyncPromptV2('')).toMatch(/steady eye contact, a slight easy smile/);
  });

  it('cena V2: enxuta, não re-descreve aparência, mantém enquadramento/ação e a fala no formato do Kling', () => {
    const p = scenePromptV2({ visualPrompt: dirty, speech: 'Para tudo "agora"', language: 'pt-BR' });
    expect(p).not.toMatch(/\b(shirt|blonde|hair|wears)\b/i);
    expect(p).toMatch(/^SOLO SHOT, medium close-up/);
    expect(p).toContain('slow push-in');
    expect(p).toContain(IDENTITY_LOCK_V2);
    expect(p).toContain('[Speaker, warm natural voice, speaking Brazilian Portuguese]: "Para tudo ”agora”"');
    expect(p.split(/\s+/).length).toBeLessThan(scenePrompt({ visualPrompt: dirty, speech: 'Para tudo "agora"', language: 'pt-BR' }).split(/\s+/).length);
    expect(scenePromptV2({ visualPrompt: 'SOLO SHOT', speech: '', language: 'en' })).toMatch(/lips closed/);
  });

  it('emoção abstrata vira comportamento físico', () => {
    expect(physicalExpressions('confident, excited')).toEqual(['steady eye contact, chin level', 'eyebrows lift, open smile']);
    expect(physicalExpressions('medium close-up, cozy room')).toEqual([]);
  });
});
