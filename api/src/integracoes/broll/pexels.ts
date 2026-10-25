// Cliente da Pexels Videos (§B3.1). A chave (PEXELS_API_KEY) é a mesma da Launchwing: o limite da conta gratuita
// (200 pedidos/hora, conferido no painel da Pexels pelo Gusta) é DIVIDIDO. Por isso: cache em memória de busca e de
// vídeo (6 h), leitura dos headers X-Ratelimit-* e uma reserva (não chama abaixo de `reserve` pedidos restantes).
import { IntegracaoError } from '../erros';

export interface PexelsVideoFile { id: number; quality: string | null; file_type: string; width: number | null; height: number | null; fps?: number | null; link: string }
export interface PexelsVideo {
  id: number; width: number; height: number; duration: number; url: string; image: string;
  user: { id: number; name: string; url: string };
  video_files: PexelsVideoFile[];
}
interface SearchResponse { videos: PexelsVideo[]; total_results?: number }

export interface PexelsOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
  /** pedidos restantes que ficam pra Launchwing (padrão 20) */
  reserve?: number;
}

export const PEXELS_API = 'https://api.pexels.com';

export class PexelsClient {
  private readonly cache = new Map<string, { at: number; value: unknown }>();
  /** último X-Ratelimit-Remaining / Reset lidos */
  remaining: number | null = null;
  resetAt: number | null = null;
  /** pedidos HTTP feitos de verdade (o resto veio do cache) */
  requests = 0;

  constructor(private readonly opts: PexelsOptions) {}

  private get now() { return (this.opts.now ?? Date.now)(); }

  private async get<T>(path: string): Promise<T> {
    const key = path;
    const hit = this.cache.get(key);
    const ttl = this.opts.ttlMs ?? 6 * 3600_000;
    if (hit && this.now - hit.at < ttl) return hit.value as T;
    const reserve = this.opts.reserve ?? 20;
    if (this.remaining != null && this.remaining <= reserve && (this.resetAt == null || this.now < this.resetAt)) {
      throw new IntegracaoError('BROLL_UNAVAILABLE', `pexels: only ${this.remaining} requests left this hour (reserve ${reserve})`, { reason: 'rate_limited', resetAt: this.resetAt });
    }
    let res: Response;
    try {
      this.requests++;
      res = await (this.opts.fetchImpl ?? fetch)(`${PEXELS_API}${path}`, { headers: { Authorization: this.opts.apiKey }, signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      throw new IntegracaoError('BROLL_UNAVAILABLE', `pexels: ${(e as Error).message}`, { reason: 'down' });
    }
    const rem = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (res.headers.get('x-ratelimit-remaining') != null && Number.isFinite(rem)) this.remaining = rem;
    if (Number.isFinite(reset) && reset > 0) this.resetAt = reset * 1000;
    if (res.status === 429) throw new IntegracaoError('BROLL_UNAVAILABLE', 'pexels 429', { reason: 'rate_limited', resetAt: this.resetAt });
    if (res.status === 401 || res.status === 403) throw new IntegracaoError('NOT_CONFIGURED', `pexels ${res.status}: check PEXELS_API_KEY`);
    if (res.status === 404) throw new IntegracaoError('BROLL_UNAVAILABLE', 'pexels 404', { reason: 'not_found' });
    if (!res.ok) throw new IntegracaoError('BROLL_UNAVAILABLE', `pexels ${res.status}`, { reason: 'down' });
    const value = (await res.json()) as T;
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { at: this.now, value });
    return value;
  }

  /** Busca de vídeos. `portrait` primeiro; o chamador junta com a busca sem orientação se faltar. */
  async search(query: string, opts: { orientation?: 'portrait' | 'landscape' | null; perPage?: number } = {}): Promise<PexelsVideo[]> {
    const q = new URLSearchParams({ query, per_page: String(opts.perPage ?? 10), size: 'medium' });
    if (opts.orientation) q.set('orientation', opts.orientation);
    const r = await this.get<SearchResponse>(`/videos/search?${q.toString()}`);
    const vids = Array.isArray(r.videos) ? r.videos : [];
    for (const v of vids) this.cache.set(`/videos/videos/${v.id}`, { at: this.now, value: v });
    return vids;
  }

  async video(id: number): Promise<PexelsVideo> {
    return this.get<PexelsVideo>(`/videos/videos/${id}`);
  }
}

/** Arquivo de prévia: o menor mp4 com lado menor ≥ 360 (contact sheet barata). */
export function previewFile(v: PexelsVideo): PexelsVideoFile | null {
  const mp4 = v.video_files.filter((f) => f.file_type === 'video/mp4' && f.width && f.height);
  const ok = mp4.filter((f) => Math.min(f.width!, f.height!) >= 360).sort((a, b) => a.width! * a.height! - b.width! * b.height!);
  return ok[0] ?? mp4.sort((a, b) => b.width! * b.height! - a.width! * a.height!)[0] ?? null;
}

/** Arquivo final: o maior mp4 até 1080 no lado menor (HD/Full HD; nunca 4K, o painel é pequeno). */
export function finalFile(v: PexelsVideo): PexelsVideoFile | null {
  const mp4 = v.video_files.filter((f) => f.file_type === 'video/mp4' && f.width && f.height && Math.min(f.width, f.height) <= 1080);
  return mp4.sort((a, b) => b.width! * b.height! - a.width! * a.height!)[0] ?? previewFile(v);
}

/** Ordem de preferência (§B3.1: vertical e HD primeiro). */
export function rankVideos(vs: PexelsVideo[], minSec: number): PexelsVideo[] {
  const score = (v: PexelsVideo) => (v.height > v.width ? 2 : 0) + (Math.min(v.width, v.height) >= 720 ? 1 : 0) + (v.duration >= minSec ? 1 : 0);
  return [...vs].sort((a, b) => score(b) - score(a));
}
