// Env do adaptador lambda (render-lambda-v1 §6.3). Defaults do plano; o arquiteto registra os valores da sonda L1 no §2.1.
import type { RenderImpl, RenderKind } from '../contrato';

export interface LambdaConfig {
  region: string;                 // REMOTION_AWS_REGION (us-east-1, L-D1)
  functionName: string;           // REMOTION_LAMBDA_FUNCTION (saída do npm run lambda:deploy)
  serveUrl: string;               // REMOTION_SERVE_URL (site hookmill-<sha>)
  framesPerLambda: number;        // RENDER_LAMBDA_FRAMES_PER_LAMBDA (150: egress do Supabase, §2.4)
  pollMs: number;                 // RENDER_LAMBDA_POLL_MS (o backend usa no @Interval)
  maxInflight: number;            // RENDER_LAMBDA_MAX_INFLIGHT (o despachante usa)
  maxInflightPerWorkspace: number;// RENDER_LAMBDA_MAX_INFLIGHT_PER_WORKSPACE
  webhook: boolean;               // RENDER_LAMBDA_WEBHOOK=on|off
  webhookSecret: string | null;   // RENDER_WEBHOOK_SECRET
  licenseKey: string | null;      // REMOTION_LICENSE_KEY (vazio = Free, §7)
  /** delayRender no Lambda (fontes + mídia remota). Padrão do Remotion = 30 s; o plano pede 60 s. */
  delayRenderTimeoutMs: number;   // RENDER_LAMBDA_DELAY_RENDER_MS
  /** Validade mínima das URLs assinadas no submit (§2.4: ≥ 2 h). */
  minUrlTtlSec: number;           // RENDER_LAMBDA_MIN_URL_TTL_SEC
  /** Espera depois de throttling da AWS antes de submeter de novo (§2.7: ≥ 15 s). */
  throttleWaitMs: number;         // RENDER_LAMBDA_THROTTLE_WAIT_MS
  /** timeoutInSeconds da função (deployFunction). Sem progresso por mais que isto + 60 s = timeout (§2.7). */
  functionTimeoutSec: number;     // REMOTION_LAMBDA_TIMEOUT_SEC
  tmpDir: string;                 // RENDER_TMP_DIR
  ffmpeg: string;
  ffprobe: string;
}

export function lambdaConfig(get: (k: string) => string | undefined): LambdaConfig {
  const int = (k: string, d: number) => {
    const n = Number(get(k));
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  const str = (k: string) => (get(k) ?? '').trim();
  return {
    region: str('REMOTION_AWS_REGION') || 'us-east-1',
    functionName: str('REMOTION_LAMBDA_FUNCTION'),
    serveUrl: str('REMOTION_SERVE_URL'),
    framesPerLambda: int('RENDER_LAMBDA_FRAMES_PER_LAMBDA', 150),
    pollMs: int('RENDER_LAMBDA_POLL_MS', 3000),
    maxInflight: int('RENDER_LAMBDA_MAX_INFLIGHT', 20),
    maxInflightPerWorkspace: int('RENDER_LAMBDA_MAX_INFLIGHT_PER_WORKSPACE', 10),
    webhook: str('RENDER_LAMBDA_WEBHOOK').toLowerCase() !== 'off',
    webhookSecret: str('RENDER_WEBHOOK_SECRET') || null,
    licenseKey: str('REMOTION_LICENSE_KEY') || null,
    delayRenderTimeoutMs: int('RENDER_LAMBDA_DELAY_RENDER_MS', 60_000),
    minUrlTtlSec: int('RENDER_LAMBDA_MIN_URL_TTL_SEC', 7200),
    throttleWaitMs: int('RENDER_LAMBDA_THROTTLE_WAIT_MS', 15_000),
    functionTimeoutSec: int('REMOTION_LAMBDA_TIMEOUT_SEC', 300),
    tmpDir: str('RENDER_TMP_DIR') || '/tmp/maquina-render',
    ffmpeg: str('FFMPEG_PATH') || 'ffmpeg',
    ffprobe: str('FFPROBE_PATH') || 'ffprobe',
  };
}

/** O que falta pra o adaptador lambda subir. Vazio = ok. */
export function faltandoNoLambda(c: LambdaConfig): string[] {
  const f: string[] = [];
  if (!c.functionName) f.push('REMOTION_LAMBDA_FUNCTION');
  if (!c.serveUrl) f.push('REMOTION_SERVE_URL');
  if (!/^https:\/\//.test(c.serveUrl) && c.serveUrl) f.push('REMOTION_SERVE_URL (tem que ser https:// do site no S3)');
  if (c.webhook && !c.webhookSecret) f.push('RENDER_WEBHOOK_SECRET (ou RENDER_LAMBDA_WEBHOOK=off)');
  return f;
}

const KINDS: RenderKind[] = ['scratch', 'auto-edit', 'remix-keep', 'frame', 'template'];

/** RENDER_IMPL (padrão) + RENDER_LAMBDA_KINDS (quais kind vão pro lambda quando RENDER_IMPL=lambda). `remotion` = `local`. */
export function escolhaDeImpl(get: (k: string) => string | undefined, padraoSemEnv: RenderImpl = 'local'): { impl: RenderImpl; lambdaKinds: Set<RenderKind> } {
  const bruto = (get('RENDER_IMPL') ?? '').trim().toLowerCase();
  const impl: RenderImpl = bruto === 'fake' ? 'fake' : bruto === 'lambda' ? 'lambda' : bruto === 'local' || bruto === 'remotion' ? 'local' : padraoSemEnv;
  const kindsEnv = get('RENDER_LAMBDA_KINDS');
  const lista = (kindsEnv === undefined ? 'scratch' : kindsEnv).split(',').map((s) => s.trim()).filter(Boolean);
  const invalidos = lista.filter((k) => !KINDS.includes(k as RenderKind));
  if (invalidos.length) throw new Error(`RENDER_LAMBDA_KINDS com kind desconhecido: ${invalidos.join(', ')} (válidos: ${KINDS.join(', ')})`);
  return { impl, lambdaKinds: new Set(lista as RenderKind[]) };
}
