// Orquestra a leitura da oferta em cascata (briefing-leitura-v2 §1): cada camada só roda se a anterior não bastou.
//   (a) HTTP puro            pagina.ts        sempre
//   (b) render + scroll      render-pagina.ts texto < 2 000 ou SPA (a melhor das duas vence)            custo 0
//   (b') caminhante de funil caminhante.ts   cara de quiz (poucos links internos ou dica na URL/título)  custo 0
//   (c) subpáginas           subpaginas.ts    há candidata (links, crt.sh ou rotas convencionais)      custo 0
//   (d) imagens              imagens.ts       gatilho §3.1 → vão na mesma chamada do briefing           ~US$ 0,01/imagem
// Orçamento de leitura: 75 s de relógio; estourou = segue pro `extracting` com o que leu (nunca falha por teto se já
// tem ≥ 200 caracteres). PAGE_UNREADABLE só depois de (a) e (b) < 200 caracteres e (d) sem imagem.
// Emite os 4 stages de leitura sempre, na ordem (etapa que não precisou rodar é emitida mesmo assim: o backend marca feita);
// `walking_quiz` só quando o caminhante roda. O caminhante tem relógio próprio (60 s), somado ao orçamento de 75 s.
// Ordem das páginas pro prompt: principal → oferta/checkout do funil → subpáginas → telas do quiz (o corte de texto
// come do fim, então as perguntas saem antes da oferta).
import { Logger } from '@nestjs/common';
import type { ExtractStage, ReadMode } from '../contrato';
import { IntegracaoError, isIntegracaoError } from '../erros';
import { IMAGE_LIMITS, captureImages, imageTrigger, type CapturedImage, type ImageCapturer } from './imagens';
import { LOGIN_WALL_CHARS, MIN_TEXT_CHARS, NO_TEXT_DETAIL, RENDER_BELOW_CHARS, fetchHtmlPage, loginWall, mergeRendered, type HttpPage, type PageText } from './pagina';
import type { FunnelWalker, WalkResult } from './caminhante';
import type { RenderPageOptions, RenderedPage } from './render-pagina';
import { pickCandidates, readSubpages, type SubpageOptions } from './subpaginas';

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
  /** (b'): caminhante de funil (A1, 28/10); null/ausente = não caminha */
  walk?: FunnelWalker | null;
}

/** Dica de quiz/funil na URL ou no título (o caminhante confirma dentro do navegador). */
const QUIZ_HINT = /\b(?:quiz|survey|assessment|questionario|questionnaire|teste|test|avaliacao|diagnostico|start|step|etapa|funil|funnel)\b/i;
/** Menos links internos que isso = candidato a quiz (SPA de uma tela só). */
export const WALK_MAX_LINKS = 3;

/** Vale abrir o caminhante? Pouco link interno (SPA/quiz) ou dica na URL/título. Landing com menu e rodapé não caminha. */
export function shouldWalk(page: PageText): boolean {
  const hint = QUIZ_HINT.test(`${page.url.normalize('NFD').replace(/[\u0300-\u036f]/g, '')} ${(page.title ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`);
  return hint || pickCandidates(page).internal.length < WALK_MAX_LINKS;
}

export interface OfferReading {
  page: PageText;
  images: CapturedImage[];
  /** por que a camada (d) rodou (null = não rodou) */
  imageReason: ReturnType<typeof imageTrigger>;
  readMs: number;
  /** o que o caminhante de funil fez (null = não rodou) */
  walk?: { screens: number; stoppedBy: WalkResult['stoppedBy']; actions: number; ms: number; blocked: number } | null;
}

const log = new Logger('LeituraOferta');

