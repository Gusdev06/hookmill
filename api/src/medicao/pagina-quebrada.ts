// Página quebrada na captura (bug 25/10, lote cmvnlm4yd000l22emdoob1j5a: a LP Next.js da Amnayalife saiu como "Application
// error: a client-side exception has occurred" e o STATIC desenhou o erro dentro do celular). PURO + 1 leitura de pixels
// por ffmpeg; testado em pagina-quebrada.spec.ts. Captura quebrada NUNCA vira `page_capture` válida (D4/§A4, SPLIT-LP, B2).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type MotivoPaginaQuebrada =
  | 'erro_do_app'          // Next/React: "Application error", "client-side exception", "Unhandled Runtime Error"
  | 'nao_encontrada'       // "This page could not be found", 404, Vercel DEPLOYMENT_NOT_FOUND
  | 'erro_do_servidor'     // 5xx, "Internal Server Error", "Bad Gateway", Vercel FUNCTION_INVOCATION_FAILED
  | 'bloqueio'             // Cloudflare / WAF: "Just a moment", "Access denied", "Attention Required", captcha
  | 'pouco_texto'          // corpo quase vazio (nada hidratou)
  | 'uma_cor';             // a imagem é quase toda de uma cor só

export interface DiagnosticoPagina { ok: boolean; motivo: MotivoPaginaQuebrada | null; detalhe: string | null; recuperavel: boolean }

/** Tabela de sinais por motivo (casados no título + começo do texto, sem caixa). `recuperavel` = vale tentar de novo. */
const SINAIS: { motivo: MotivoPaginaQuebrada; termos: string[]; recuperavel: boolean }[] = [
  {
    motivo: 'erro_do_app', recuperavel: true,
    termos: ['application error', 'client-side exception', 'a client-side exception has occurred', 'unhandled runtime error', 'something went wrong', 'chunkloaderror', 'hydration failed'],
  },
  { motivo: 'nao_encontrada', recuperavel: false, termos: ['this page could not be found', 'page not found', '404 not found', '404: not found', 'página não encontrada', 'pagina no encontrada', 'deployment_not_found', 'this deployment cannot be found'] },
  {
    motivo: 'erro_do_servidor', recuperavel: true,
    termos: ['internal server error', '500 internal', 'bad gateway', '502 bad', 'service unavailable', '503 service', 'gateway timeout', '504 gateway', 'function_invocation_failed', 'error 1020', 'error code 52'],
  },
  {
    motivo: 'bloqueio', recuperavel: true,
    termos: ['just a moment', 'attention required', 'access denied', 'verify you are human', 'checking your browser', 'captcha', 'enable javascript and cookies', 'request blocked', '403 forbidden'],
  },
];

/** Corpo com menos que isso (e sem imagem) = nada hidratou. */
export const MIN_TEXTO = 20;

/**
 * Página quebrada pelo que o navegador leu (título + texto visível + status). Os sinais só valem no começo do texto
 * (até 600 caracteres) ou no título: uma LP boa que cita "404" no meio de um parágrafo não cai aqui.
 */
export function diagnosticarPagina(i: { title: string; text: string; status?: number | null; imagens?: number }): DiagnosticoPagina {
  const st = i.status ?? null;
  if (st && st >= 500) return { ok: false, motivo: 'erro_do_servidor', detalhe: `http ${st}`, recuperavel: true };
  if (st === 404 || st === 410) return { ok: false, motivo: 'nao_encontrada', detalhe: `http ${st}`, recuperavel: false };
  if (st && [401, 403, 407, 429, 451].includes(st)) return { ok: false, motivo: 'bloqueio', detalhe: `http ${st}`, recuperavel: true };
  const texto = (i.text ?? '').trim();
  const alvo = `${i.title ?? ''}\n${texto.slice(0, 600)}`.toLowerCase();
  for (const s of SINAIS) {
    const t = s.termos.find((x) => alvo.includes(x));
    if (t) return { ok: false, motivo: s.motivo, detalhe: t, recuperavel: s.recuperavel };
  }
  if (texto.length < MIN_TEXTO && !(i.imagens ?? 0)) return { ok: false, motivo: 'pouco_texto', detalhe: `${texto.length} caracteres`, recuperavel: true };
  return { ok: true, motivo: null, detalhe: null, recuperavel: false };
}

/**
 * Fração de pixels perto da cor mais frequente (RGB 24 bits, cores agrupadas em blocos de 16 níveis). 1 = uma cor só.
 */
export function fracaoDaCorDominante(rgb: Uint8Array): number {
  const n = Math.floor(rgb.length / 3);
  if (!n) return 1;
  const conta = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const k = ((rgb[3 * i] >> 4) << 8) | ((rgb[3 * i + 1] >> 4) << 4) | (rgb[3 * i + 2] >> 4);
    conta.set(k, (conta.get(k) ?? 0) + 1);
  }
  return Math.max(...conta.values()) / n;
}

/** Tela "quase só de uma cor": ≥ 98,5 % da cor dominante; ou ≥ 95 % com pouco texto (< 150 caracteres). */
export function quaseUmaCor(fracao: number, textoChars: number): boolean {
  return fracao >= 0.985 || (fracao >= 0.95 && textoChars < 150);
}

/** Pixels de uma imagem reduzida a 48×48 (ffmpeg). Falhou = null (não decide nada). */
export async function lerPixels(arquivo: string, ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'): Promise<Uint8Array | null> {
  try {
    const r = await run(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', arquivo, '-frames:v', '1', '-vf', 'scale=48:48', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
      encoding: 'buffer', maxBuffer: 1 << 20, timeout: 20_000,
    });
    return new Uint8Array(r.stdout as Buffer);
  } catch {
    return null;
  }
}

/** Diagnóstico pela IMAGEM (captura já salva, sem texto): só o critério de "uma cor" com pouco texto desconhecido. */
export async function diagnosticarImagem(arquivo: string, textoChars = 0): Promise<DiagnosticoPagina> {
  const px = await lerPixels(arquivo);
  if (!px) return { ok: true, motivo: null, detalhe: null, recuperavel: false };
  const f = fracaoDaCorDominante(px);
  return quaseUmaCor(f, textoChars)
    ? { ok: false, motivo: 'uma_cor', detalhe: `${Math.round(f * 1000) / 10} % de uma cor`, recuperavel: true }
    : { ok: true, motivo: null, detalhe: null, recuperavel: false };
}
