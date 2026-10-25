import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RenderError, RenderThrottledError, type AutoEditRenderInput, type RenderSubmission, type ScratchRenderInput } from '../contrato';
import type { ClienteRemotionLambda, ProgressoLambda, SaidaS3 } from './cliente';
import { lambdaConfig, type LambdaConfig } from './config';
import { decidirWebhook, prazoEstourado, snapshotDoProgresso } from './estados';
import { LambdaRenderPort, nomeDaSaida } from './lambda-render.port';
import { problemasDeMidia } from './midia';
import type { FrameSpec } from '../../integracoes/contrato';
import type { AutoEditContext } from '../auto-edit';
import type { FrameRenderInput } from '../contrato';
import { buildFrameInput } from '../frame';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const AGORA = Date.UTC(2026, 9, 25, 12, 0, 0);
const SEGREDO = 'segredo-de-teste';

/** URL assinada SigV4 como a do StorageService (X-Amz-Date + X-Amz-Expires), assinada `haSec` atrás. */
const assinada = (arquivo: string, o: { haSec?: number; ttl?: number; host?: string } = {}) => {
  const d = new Date(AGORA - (o.haSec ?? 0) * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `https://${o.host ?? 'grbwshqevyahuukfdpfx.supabase.co'}/storage/v1/s3/hookmill/${arquivo}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=${d}&X-Amz-Expires=${o.ttl ?? 21600}&X-Amz-Signature=abc`;
};

const scratch = (over: Partial<ScratchRenderInput> = {}): ScratchRenderInput => ({
  renderId: 'r1', templateId: 'clean', format: 'VERTICAL_9_16', fps: 30, language: 'en',
  scenes: [{ clipUrl: assinada('c1.mp4'), durationSec: 2, words: [{ word: 'Oi', startSec: 0, endSec: 0.4 }] }],
  captionStyle: 'word', captionPosition: 'bottom', headline: null, ctaText: 'Go', endCard: false,
  ...over,
});

const autoEdit = (): AutoEditRenderInput => ({
  kind: 'auto-edit', renderId: 'ae1', templateId: 'auto-edit', format: 'VERTICAL_9_16', language: 'en',
  source: { videoUrl: assinada('campeao.mp4'), width: 1080, height: 1920, fps: 30, durationSec: 10, hasAudio: false },
  reframe: { mode: 'contain_blur' }, timeline: [{ startSec: 0, endSec: 2 }], joinFadeMs: 40, safeArea: { top: 0, bottom: 0 },
  palette: ['#000000'], brandName: 'X', type: 'CUT', params: { type: 'CUT', targetSec: 15 },
});

let MP4 = '';
beforeAll(() => {
  // saída "do Lambda": MP4 de verdade, 2 s × 30 fps = 60 frames, pra o ffprobe/ffmpeg do finalize rodarem de verdade
  MP4 = path.join(mkdtempSync(path.join(tmpdir(), 'lambda-saida-')), 'saida.mp4');
  execFileSync(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=108x192:r=30:d=2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', MP4]);
});

const progresso = (over: Partial<ProgressoLambda> = {}): ProgressoLambda => ({
  done: false, overallProgress: 0, framesRendered: 0, encodingStatus: null,
  renderMetadata: { frameRange: [0, 59], startedDate: AGORA, totalChunks: 1 },
  costs: { accruedSoFar: 0.004 }, errors: [], fatalErrorEncountered: false,
  outBucket: null, outKey: null, outputFile: null, currentTime: AGORA, timeoutTimestamp: AGORA + 300_000,
  ...over,
});

/** Remotion Lambda falso: guarda as chamadas e devolve a fila de progressos (o último se repete). */
function fakeCliente(o: { progressos?: (ProgressoLambda | Error)[]; submitErro?: Error } = {}) {
  const chamadas: { submit: Record<string, unknown>[]; progresso: Record<string, unknown>[] } = { submit: [], progresso: [] };
  const fila = [...(o.progressos ?? [progresso({ done: true, overallProgress: 1, framesRendered: 60 })])];
  let n = 0;
  const cliente: ClienteRemotionLambda = {
    renderMediaOnLambda: async (x) => {
      chamadas.submit.push(x);
      if (o.submitErro) throw o.submitErro;
      return { renderId: `ext-${++n}`, bucketName: 'remotionlambda-useast1-teste' };
    },
    getRenderProgress: async (x) => {
      chamadas.progresso.push(x as Record<string, unknown>);
      const p = fila.length > 1 ? fila.shift()! : fila[0];
      if (p instanceof Error) throw p;
      return p;
    },
    // o validador oficial de verdade (puro: HMAC-SHA512 de JSON.stringify(body))
    validateWebhookSignature: (x) => (require('@remotion/lambda/client') as { validateWebhookSignature: ClienteRemotionLambda['validateWebhookSignature'] }).validateWebhookSignature(x),
  };
  return { cliente, chamadas };
}

function fakeS3() {
  const baixados: string[] = [];
  const apagados: string[] = [];
  const s3: SaidaS3 = {
    baixar: async ({ bucket, key, destino }) => { baixados.push(`${bucket}/${key}`); copyFileSync(MP4, destino); },
    apagar: async ({ bucket, key }) => { apagados.push(`${bucket}/${key}`); },
  };
  return { s3, baixados, apagados };
}

const cfg = (over: Partial<LambdaConfig> = {}): LambdaConfig => ({
  ...lambdaConfig((k) => ({
    REMOTION_LAMBDA_FUNCTION: 'remotion-render-4-0-533-mem3008mb-disk4096mb-300sec',
    REMOTION_SERVE_URL: 'https://remotionlambda-useast1-teste.s3.us-east-1.amazonaws.com/sites/hookmill-abc1234/index.html',
    RENDER_WEBHOOK_SECRET: SEGREDO,
    RENDER_TMP_DIR: mkdtempSync(path.join(tmpdir(), 'lambda-tmp-')),
  } as Record<string, string>)[k]),
  ...over,
});

const novaPorta = (c: ReturnType<typeof fakeCliente>, s: ReturnType<typeof fakeS3>, over: Partial<LambdaConfig> = {}) =>
  new LambdaRenderPort(cfg(over), { cliente: c.cliente, s3: s.s3, agora: () => AGORA, templates: () => [] });

const corpoAssinado = (body: unknown, segredo = SEGREDO) => {
  const raw = Buffer.from(JSON.stringify(body));
  return { raw, headers: { 'x-remotion-signature': `sha512=${createHmac('sha512', segredo).update(raw).digest('hex')}`, 'x-remotion-status': 'success' } };
};

describe('LambdaRenderPort: submit', () => {
  it('submete com as opções do plano (§2.2) e devolve a submissão sem esperar o render', async () => {
    const c = fakeCliente();
    const sub = await novaPorta(c, fakeS3()).submit(scratch(), { attempt: 2, webhookUrl: 'https://api.hookmill.app/api/v1/webhooks/render' });
    expect(sub).toEqual({
      impl: 'lambda', externalId: 'ext-1', bucket: 'remotionlambda-useast1-teste', attempt: 2,
      serveUrl: 'https://remotionlambda-useast1-teste.s3.us-east-1.amazonaws.com/sites/hookmill-abc1234/index.html',
    });
    expect(c.chamadas.progresso).toHaveLength(0);
    const o = c.chamadas.submit[0];
    expect(o).toMatchObject({
      region: 'us-east-1', functionName: 'remotion-render-4-0-533-mem3008mb-disk4096mb-300sec', composition: 'Criativo',
      codec: 'h264', imageFormat: 'jpeg', pixelFormat: 'yuv420p', x264Preset: 'medium',
      offthreadVideoCacheSizeInBytes: 256 * 1024 * 1024, concurrencyPerLambda: 1, framesPerLambda: 150, maxRetries: 1,
      timeoutInMilliseconds: 60_000, privacy: 'private', downloadBehavior: { type: 'play-in-browser' },
      outName: 'r1-a2.mp4', logLevel: 'error',
      webhook: { url: 'https://api.hookmill.app/api/v1/webhooks/render', secret: SEGREDO, customData: { r: 'r1', a: 2 } },
    });
    expect(o.inputProps).not.toHaveProperty('renderId');
    expect(o.licenseKey).toBeUndefined();
  });

  it('remix-keep sai mudo em png/crf 10; auto-edit com aac e jpeg 90 (iguais ao local)', async () => {
    const c = fakeCliente();
    await novaPorta(c, fakeS3()).submit(autoEdit(), { attempt: 0, webhookUrl: null });
    expect(c.chamadas.submit[0]).toMatchObject({ composition: 'AutoEdit', imageFormat: 'jpeg', jpegQuality: 90, audioCodec: 'aac', muted: true });
    expect(c.chamadas.submit[0].webhook).toBeUndefined(); // sem URL = só polling
    await novaPorta(c, fakeS3()).submit({
      kind: 'remix-keep', renderId: 'rk1', templateId: 'remix-keep', canvas: { width: 720, height: 1280, fps: 30, frameCount: 60 },
      baseVideoUrl: assinada('campeao.mp4'), audioPassthroughUrl: assinada('campeao.mp4'), overlays: [], textLayers: [],
    }, { attempt: 0, webhookUrl: null });
    expect(c.chamadas.submit[1]).toMatchObject({ composition: 'RemixKeep', imageFormat: 'png', crf: 10, colorSpace: 'bt709', muted: true, outName: 'rk1-a0.mp4' });
  });

  it('RENDER_LAMBDA_WEBHOOK=off: não manda webhook mesmo com URL', async () => {
    const c = fakeCliente();
    await novaPorta(c, fakeS3(), { webhook: false }).submit(scratch(), { attempt: 0, webhookUrl: 'https://api/x' });
    expect(c.chamadas.submit[0].webhook).toBeUndefined();
  });

  it.each([
    ['localhost', 'http://localhost:9000/hookmill/c1.mp4'],
    ['127.0.0.1 (mock-media / versitygw)', 'http://127.0.0.1:4100/api/v1/mock-media/c1.mp4'],
    ['rede privada', 'http://192.168.0.10/c1.mp4'],
    ['host.docker.internal', 'http://host.docker.internal:9000/c1.mp4'],
    ['fixture relativa', 'fixtures/c1.mp4'],
    ['URL assinada vencendo (assinada há 5 h com TTL de 6 h)', assinada('c1.mp4', { haSec: 5 * 3600 })],
  ])('mídia que o Lambda não alcança = RENDER_ERROR sem invocar nada: %s', async (_nome, url) => {
    const c = fakeCliente();
    const p = novaPorta(c, fakeS3()).submit(scratch({ scenes: [{ clipUrl: url, durationSec: 2, words: [] }] }), { attempt: 0, webhookUrl: null });
    await expect(p).rejects.toBeInstanceOf(RenderError);
    await expect(p).rejects.toThrow(/mídia que o Lambda não alcança/);
    expect(c.chamadas.submit).toHaveLength(0);
  });

  it('erro de mídia não vaza a assinatura da URL', async () => {
    const c = fakeCliente();
    const e = await novaPorta(c, fakeS3()).submit(scratch({ scenes: [{ clipUrl: assinada('c1.mp4', { haSec: 6 * 3600 }), durationSec: 2, words: [] }] }), { attempt: 0, webhookUrl: null }).catch((x) => x);
    expect(String(e.message)).not.toMatch(/X-Amz-Signature/);
  });

  it('throttling da AWS ao invocar = RenderThrottledError (volta pra QUEUED, mesmo attempt, espera ≥ 15 s)', async () => {
    const erro = Object.assign(new Error('Rate Exceeded.'), { name: 'TooManyRequestsException', $metadata: { httpStatusCode: 429 } });
    const e = await novaPorta(fakeCliente({ submitErro: erro }), fakeS3()).submit(scratch(), { attempt: 1, webhookUrl: null }).catch((x) => x);
    expect(e).toBeInstanceOf(RenderThrottledError);
    expect(e).toMatchObject({ retryAfterMs: 15_000, reason: 'throttled', code: 'RENDER_THROTTLED' });
  });

  it('ConcurrentInvocationLimitExceeded também é throttling; rede caída = transient; AccessDenied = RENDER_ERROR', async () => {
    const lim = await novaPorta(fakeCliente({ submitErro: new Error('ConcurrentInvocationLimitExceeded') }), fakeS3()).submit(scratch(), { attempt: 0, webhookUrl: null }).catch((x) => x);
    expect(lim).toMatchObject({ reason: 'throttled' });
    const rede = await novaPorta(fakeCliente({ submitErro: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }) }), fakeS3()).submit(scratch(), { attempt: 0, webhookUrl: null }).catch((x) => x);
    expect(rede).toMatchObject({ reason: 'transient' });
    const negado = await novaPorta(fakeCliente({ submitErro: Object.assign(new Error('User is not authorized to perform: lambda:InvokeFunction'), { name: 'AccessDeniedException', $metadata: { httpStatusCode: 403 } }) }), fakeS3()).submit(scratch(), { attempt: 0, webhookUrl: null }).catch((x) => x);
    expect(negado).toBeInstanceOf(RenderError);
  });

  it('sem função ou site configurado: não sobe', () => {
    expect(() => new LambdaRenderPort(cfg({ functionName: '' }), { templates: () => [] })).toThrow(/REMOTION_LAMBDA_FUNCTION/);
    expect(() => new LambdaRenderPort(cfg({ webhookSecret: null }), { templates: () => [] })).toThrow(/RENDER_WEBHOOK_SECRET/);
    expect(() => new LambdaRenderPort(cfg({ webhookSecret: null, webhook: false }), { templates: () => [] })).not.toThrow();
  });
});

