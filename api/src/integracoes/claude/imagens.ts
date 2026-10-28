// Camada (d) da leitura da oferta (briefing-leitura-v2 §3): imagens lidas pelo Claude com visão, na MESMA chamada do
// briefing. Só com gatilho (§3.1): pouco texto, landing "de banner", sem preço no texto mas com palavra de compra,
// ou quiz/VSL. O que entra (teto 8, nesta ordem): 4 telas da principal, poster do vídeo da primeira tela, maiores
// <img> (≥ 200 px, sem svg/gif/logo), e, sobrando vaga, 1 tela da página checkout/pricing. Tudo redimensionado pra
// lado maior ≤ 1 568 px (JPEG) pelo canvas do próprio Chromium (sem lib nativa). Custo ≈ US$ 0,01 por imagem
// (≤ ~1 600 tokens cada, `claude-opus-5-5`); teto de visão por job US$ 0,10 garantido pelas 8 imagens.
// Nada vai pro storage: as imagens vivem na memória do job e morrem com ele (§7).
import type { PageImage, PageRole } from '../contrato';
import { assertPublicHost, readCapped, type PageText, type ReadPage } from './pagina';
import { IMAGE_MAX_SIDE, openPage, readDom, resizeImage, shootScreens, type RenderPageOptions } from './render-pagina';

export const IMAGE_LIMITS = {
  max: 8,
  screens: 4,
  minImgWidth: 200,
  maxSide: IMAGE_MAX_SIDE,
  /** gatilho 1: texto total (principal + subpáginas) abaixo disso */
  triggerTextChars: 1_500,
  /** gatilho 2: ≥ 3 <img> ≥ 400 px e texto da principal abaixo de 4 000 */
  bannerImgs: 3,
  bannerTextChars: 4_000,
  imgBytes: 4 * 1024 * 1024,
  imgTimeoutMs: 5_000,
} as const;

const PRICE = /R\$ ?\d|US?\$ ?\d|€ ?\d|£ ?\d|\d+x de|\/m[eê]s|\/month|\/mo\b|\/ano|\/year|por m[eê]s|per month/i;
const BUY = /\b(?:comprar|compre|buy|assinar|assine|subscribe|checkout|quero|get started|começar|comece|start now|order|adquirir|garanta|garantir)\b/i;
const QUIZ_VSL = /\b(?:quiz|vsl)\b/i;

export interface ImageTriggerInput {
  url: string;
  title: string | null;
  mainText: string;
  totalText: string;
  /** <img> com largura ≥ 400 na principal */
  bigImgs: number;
  /** player de vídeo na primeira tela (ou, sem render, no HTML) */
  hasVideo: boolean;
  /** o caminhante de funil percorreu um quiz (gatilho 4 do §3.1) */
  quiz?: boolean;
}

/** §3.1: motivo do gatilho ou null. */
export function imageTrigger(i: ImageTriggerInput): 'little_text' | 'banner_page' | 'no_price' | 'quiz_or_vsl' | null {
  if (i.totalText.length < IMAGE_LIMITS.triggerTextChars) return 'little_text';
  if (i.bigImgs >= IMAGE_LIMITS.bannerImgs && i.mainText.length < IMAGE_LIMITS.bannerTextChars) return 'banner_page';
  if (!PRICE.test(i.totalText) && BUY.test(i.totalText)) return 'no_price';
  if (QUIZ_VSL.test(`${i.url} ${i.title ?? ''}`) || i.hasVideo || i.quiz) return 'quiz_or_vsl';
  return null;
}

/** Imagem pronta pra chamada: metadados do contrato + JPEG base64 + a página de onde veio (pro rótulo). */
export interface CapturedImage extends PageImage {
  data: string;
  mediaType: 'image/jpeg';
  page: { role: PageRole; url: string };
}

export interface CaptureOptions extends RenderPageOptions {
  fetchImpl?: typeof fetch;
  /** relógio da leitura (§1): passou, não abre página nova */
  deadline?: number;
  now?: () => number;
}

/** Injetável nos testes: (principal, subpáginas) → imagens. A real abre o Chromium. */
export type ImageCapturer = (main: PageText, pages: ReadPage[], opts: CaptureOptions) => Promise<CapturedImage[]>;

