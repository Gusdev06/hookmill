// estatico-montado-e-molduras-v1 PARTE A (A-I, 25/10): prompt V2 (blocos, aspectos, safe, referência), submissão 2k com
// `edit` quando há referência (D4), checagem de texto por visão (Haiku) e o fake com os gatilhos do §A9.
// Nenhuma chamada paga: fetch, transporte e ffmpeg são sempre falsos.
import type { CheckStaticTextInput, StaticCopy, StaticImageSpec, StaticImageSpecV2, SubmitStaticImageInput } from './contrato';
import { CatalogServiceImpl } from './catalogo/catalog.service';
import { ClaudeLiveService } from './claude/claude.service';
import { cropPlan, imageSize, parseTextCheck, prepareCheckImages, TEXT_CHECK_SCHEMA, textCheckEffort } from './claude/checagem-texto';
import { SdkClaudeTransport, type ClaudeCall, type ClaudeResult, type ClaudeTransport } from './claude/transporte';
import { FakeClaudeService, misspell } from './mock/fake-claude.service';
import { FakeGenerationService } from './mock/fake-generation.service';
import type { ProviderTaskFinishedEvent } from './portas';
import { MemoryCostStore, MemoryTaskStore } from './store/memoria.store';
import { WaveSpeedClient } from './wavespeed/cliente';
import { WaveSpeedGenerationService } from './wavespeed/generation.service';
import { blocosPorAspecto, buildStaticImagePromptV2, staticImagePrompt, staticTextsFor, twoLines } from './wavespeed/prompts-estatico';
import { buildStaticImagePrompt } from './wavespeed/prompts-midia';

// Briefing de exemplo NO NÍVEL do experimento aprovado (gerar.ts), mas só com dado que estaria no Brain: sem "7 dias
// grátis", sem "iOS e Android", sem lista de exercícios na tela.
const COPY: StaticCopy = {
  brandLine: 'Rotina noturna de 10 min', brandLineSource: 'what',
  tagline: 'Menos dor. Mais vida.',
  headline: { lead: 'Você não nasceu pra acordar', highlight: 'com dor.' }, headlineSource: 'pains',
  subheadline: '10 minutos antes de dormir. Sem academia, sem remédio. Do seu quarto.', subheadlineSource: 'what',
  handwritten: 'Sua manhã de volta.',
  benefits: [
    { icon: 'moon', title: 'Antes de dormir', line: 'Só 10 minutos por noite.', source: 'what' },
    { icon: 'person', title: 'Guiado passo a passo', line: 'Vídeo e voz em cada movimento.', source: 'what' },
    { icon: 'home', title: 'Sem equipamento', line: 'Na cama ou no tapete.', source: 'what' },
    { icon: 'heart', title: 'Pra quem tem dor', line: 'Movimentos leves e seguros.', source: 'audience' },
  ],
  trust: [
    { icon: 'shield', text: 'Feito pra iniciantes', source: 'audience' },
    { icon: 'clock', text: '10 minutos por noite', source: 'what' },
    { icon: 'lightning', text: 'Comece hoje', source: 'cta' },
  ],
  cta: { main: 'Comece hoje', sub: null, subSource: null },
  closing: 'Seu corpo agradece. Sua manhã também.',
};
const V2: StaticImageSpecV2 = {
  layout: 'assembled', screenLanguage: 'pt-BR', brandName: 'Coluna Leve',
  palette: { background: '#140B05', accent: '#FF8A3D' },
  copy: COPY,
  visual: {
    hero: { person: 'A woman in her forties in a grey knit sweater', setting: 'sitting on the edge of her bed in a dim bedroom, one hand on her lower back', emotion: 'pain', light: 'warm lamp light on her face from the left' },
    product: { kind: 'phone_screen', look: 'tilted slightly, overlapping the woman', screenTitle: 'Hoje à noite', screenTitleSource: 'what' },
    mood: 'emotional, intimate, hopeful',
  },
  screenRefUrl: null,
};
const LEGACY: StaticImageSpec = {
  headline: 'Acorde sem dor nas costas', screenLanguage: 'pt-BR',
  visual: { object: 'A woman in her forties', scene: 'a bright bedroom', vibe: 'relieved, soft window light from the left', style: 'everyday_photo', headlinePlacement: 'top' },
};
const INPUT: SubmitStaticImageInput = { workspaceId: 'w1', renderId: 'r1', creativeId: 'c1', variationBatchId: 'b1', spec: LEGACY, specV2: V2, aspectRatio: '9:16', safe: false, notes: null };
const without = (over: Partial<StaticCopy>, visual?: Partial<StaticImageSpecV2['visual']>): StaticImageSpecV2 => ({ ...V2, copy: { ...COPY, ...over }, visual: { ...V2.visual, ...visual } });

