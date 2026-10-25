// render-lambda-v1 §2.4 e §2.6: toda mídia que o Lambda baixa tem que ser URL pública assinada, com validade que cubra o
// render, e nunca localhost / rede privada / caminho relativo (fixture de dev não vai pro site no S3).

export interface ProblemaDeMidia { caminho: string; valor: string; motivo: string }

const HOST_PRIVADO = [
  /^localhost$/i, /\.localhost$/i, /\.local$/i, /\.internal$/i, /^host\.docker\.internal$/i,
  /^127\./, /^0\.0\.0\.0$/, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./,
  /^\[?::1\]?$/, /^\[?fc/i, /^\[?fd/i, /^\[?fe80:/i,
];

/** Chave que guarda mídia (clipUrl, videoUrl, imageUrl, src, baseVideoUrl, url...). */
const CHAVE_DE_MIDIA = /(url|src)$/i;

/** Segundos que a URL assinada ainda vale, ou null se não der pra saber (sem assinatura conhecida). */
export function validadeRestanteSec(u: URL, agoraMs: number): number | null {
  const q = u.searchParams;
  // S3 SigV4 (Supabase Storage pelo endpoint S3, versitygw, AWS): X-Amz-Date=YYYYMMDDTHHMMSSZ + X-Amz-Expires=s
  const data = q.get('X-Amz-Date');
  const exp = q.get('X-Amz-Expires');
  if (data && exp) {
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(data);
    if (!m) return 0;
    const inicio = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return Math.floor((inicio + Number(exp) * 1000 - agoraMs) / 1000);
  }
  // S3 SigV2 / CloudFront: Expires=epoch
  const ep = q.get('Expires');
  if (ep && /^\d+$/.test(ep)) return Math.floor(Number(ep) - agoraMs / 1000);
  // Supabase /object/sign/...?token=<JWT com exp>
  const token = q.get('token');
  if (token && token.split('.').length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: number };
      if (typeof payload.exp === 'number') return Math.floor(payload.exp - agoraMs / 1000);
    } catch { /* token ilegível */ }
    return 0;
  }
  return null;
}

/**
 * Percorre as props (ou o RenderInput) e devolve tudo que o Lambda não vai conseguir baixar.
 * - string http(s) em qualquer lugar: host não pode ser localhost/privado; URL assinada tem que valer ≥ minTtlSec.
 * - string em chave de mídia (…Url/…src) que não é http(s) nem data:: caminho local (fixture) = não chega no Lambda.
 * URL pública sem assinatura (ex.: CDN) passa: o Lambda alcança, e não há validade pra conferir.
 */
export function problemasDeMidia(valor: unknown, o: { agoraMs: number; minTtlSec: number }): ProblemaDeMidia[] {
  const out: ProblemaDeMidia[] = [];
  const visitar = (v: unknown, caminho: string, chave: string) => {
    if (typeof v === 'string') {
      if (/^https?:\/\//i.test(v)) {
        let u: URL;
        try { u = new URL(v); } catch { out.push({ caminho, valor: v, motivo: 'URL inválida' }); return; }
        const host = u.hostname.toLowerCase();
        if (HOST_PRIVADO.some((r) => r.test(host))) { out.push({ caminho, valor: v, motivo: `host local/privado (${host}): o Lambda não alcança` }); return; }
        const resta = validadeRestanteSec(u, o.agoraMs);
        if (resta !== null && resta < o.minTtlSec) out.push({ caminho, valor: v, motivo: `URL assinada vale só ${Math.max(0, resta)} s (mínimo ${o.minTtlSec} s)` });
      } else if (CHAVE_DE_MIDIA.test(chave) && v !== '' && !/^data:/i.test(v)) {
        out.push({ caminho, valor: v, motivo: 'caminho local (fixture/staticFile): não existe no site do S3' });
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, i) => visitar(x, `${caminho}[${i}]`, chave)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visitar(x, caminho ? `${caminho}.${k}` : k, k);
  };
  visitar(valor, '', '');
  return out;
}

/** Valor sem a query (não vaza assinatura em log/erro). */
export const semAssinatura = (v: string) => v.replace(/\?.*$/, '?…');