export async function readOffer(url: string, opts: ReadOfferOptions, onStage: (stage: ExtractStage) => void): Promise<OfferReading> {
  const now = opts.now ?? Date.now;
  const start = now();
  let deadline = start + READ_BUDGET_MS;

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

  // (b') caminhante de funil: quiz → clica a resposta neutra até a oferta final e PARA (nunca paga)
  let walked: WalkResult | null = null;
  if (opts.walk && now() <= deadline && shouldWalk(page)) {
    onStage('walking_quiz');
    const t = now();
    walked = await opts.walk(page.url).catch((e) => { log.warn(`caminhante de ${page.url} falhou (${(e as Error).message})`); return null; });
    deadline += now() - t; // relógio próprio: não come o orçamento das outras camadas
  }
  const mainKey = page.text.slice(0, 500);
  const walkPages = (walked?.screens ?? [])
    .filter((sc) => sc.text.trim() && sc.text.slice(0, 500) !== mainKey)
    .map((sc) => ({ url: `${sc.url.replace(/#.*$/, '')}#step-${sc.step}`, role: sc.role, title: sc.title, text: sc.text, truncated: sc.truncated, via: 'rendered' as const, images: [] }));
  const walkFinal = walkPages.filter((p) => p.role !== 'quiz_step');
  const walkSteps = walkPages.filter((p) => p.role === 'quiz_step');

  // (c) subpáginas
  onStage('reading_subpages');
  let subs: PageText['pages'] = [];
  if (now() <= deadline && (page.anchors?.length || page.links?.length || page.text.length >= MIN_TEXT_CHARS)) {
    const walkKeys = new Set(walkPages.map((p) => p.text.slice(0, 500)));
    subs = (await readSubpages(page, { ...opts, deadline, now })).filter((p) => !walkKeys.has(p.text.slice(0, 500)));
  }
  if (subs.length || walkPages.length) page = { ...page, pages: [page.pages[0], ...walkFinal, ...subs, ...walkSteps] };
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
  const imageReason = imageTrigger({ url: page.url, title: page.title, mainText: page.text, totalText, bigImgs, hasVideo, quiz: walkPages.length > 0 });
  let images: CapturedImage[] = [];
  const capture = opts.capture === undefined ? captureImages : opts.capture;
  if (imageReason && capture && now() <= deadline) {
    try {
      images = await capture(page, page.pages.slice(1), { ...opts.browser, fetchImpl: opts.fetchImpl, resolve: opts.resolve, allowPrivate: opts.allowPrivate, deadline, now });
    } catch (e) {
      log.warn(`imagens de ${page.url} falharam (${(e as Error).message}); segue sem visão`);
    }
  }
  // prints da tela final do funil (a oferta é estado da SPA: só o caminhante chegou lá) entram garantidos no teto de 8
  const final = walkFinal[walkFinal.length - 1];
  if (imageReason && final && walked?.shots.length) {
    const shots = walked.shots.slice(0, IMAGE_LIMITS.max);
    images = [...images.slice(0, IMAGE_LIMITS.max - shots.length), ...shots.map((sh, k) => ({
      index: 0, src: `${final.url}#screen-${k + 1}`, alt: null, kind: 'screenshot' as const, widthPx: sh.widthPx, heightPx: sh.heightPx,
      data: sh.data, mediaType: 'image/jpeg' as const, page: { role: final.role, url: final.url },
    }))].map((img, i) => ({ ...img, index: i + 1 }));
  }
  if (images.length) page = { ...page, pages: page.pages.map((p) => ({ ...p, images: images.filter((i) => i.page.url === p.url && i.page.role === p.role).map(({ index, src, alt, kind, widthPx, heightPx }) => ({ index, src, alt, kind, widthPx, heightPx })) })) };

  // página vazia de verdade: (a) e (b) < 200 e nada pra olhar
  if (total < MIN_TEXT_CHARS && !images.length) {
    throw renderTried
      ? new IntegracaoError('PAGE_UNREADABLE', 'empty after render', { reason: 'empty_after_render' })
      : new IntegracaoError('PAGE_UNREADABLE', NO_TEXT_DETAIL);
  }

  const readMode: ReadMode = images.length ? 'vision' : page.pages.length > 1 ? 'crawled' : page.rendered ? 'rendered' : 'http';
  const walk = walked ? { screens: walked.screens.length, stoppedBy: walked.stoppedBy, actions: walked.actions, ms: walked.ms, blocked: walked.blocked } : null;
  if (walk) log.log(`caminhante ${page.url}: ${walk.screens} telas, ${walk.actions} ações, parou por ${walk.stoppedBy}, ${walk.blocked} requisições barradas, ${walk.ms} ms`);
  return { page: { ...page, readMode }, images, imageReason, readMs: now() - start, walk };
}

function stripHttp(h: HttpPage): PageText {
  const { spa: _s, passwordInput: _p, bigImgs: _b, hasVideo: _v, status: _st, ...page } = h;
  return page;
}
