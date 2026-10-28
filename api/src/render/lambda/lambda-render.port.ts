// Adaptador `lambda` da RenderPort (render-lambda-v1 §2.2-§2.5 e §6.1). Sem estado em memória: tudo que precisa pra
// acompanhar e finalizar está na RenderSubmission gravada no `Render` (é o que segura restart e rollback, §2.7).
import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  RenderError,
  RenderThrottledError,
  RenderValidationError,
  isAutoEdit,
  isFrame,
  isTemplate,
  isRemixKeep,
  type RenderInput,
  type RenderPort,
  type RenderResult,
  type RenderService,
  type RenderSnapshot,
  type RenderSubmission,
  type RenderWebhookEvent,
} from '../contrato';
import { comporSobreOCampeao, contarFrames, posterPorFfmpeg, sondarVideo, type Ff } from '../posprocesso';
import { clienteRemotionReal, saidaS3Real, type ClienteRemotionLambda, type ProgressoLambda, type SaidaS3 } from './cliente';
import { faltandoNoLambda, type LambdaConfig } from './config';
import { ehThrottling, ehTransitorio, snapshotDoProgresso, totalDeFrames } from './estados';
import { problemasDeMidia, semAssinatura } from './midia';
import { montarPlano } from './plano';

/** Pós-processo trocável no teste (o padrão é o ffmpeg de verdade, o mesmo do adaptador local). */
export interface PosProcessoLambda {
  comporSobreOCampeao: typeof comporSobreOCampeao;
  contarFrames: typeof contarFrames;
  sondarVideo: typeof sondarVideo;
  posterPorFfmpeg: typeof posterPorFfmpeg;
}

export interface LambdaDeps {
  cliente?: ClienteRemotionLambda;
  s3?: SaidaS3;
  pos?: Partial<PosProcessoLambda>;
  agora?: () => number;
  /** Templates (o mesmo registro do @maquina/video que o local lista). */
  templates: RenderService['templates'];
}

/** Nome da saída no bucket: determinístico por tentativa (§2.2). A chave é renders/<externalId>/<outName>. */
export const nomeDaSaida = (renderId: string, attempt: number) => `${renderId}-a${attempt}.mp4`;
const MAX_MSG = 500;

export class LambdaRenderPort implements RenderPort {
  readonly impl = 'lambda' as const;
  private readonly log = new Logger('RenderLambda');
  private readonly cliente: ClienteRemotionLambda;
  private readonly s3: SaidaS3;
  private readonly pos: PosProcessoLambda;
  private readonly agora: () => number;
  private readonly ff: Ff;

  constructor(private readonly cfg: LambdaConfig, private readonly deps: LambdaDeps) {
    const falta = faltandoNoLambda(cfg);
    if (falta.length) throw new Error(`render lambda sem configuração: ${falta.join(', ')}`);
    this.cliente = deps.cliente ?? clienteRemotionReal();
    this.s3 = deps.s3 ?? saidaS3Real();
    this.pos = { comporSobreOCampeao, contarFrames, sondarVideo, posterPorFfmpeg, ...deps.pos };
    this.agora = deps.agora ?? Date.now;
    this.ff = { ffmpeg: cfg.ffmpeg, ffprobe: cfg.ffprobe };
  }

  templates() { return this.deps.templates(); }