// Moldura (kind 'frame', estatico-montado-e-molduras-v1 §B2): mesmo builder que o backend injeta (FRAME_BUILDER).
const molduraCtx = (videoUrl = assinada('campeao.mp4')): AutoEditContext => ({
  renderId: 'fr1', type: 'FRAME' as never, params: { type: 'FRAME' } as never, language: 'pt',
  source: { videoUrl, width: 960, height: 960, fps: 24, durationSec: 31.04, hasAudio: true },
  editMap: {
    width: 960, height: 960, fps: 24, frameCount: 745, layers: [],
    faceTrack: [{ startFrame: 0, endFrame: 745, region: { x: 0, y: 0, w: 960, h: 960 }, fullFrame: true, faceInRegion: [{ atFrame: 0, box: { x: 0.41, y: 0.1, w: 0.26, h: 0.35 } }], facesMax: 1, minScore: 0.9 }],
  } as never,
  words: [], silences: [], blocks: [], hookEndSec: null, palette: ['#202020'], brandName: 'Acme', page: null,
});
const molduraSpec = (template: string, texts: unknown, over: Partial<FrameSpec> = {}): FrameSpec =>
  ({ template, texts, screenLanguage: 'pt', brand: { name: 'Coluna Leve', handle: '@colunaleve', initials: 'CL', color: '#5B4BF5' }, faceAtSec: null, second: null, suggestedPrimaryText: null, ...over }) as FrameSpec;