describe('blocosPorAspecto (§A4)', () => {
  it('9:16 tem tudo; 4:5 corta fechamento e cards até 3; 1:1 corta tagline, manuscrito, confiança, sub longa e cards viram compactos', () => {
    expect(blocosPorAspecto('9:16', V2)).toEqual({ brandLine: true, tagline: true, subheadline: true, handwritten: true, hero: true, device: true, benefits: 4, compactBenefits: false, trust: true, ctaSub: false, closing: true });
    expect(blocosPorAspecto('4:5', V2)).toMatchObject({ tagline: true, handwritten: true, benefits: 3, trust: true, closing: false });
    expect(blocosPorAspecto('1:1', V2)).toMatchObject({ tagline: false, subheadline: false, handwritten: false, benefits: 3, compactBenefits: true, trust: false, closing: false });
    expect(blocosPorAspecto('1:1', without({ subheadline: 'Dez minutos antes de dormir.' })).subheadline).toBe(true); // ≤ 45 entra
  });
  it('bloco sem dado some em qualquer aspecto: cards < 3, confiança ≠ 3, sem pessoa, sem produto', () => {
    const b = blocosPorAspecto('9:16', without({ benefits: COPY.benefits.slice(0, 2), trust: [], brandLine: null, tagline: null, handwritten: null, closing: null }, { hero: null, product: { kind: 'none', look: null, screenTitle: null, screenTitleSource: null } }));
    expect(b).toMatchObject({ brandLine: false, tagline: false, handwritten: false, closing: false, benefits: 0, trust: false, hero: false, device: false });
  });
});

