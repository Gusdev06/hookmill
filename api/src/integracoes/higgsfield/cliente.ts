// Cliente HTTP da Higgsfield (rosto: Soul V2). Só o servidor fala com ela; credencial = HF_API_KEY_ID + HF_API_KEY_SECRET.
//   POST {base}/higgsfield-ai/soul/v2/standard  { prompt, aspect_ratio, resolution, batch_size, seed? }  + Idempotency-Key
//        → { status: 'queued', request_id, status_url, cancel_url }
//   GET  {base}/requests/{request_id}/status  → { status: queued|in_progress|completed|failed|nsfw|canceled, images: [{ url }] }
// failed/nsfw não cobram. O CDN da saída guarda >= 7 dias; o backend baixa pro nosso storage (ingestFromUrl).
// Regra de dinheiro (igual à WaveSpeed): a submissão NUNCA é repetida automaticamente.
import { IntegracaoError } from '../erros';
import { isContentRefusal } from '../wavespeed/cliente';
import type { Final } from '../wavespeed/normalizar';

export const HIGGSFIELD_BASE = 'https://api.higgsfield.ai';
export const SOUL_V2_ENDPOINT = 'higgsfield-ai/soul/v2/standard';

export interface HfClientOptions {
  keyId: string;
  keySecret: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface HfSoulInput {
  prompt: string;
  aspect_ratio: '1:1' | '9:16' | '16:9' | '4:3' | '3:4' | '2:3' | '3:2';
  resolution: '720p' | '1080p';
  batch_size: number;
  seed?: number;
}

export interface HfRequest {
  requestId: string;
  status: string;
  /** URLs das imagens (só em completed) */
  images: string[];
  error: string | null;
  raw: Record<string, unknown>;
}

/** Recusa de CONTEÚDO na submissão (vira task FAILED com SAFETY_BLOCK, não erro de submissão). */
export class HfContentRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HfContentRejected';
  }
}

export class HiggsfieldClient {
  private readonly f: typeof fetch;
  private readonly base: string;

  constructor(private readonly opts: HfClientOptions) {
    if (!opts.keyId || !opts.keySecret) throw new IntegracaoError('NOT_CONFIGURED', 'HF_API_KEY_ID / HF_API_KEY_SECRET is empty in api/.env');
    this.f = opts.fetchImpl ?? fetch;
    this.base = (opts.baseUrl ?? HIGGSFIELD_BASE).replace(/\/$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Key ${this.opts.keyId}:${this.opts.keySecret}`, accept: 'application/json', ...extra };
  }

  async submit(endpoint: string, body: HfSoulInput, idempotencyKey: string): Promise<HfRequest> {
    let res: Response;
    try {
      res = await this.f(`${this.base}/${endpoint}`, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json', 'idempotency-key': idempotencyKey }),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `higgsfield submit network error (request may exist, not retried): ${(e as Error).message}`);
    }
    const json = await safeJson(res);
    if (!res.ok) {
      const msg = errorText(json) ?? `HTTP ${res.status}`;
      if (res.status === 400 || res.status === 422) {
        if (isContentRefusal(msg)) throw new HfContentRejected(msg);
        throw new IntegracaoError('PROVIDER_ERROR', `higgsfield rejected input: ${msg}`);
      }
      // 401/403 chave inválida, 402 sem crédito, 429, 5xx
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `higgsfield submit ${res.status}: ${msg}`);
    }
    const r = toRequest(json);
    if (!r.requestId) throw new IntegracaoError('PROVIDER_UNAVAILABLE', 'higgsfield submit without request_id');
    return r;
  }

  async status(requestId: string): Promise<HfRequest> {
    let res: Response;
    try {
      res = await this.f(`${this.base}/requests/${encodeURIComponent(requestId)}/status`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch (e) {
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `higgsfield status network error: ${(e as Error).message}`);
    }
    const json = await safeJson(res);
    if (res.status === 404) throw new IntegracaoError('TASK_NOT_FOUND', `higgsfield request ${requestId} not found`);
    if (!res.ok) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `higgsfield status ${res.status}: ${errorText(json) ?? ''}`);
    const r = toRequest(json);
    return r.requestId ? r : { ...r, requestId };
  }
}

/** Status da Higgsfield → contrato. null = ainda rodando (queued / in_progress). */
export function hfFinalStatus(r: Pick<HfRequest, 'status' | 'error'>): { status: Final; errorCode: string | null } | null {
  switch (r.status) {
    case 'completed':
      return { status: 'COMPLETED', errorCode: null };
    case 'nsfw':
      return { status: 'FAILED', errorCode: 'SAFETY_BLOCK' };
    case 'failed':
      return { status: 'FAILED', errorCode: isContentRefusal(r.error) ? 'SAFETY_BLOCK' : 'PROVIDER_ERROR' };
    case 'canceled':
    case 'cancelled':
      return { status: 'CANCELLED', errorCode: 'CANCELLED' };
    default:
      return null;
  }
}

export function toRequest(json: Record<string, unknown>): HfRequest {
  const images = Array.isArray(json.images)
    ? json.images.map((i) => (i && typeof i === 'object' ? (i as Record<string, unknown>).url : i)).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
    : [];
  const err = errorText(json);
  return {
    requestId: String(json.request_id ?? json.id ?? ''),
    status: String(json.status ?? 'queued').toLowerCase(),
    images,
    error: err,
    raw: json,
  };
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
  for (const v of [json.error, json.detail, json.message]) {
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object') return JSON.stringify(v).slice(0, 500);
  }
  return null;
}
