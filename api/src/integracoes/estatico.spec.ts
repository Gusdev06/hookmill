// variacao-auto-v1 rev. 23/10 (§14.3, R-I): imagem do STATIC no GPT Image 2 (WaveSpeed). Prompt (função pura, snapshot),
// submissão real com fetch falso, recusa, custo, reconciliador 2 min / 10 min, fake com os gatilhos do §14.7 e catálogo.
// Nenhuma chamada paga: o fetch é sempre falso.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalogServiceImpl } from './catalogo/catalog.service';
import { STATIC_IMAGE_MODEL } from './catalogo/precos';
import type { StaticImageSpec, SubmitStaticImageInput } from './contrato';
import { FakeGenerationService } from './mock/fake-generation.service';
import { ensureMockMedia } from './mock/midia';
import type { ProviderTaskFinishedEvent } from './portas';
import { MemoryCostStore, MemoryTaskStore } from './store/memoria.store';
import { WaveSpeedClient } from './wavespeed/cliente';
import { REJECTED_PREFIX, WaveSpeedGenerationService } from './wavespeed/generation.service';
import { buildStaticImagePrompt, withoutPeople } from './wavespeed/prompts-midia';
import { RECONCILE, Reconciliador } from './wavespeed/reconciliador';

const SPEC: StaticImageSpec = {
  headline: 'Acorde sem dor nas costas',
  screenLanguage: 'pt-BR',
  visual: {
    object: 'A woman in her forties in a grey sweater, sitting up in bed, stretching her arms, a stunning smile',
    scene: 'a bright bedroom in the morning, rumpled white sheets, a glass of water on the nightstand',
    vibe: 'relieved and rested, soft window light from the left, early morning',
    style: 'everyday_photo',
    headlinePlacement: 'top',
  },
};

const INPUT: SubmitStaticImageInput = {
  workspaceId: 'w1', renderId: 'r1', creativeId: 'c1', variationBatchId: 'b1', spec: SPEC, aspectRatio: '9:16', safe: false, notes: null,
};

describe('buildStaticImagePrompt', () => {
  it('estrutura da skill gpt-image-2-prompt (snapshot): object/scene/vibe/photo quality/headline/aspect ratio/Avoid', () => {
    expect(buildStaticImagePrompt(SPEC, '9:16', { safe: false })).toMatchInlineSnapshot(`
"object: A woman in her forties in a grey sweater, sitting up in bed, stretching her arms, a smile
scene: a bright bedroom in the morning, rumpled white sheets, a glass of water on the nightstand
vibe: relieved and rested, soft window light from the left, early morning
photo quality and vibe: non-studio lighting, no oversharpening, real light from the location, iphone photo vibe, imperfect photo quality/raw quality (for realism), random realistic photo taken during a random moment of the day, make sure the lighting is natural and matches the background, 2k, the photo slightly soft like a phone photo while the headline text stays crisp
text on the image, exactly as written, in Brazilian Portuguese: "Acorde sem dor nas costas"
text placement: in the upper third of the frame, just below the top safe margin, inside the safe area (the top 12% and the bottom 12% of the frame stay free of text), large bold legible sans-serif letters with strong contrast against the background, written once, every letter and accent spelled exactly as given
no other text, no watermarks, no logos, no borders, no frames.
aspect ratio: 9:16
Avoid: excessive yellow in the photo, too sharp or overly sharpened image, too many highlights or glare on faces, misspelled or extra words, studio lighting, overpolished look."
`);
  });

  it('estilo e posição mudam o bloco certo; aspas da headline não quebram o prompt; aspas do visual somem', () => {
    const p = buildStaticImagePrompt({ ...SPEC, headline: 'Diga "sim" hoje', visual: { ...SPEC.visual, scene: 'a "SALE" sign', style: 'ad_graphic', headlinePlacement: 'bottom' } }, '1:1', { safe: false });
    expect(p).toContain('photo quality and vibe: social media ad creative, clean composition, strong color direction');
    expect(p).toContain('"Diga ”sim” hoje"');
    expect(p).toContain('scene: a SALE sign');
    expect(p).toContain('in the lower third of the frame');
    expect(p).toContain('aspect ratio: 1:1');
    expect(buildStaticImagePrompt({ ...SPEC, visual: { ...SPEC.visual, style: 'cinematic' } }, '4:5', { safe: false })).toContain('movie-still composition');
  });

  it('safe: sem pessoa/corpo, mantém cena (sem os trechos com gente), clima e headline', () => {
    const p = buildStaticImagePrompt(SPEC, '9:16', { safe: true });
    expect(p).not.toMatch(/woman|sweater|arms|smile/i);
    expect(p).toContain('object: an everyday setting with a few ordinary objects that fit it, empty of people');
    expect(p).toContain('scene: a bright bedroom in the morning, rumpled white sheets, a glass of water on the nightstand, nobody in the frame');
    expect(p).toContain('vibe: relieved and rested, soft window light from the left, early morning');
    expect(p).toContain('"Acorde sem dor nas costas"');
    // cena toda sobre a pessoa → cena genérica
    expect(buildStaticImagePrompt({ ...SPEC, visual: { ...SPEC.visual, scene: 'she smiles at the camera' } }, '9:16', { safe: true })).toContain('scene: an ordinary everyday setting that fits the headline, nobody in the frame');
    expect(withoutPeople('a kitchen at dawn, a man holding a cup, steam rising')).toBe('a kitchen at dawn, steam rising');
  });

  it('plano antigo (visual vazio) = pôster tipográfico com a headline', () => {
    const p = buildStaticImagePrompt({ ...SPEC, visual: { object: '', scene: '', vibe: '', style: 'ad_graphic', headlinePlacement: 'center' } }, '4:5', { safe: false });
    expect(p).toContain('object: the headline set as large bold typography, the main and only element of the image');
    expect(p).toContain('across the middle of the frame');
    expect(p).toContain('aspect ratio: 4:5');
  });
});