describe('buildStaticImagePromptV2 (§A4)', () => {
  it('9:16 completo (snapshot): ordem do experimento aprovado, paleta do backend, wordmark sem ícone, checklist exato', () => {
    expect(buildStaticImagePromptV2(V2, '9:16', { safe: false, hasScreenRef: false })).toMatchSnapshot();
  });

  it('nada inventado: só os textos do spec; tela abstrata sem palavras (só o screenTitle); nenhum dado do experimento que não veio', () => {
    const p = buildStaticImagePromptV2(V2, '9:16', { safe: false, hasScreenRef: false });
    expect(p).not.toMatch(/7 DIAS|GRÁTIS|iOS|ANDROID|Gato e vaca|3 de 5|21 dias/i);
    expect(p).toContain('abstract interface in dark mode');
    expect(p).toContain('the only words on the screen are the title "Hoje à noite"');
    expect(p).toContain('"Coluna Leve" as a bold white wordmark in typography only, with no symbol, icon or logo');
    expect(p).toContain('"ROTINA NOTURNA DE 10 MIN"');
    expect(p).toContain('on two lines "MENOS DOR." / "MAIS VIDA."');
    expect(p).toContain('"Você não nasceu pra acordar" in white, continuing straight into "com dor." in #FF8A3D');
    expect(p).toContain('"Sua manhã de volta." written with clearly separated letters, the same letters and accents as written, no extra accent marks');
    expect(p).toContain('the text "COMECE HOJE" (large, bold, white)'); // sem cta.sub = botão de 1 linha
    expect(p).toContain('Keep the top 5% and the bottom 10% of the frame free of text and buttons'); // D6
    expect(p).toContain('very dark background in a deep shade of the accent hue (#140B05)');
    expect(p.trim().endsWith('aspect ratio: 9:16')).toBe(true);
    // checklist = staticTextsFor, 1 por linha
    const list = p.split('TEXT CHECKLIST')[1].split('\n\naspect ratio')[0].split('\n').slice(1);
    expect(list).toEqual(staticTextsFor(V2, '9:16').map((t) => `"${t.text}"`));
  });

  it('omissão de bloco: sem cards o herói e o device ocupam a largura; sem trust/sub/manuscrito/fechamento os blocos não aparecem', () => {
    const p = buildStaticImagePromptV2(without({ benefits: [], trust: [], subheadline: null, handwritten: null, closing: null, tagline: null, brandLine: null }), '9:16', { safe: false, hasScreenRef: false });
    for (const b of ['RIGHT COLUMN', 'TRUST STRIP', 'SUBHEADLINE', 'HANDWRITTEN ACCENT', 'BOTTOM RIGHT', 'TOP RIGHT', 'small spaced caps "']) expect(p).not.toContain(b);
    expect(p).toContain('No cards: the hero image and the device fill the full width');
    expect(p).toContain('HERO EMOTION (large, partly cropped by the frame edge');
  });

  it('cta.sub com dado = botão de 2 linhas, em caixa alta e crítico na checagem', () => {
    const spec = without({ cta: { main: 'Comece hoje', sub: 'Teste grátis de 7 dias', subSource: 'offerAndPrice' } });
    expect(buildStaticImagePromptV2(spec, '9:16', { safe: false, hasScreenRef: false })).toContain('text in two lines "COMECE HOJE" (large, bold, white) and "TESTE GRÁTIS DE 7 DIAS"');
    expect(staticTextsFor(spec, '9:16').find((t) => t.key === 'cta.sub')).toEqual({ key: 'cta.sub', text: 'TESTE GRÁTIS DE 7 DIAS', critical: true });
  });

  it('safe: sem pessoa (natureza-morta do cenário, mesma luz), resto igual', () => {
    const p = buildStaticImagePromptV2(V2, '9:16', { safe: true, hasScreenRef: false });
    expect(p).not.toContain('HERO EMOTION');
    expect(p).not.toMatch(/\bwoman\b|\bher\b/i);
    // cenário e luz do fixture citam a pessoa ("her bed", "her face"): saem inteiros e entra o neutro
    expect(p).toContain('STILL LIFE (left side): an everyday setting that fits the mood, a few ordinary objects that fit the scene, nobody in the frame, lit by soft warm light glowing from the left.');
    const kept = buildStaticImagePromptV2(without({}, { hero: { ...V2.visual.hero!, setting: 'a dim bedroom, rumpled sheets', light: 'warm bedside lamp from the left' } }), '9:16', { safe: true, hasScreenRef: false });
    expect(kept).toContain('STILL LIFE (left side): a dim bedroom, rumpled sheets, a few ordinary objects');
    expect(kept).toContain('lit by warm bedside lamp from the left');
    expect(p).toContain('"Você não nasceu pra acordar"');
    expect(p).toContain('no element cut off except the photo on the edge');
  });

  it('D4: com referência a tela é exatamente a da imagem (sem screenTitle no prompt nem no checklist); produto físico', () => {
    const p = buildStaticImagePromptV2({ ...V2, screenRefUrl: 'https://s/cap.png' }, '9:16', { safe: false, hasScreenRef: true });
    expect(p).toContain('its screen showing exactly the screen from the reference image, kept as it is');
    expect(p).not.toContain('Hoje à noite');
    const phys = buildStaticImagePromptV2(without({}, { product: { kind: 'physical_product', look: 'a small white jar', screenTitle: null, screenTitleSource: null } }), '4:5', { safe: false, hasScreenRef: false });
    expect(phys).toContain('the product, a small white jar, standing on a soft surface with a gentle shadow, no readable label');
    expect(phys).toContain('Keep 4% margins on all sides');
  });

  it('1:1: quadrado, herói e device lado a lado, cards compactos (só título), sem tagline/manuscrito/confiança/fechamento', () => {
    const p = buildStaticImagePromptV2(V2, '1:1', { safe: false, hasScreenRef: false });
    expect(p).toContain('square direct-response ad poster');
    expect(p).toContain('RIGHT HALF, side by side with the photo');
    expect(p).toContain('BOTTOM ROW: 3 compact dark rounded cards side by side');
    expect(p).not.toContain('Só 10 minutos por noite.');
    for (const b of ['TOP RIGHT', 'HANDWRITTEN', 'TRUST STRIP', 'BOTTOM RIGHT', 'SUBHEADLINE']) expect(p).not.toContain(b);
    expect(p.trim().endsWith('aspect ratio: 1:1')).toBe(true);
  });

  it('textos com aspas retas não quebram o prompt; slop sai dos campos em inglês', () => {
    const p = buildStaticImagePromptV2(without({ headline: { lead: 'Diga "sim"', highlight: 'pro seu corpo' } }, { mood: 'stunning, cinematic, hopeful' }), '9:16', { safe: false, hasScreenRef: false });
    expect(p).toContain('"Diga ”sim”"');
    expect(p).toContain('hopeful. Subtle film grain');
    expect(p).not.toMatch(/stunning|cinematic/);
  });

  it('staticTextsFor: corta pelo aspecto, críticos = marca, headline, CTA e todo texto com número', () => {
    const t916 = staticTextsFor(V2, '9:16');
    expect(t916.filter((t) => t.critical).map((t) => t.key)).toEqual(['brand', 'brandLine', 'headline', 'subheadline', 'benefits.0.line', 'trust.1', 'cta.main']);
    expect(staticTextsFor(V2, '1:1').map((t) => t.key)).toEqual(['brand', 'brandLine', 'headline', 'screenTitle', 'benefits.0.title', 'benefits.1.title', 'benefits.2.title', 'cta.main']);
    expect(twoLines('Menos dor. Mais vida.')).toEqual(['Menos dor.', 'Mais vida.']);
    expect(twoLines('um dois três')).toEqual(['um dois', 'três']);
  });

  it('legado intacto: sem specV2 o dispatcher usa o builder de 23/10 (photo_headline e pôster)', () => {
    const { specV2: _v, ...legacy } = INPUT;
    expect(staticImagePrompt(legacy, false)).toBe(buildStaticImagePrompt(LEGACY, '9:16', { safe: false }));
    const poster = { ...LEGACY, visual: { ...LEGACY.visual, object: '', scene: '', vibe: '' } };
    expect(staticImagePrompt({ ...legacy, spec: poster }, false)).toContain('the headline set as large bold typography');
    expect(staticImagePrompt(INPUT, false)).toBe(buildStaticImagePromptV2(V2, '9:16', { safe: false, hasScreenRef: false }));
  });
});