const noticia = (): FrameRenderInput => buildFrameInput(molduraSpec('news', { topic: 'Saúde', headline: { lead: 'Rotina de 10 minutos:', highlight: 'a dor vem da noite' }, dek: 'Leve.', cta: 'Veja' }), molduraCtx(), 'VERTICAL_9_16');

describe('LambdaRenderPort: kind frame (Moldura)', () => {
  it('vai pra composição Moldura com as props do FrameRenderInput e a codificação do local (jpeg 90, aac, com áudio)', async () => {
    const c = fakeCliente();
    const input = noticia();
    await novaPorta(c, fakeS3()).submit(input, { attempt: 0, webhookUrl: null });
    const o = c.chamadas.submit[0];
    expect(o).toMatchObject({ composition: 'Moldura', imageFormat: 'jpeg', jpegQuality: 90, audioCodec: 'aac', muted: false, outName: 'fr1-a0.mp4', framesPerLambda: 150 });
    expect(o.inputProps).toMatchObject({ format: 'VERTICAL_9_16', frame: { id: 'news' }, video: { source: { videoUrl: input.video.source.videoUrl } } });
    expect(o.inputProps).not.toHaveProperty('renderId');
    expect(o.inputProps).not.toHaveProperty('kind');
  });

  it('2ª fonte assinada e rosto do faceAtSec (face_crop do próprio campeão) passam', async () => {
    const c = fakeCliente();
    const rosto = buildFrameInput(molduraSpec('question_box', { question: 'Dói?' }, { faceAtSec: 3.2 }), molduraCtx(), 'VERTICAL_9_16');
    const foto = buildFrameInput(molduraSpec('call', { title: 'Aula', slideTitle: 'Noite 1', slideSteps: ['a', 'b'] }, { second: { kind: 'product_photo', fileUrl: assinada('produto.png') } }), molduraCtx(), 'SQUARE_1_1');
    const porta = novaPorta(c, fakeS3());
    await porta.submit(rosto, { attempt: 0, webhookUrl: null });
    await porta.submit(foto, { attempt: 0, webhookUrl: null });
    expect(c.chamadas.submit[0].inputProps).toMatchObject({ face: { kind: 'face_crop', atSec: 3.2 } });
    expect(c.chamadas.submit[1].inputProps).toMatchObject({ second: { kind: 'product_photo', fileUrl: assinada('produto.png') } });
  });

  it.each([
    ['campeão em localhost', () => buildFrameInput(molduraSpec('news', { topic: 'x', headline: { lead: 'a', highlight: 'b' }, dek: 'c', cta: 'd' }), molduraCtx('http://localhost:9000/maquina-anuncios/c.mp4'), 'VERTICAL_9_16'), /video\.source\.videoUrl/],
    ['2ª fonte em 127.0.0.1', () => buildFrameInput(molduraSpec('gossip_white', { headline: 'Dor' }, { second: { kind: 'stock_broll', fileUrl: 'http://127.0.0.1:4100/api/v1/mock-media/b.mp4', provenance: { provider: 'pexels', sourceUrl: 'u', creator: null, license: 'Pexels License', licenseCommercialOk: true, startSec: 2, endSec: 7 } } as never }), molduraCtx(), 'PORTRAIT_4_5'), /second\.fileUrl/],
    ['foto do rosto como caminho local', () => ({ ...noticia(), face: { kind: 'image', url: 'fixtures/rosto-take.jpg' } }) as FrameRenderInput, /face\.url/],
  ])('mídia que o Lambda não alcança = RENDER_ERROR sem invocar: %s', async (_n, fazer, caminho) => {
    const c = fakeCliente();
    const p = novaPorta(c, fakeS3()).submit(fazer(), { attempt: 0, webhookUrl: null });
    await expect(p).rejects.toBeInstanceOf(RenderError);
    await expect(p).rejects.toThrow(caminho);
    expect(c.chamadas.submit).toHaveLength(0);
  });

  it('finalize: nb_frames diferente do calculado = RENDER_ERROR (igual ao auto-edit)', async () => {
    const porta = new LambdaRenderPort(cfg(), { cliente: fakeCliente({ progressos: [progresso({ done: true, framesRendered: 90, renderMetadata: { frameRange: [0, 89], startedDate: AGORA } })] }).cliente, s3: fakeS3().s3, agora: () => AGORA, templates: () => [] });
    const e = await porta.finalize(noticia(), { impl: 'lambda', externalId: 'ext-1', bucket: 'b', serveUrl: null, attempt: 0 }).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(/nb_frames 60 != 90/);
  });
});

