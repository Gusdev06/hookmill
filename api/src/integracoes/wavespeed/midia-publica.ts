// A WaveSpeed só baixa entrada de URL pública ("Invalid image/audio URL: private or local network URLs are not
// allowed", 05/10 no live local com o S3 em localhost:9000). URL local/privada (ou PUBLIC_MEDIA=off) → a API
// baixa os bytes do storage e sobe pelo upload de mídia da WaveSpeed, mandando a URL que volta.
import { isIP } from 'node:net';
import { isPrivateIp } from '../claude/pagina';
import { IntegracaoError } from '../erros';

export function isPublicUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(host)) return !isPrivateIp(host);
  if (!host.includes('.')) return false; // localhost, nome de contêiner (minio, versitygw…)
  return !/\.(local|localhost|internal|lan|home|test|invalid)$/.test(host);
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};

export function filenameFor(url: string, contentType: string | null, fallback: string): string {
  const base = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  if (/^[\w.-]+\.[a-z0-9]{2,4}$/i.test(base)) return base;
  const ext = EXT_BY_TYPE[(contentType ?? '').split(';')[0].trim().toLowerCase()];
  return ext ? `${fallback}.${ext}` : fallback;
}

/** Limite do que a API puxa pra memória pra repassar (clipe de 30 s em 720p fica bem abaixo). */
export const MAX_INPUT_BYTES = 200 * 1024 * 1024;

export async function readInput(url: string, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new IntegracaoError('PROVIDER_ERROR', `could not read input media from storage: ${(e as Error).message}`);
  }
  if (!res.ok) throw new IntegracaoError('PROVIDER_ERROR', `could not read input media from storage: HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_INPUT_BYTES) throw new IntegracaoError('PROVIDER_ERROR', `input media too large (${len} bytes)`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength) throw new IntegracaoError('PROVIDER_ERROR', 'input media is empty');
  if (bytes.byteLength > MAX_INPUT_BYTES) throw new IntegracaoError('PROVIDER_ERROR', `input media too large (${bytes.byteLength} bytes)`);
  return { bytes, contentType: res.headers.get('content-type') };
}
