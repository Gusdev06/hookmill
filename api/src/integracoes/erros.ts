// Erros que a integracoes devolve ao backend. O texto humano é do backend (i18n por `code`),
// nunca a mensagem crua do provedor.

export type IntegracaoErrorCode =
  // Claude (extractOffer / generateScripts)
  | 'PAGE_FORBIDDEN'
  | 'PAGE_UNREADABLE'
  | 'RATE_LIMITED'
  // WaveSpeed (normalizados, eventos.md §3)
  | 'SAFETY_BLOCK'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_ERROR'
  | 'CANCELLED'
  | 'DOWNLOAD_INVALID'
  // o provedor recusou a SUBMISSÃO na hora (fora do ar, 5xx, chave inválida/sem saldo): api.md → 503 PROVIDER_UNAVAILABLE
  | 'PROVIDER_UNAVAILABLE'
  // falta configuração do modo live (chave no .env)
  | 'NOT_CONFIGURED'
  // entrada inválida vinda do backend (bug de chamada, não do usuário)
  | 'INVALID_MODEL'
  | 'INVALID_SCRIPT'
  | 'INVALID_VOICE'
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_READY'
  // modo live ainda não implementado (I2/I3)
  | 'NOT_IMPLEMENTED'
  // feature 2: Ad Library (Apify). AD_LIBRARY_UNAVAILABLE leva details { reason, retryAfter }
  | 'AD_LIBRARY_UNAVAILABLE'
  | 'AD_NOT_FOUND'
  | 'AD_HAS_NO_VIDEO'
  // feature 2: tipo de variação ainda fora do build (COPY_NEW / REMIX_EDIT até a vez deles)
  | 'KIND_NOT_ENABLED'
  // §13.5: áudio do take > 600 s (teto do Pruna por chamada); details { durationSec, maxSec: 600 }
  | 'LIPSYNC_AUDIO_TOO_LONG'
  // §B3.1 b-roll (estatico-montado-e-molduras-v1): nenhum candidato serve (details { rejected, fallbackSubject }) → o
  // backend cai pro champion_segment ou pra imagem gerada; banco fora/cota (details { reason }); fonte desligada (D15)
  | 'BROLL_NO_MATCH'
  | 'BROLL_UNAVAILABLE'
  | 'BROLL_SOURCE_NOT_SUPPORTED';

export class IntegracaoError extends Error {
  constructor(
    public readonly code: IntegracaoErrorCode,
    message?: string,
    /** Dados pro `details` do erro da API (ex.: AD_LIBRARY_UNAVAILABLE → { reason, retryAfter }). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'IntegracaoError';
  }
}

export function isIntegracaoError(e: unknown): e is IntegracaoError {
  return e instanceof IntegracaoError;
}