  async submit(input: RenderInput, o: { attempt: number; webhookUrl: string | null }): Promise<RenderSubmission> {
    const plano = await montarPlano(input, { ffmpeg: this.cfg.ffmpeg, aviso: (m) => this.log.warn(m) });
    // §2.4/§2.6: o que o Lambda baixa tem que ser público, assinado com folga e nunca localhost
    const problemas = problemasDeMidia(plano.props, { agoraMs: this.agora(), minTtlSec: this.cfg.minUrlTtlSec });
    if (problemas.length) {
      const p = problemas[0];
      throw new RenderError('RENDER_ERROR', null,
        `mídia que o Lambda não alcança (${problemas.length}): ${p.caminho} = ${semAssinatura(p.valor)}: ${p.motivo}`.slice(0, MAX_MSG));
    }
    const webhook = this.cfg.webhook && o.webhookUrl && this.cfg.webhookSecret
      ? { url: o.webhookUrl, secret: this.cfg.webhookSecret, customData: { r: input.renderId, a: o.attempt } }
      : undefined;
    let res: { renderId: string; bucketName: string };
    try {
      res = await this.cliente.renderMediaOnLambda({
        region: this.cfg.region,
        functionName: this.cfg.functionName,
        serveUrl: this.cfg.serveUrl,
        composition: plano.compositionId,
        inputProps: plano.props,
        ...plano.codificacao,
        concurrencyPerLambda: 1,
        framesPerLambda: this.cfg.framesPerLambda,
        maxRetries: 1,
        timeoutInMilliseconds: this.cfg.delayRenderTimeoutMs,
        privacy: 'private',
        downloadBehavior: { type: 'play-in-browser' },
        outName: nomeDaSaida(input.renderId, o.attempt),
        overwrite: true,
        webhook,
        licenseKey: this.cfg.licenseKey ?? undefined,
        logLevel: 'error',
      });
    } catch (e) {
      throw this.erroDeChamada(e, `submit ${input.renderId}`);
    }
    this.log.log(`render ${input.renderId} a${o.attempt} → lambda ${res.renderId} (${plano.compositionId})`);
    return { impl: 'lambda', externalId: res.renderId, bucket: res.bucketName, serveUrl: this.cfg.serveUrl, attempt: o.attempt };
  }

  async snapshot(sub: RenderSubmission): Promise<RenderSnapshot> {
    return snapshotDoProgresso(await this.progresso(sub));
  }

  async finalize(input: RenderInput, sub: RenderSubmission): Promise<RenderResult & { costUsd: number | null }> {
    const p = await this.progresso(sub);
    if (!p.done) throw new RenderError('RENDER_ERROR', null, `finalize antes do fim (lambda ${sub.externalId})`);
    const dir = path.join(this.cfg.tmpDir, input.renderId);
    const outputPath = path.join(dir, 'video.mp4');
    const posterPath = path.join(dir, 'poster.jpg');
    const total = totalDeFrames(p);
    try {
      await rm(dir, { recursive: true, force: true });   // finalize repetido refaz do zero
      await mkdir(dir, { recursive: true });
      const remix = isRemixKeep(input);
      const baixado = remix ? path.join(dir, 'remotion.mudo.mp4') : outputPath;
      const { bucket, key } = this.saidaDe(input, sub, p);
      await this.s3.baixar({ region: this.cfg.region, bucket, key, destino: baixado });

      if (remix) {
        await this.pos.comporSobreOCampeao(this.ff, input, baixado, outputPath);
        const n = await this.pos.contarFrames(this.ff, outputPath);
        if (n !== input.canvas.frameCount) throw new RenderValidationError('RENDER_ERROR', null, `nb_frames ${n} != campeão ${input.canvas.frameCount}`);
      }
      const v = await this.pos.sondarVideo(this.ff, outputPath);
      if ((isAutoEdit(input) || isFrame(input) || isTemplate(input)) && total > 0 && v.frames !== total) throw new RenderValidationError('RENDER_ERROR', null, `nb_frames ${v.frames} != ${total} calculados`);
      const fps = v.fps > 0 ? v.fps : 30;
      const frames = total > 0 && !remix ? total : v.frames;
      await this.pos.posterPorFfmpeg(this.ff, outputPath, posterPath, Math.min(1.5, Math.max(0, (frames - 1) / fps)));
      const { size } = await stat(outputPath);
      return {
        outputPath, posterPath,
        durationSec: frames / fps,
        width: v.width, height: v.height, sizeBytes: size, mimeType: 'video/mp4',
        costUsd: typeof p.costs?.accruedSoFar === 'number' ? p.costs.accruedSoFar : null,
      };
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      if (e instanceof RenderError || e instanceof RenderThrottledError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      this.log.error(`finalize ${input.renderId} (lambda ${sub.externalId}) falhou: ${msg}`);
      throw new RenderError('RENDER_ERROR', null, `finalize: ${msg.split('\n')[0]}`.slice(0, MAX_MSG));
    }
  }

  async release(input: RenderInput, sub: RenderSubmission): Promise<void> {
    if (!sub.bucket) return;
    const key = `renders/${sub.externalId}/${nomeDaSaida(input.renderId, sub.attempt)}`;
    // a regra de ciclo de vida de 1 dia no prefixo renders/ cobre o que falhar aqui (§2.5)
    await this.s3.apagar({ region: this.cfg.region, bucket: sub.bucket, key })
      .catch((e: unknown) => this.log.warn(`release ${input.renderId}: ${(e as Error).message}`));
  }

  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): RenderWebhookEvent | null {
    const secret = this.cfg.webhookSecret;
    if (!secret) return null;
    const h = (n: string) => {
      const k = Object.keys(headers).find((x) => x.toLowerCase() === n);
      const v = k ? headers[k] : undefined;
      return Array.isArray(v) ? v[0] : v;
    };
    const sig = h('x-remotion-signature');
    if (!sig || !rawBody?.length) return null;
    let body: Record<string, unknown>;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { return null; }
    if (!body || typeof body !== 'object') return null;
    // HMAC-SHA512 do corpo cru (tempo constante); senão, o validateWebhookSignature oficial (que assina JSON.stringify(body))
    const esperado = Buffer.from(`sha512=${createHmac('sha512', secret).update(rawBody).digest('hex')}`);
    const recebido = Buffer.from(sig);
    let ok = esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
    if (!ok) {
      try { this.cliente.validateWebhookSignature({ secret, body, signatureHeader: sig }); ok = true; } catch { ok = false; }
    }
    if (!ok) return null;
    const cd = body.customData as { r?: unknown; a?: unknown } | null | undefined;
    const tipo = body.type;
    if (typeof body.renderId !== 'string' || !cd || typeof cd.r !== 'string' || !Number.isInteger(cd.a)) return null;
    if (tipo !== 'success' && tipo !== 'error' && tipo !== 'timeout') return null;
    const custo = (body.costs as { estimatedCost?: unknown } | undefined)?.estimatedCost;
    return { externalId: body.renderId, renderId: cd.r, attempt: cd.a as number, status: tipo, costUsd: tipo === 'success' && typeof custo === 'number' ? custo : null };
  }