describe('LambdaRenderPort: progresso → estados do Render (§2.8)', () => {
  const sub: RenderSubmission = { impl: 'lambda', externalId: 'ext-1', bucket: 'b', serveUrl: 's', attempt: 0 };

  it('preparando → rendering → encoding → done, com custo do costs.accruedSoFar', async () => {
    const c = fakeCliente({ progressos: [
      progresso({ renderMetadata: null, overallProgress: 0.02 }),
      progresso({ overallProgress: 0.456, framesRendered: 27 }),
      progresso({ overallProgress: 0.97, framesRendered: 60 }),
      progresso({ done: true, overallProgress: 1, framesRendered: 60, costs: { accruedSoFar: 0.0123 } }),
    ] });
    const porta = novaPorta(c, fakeS3());
    const s = [await porta.snapshot(sub), await porta.snapshot(sub), await porta.snapshot(sub), await porta.snapshot(sub)];
    expect(s.map((x) => [x.state, x.progress.stage, x.progress.progress])).toEqual([
      ['running', 'bundling', 0], ['running', 'rendering', 45], ['running', 'encoding', 97], ['done', 'encoding', 99],
    ]);
    expect(s[1].progress).toEqual({ stage: 'rendering', progress: 45, frame: 27, totalFrames: 60 });
    expect(s[3].costUsd).toBe(0.0123);
    expect(c.chamadas.progresso[0]).toEqual({ functionName: cfg().functionName, bucketName: 'b', renderId: 'ext-1', region: 'us-east-1', logLevel: 'error' });
  });

  it('erro determinístico na composição = failed com o frame, sem retentativa', async () => {
    const porta = novaPorta(fakeCliente({ progressos: [progresso({ fatalErrorEncountered: true, framesRendered: 30,
      errors: [{ message: 'TypeError: x is undefined\n at Cena', name: 'Error', frame: 31, isFatal: true, willRetry: false }] })] }), fakeS3());
    expect(await porta.snapshot(sub)).toMatchObject({ state: 'failed', error: { message: 'TypeError: x is undefined', failedFrame: 31, retryable: false } });
  });

  it('erro de pedaço que o Remotion ainda vai tentar (willRetry) não derruba o render', () => {
    const s = snapshotDoProgresso(progresso({ overallProgress: 0.3, framesRendered: 20,
      errors: [{ message: 'Target closed', name: 'Error', frame: 12, isFatal: false, willRetry: true }] }));
    expect(s.state).toBe('running');
  });

  it('timeout do Remotion = timeout retryable (attempt+1; na 2ª, RENDER_TIMEOUT)', async () => {
    const porta = novaPorta(fakeCliente({ progressos: [progresso({ fatalErrorEncountered: true,
      errors: [{ message: 'The main function timed out after 300000ms.', name: 'TimeoutError', frame: null, isFatal: true, willRetry: false }] })] }), fakeS3());
    expect(await porta.snapshot(sub)).toMatchObject({ state: 'timeout', error: { failedFrame: null, retryable: true } });
  });

  it('pedaço morto por throttling = failed retryable', () => {
    const s = snapshotDoProgresso(progresso({ fatalErrorEncountered: true,
      errors: [{ message: 'TooManyRequestsException: Rate Exceeded.', name: 'TooManyRequestsException', frame: null, isFatal: true, willRetry: false }] }));
    expect(s).toMatchObject({ state: 'failed', error: { retryable: true } });
  });

  it('sem progresso por timeoutInSeconds + 60 s: prazoEstourado', () => {
    expect(prazoEstourado(new Date(AGORA - 359_000), AGORA, 300)).toBe(false);
    expect(prazoEstourado(new Date(AGORA - 361_000), AGORA, 300)).toBe(true);
  });

  it('throttling no getRenderProgress = RenderThrottledError (sem notícia neste ciclo, não é falha)', async () => {
    const porta = novaPorta(fakeCliente({ progressos: [Object.assign(new Error('Rate Exceeded.'), { name: 'TooManyRequestsException' })] }), fakeS3());
    await expect(porta.snapshot(sub)).rejects.toBeInstanceOf(RenderThrottledError);
  });
});

