// Cliente HTTP da WaveSpeed (API v3). Só o servidor fala com ela; a chave vem de WAVESPEED_API_KEY.
//   POST {base}/{model}?webhook=<url>   → { code, message, data: { id, status, outputs, urls.get, error } }
//   GET  {base}/predictions/{id}/result → idem
// Regra de dinheiro: a submissão NUNCA é repetida automaticamente. "fetch failed" não quer dizer que a task
// não foi criada (lição de 27/09: ela completa e é cobrada); repetir pagaria em dobro.
import { IntegracaoError } from '../erros';

export const WAVESPEED_BASE = 'https://api.wavespeed.ai/api/v3';

export type WsStatus = 'created' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'timeout' | 'deleted' | string;

export interface WsPrediction {
  id: string;
  model?: string;
  status: WsStatus;
  outputs: unknown[];
  error: string | null;
  getUrl: string | null;
  raw: Record<string, unknown>;
}

export interface WaveSpeedClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

/** Recusa do provedor que é sobre o CONTEÚDO (vira task FAILED com SAFETY_BLOCK, não erro de submissão). */
export class WsContentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WsContentRejected';
  }
}

/** Palavras de recusa de CONTEÚDO. Genéricas como "not allowed" / "prohibited" ficaram de fora: "Invalid image URL:
 *  private or local network URLs are not allowed" virou SAFETY_BLOCK e a tela culpou a descrição (05/10). */
const CONTENT_RE = /safety|moderat|content polic|polic(y|ies) violat|violat\w* (our|the|content|usage) polic|nsfw|sensitive content|inappropriate|sexual|explicit content|celebrit|public figure|copyright|flagged|harmful content/i;
/** Erro de entrada/rede: nunca é recusa de conteúdo, mesmo que cite uma das palavras acima. */
const INPUT_RE = /\burl\b|invalid|parameter|format|must be|required|missing|unsupported|too (large|long|short)|size|duration|resolution|download|fetch|network|private|localhost|timeout|unavailable/i;

/** true só pra recusa de conteúdo (vira SAFETY_BLOCK); erro de entrada, rede ou provedor → false. */
export function isContentRefusal(message: string | null | undefined): boolean {
  return !!message && CONTENT_RE.test(message) && !INPUT_RE.test(message);
}

export class WaveSpeedClient {
  private readonly f: typeof fetch;
  private readonly base: string;

  constructor(private readonly opts: WaveSpeedClientOptions) {
    this.f = opts.fetchImpl ?? fetch;
    this.base = (opts.baseUrl ?? WAVESPEED_BASE).replace(/\/$/, '');
  }

  async submit(model: string, body: Record<string, unknown>, webhookUrl?: string | null): Promise<WsPrediction> {
    const url = `${this.base}/${model}${webhookUrl ? `?webhook=${encodeURIComponent(webhookUrl)}` : ''}`;
    let res: Response;
    try {
      res = await this.f(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed submit network error (task may exist, not retried): ${(e as Error).message}`);
    }
    const json = await safeJson(res);
    const msg = errorText(json) ?? `HTTP ${res.status}`;
    if (!res.ok || (typeof json.code === 'number' && json.code !== 200 && json.code !== 0)) {
      if (res.status === 400 || res.status === 422) {
        if (isContentRefusal(msg)) throw new WsContentRejected(msg);
        throw new IntegracaoError('PROVIDER_ERROR', `wavespeed rejected input: ${msg}`);
      }
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed submit ${res.status}: ${msg}`);
    }
    const p = toPrediction(json);
    if (!p.id) throw new IntegracaoError('PROVIDER_UNAVAILABLE', 'wavespeed submit without id');
    return p;
  }

  /**
   * Sobe bytes pro storage da WaveSpeed e devolve a URL pública (mesmo fluxo do SDK oficial / `wavespeed upload`):
   *   POST {base}/media/uploads { filename, size } → data.download_url + data.upload { url, method: PUT, headers }
   *   PUT data.upload.url com os bytes.
   * Serve pra entrada que mora numa URL que a WaveSpeed não alcança (S3 local, rede interna).
   */
  async upload(bytes: Uint8Array, filename: string): Promise<string> {
    let res: Response;
    try {
      res = await this.f(`${this.base}/media/uploads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ filename, size: bytes.byteLength }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed upload network error: ${(e as Error).message}`);
    }
    const json = await safeJson(res);
    const d = (json.data ?? {}) as { download_url?: string; upload?: { url?: string; method?: string; headers?: Record<string, string> } };
    if (!res.ok || (typeof json.code === 'number' && json.code !== 200) || !d.download_url || !d.upload?.url || (d.upload.method ?? 'PUT').toUpperCase() !== 'PUT')
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed upload ${res.status}: ${errorText(json) ?? 'invalid upload instruction'}`);
    let put: Response;
    try {
      put = await this.f(d.upload.url, { method: 'PUT', headers: d.upload.headers ?? {}, body: bytes as unknown as BodyInit, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed upload PUT failed: ${(e as Error).message}`);
    }
    if (!put.ok) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed upload PUT ${put.status}`);
    return d.download_url;
  }

  async result(id: string, getUrl?: string | null): Promise<WsPrediction> {
    const url = getUrl && getUrl.startsWith(this.base) ? getUrl : `${this.base}/predictions/${encodeURIComponent(id)}/result`;
    let res: Response;
    try {
      res = await this.f(url, { headers: { authorization: `Bearer ${this.opts.apiKey}` }, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000) });
    } catch (e) {
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed result network error: ${(e as Error).message}`);
    }
    const json = await safeJson(res);
    if (res.status === 404) throw new IntegracaoError('TASK_NOT_FOUND', `wavespeed prediction ${id} not found`);
    if (!res.ok) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `wavespeed result ${res.status}: ${errorText(json) ?? ''}`);
    return toPrediction(json);
  }
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const v = await res.json();
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorText(json: Record<string, unknown>): string | null {
  const d = (json.data ?? {}) as Record<string, unknown>;
  for (const v of [d.error, json.message, json.error]) if (typeof v === 'string' && v.trim() && v !== 'success') return v.trim();
  return null;
}

/** Aceita o envelope { code, data } da API e o objeto cru (webhook manda o objeto direto). */
export function toPrediction(json: Record<string, unknown>): WsPrediction {
  const d = (json.data && typeof json.data === 'object' ? json.data : json) as Record<string, unknown>;
  const urls = (d.urls ?? {}) as Record<string, unknown>;
  const err = typeof d.error === 'string' && d.error.trim() ? d.error.trim() : null;
  return {
    id: String(d.id ?? ''),
    model: typeof d.model === 'string' ? d.model : undefined,
    status: String(d.status ?? 'created').toLowerCase(),
    outputs: Array.isArray(d.outputs) ? d.outputs : [],
    error: err,
    getUrl: typeof urls.get === 'string' ? urls.get : null,
    raw: d,
  };
}
