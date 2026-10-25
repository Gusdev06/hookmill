// Mapeamento Remotion Lambda → estados do `Render` de hoje (render-lambda-v1 §2.7 e §2.8). Funções puras.
import type { RenderSnapshot, RenderWebhookEvent } from '../contrato';
import { frameDoErro } from '../progresso';
import type { ProgressoLambda } from './cliente';

type ErroLike = { name?: unknown; message?: unknown; stack?: unknown; code?: unknown; $metadata?: { httpStatusCode?: number } } | null | undefined;
const texto = (e: ErroLike) => (e ? `${String(e.name ?? '')} ${String(e.code ?? '')} ${String(e.message ?? '')} ${String(e.stack ?? '')}` : '');

/** Cota de concorrência da AWS (o mesmo critério do Remotion em lambda-client: TooManyRequestsException / Rate Exceeded /
 *  ConcurrentInvocationLimitExceeded), throttling do S3/STS e HTTP 429. */
export function ehThrottling(e: unknown): boolean {
  const x = e as ErroLike;
  return x?.$metadata?.httpStatusCode === 429 ||
    /TooManyRequests|Rate Exceeded|ConcurrentInvocationLimitExceeded|ThrottlingException|Throttling|SlowDown|RequestLimitExceeded/i.test(texto(x));
}

/** Falha de rede/5xx da AWS ao invocar: tenta de novo mais tarde, com o mesmo attempt (não é erro do render). */
export function ehTransitorio(e: unknown): boolean {
  const x = e as ErroLike;
  const st = x?.$metadata?.httpStatusCode;
  return (typeof st === 'number' && st >= 500) ||
    /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|socket timed out|ServiceUnavailable|InternalFailure|ServiceException|TimeoutError/i.test(texto(x));
}

export const totalDeFrames = (p: Pick<ProgressoLambda, 'renderMetadata'>) => {
  const fr = p.renderMetadata?.frameRange;
  return fr ? fr[1] - fr[0] + 1 : 0;
};

/**
 * getRenderProgress → RenderSnapshot.
 * - sem renderMetadata (função principal ainda abrindo o site / calculando metadados): `bundling` 0 ("preparando").
 * - framesRendered < total: `rendering`; senão `encoding`. progress = floor(overallProgress*100), teto 99 (o 100 é do READY).
 * - done: `done` (o backend chama finalize → stage `uploading`).
 * - erro fatal sem retentativa: `timeout` se for TimeoutError do Remotion (a função principal estourou), senão `failed`.
 *   retryable: timeout e pedaço morto por throttling. Erro com willRetry (o Remotion tenta o pedaço de novo) não conta.
 */
export function snapshotDoProgresso(p: ProgressoLambda): RenderSnapshot {
  const total = totalDeFrames(p);
  const costUsd = typeof p.costs?.accruedSoFar === 'number' ? p.costs.accruedSoFar : null;
  if (p.done) return { state: 'done', costUsd, error: null, progress: { stage: 'encoding', progress: 99, frame: total, totalFrames: total } };

  const fatal = (p.errors ?? []).find((e) => e.isFatal && !e.willRetry) ?? (p.fatalErrorEncountered ? (p.errors ?? [])[0] ?? null : null);
  const frame = Math.min(p.framesRendered ?? 0, total || Infinity);
  const pct = Math.max(0, Math.min(99, Math.floor((p.overallProgress ?? 0) * 100)));
  const stage = !p.renderMetadata ? 'bundling' : (p.framesRendered ?? 0) < total ? 'rendering' : 'encoding';
  const progress = { stage, progress: p.renderMetadata ? pct : 0, frame: Number.isFinite(frame) ? frame : 0, totalFrames: total } as const;

  if (fatal || p.fatalErrorEncountered) {
    const msg = String(fatal?.message ?? 'render no Lambda falhou sem mensagem').split('\n')[0].slice(0, 500);
    const timeout = fatal?.name === 'TimeoutError' || /main function timed out|has timed out/i.test(msg);
    const throttle = ehThrottling(fatal);
    const failedFrame = typeof fatal?.frame === 'number' ? fatal.frame : timeout ? null : frameDoErro(fatal ?? msg);
    return { state: timeout ? 'timeout' : 'failed', costUsd, progress, error: { message: msg, failedFrame, retryable: timeout || throttle } };
  }
  return { state: 'running', costUsd, error: null, progress };
}

/**
 * §2.7 "sem progresso por mais de timeoutInSeconds + 60 s": o getRenderProgress já acusa TimeoutError quando a função
 * principal começou; isto cobre a função que nunca chegou a gravar metadados. O backend chama com o `submittedAt`.
 */
export function prazoEstourado(submittedAt: Date | number, agoraMs: number, functionTimeoutSec: number): boolean {
  const t = submittedAt instanceof Date ? submittedAt.getTime() : submittedAt;
  return agoraMs - t > (functionTimeoutSec + 60) * 1000;
}

/** Linha do `Render` que o settle confere (§6.2). */
export interface LinhaDeRender {
  id: string; status: string; impl: string | null; externalId: string | null; attempt: number; finalizingAt: Date | null;
}

/**
 * Webhook × linha (§2.7). `settle` = ponha na mesma rotina do poller (que ainda faz o claim por updateMany com
 * finalizingAt null; isto aqui só descarta cedo o que com certeza não é pra mexer). Sempre responda 200 se a assinatura valeu.
 */
export function decidirWebhook(ev: RenderWebhookEvent, linha: LinhaDeRender | null): { acao: 'settle' | 'ignorar'; motivo: string } {
  if (!linha) return { acao: 'ignorar', motivo: 'render não existe' };
  if (linha.impl !== 'lambda') return { acao: 'ignorar', motivo: `render impl ${linha.impl}` };
  if (linha.externalId !== ev.externalId || linha.attempt !== ev.attempt) return { acao: 'ignorar', motivo: 'tentativa antiga (atrasado)' };
  if (linha.status !== 'RENDERING') return { acao: 'ignorar', motivo: `já ${linha.status} (duplicado)` };
  if (linha.finalizingAt) return { acao: 'ignorar', motivo: 'já finalizando (duplicado)' };
  return { acao: 'settle', motivo: ev.status };
}