// ---------------------------------------------------------------- submissão (fetch falso)

type Call = { url: string; init?: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const envelope = (data: Record<string, unknown>) => json(200, { code: 200, message: 'success', data });
function setup() {
  const tasks = new MemoryTaskStore();
  const costs = new MemoryCostStore();
  const events: ProviderTaskFinishedEvent[] = [];
  const calls: Call[] = [];
  let n = 0;
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return init?.method === 'POST' ? envelope({ id: `p${++n}`, status: 'created', outputs: [] }) : envelope({ id: 'x', status: 'processing', outputs: [] });
  }) as unknown as typeof fetch;
  const svc = new WaveSpeedGenerationService(new WaveSpeedClient({ apiKey: 'k', fetchImpl: f }), tasks, costs, { emit: (_e: string, p: ProviderTaskFinishedEvent) => events.push(p) } as never, {
    webhookUrl: 'https://api.x/api/v1/webhooks/wavespeed', fetchImpl: f, lookupRetryMs: 0,
  });
  return { svc, tasks, costs, calls };
}

describe('submitStaticImage V2 (live, fetch falso)', () => {
  it('assembled sem referência: text-to-image high 2k png, prompt V2, 0,40 gravado na task', async () => {
    const { svc, tasks, calls } = setup();
    const s = await svc.submitStaticImage(INPUT);
    expect(s.estimatedUsd).toBe(0.4);
    const body = JSON.parse(String(calls[0].init!.body));
    expect(calls[0].url.split('?')[0]).toBe('https://api.wavespeed.ai/api/v3/openai/gpt-image-2/text-to-image');
    expect(body).toEqual({ prompt: buildStaticImagePromptV2(V2, '9:16', { safe: false, hasScreenRef: false }), aspect_ratio: '9:16', resolution: '2k', quality: 'high', output_format: 'png' });
    expect((await tasks.get(s.providerTaskId))!.input).toMatchObject({ layout: 'assembled', resolution: '2k', usdPerImage: 0.4, model: 'openai/gpt-image-2/text-to-image' });
  });

  it('D4: com screenRefUrl vai pro gpt-image-2/edit com a referência em images; custo real 0,41 no webhook', async () => {
    const { svc, tasks, costs, calls } = setup();
    const s = await svc.submitStaticImage({ ...INPUT, specV2: { ...V2, screenRefUrl: 'https://storage.example.com/cap.png?sig=1' } });
    expect(s.estimatedUsd).toBe(0.41);
    const body = JSON.parse(String(calls[0].init!.body));
    expect(calls[0].url.split('?')[0]).toBe('https://api.wavespeed.ai/api/v3/openai/gpt-image-2/edit');
    expect(body.images).toEqual(['https://storage.example.com/cap.png?sig=1']);
    expect(body).toMatchObject({ aspect_ratio: '9:16', resolution: '2k', quality: 'high', output_format: 'png' });
    expect(body.prompt).toContain('its screen showing exactly the screen from the reference image');
    const t = (await tasks.get(s.providerTaskId))!;
    expect(t.model).toBe('openai/gpt-image-2/edit');
    expect(await svc.handleWebhook({ id: s.externalId, status: 'completed', outputs: ['https://cdn.ws/i.png'] })).toBe('processed');
    expect(costs.entries).toEqual([expect.objectContaining({ kind: 'IMAGE', units: 1, amountUsd: 0.41, model: 'openai/gpt-image-2/edit', creativeId: 'c1', variationBatchId: 'b1' })]);
  });

  it('fake: mesmo prompt V2 e modelo edit com referência (custo 0); catálogo 0,40 / 0,41', async () => {
    const tasks = new MemoryTaskStore();
    const svc = new FakeGenerationService(tasks, new MemoryCostStore(), { emit: () => true } as never, { publicApiUrl: 'http://api.test', delayMs: () => 0 });
    const s = await svc.submitStaticImage({ ...INPUT, specV2: { ...V2, screenRefUrl: 'http://storage/cap.png' } });
    const t = (await tasks.get(s.providerTaskId))!;
    expect(t.model).toBe('openai/gpt-image-2/edit');
    expect(t.input.prompt).toBe(buildStaticImagePromptV2({ ...V2, screenRefUrl: 'http://storage/cap.png' }, '9:16', { safe: false, hasScreenRef: true }));
    expect(t.input).toMatchObject({ usdPerImage: 0.41, resolution: '2k', layout: 'assembled' });
    svc.dispose();
    const c = new CatalogServiceImpl({ voiceSampleUrl: () => '' });
    expect([c.estimateStaticImages(1), c.estimateStaticImages(1, { withScreenRef: true })]).toEqual([0.4, 0.41]);
  });
});