describe('LambdaRenderPort: finalize (S3 → API → storage)', () => {
  it('baixa a saída pro RENDER_TMP_DIR/<renderId>/, tira o pôster no ffmpeg e devolve o RenderResult de hoje + custo', async () => {
    const c = fakeCliente({ progressos: [progresso({ done: true, overallProgress: 1, framesRendered: 60, outBucket: 'remotionlambda-useast1-teste', outKey: 'renders/ext-1/r1-a0.mp4', costs: { accruedSoFar: 0.011 } })] });
    const s = fakeS3();
    const config = cfg();
    const porta = new LambdaRenderPort(config, { cliente: c.cliente, s3: s.s3, agora: () => AGORA, templates: () => [] });
    const sub = await porta.submit(scratch(), { attempt: 0, webhookUrl: null });
    const r = await porta.finalize(scratch(), sub);
    expect(s.baixados).toEqual(['remotionlambda-useast1-teste/renders/ext-1/r1-a0.mp4']);
    expect(r).toMatchObject({ width: 108, height: 192, durationSec: 2, mimeType: 'video/mp4', costUsd: 0.011 });
    expect(r.outputPath).toBe(path.join(config.tmpDir, 'r1', 'video.mp4'));
    expect(r.posterPath).toBe(path.join(config.tmpDir, 'r1', 'poster.jpg'));
    expect(existsSync(r.posterPath) && statSync(r.posterPath).size > 0).toBe(true);
    expect(r.sizeBytes).toBe(statSync(r.outputPath).size);
    expect(s.apagados).toHaveLength(0); // só apaga no release, depois do storage.put
    await porta.release(scratch(), sub);
    expect(s.apagados).toEqual([`remotionlambda-useast1-teste/renders/ext-1/${nomeDaSaida('r1', 0)}`]);
  });

  it('finalize antes do fim = RENDER_ERROR', async () => {
    const porta = novaPorta(fakeCliente({ progressos: [progresso({ overallProgress: 0.5, framesRendered: 30 })] }), fakeS3());
    await expect(porta.finalize(scratch(), { impl: 'lambda', externalId: 'ext-1', bucket: 'b', serveUrl: null, attempt: 0 })).rejects.toBeInstanceOf(RenderError);
  });

  it('auto-edit com nb_frames diferente do calculado = RENDER_ERROR e pasta apagada', async () => {
    const config = cfg();
    const porta = new LambdaRenderPort(config, { cliente: fakeCliente({ progressos: [progresso({ done: true, framesRendered: 90, renderMetadata: { frameRange: [0, 89], startedDate: AGORA } })] }).cliente, s3: fakeS3().s3, agora: () => AGORA, templates: () => [] });
    const e = await porta.finalize(autoEdit(), { impl: 'lambda', externalId: 'ext-1', bucket: 'b', serveUrl: null, attempt: 0 }).catch((x) => x);
    expect(e).toBeInstanceOf(RenderError);
    expect(e.message).toMatch(/nb_frames 60 != 90/);
    expect(existsSync(path.join(config.tmpDir, 'ae1'))).toBe(false);
  });

  it('download falhando = RENDER_ERROR (o backend tenta o finalize de novo; a saída continua no S3)', async () => {
    const s3: SaidaS3 = { baixar: async () => { throw new Error('NoSuchKey'); }, apagar: async () => undefined };
    const porta = new LambdaRenderPort(cfg(), { cliente: fakeCliente().cliente, s3, agora: () => AGORA, templates: () => [] });
    await expect(porta.finalize(scratch(), { impl: 'lambda', externalId: 'ext-1', bucket: 'b', serveUrl: null, attempt: 0 })).rejects.toThrow(/finalize: NoSuchKey/);
  });

  it('restart no meio: outra instância (memória vazia) acompanha e finaliza só com a submissão gravada no banco', async () => {
    const config = cfg();
    const antes = new LambdaRenderPort(config, { cliente: fakeCliente().cliente, s3: fakeS3().s3, agora: () => AGORA, templates: () => [] });
    const gravada = JSON.parse(JSON.stringify(await antes.submit(scratch(), { attempt: 0, webhookUrl: null }))) as RenderSubmission;
    // API reiniciou: instância nova, cliente novo
    const c = fakeCliente({ progressos: [progresso({ overallProgress: 0.5, framesRendered: 30 }), progresso({ done: true, overallProgress: 1, framesRendered: 60 })] });
    const s = fakeS3();
    const depois = new LambdaRenderPort(config, { cliente: c.cliente, s3: s.s3, agora: () => AGORA, templates: () => [] });
    expect((await depois.snapshot(gravada)).state).toBe('running');
    expect((await depois.finalize(scratch(), gravada)).durationSec).toBe(2);
    expect(s.baixados).toEqual(['remotionlambda-useast1-teste/renders/ext-1/r1-a0.mp4']); // chave calculada sem outKey
    expect(c.chamadas.submit).toHaveLength(0); // não submeteu de novo
  });
});