/** §3.2: telas da principal → poster → maiores <img> → 1 tela do checkout/pricing. `[]` sem binário ou sem nada legível. */
export async function captureImages(main: PageText, pages: ReadPage[], opts: CaptureOptions = {}): Promise<CapturedImage[]> {
  const now = opts.now ?? Date.now;
  const out: CapturedImage[] = [];
  const mainPage = { role: 'main' as PageRole, url: main.url };
  const push = (img: Omit<CapturedImage, 'index'>) => { if (out.length < IMAGE_LIMITS.max) out.push({ ...img, index: out.length + 1 }); };

  const captured = await openPage(main.url, { ...opts, scroll: true }, async (s) => {
    const dom = await readDom(s);
    // 1. telas da principal
    for (const shot of await shootScreens(s, IMAGE_LIMITS.screens)) {
      push({ src: `${s.finalUrl}#screen-${out.length + 1}`, alt: null, kind: 'screenshot', widthPx: shot.widthPx, heightPx: shot.heightPx, data: shot.data, mediaType: 'image/jpeg', page: mainPage });
    }
    const util = await s.browser.newPage();
    try {
      const grab = async (src: string, alt: string | null, kind: 'img' | 'poster') => {
        if (out.length >= IMAGE_LIMITS.max || now() > (opts.deadline ?? Infinity)) return;
        const bytes = await downloadImage(src, opts);
        if (!bytes) return;
        const shot = await resizeImage(util, bytes.data, bytes.mime, IMAGE_LIMITS.maxSide);
        if (!shot || shot.widthPx < IMAGE_LIMITS.minImgWidth) return;
        push({ src, alt, kind, widthPx: shot.widthPx, heightPx: shot.heightPx, data: shot.data, mediaType: 'image/jpeg', page: mainPage });
      };
      // 2. poster do vídeo da primeira tela (poster/thumb conhecida; senão og:image)
      const poster = dom.video.firstScreen ? dom.video.poster ?? dom.video.ogImage : null;
      if (poster) await grab(poster, 'video poster', 'poster');
      // 3. maiores <img> por área, sem repetir src
      const seen = new Set<string>(poster ? [poster] : []);
      for (const img of dom.images) {
        if (out.length >= IMAGE_LIMITS.max) break;
        if (seen.has(img.src) || img.width < IMAGE_LIMITS.minImgWidth) continue;
        seen.add(img.src);
        await grab(img.src, img.alt, 'img');
      }
    } finally {
      await util.close().catch(() => undefined);
    }
    return true;
  });
  if (!captured) return [];

  // 4. sobrou vaga: 1 tela da página de checkout/pricing (preço em imagem mora lá)
  const money = pages.find((p) => p.role === 'checkout') ?? pages.find((p) => p.role === 'pricing');
  if (money && out.length < IMAGE_LIMITS.max && now() <= (opts.deadline ?? Infinity)) {
    await openPage(money.url, { ...opts, scroll: false, timeoutMs: Math.min(opts.timeoutMs ?? 10_000, 10_000) }, async (s) => {
      const [shot] = await shootScreens(s, 1);
      if (shot) push({ src: `${s.finalUrl}#screen-1`, alt: null, kind: 'screenshot', widthPx: shot.widthPx, heightPx: shot.heightPx, data: shot.data, mediaType: 'image/jpeg', page: { role: money.role, url: money.url } });
    }).catch(() => undefined);
  }
  return out;
}

/** Baixa a imagem com a mesma trava de SSRF das páginas; ≤ 4 MB, 5 s. Falha → null. */
export async function downloadImage(src: string, opts: CaptureOptions): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const u = new URL(src);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!opts.allowPrivate) await assertPublicHost(u.hostname, opts.resolve);
    const res = await (opts.fetchImpl ?? fetch)(u.toString(), { signal: AbortSignal.timeout(IMAGE_LIMITS.imgTimeoutMs), headers: { accept: 'image/*' } });
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() || 'image/jpeg';
    if (!mime.startsWith('image/') || /svg|gif/.test(mime)) return null;
    const bytes = await readCapped(res, IMAGE_LIMITS.imgBytes);
    return bytes.byteLength ? { data: Buffer.from(bytes), mime } : null;
  } catch {
    return null;
  }
}

/** Rótulo de cada imagem na chamada (§3.2). */
export function imageCaption(i: CapturedImage): string {
  return `[image ${i.index} — page: ${i.page.role} ${i.page.url} — src: ${i.kind === 'screenshot' ? `screenshot ${i.src.split('#').pop()}` : i.src}${i.alt ? ` — alt: ${i.alt}` : ''}]`;
}

/** O que vai pro `ExtractSources.imagesRead` (sem base64). */
export function stripImage(i: CapturedImage, read?: string): PageImage {
  const { index, src, alt, kind, widthPx, heightPx } = i;
  return { index, src, alt, kind, widthPx, heightPx, ...(read ? { read } : {}) };
}
