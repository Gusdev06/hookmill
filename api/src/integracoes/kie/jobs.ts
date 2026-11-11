// 11/11 (Gusta): tarefas assíncronas do Kie.ai (Market: createTask → recordInfo). Hoje só a transcrição
// (nvidia/nemotron-3-5-transcribe), que substitui o wavespeed-ai/openai-whisper-with-video (~80x mais barato).
// Docs: https://docs.kie.ai/market/nvidia/nemotron-3-5-transcribe.md e https://docs.kie.ai/file-upload-api/upload-file-stream.md
import { IntegracaoError } from '../erros';

export const KIE_API = 'https://api.kie.ai';
export const KIE_UPLOAD_API = 'https://kieai.redpandaai.co';

export type KieState = 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';

export interface KieRecord {
  taskId: string;
  state: KieState | string;
  /** resultJson já parseado (resultObject / resultUrls) */
  result: Record<string, unknown> | null;
  failMsg: string | null;
  failCode: string | null;
  raw: Record<string, unknown>;
}

export class KieJobsClient {
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly o: { apiKey: string; fetchImpl?: typeof fetch }) {
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  private async call(url: string, init: RequestInit, what: string): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, headers: { authorization: `Bearer ${this.o.apiKey}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      throw new IntegracaoError('PROVIDER_UNAVAILABLE', `kie ${what}: ${(e as Error).message}`);
    }
    const raw = await res.text();
    let j: Record<string, any> = {};
    try { j = JSON.parse(raw); } catch { /* não-JSON */ }
    // o Kie responde HTTP 200 com { code, msg } no corpo
    const code = typeof j.code === 'number' ? j.code : res.status;
    if (!res.ok || code !== 200) {
      const detail = `${code}: ${String(j.msg ?? raw).slice(0, 500)}`;
      if (code === 401 || code === 403) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `kie ${what} auth`, { providerDetail: detail });
      if (code === 402) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `kie ${what}: saldo insuficiente`, { providerDetail: detail });
      if (code === 429) throw new IntegracaoError('RATE_LIMITED', `kie ${what} 429`, { providerDetail: detail });
      if (code >= 500) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `kie ${what} ${code}`, { providerDetail: detail });
      throw new IntegracaoError('PROVIDER_ERROR', `kie ${what} ${code}`, { providerDetail: detail });
    }
    return j;
  }

  async createTask(model: string, input: Record<string, unknown>, callBackUrl?: string | null): Promise<string> {
    const j = await this.call(`${KIE_API}/api/v1/jobs/createTask`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, input, ...(callBackUrl ? { callBackUrl } : {}) }),
    }, 'createTask');
    const id = j.data?.taskId;
    if (typeof id !== 'string' || !id) throw new IntegracaoError('PROVIDER_ERROR', 'kie createTask sem taskId', { providerDetail: JSON.stringify(j).slice(0, 500) });
    return id;
  }

  async recordInfo(taskId: string): Promise<KieRecord> {
    const j = await this.call(`${KIE_API}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { method: 'GET' }, 'recordInfo');
    const d = (j.data ?? {}) as Record<string, any>;
    if (!d.taskId) throw new IntegracaoError('TASK_NOT_FOUND', taskId);
    let result: Record<string, unknown> | null = null;
    if (typeof d.resultJson === 'string' && d.resultJson) {
      try { result = JSON.parse(d.resultJson); } catch { result = null; }
    }
    return { taskId: d.taskId, state: String(d.state ?? ''), result, failMsg: d.failMsg ?? null, failCode: d.failCode != null ? String(d.failCode) : null, raw: d };
  }

  /** Sobe bytes pro armazenamento temporário do Kie (pra mídia que não tem URL pública). Devolve a URL de download. */
  async upload(bytes: Uint8Array, fileName: string): Promise<string> {
    const form = new FormData();
    form.append('file', new Blob([bytes as BlobPart]), fileName);
    form.append('uploadPath', 'hookmill');
    form.append('fileName', fileName);
    const j = await this.call(`${KIE_UPLOAD_API}/api/file-stream-upload`, { method: 'POST', body: form }, 'upload');
    const url = j.data?.downloadUrl;
    if (typeof url !== 'string' || !url) throw new IntegracaoError('PROVIDER_ERROR', 'kie upload sem downloadUrl');
    return url;
  }
}