type Call = { url: string; init?: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = (data: Record<string, unknown>) => json(200, { code: 200, message: 'success', data });

function setup(opts: { submit?: (c: Call) => Response; result?: (c: Call) => Response; webhook?: boolean } = {}) {
  const tasks = new MemoryTaskStore();
  const costs = new MemoryCostStore();
  const events: ProviderTaskFinishedEvent[] = [];
  const calls: Call[] = [];
  let n = 0;
  const f = (async (url: string, init?: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    return c.init?.method === 'POST'
      ? (opts.submit ?? (() => envelope({ id: `p${++n}`, status: 'created', outputs: [] })))(c)
      : (opts.result ?? (() => envelope({ id: 'x', status: 'processing', outputs: [] })))(c);
  }) as unknown as typeof fetch;
  const clock = { now: Date.now() };
  const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k', fetchImpl: f }), tasks, costs, { emit: (_e: string, p: ProviderTaskFinishedEvent) => events.push(p) } as never, {
    webhookUrl: opts.webhook === false ? null : 'https://api.x/api/v1/webhooks/wavespeed', fetchImpl: f, now: () => clock.now, lookupRetryMs: 0,
  });
  return { svc, tasks, costs, events, calls, clock };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('submitStaticImage (live, fetch falso)', () => {
  it('legado: POST no gpt-image-2 text-to-image high/2k/png com o aspecto; task STATIC_IMAGE com renderId e prompt de 23/10; estimativa 0,40', async () => {
    const { svc, tasks, calls } = setup();
    for (const aspect of ['9:16', '4:5', '1:1'] as const) {
      const s = await svc.submitStaticImage({ ...INPUT, aspectRatio: aspect, notes: '[mock:static-reject]' });
      expect(s.estimatedUsd).toBe(0.4);
      const t = (await tasks.get(s.providerTaskId))!;
      expect(t).toMatchObject({ kind: 'STATIC_IMAGE', model: 'openai/gpt-image-2/text-to-image', renderId: 'r1', estimatedUsd: 0.4 });
      expect(t.input).toMatchObject({ resolution: '2k', usdPerImage: 0.4, layout: 'legacy' });
      expect(t.input.prompt).toBe(buildStaticImagePrompt(SPEC, aspect, { safe: false }));
      expect(t.input.notes).toBeUndefined(); // notas da oferta: só o mock lê
    }
    const bodies = calls.filter((c) => c.init?.method === 'POST');
    expect(bodies.map((c) => c.url.split('?')[0])).toEqual(Array(3).fill('https://api.wavespeed.ai/api/v3/openai/gpt-image-2/text-to-image'));
    expect(bodies[0].url).toContain('?webhook=');
    expect(bodies.map((c) => JSON.parse(String(c.init!.body)))).toEqual(
      (['9:16', '4:5', '1:1'] as const).map((aspect) => ({ prompt: buildStaticImagePrompt(SPEC, aspect, { safe: false }), aspect_ratio: aspect, resolution: '2k', quality: 'high', output_format: 'png' })),
    );
  });

  it('safe: true manda o prompt seguro', async () => {
    const { svc, calls } = setup();
    await svc.submitStaticImage({ ...INPUT, safe: true });
    expect(JSON.parse(String(calls[0].init!.body)).prompt).toBe(buildStaticImagePrompt(SPEC, '9:16', { safe: true }));
  });

  it('recusa na submissão = task FAILED SAFETY_BLOCK + evento com renderId, custo 0, sem cost_entry', async () => {
    const { svc, tasks, costs, events } = setup({ submit: () => json(400, { code: 400, message: 'Your request was flagged by our content moderation system' }) });
    const s = await svc.submitStaticImage(INPUT);
    expect(s.estimatedUsd).toBe(0);
    expect(s.externalId.startsWith(REJECTED_PREFIX)).toBe(true);
    await flush();
    expect(events).toEqual([{ providerTaskId: s.providerTaskId, kind: 'STATIC_IMAGE', status: 'FAILED', outputUrls: [], errorCode: 'SAFETY_BLOCK', renderId: 'r1' }]);
    expect((await tasks.get(s.providerTaskId))!.status).toBe('FAILED');
    expect(costs.entries).toHaveLength(0);
  });

  it('erro síncrono do provedor sobe (o backend marca o render FAILED PROVIDER_ERROR)', async () => {
    const { svc } = setup({ submit: () => json(500, {}) });
    await expect(svc.submitStaticImage(INPUT)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });

  it('webhook COMPLETED: cost_entry IMAGE 1 × 0,40 no criativo e no lote; evento com renderId e a URL', async () => {
    const { svc, costs, events } = setup();
    const s = await svc.submitStaticImage(INPUT);
    expect(await svc.handleWebhook({ id: s.externalId, status: 'completed', outputs: ['https://cdn.ws/i.png'] })).toBe('processed');
    expect(events).toEqual([{ providerTaskId: s.providerTaskId, kind: 'STATIC_IMAGE', status: 'COMPLETED', outputUrls: ['https://cdn.ws/i.png'], errorCode: null, renderId: 'r1' }]);
    expect(costs.entries).toEqual([
      expect.objectContaining({ kind: 'IMAGE', units: 1, unit: 'image', amountUsd: 0.4, model: 'openai/gpt-image-2/text-to-image', providerTaskId: s.providerTaskId, creativeId: 'c1', variationBatchId: 'b1' }),
    ]);
    expect(await svc.handleWebhook({ id: s.externalId, status: 'completed', outputs: ['https://cdn.ws/i.png'] })).toBe('duplicate');
  });

  it('webhook failed (NSFW) = SAFETY_BLOCK sem custo; completed sem saída = PROVIDER_ERROR', async () => {
    const { svc, costs, events } = setup();
    const a = await svc.submitStaticImage(INPUT);
    await svc.handleWebhook({ id: a.externalId, status: 'failed', error: 'NSFW content detected', outputs: [] });
    const b = await svc.submitStaticImage({ ...INPUT, renderId: 'r2' });
    await svc.handleWebhook({ id: b.externalId, status: 'completed', outputs: [] });
    expect(events.map((e) => [e.renderId, e.status, e.errorCode])).toEqual([['r1', 'FAILED', 'SAFETY_BLOCK'], ['r2', 'FAILED', 'PROVIDER_ERROR']]);
    expect(costs.entries).toHaveLength(0);
  });

  it('reconciliador: laço do STATIC consulta a partir de 2 min e dá TIMEOUT em 10 min; o laço geral não espera 30 min pra imagem', async () => {
    let status = 'processing';
    const { svc, events, clock, calls } = setup({ result: () => envelope({ id: 'x', status, outputs: status === 'completed' ? ['https://cdn.ws/i.png'] : [] }) });
    const t0 = clock.now;
    const lane = { minAgeMs: RECONCILE.staticImage.minAgeMs, timeoutMs: RECONCILE.staticImage.timeoutMs, provider: 'WAVESPEED' as const, kinds: ['STATIC_IMAGE' as const] };
    await svc.submitStaticImage(INPUT);
    await svc.submitTts({ workspaceId: 'w', sceneId: 's1', voiceId: 'Calm_Woman', text: 'x', language: 'en' });
    const gets = () => calls.filter((c) => !c.init?.method).length;

    clock.now = t0 + 90_000;
    expect(await svc.reconcile(lane)).toBe(0);
    expect(gets()).toBe(0); // 1,5 min: ainda não consulta
    clock.now = t0 + 2 * 60_000 + 5_000;
    expect(await svc.reconcile(lane)).toBe(0);
    expect(gets()).toBe(1); // 2 min: consulta só a imagem (o TTS não entra nesse laço)
    status = 'completed';
    expect(await svc.reconcile(lane)).toBe(1);
    expect(events[0]).toMatchObject({ kind: 'STATIC_IMAGE', status: 'COMPLETED', renderId: 'r1' });

    status = 'processing';
    await svc.submitStaticImage({ ...INPUT, renderId: 'r2' });
    clock.now += 10 * 60_000 + 5_000;
    // até o laço geral (webhook, 10 min / 30 min) fecha a imagem em 10 min
    expect(await svc.reconcile({ minAgeMs: RECONCILE.withWebhooks.minAgeMs, timeoutMs: RECONCILE.timeoutMs })).toBe(1);
    expect(events[1]).toMatchObject({ renderId: 'r2', status: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT' });
  });

  it('Reconciliador STATIC_IMAGE: 30 s, 2 min, só WAVESPEED + STATIC_IMAGE', async () => {
    const gen = { reconcile: jest.fn(async () => 0) };
    const r = new Reconciliador(gen as never, true, 'STATIC_IMAGE');
    expect(r.schedule).toEqual({ everyMs: 30_000, minAgeMs: 120_000 });
    await r.tick();
    expect(gen.reconcile).toHaveBeenCalledWith({ minAgeMs: 120_000, timeoutMs: 600_000, provider: 'WAVESPEED', kinds: ['STATIC_IMAGE'] });
  });
});

describe('submitStaticImage (fake, §14.7)', () => {
  const fake = () => {
    const tasks = new MemoryTaskStore();
    const costs = new MemoryCostStore();
    const events: ProviderTaskFinishedEvent[] = [];
    const svc = new FakeGenerationService(tasks, costs, { emit: (_e: string, p: ProviderTaskFinishedEvent) => events.push(p) } as never, { publicApiUrl: 'http://api.test', delayMs: () => 0 });
    return { svc, tasks, costs, events };
  };
  const until = async (cond: () => boolean, ms = 4000) => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  it('sem gatilho: COMPLETED com PNG fake no aspecto, renderId no evento, custo 0 no criativo/lote', async () => {
    const { svc, tasks, costs, events } = fake();
    const s = await svc.submitStaticImage({ ...INPUT, aspectRatio: '4:5' });
    await until(() => events.length === 1);
    expect(events[0]).toMatchObject({ kind: 'STATIC_IMAGE', status: 'COMPLETED', renderId: 'r1', errorCode: null });
    expect(events[0].outputUrls[0]).toMatch(/^http:\/\/api\.test\/api\/v1\/mock-media\/static\/[0-9a-f]{16}\.png\?format=PORTRAIT_4_5$/);
    expect((await tasks.get(s.providerTaskId))!.input.prompt).toBe(buildStaticImagePrompt(SPEC, '4:5', { safe: false }));
    expect(costs.entries).toEqual([expect.objectContaining({ kind: 'IMAGE', amountUsd: 0, creativeId: 'c1', variationBatchId: 'b1' })]);
    svc.dispose();
  });

  it('[mock:static-reject]: a 1ª recusa, o reenvio safe passa; [mock:static-reject-all]: as duas recusam; falha não cobra', async () => {
    const { svc, costs, events } = fake();
    await svc.submitStaticImage({ ...INPUT, notes: '[mock:static-reject]' });
    await until(() => events.length === 1);
    expect(events[0]).toMatchObject({ status: 'FAILED', errorCode: 'SAFETY_BLOCK', renderId: 'r1' });
    await svc.submitStaticImage({ ...INPUT, safe: true, notes: '[mock:static-reject]' });
    await until(() => events.length === 2);
    expect(events[1]).toMatchObject({ status: 'COMPLETED' });

    await svc.submitStaticImage({ ...INPUT, renderId: 'r9', notes: '[mock:static-reject-all]' });
    await svc.submitStaticImage({ ...INPUT, renderId: 'r9', safe: true, notes: '[mock:static-reject-all]' });
    await until(() => events.length === 4);
    expect(events.slice(2).map((e) => e.errorCode)).toEqual(['SAFETY_BLOCK', 'SAFETY_BLOCK']);
    expect(costs.entries).toHaveLength(1); // só a que completou
    svc.dispose();
  });

  it('[mock:static-timeout]: a 1ª task do render fecha TIMEOUT em ~3 s; o reenvio passa', async () => {
    const { svc, events } = fake();
    const t0 = Date.now();
    await svc.submitStaticImage({ ...INPUT, notes: '[mock:static-timeout]' });
    await until(() => events.length === 1, 5000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2900);
    expect(events[0]).toMatchObject({ status: 'TIMEOUT', errorCode: 'PROVIDER_TIMEOUT', renderId: 'r1' });
    await svc.submitStaticImage({ ...INPUT, notes: '[mock:static-timeout]' });
    await until(() => events.length === 2);
    expect(events[1].status).toBe('COMPLETED');
    svc.dispose();
  }, 10_000);

  it('PNG fake decodifica inteiro no tamanho do aspecto (2× a grade)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'static-mock-'));
    const prev = process.env.INTEGRACOES_MOCK_MEDIA_DIR;
    process.env.INTEGRACOES_MOCK_MEDIA_DIR = dir;
    try {
      const size = async (format: 'VERTICAL_9_16' | 'PORTRAIT_4_5' | 'SQUARE_1_1') => {
        const f = await ensureMockMedia({ kind: 'static', seed: '0123456789abcdef', format });
        expect(f.mimeType).toBe('image/png');
        return execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f.path]).toString().trim();
      };
      expect(await size('VERTICAL_9_16')).toBe('720,1280');
      expect(await size('PORTRAIT_4_5')).toBe('864,1080');
      expect(await size('SQUARE_1_1')).toBe('960,960');
    } finally {
      if (prev === undefined) delete process.env.INTEGRACOES_MOCK_MEDIA_DIR;
      else process.env.INTEGRACOES_MOCK_MEDIA_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('catálogo do STATIC', () => {
  it('STATIC_IMAGE_MODEL e estimateStaticImages (por imagem, nunca por chamada)', () => {
    // D1 = 2k (25/10): t2i 0,40, edit 0,41 (+0,012 por imagem extra), etaSec 90
    expect(STATIC_IMAGE_MODEL).toMatchObject({ providerModel: 'openai/gpt-image-2/text-to-image', editProviderModel: 'openai/gpt-image-2/edit', quality: 'high', resolution: '2k', usdPerImage: 0.4, usdPerImageEdit: 0.41, etaSec: 90 });
    const c = new CatalogServiceImpl({ voiceSampleUrl: () => '' });
    expect(c.estimateStaticImages(1)).toBe(0.4);
    expect(c.estimateStaticImages(3)).toBe(1.2);
    expect(c.estimateStaticImages(2, { withScreenRef: true })).toBe(0.82);
    expect(c.estimateStaticTextChecks(2)).toBe(0.015);
    expect(c.estimateStaticImages(0)).toBe(0);
    expect(c.estimateStaticImages(-2)).toBe(0);
  });
});
