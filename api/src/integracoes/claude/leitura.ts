// Orquestra a leitura da oferta em cascata (briefing-leitura-v2 §1): cada camada só roda se a anterior não bastou.
//   (a) HTTP puro            pagina.ts        sempre
//   (b) render + scroll      render-pagina.ts texto < 2 000 ou SPA (a melhor das duas vence)            custo 0
//   (c) subpáginas           subpaginas.ts    há candidata (links, crt.sh ou rotas convencionais)      custo 0
//   (d) imagens              imagens.ts       gatilho §3.1 → vão na mesma chamada do briefing           ~US$ 0,01/imagem
// Orçamento de leitura: 75 s de relógio; estourou = segue pro `extracting` com o que leu (nunca falha por teto se já
// tem ≥ 200 caracteres). PAGE_UNREADABLE só depois de (a) e (b) < 200 caracteres e (d) sem imagem.
// Emite os 4 stages de leitura sempre, na ordem (etapa que não precisou rodar é emitida mesmo assim: o backend marca feita).
import { Logger } from '@nestjs/common';
import type { ExtractStage, ReadMode } from '../contrato';
import { IntegracaoError, isIntegracaoError } from '../erros';
import { captureImages, imageTrigger, type CapturedImage, type ImageCapturer } from './imagens';
import { LOGIN_WALL_CHARS, MIN_TEXT_CHARS, NO_TEXT_DETAIL, RENDER_BELOW_CHARS, fetchHtmlPage, loginWall, mergeRendered, type HttpPage, type PageText } from './pagina';
import type { RenderPageOptions, RenderedPage } from './render-pagina';
import { readSubpages, type SubpageOptions } from './subpaginas';

/** §1: relógio da leitura inteira (a+b+c+d). */
export const READ_BUDGET_MS = 75_000;
/** §2.4: teto de texto ≈ 60 000 (principal) + 6 × 8 000. */
export const MAX_TOTAL_CHARS = 108_000;

export interface ReadOfferOptions extends SubpageOptions {
  /** (b): render da principal; subpáginas usam o `render` herdado do FetchPageOptions. null/ausente = sem binário */
  renderMain?: ((url: string) => Promise<RenderedPage | null>) | null;
  /** (d): captura das imagens (testes injetam); null = sem navegador */
  capture?: ImageCapturer | null;
  /** opções do navegador pra (d) (executável, SSRF) */
  browser?: RenderPageOptions;
}

export interface OfferReading {
  page: PageText;
  images: CapturedImage[];
  /** por que a camada (d) rodou (null = não rodou) */
  imageReason: ReturnType<typeof imageTrigger>;
  readMs: number;
}

const log = new Logger('LeituraOferta');

export async function readOffer(url: string, opts: ReadOfferOptions, onStage: (stage: ExtractStage) => void): Promise<OfferReading> {
  const now = opts.now ?? Date.now;
  const start = now();
  const deadline = start + READ_BUDGET_MS;

  // (a) HTTP puro — lança por HTTP/bloqueio/muro de login
  onStage('fetching_page');
  const http = await fetchHtmlPage(url, opts);
  let page: PageText = stripHttp(http);
  let rendered: RenderedPage | null = null;
  let renderTried = false;
  let bigImgs = http.bigImgs;
  let hasVideo = http.hasVideo;

  // (b) render + scroll — texto curto ou esqueleto de SPA; a melhor das duas vence
  onStage('rendering_page');
  if ((http.text.length < RENDER_BELOW_CHARS || http.spa) && opts.renderMain) {
    renderTried = true;
    try {
      rendered = await opts.renderMain(http.url);
      if (rendered) {
        if (rendered.passwordVisible && rendered.text.length < LOGIN_WALL_CHARS) throw loginWall();
        bigImgs = Math.max(bigImgs, rendered.bigImgs);
        hasVideo = hasVideo || rendered.video.firstScreen;
        if (rendered.text.length > http.text.length) page = mergeRendered(http, rendered);
      } else renderTried = false; // sem binário: a cascata segue como hoje
    } catch (e) {
      // render que falha não derruba uma página que o HTTP já leu; página vazia propaga o motivo (403, login_wall…)
      if (http.text.length < MIN_TEXT_CHARS || (isIntegracaoError(e) && e.details?.reason === 'login_wall')) throw e;
      log.warn(`render de ${http.url} falhou (${(e as Error).message}); segue com o HTTP`);
    }
  }

  // (c) subpáginas
  onStage('reading_subpages');
  if (now() <= deadline && (page.anchors?.length || page.links?.length || page.text.length >= MIN_TEXT_CHARS)) {
    const subs = await readSubpages(page, { ...opts, deadline, now });
    page = { ...page, pages: [page.pages[0], ...subs] };
  }
  let total = page.pages.reduce((n, p) => n + p.text.length, 0);
  if (total > MAX_TOTAL_CHARS) {
    // teto de texto: corta as subpáginas do fim
    let budget = MAX_TOTAL_CHARS - page.pages[0].text.length;
    page = { ...page, pages: [page.pages[0], ...page.pages.slice(1).map((p) => { const t = p.text.slice(0, Math.max(0, budget)); budget -= t.length; return { ...p, text: t, truncated: p.truncated || t.length < p.text.length }; }).filter((p) => p.text.length)] };
    total = MAX_TOTAL_CHARS;
  }

  // (d) imagens — gatilho §3.1, na mesma chamada do briefing
  onStage('reading_images');
  const totalText = page.pages.map((p) => p.text).join('\n');
  const imageReason = imageTrigger({ url: page.url, title: page.title, mainText: page.text, totalText, bigImgs, hasVideo });
  let images: CapturedImage[] = [];
  const capture = opts.capture === undefined ? captureImages : opts.capture;
  if (imageReason && capture && now() <= deadline) {
    try {
      images = await capture(page, page.pages.slice(1), { ...opts.browser, fetchImpl: opts.fetchImpl, resolve: opts.resolve, allowPrivate: opts.allowPrivate, deadline, now });
    } catch (e) {
      log.warn(`imagens de ${page.url} falharam (${(e as Error).message}); segue sem visão`);
    }
  }
  if (images.length) page = { ...page, pages: page.pages.map((p) => ({ ...p, images: images.filter((i) => i.page.url === p.url && i.page.role === p.role).map(({ index, src, alt, kind, widthPx, heightPx }) => ({ index, src, alt, kind, widthPx, heightPx })) })) };

  // página vazia de verdade: (a) e (b) < 200 e nada pra olhar
  if (total < MIN_TEXT_CHARS && !images.length) {
    throw renderTried
      ? new IntegracaoError('PAGE_UNREADABLE', 'empty after render', { reason: 'empty_after_render' })
      : new IntegracaoError('PAGE_UNREADABLE', NO_TEXT_DETAIL);
  }

  const readMode: ReadMode = images.length ? 'vision' : page.pages.length > 1 ? 'crawled' : page.rendered ? 'rendered' : 'http';
  return { page: { ...page, readMode }, images, imageReason, readMs: now() - start };
}

function stripHttp(h: HttpPage): PageText {
  const { spa: _s, passwordInput: _p, bigImgs: _b, hasVideo: _v, status: _st, ...page } = h;
  return page;
}