  // ───────── internos ─────────

  private async progresso(sub: RenderSubmission): Promise<ProgressoLambda> {
    if (sub.impl !== 'lambda' || !sub.bucket) throw new RenderError('RENDER_ERROR', null, `submissão não é do lambda (${sub.impl})`);
    try {
      return await this.cliente.getRenderProgress({
        functionName: this.cfg.functionName, bucketName: sub.bucket, renderId: sub.externalId, region: this.cfg.region, logLevel: 'error',
      });
    } catch (e) {
      throw this.erroDeChamada(e, `progresso ${sub.externalId}`);
    }
  }

  private saidaDe(input: RenderInput, sub: RenderSubmission, p: ProgressoLambda) {
    return {
      bucket: p.outBucket ?? sub.bucket!,
      key: p.outKey ?? `renders/${sub.externalId}/${nomeDaSaida(input.renderId, sub.attempt)}`,
    };
  }

  /** Throttling/rede = RenderThrottledError (tenta depois, mesmo attempt); o resto = RenderError. */
  private erroDeChamada(e: unknown, onde: string): Error {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    if (ehThrottling(e)) {
      this.log.warn(`${onde}: throttling da AWS (${msg}); de novo em ${this.cfg.throttleWaitMs} ms`);
      return new RenderThrottledError(this.cfg.throttleWaitMs, msg, 'throttled');
    }
    if (ehTransitorio(e)) {
      this.log.warn(`${onde}: falha transitória (${msg})`);
      return new RenderThrottledError(this.cfg.throttleWaitMs, msg, 'transient');
    }
    this.log.error(`${onde}: ${msg}`);
    return new RenderError('RENDER_ERROR', null, msg.slice(0, MAX_MSG));
  }
}