// ---------------------------------------------------------------- checagem de texto (§A6)

const png = (w: number, h: number) => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const CHECK: CheckStaticTextInput = {
  workspaceId: 'w1', creativeId: 'c1', variationBatchId: 'b1', renderId: 'r1', imageUrl: 'https://s/static.png', language: 'pt-BR',
  expected: [{ key: 'brand', text: 'Coluna Leve', critical: true }, { key: 'handwritten', text: 'Sua manhã de volta.', critical: false }, { key: 'headline', text: 'Você não nasceu pra acordar com dor.', critical: true }],
};
class FakeTransport implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly reply: (n: number) => ClaudeResult) {}
  async run(call: ClaudeCall): Promise<ClaudeResult> {
    return this.reply(this.calls.push(call) - 1);
  }
}
const haikuUsage = [{ model: 'claude-haiku-4-5', inputTokens: 5500, outputTokens: 400, cacheWriteTokens: 0, cacheReadTokens: 0 }];

describe('checkStaticText (live, transporte e ffmpeg falsos)', () => {
  const live = (t: ClaudeTransport, costs = new MemoryCostStore(), ffmpegArgs: string[][] = []) =>
    new ClaudeLiveService(t, costs, {
      model: 'claude-opus-5-5',
      fetchImpl: (async () => new Response(png(1440, 2560), { status: 200 })) as unknown as typeof fetch,
      runFfmpeg: async (args) => { ffmpegArgs.push(args); return Buffer.from([0xff, 0xd8, 0xff, 0xd9]); },
    });

  it('Haiku 4.5 sem effort, 2 metades JPEG do 9:16, esquema estruturado; devolve o que foi visto e grava o custo no lote', async () => {
    const t = new FakeTransport(() => ({
      text: JSON.stringify({ items: [{ key: 'brand', found: true, seen: 'Coluna Leve' }, { key: 'handwritten', found: true, seen: 'Sua manhã de vólta.' }], extraText: ['iOS'] }),
      stopReason: 'end_turn', usage: haikuUsage,
    }));
    const costs = new MemoryCostStore();
    const args: string[][] = [];
    const out = await live(t, costs, args).checkStaticText(CHECK);
    expect(t.calls[0]).toMatchObject({ model: 'claude-haiku-4-5', effort: null, schema: TEXT_CHECK_SCHEMA });
    expect(t.calls[0].images!.map((i) => [i.mediaType, i.caption])).toEqual([['image/jpeg', 'Part 1 of 2 (top):'], ['image/jpeg', 'Part 2 of 2 (bottom):']]);
    expect(args[0].join(' ')).toContain('crop=iw:trunc(ih*0.55/2)*2:0:trunc(ih*0.00/2)*2');
    expect(args[1].join(' ')).toContain('trunc(ih*0.45/2)*2,scale=');
    expect(t.calls[0].user).toContain('handwritten: Sua manhã de volta.');
    expect(out.items).toEqual([
      { key: 'brand', found: true, seen: 'Coluna Leve' },
      { key: 'handwritten', found: true, seen: 'Sua manhã de vólta.' },
      { key: 'headline', found: false, seen: null }, // chave esquecida = não achada
    ]);
    expect(out.extraText).toEqual(['iOS']);
    expect(out.costUsd).toBe(0.0075); // 5,5k × 1 + 0,4k × 5 por milhão
    expect(costs.entries.map((e) => [e.kind, e.unit, e.variationBatchId, e.creativeId, e.model])).toEqual([
      ['LLM', 'ktoken_in', 'b1', 'c1', 'claude-haiku-4-5'], ['LLM', 'ktoken_out', 'b1', 'c1', 'claude-haiku-4-5'],
    ]);
  });

  it('resposta inválida tenta 1x de novo; recusa sobe SAFETY_BLOCK; imagem que não baixa = PROVIDER_ERROR; lista vazia não chama', async () => {
    const t = new FakeTransport((n) => (n === 0 ? { text: 'nope', stopReason: 'end_turn', usage: haikuUsage } : { text: JSON.stringify({ items: [], extraText: [] }), stopReason: 'end_turn', usage: haikuUsage }));
    expect((await live(t).checkStaticText(CHECK)).items.every((x) => !x.found)).toBe(true);
    expect(t.calls).toHaveLength(2);
    await expect(live(new FakeTransport(() => ({ text: '', stopReason: 'refusal', usage: haikuUsage }))).checkStaticText(CHECK)).rejects.toMatchObject({ code: 'SAFETY_BLOCK' });
    const broken = new ClaudeLiveService(new FakeTransport(() => { throw new Error('x'); }), new MemoryCostStore(), { model: 'm', fetchImpl: (async () => new Response('', { status: 404 })) as unknown as typeof fetch });
    await expect(broken.checkStaticText(CHECK)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(await live(t).checkStaticText({ ...CHECK, expected: [] })).toEqual({ items: [], extraText: [], costUsd: 0 });
  });

  it('modelo trocável por env (Haiku 5.5 aceita effort low); imagem e recorte', async () => {
    expect(textCheckEffort('claude-haiku-4-5')).toBeNull();
    expect(textCheckEffort('claude-haiku-5-5')).toBe('low');
    expect(imageSize(png(1440, 2560))).toEqual({ w: 1440, h: 2560 });
    expect(cropPlan({ w: 1440, h: 2560 })).toHaveLength(2);
    expect(cropPlan({ w: 1440, h: 1800 })).toHaveLength(1); // 4:5 inteiro
    expect(cropPlan(null)).toHaveLength(1);
    // sem ffmpeg: original se couber; grande demais = erro (backend → skipped)
    expect(await prepareCheckImages(png(100, 100), null)).toEqual([{ mediaType: 'image/png', data: png(100, 100).toString('base64'), caption: 'The ad image:' }]);
    await expect(prepareCheckImages(Buffer.concat([png(1440, 2560), Buffer.alloc(4_000_000)]), null)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(parseTextCheck('{"items":[{"key":"a","found":true,"seen":""}],"extraText":[]}', [{ key: 'a', text: 'x', critical: false }]).items).toEqual([{ key: 'a', found: false, seen: null }]);
  });

  it('transporte: modelo da chamada sem fallback de servidor e sem effort quando null', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          stream: (params: Record<string, unknown>) => {
            seen.push(params);
            return {
              async *[Symbol.asyncIterator]() {},
              finalMessage: async () => ({ model: 'claude-haiku-4-5', content: [{ type: 'text', text: '{}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
            };
          },
        },
      },
    };
    const tr = new SdkClaudeTransport(client as never, { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true });
    await tr.run({ system: 's', user: 'u', schema: {}, maxTokens: 10, model: 'claude-haiku-4-5', effort: null });
    await tr.run({ system: 's', user: 'u', schema: {}, maxTokens: 10 });
    expect(seen[0]).toMatchObject({ model: 'claude-haiku-4-5', output_config: { format: { type: 'json_schema', schema: {} } } });
    expect(seen[0].output_config).not.toHaveProperty('effort');
    expect(seen[0]).not.toHaveProperty('fallbacks');
    expect(seen[1]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'medium' }, fallbacks: 'default' });
  });
});