describe('LambdaRenderPort: webhook (§2.3)', () => {
  const porta = () => novaPorta(fakeCliente(), fakeS3());
  const corpo = (over: Record<string, unknown> = {}) => ({
    type: 'success', renderId: 'ext-1', bucketName: 'b', expectedBucketOwner: '1', customData: { r: 'r1', a: 0 },
    outputUrl: 'https://s3/x.mp4', outputFile: 'x.mp4', timeToFinish: 30000, lambdaErrors: [],
    costs: { estimatedCost: 0.0123, estimatedDisplayCost: '$0.012', currency: 'USD', disclaimer: '' }, ...over,
  });
  const linha = (over: Record<string, unknown> = {}) => ({ id: 'r1', status: 'RENDERING', impl: 'lambda', externalId: 'ext-1', attempt: 0, finalizingAt: null, ...over });

  it('assinatura certa → evento com custo', () => {
    const { raw, headers } = corpoAssinado(corpo());
    expect(porta().parseWebhook(raw, headers)).toEqual({ externalId: 'ext-1', renderId: 'r1', attempt: 0, status: 'success', costUsd: 0.0123 });
  });

  it('cabeçalho com maiúscula e array (Express) também vale; error/timeout sem custo', () => {
    const { raw, headers } = corpoAssinado(corpo({ type: 'timeout' }));
    expect(porta().parseWebhook(raw, { 'X-Remotion-Signature': [headers['x-remotion-signature']] })).toMatchObject({ status: 'timeout', costUsd: null });
  });

  it('assinatura errada, sem assinatura, corpo adulterado ou sem segredo configurado → null (401, nada gravado)', () => {
    const { raw, headers } = corpoAssinado(corpo(), 'outro-segredo');
    expect(porta().parseWebhook(raw, headers)).toBeNull();
    const ok = corpoAssinado(corpo());
    expect(porta().parseWebhook(ok.raw, {})).toBeNull();
    expect(porta().parseWebhook(ok.raw, { 'x-remotion-signature': 'NO_SECRET_PROVIDED' })).toBeNull();
    const adulterado = Buffer.from(ok.raw.toString().replace('"r1"', '"r2"'));
    expect(porta().parseWebhook(adulterado, ok.headers)).toBeNull();
    const semSegredo = new LambdaRenderPort(cfg({ webhookSecret: null, webhook: false }), { cliente: fakeCliente().cliente, s3: fakeS3().s3, templates: () => [] });
    expect(semSegredo.parseWebhook(ok.raw, ok.headers)).toBeNull();
  });

  it('assinado mas sem customData nosso → null', () => {
    const { raw, headers } = corpoAssinado(corpo({ customData: null }));
    expect(porta().parseWebhook(raw, headers)).toBeNull();
  });

  it('duplicado: o 2º (render já finalizando ou READY) é ignorado', () => {
    const ev = porta().parseWebhook(...(Object.values(corpoAssinado(corpo())) as [Buffer, Record<string, string>]))!;
    expect(decidirWebhook(ev, linha()).acao).toBe('settle');
    expect(decidirWebhook(ev, linha({ finalizingAt: new Date() }))).toEqual({ acao: 'ignorar', motivo: 'já finalizando (duplicado)' });
    expect(decidirWebhook(ev, linha({ status: 'READY' })).acao).toBe('ignorar');
  });

  it('atrasado: webhook de tentativa antiga (attempt ou externalId diferente) é ignorado', () => {
    const ev = porta().parseWebhook(...(Object.values(corpoAssinado(corpo({ type: 'timeout' }))) as [Buffer, Record<string, string>]))!;
    expect(decidirWebhook(ev, linha({ attempt: 1, externalId: 'ext-2' }))).toEqual({ acao: 'ignorar', motivo: 'tentativa antiga (atrasado)' });
    expect(decidirWebhook(ev, linha({ impl: 'local' })).acao).toBe('ignorar');
    expect(decidirWebhook(ev, null).acao).toBe('ignorar');
  });
});

describe('problemasDeMidia (nenhuma prop com localhost, §2.6)', () => {
  const o = { agoraMs: AGORA, minTtlSec: 7200 };
  it('URL assinada com folga, data: e texto comum passam', () => {
    expect(problemasDeMidia({ clipUrl: assinada('a.mp4'), img: { src: 'data:image/png;base64,AAAA' }, text: '/month only' }, o)).toEqual([]);
  });
  it('acha localhost em qualquer profundidade, com o caminho', () => {
    const p = problemasDeMidia({ scenes: [{ src: 'https://x/ok.mp4' }, { src: 'http://localhost:3000/a.mp4' }] }, o);
    expect(p).toHaveLength(1);
    expect(p[0].caminho).toBe('scenes[1].src');
  });
  it('token JWT do Supabase (/object/sign) vencido', () => {
    const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.y`;
    expect(problemasDeMidia({ u: `https://p.supabase.co/storage/v1/object/sign/b/a.mp4?token=${jwt(AGORA / 1000 + 600)}` }, o)).toHaveLength(1);
    expect(problemasDeMidia({ u: `https://p.supabase.co/storage/v1/object/sign/b/a.mp4?token=${jwt(AGORA / 1000 + 21600)}` }, o)).toHaveLength(0);
  });
});
