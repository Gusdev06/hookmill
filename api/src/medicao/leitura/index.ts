// Leitura de mídia do anúncio (leitura-lambda-v1). Escolha do adaptador por ANALYZE_IMPL=local|lambda (padrão lambda desde 02/11:
// a leitura local prendia o event loop da API sob carga, QA F3; local fica só pros testes).
import type { MediaAnalysisService } from '../contrato';
import { InvocadorAws } from './invocador-aws';
import { LeituraLambda, type InvocadorLambda } from './lambda';
import { LeituraLocal } from './local';
import type { LeituraMidia, StorageDaLeitura } from './contrato';

export * from './contrato';
export { keyframeTimes, KEYFRAME_MAX_SIDE, MAX_KEYFRAMES } from './etapas';
export { LeituraLocal } from './local';
export { LeituraLambda, ErroInvocacao, type InvocadorLambda } from './lambda';

export interface LeituraConfig {
  impl: 'local' | 'lambda';
  functionName: string;
  region: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  timeoutMs: number;
  fallback: boolean;
  urlTtlSec: number;
}

export function leituraConfig(get: (k: string) => string | undefined): LeituraConfig {
  const s = (k: string) => (get(k) ?? '').trim();
  const n = (k: string, d: number) => { const v = Number(s(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const bruto = s('ANALYZE_IMPL').toLowerCase();
  if (bruto && bruto !== 'local' && bruto !== 'lambda') throw new Error(`ANALYZE_IMPL=${bruto} inválido (local | lambda)`);
  return {
    impl: bruto === 'local' ? 'local' : 'lambda',
    functionName: s('ANALYZE_LAMBDA_FUNCTION') || 'hookmill-leitura',
    region: s('ANALYZE_LAMBDA_REGION') || s('REMOTION_AWS_REGION') || 'us-east-1',
    accessKeyId: s('REMOTION_AWS_ACCESS_KEY_ID') || null,
    secretAccessKey: s('REMOTION_AWS_SECRET_ACCESS_KEY') || null,
    timeoutMs: n('ANALYZE_LAMBDA_TIMEOUT_SEC', 620) * 1000,
    // 02/11: sem fallback por padrão: refazer a etapa no processo da API traria de volta o travamento do F3
    fallback: s('ANALYZE_LAMBDA_FALLBACK').toLowerCase() === 'on',
    urlTtlSec: n('SIGNED_URL_TTL_SEC', 21600),
  };
}

/**
 * lambda (padrão) = função na AWS; fallback local só com ANALYZE_LAMBDA_FALLBACK=on. local = etapas no processo (testes). Sem credencial AWS com
 * ANALYZE_IMPL=lambda: falha no boot (mesma regra do RENDER_IMPL=lambda).
 */
export function criarLeitura(
  cfg: LeituraConfig,
  deps: { storage: StorageDaLeitura; media: MediaAnalysisService; ffmpeg: string; log: { warn(m: string): void; log?(m: string): void }; invocador?: InvocadorLambda },
): LeituraMidia {
  const local = new LeituraLocal(deps.storage, { media: deps.media, ffmpeg: deps.ffmpeg, aviso: (m) => deps.log.warn(m) });
  if (cfg.impl === 'local') return local;
  if (!deps.invocador && (!cfg.accessKeyId || !cfg.secretAccessKey)) {
    throw new Error('ANALYZE_IMPL=lambda sem REMOTION_AWS_ACCESS_KEY_ID / REMOTION_AWS_SECRET_ACCESS_KEY');
  }
  const inv = deps.invocador ?? new InvocadorAws({ region: cfg.region, functionName: cfg.functionName, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, timeoutMs: cfg.timeoutMs });
  return new LeituraLambda(inv, deps.storage, local, { fallback: cfg.fallback, urlTtlSec: cfg.urlTtlSec }, deps.log);
}