describe('checkStaticText (fake, §A9)', () => {
  const fake = () => new FakeClaudeService(new MemoryCostStore(), { model: 'mock', stepMs: 0 });
  it('sem gatilho vê tudo certo; [mock:static-text-mismatch] erra o 1º crítico só na 1ª do render; -all erra sempre; -fail lança', async () => {
    const f = fake();
    expect((await f.checkStaticText(CHECK)).items.every((x) => x.found && x.seen === CHECK.expected.find((e) => e.key === x.key)!.text)).toBe(true);
    const n = { ...CHECK, notes: '[mock:static-text-mismatch]' };
    const first = await f.checkStaticText(n);
    expect(first.items[0]).toEqual({ key: 'brand', found: true, seen: 'Cóluna Leve' });
    expect((await f.checkStaticText(n)).items[0].seen).toBe('Coluna Leve');
    const all = { ...CHECK, renderId: 'r2', notes: '[mock:static-text-mismatch-all]' };
    expect((await f.checkStaticText(all)).items[0].seen).not.toBe('Coluna Leve');
    expect((await f.checkStaticText(all)).items[0].seen).not.toBe('Coluna Leve');
    await expect(f.checkStaticText({ ...CHECK, notes: '[mock:static-text-fail]' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(misspell('Sua manhã de volta.')).toBe('Sua manha de volta.');
    expect(misspell('volta')).toBe('vólta');
  });
});
