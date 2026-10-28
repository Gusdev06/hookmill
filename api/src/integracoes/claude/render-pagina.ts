// Camada (b) da leitura da oferta (briefing-leitura-v2 §1) e a sessão de navegador que a camada (d) reaproveita.
// Bug live 22/10: quiz 100% JS devolvia 135 caracteres por HTTP puro e o job caía em PAGE_UNREADABLE. Abre a URL no
// mesmo chrome-headless-shell que a API já carrega pro Remotion (custo US$ 0), espera a rede assentar, ROLA a página
// até o fim (lazy-load, seções animadas, conteúdo "ao rolar") e só então lê innerText + title + meta description +
// alt das imagens + texto de <noscript>, os links internos (href + âncora + se é botão), as maiores <img> (tamanho
// natural), o player de vídeo da primeira tela e se há senha visível (muro de login, §7).
// `openPage` é a sessão reutilizável: imagens.ts usa pra tirar as telas e redimensionar imagens (canvas, sem lib nativa).
// Nunca clica, digita ou envia formulário (§6/§7). SSRF: quem chama já validou o host (pagina.ts); aqui ainda
// barramos redirect pra host privado e sub-recurso pra IP privado.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { getDomain } from 'tldts';
import type { Browser, Page } from 'puppeteer-core';
import { acharNavegador } from '../../common/util/navegador';
import { IntegracaoError } from '../erros';
import { isPrivateIp } from './pagina';
import { pickCtaColor } from './cor-marca';

export interface RenderedLink { href: string; text: string; cta?: boolean }
/** `<img>` da página com tamanho natural (candidata da camada d). */
export interface RenderedImage { src: string; alt: string | null; width: number; height: number }

export interface RenderedPage {
  /** URL final (depois dos redirects do navegador) */
  url: string;
  title: string | null;
  description: string | null;
  /** innerText + [image: alt] + <noscript>, já limpo; cortado em `maxChars` */
  text: string;
  /** links do mesmo domínio/subdomínios (href absoluto + texto da âncora + cta), sem repetir, até 50 */
  links: RenderedLink[];
  /** maiores `<img>` (largura natural ≥ 200, sem svg/gif, sem logo/ícone), por área, até 40 */
  images: RenderedImage[];
  /** `<img>` com largura natural ≥ 400 (gatilho 2 do §3.1) */
  bigImgs: number;
  /** player na primeira tela: poster do <video> ou thumb conhecida; `ogImage` é o fallback */
  video: { firstScreen: boolean; poster: string | null; ogImage: string | null };
  /** `<input type=password>` visível (muro de login) */
  passwordVisible: boolean;
  /** resultado-v1: cor de destaque dos CTAs (`#RRGGBB`, computed style); null = nenhum CTA com cor */
  ctaColor?: string | null;
  /** telas 390×844 @2x já redimensionadas (lado maior ≤ 1 568), JPEG base64 — só com `screens > 0` */
  screens?: RenderedShot[];
  /** print da página inteira (só com `screenshot: true`) */
  screenshotPng?: Buffer;
}

export interface RenderedShot { data: string; widthPx: number; heightPx: number }

export interface RenderPageOptions {
  /** REMOTION_BROWSER_EXECUTABLE; vazio = o chrome-headless-shell do Remotion. Sem binário → `null` (a chamada pula o fallback). */
  browserExecutable?: string | null;
  /** navegação até networkidle2 (20 s) */
  timeoutMs?: number;
  /** rola até o fim antes de ler (padrão true) */
  scroll?: boolean;
  /** teto do auto-scroll (30 s) */
  scrollTimeoutMs?: number;
  /** devolve `screenshotPng` da página inteira */
  screenshot?: boolean;
  /** devolve as N primeiras telas (§3.2) já redimensionadas */
  screens?: number;
  maxChars?: number;
  /** só testes: libera localhost */
  allowPrivate?: boolean;
  resolve?: (host: string) => Promise<string[]>;
}

/** Leitor injetável no fetchPage: `null` = não deu pra renderizar (sem binário), o chamador segue como antes. */
export type PageRenderer = (url: string) => Promise<RenderedPage | null>;

const NAV_TIMEOUT_MS = 20_000;
const SCROLL_TIMEOUT_MS = 30_000;
const SCROLL_PAUSE_MS = 300;
const MAX_LINKS = 50;
const MAX_IMAGES = 40;
const MAX_CHARS = 60_000;
/** §3.2: lado maior das imagens que vão pro Claude. */
export const IMAGE_MAX_SIDE = 1_568;
/** Viewport de celular (§1 b): página de venda e quiz são mobile-first; as telas saem em 9:16. */
export const CSS_W = 390, CSS_H = 844, DPR = 2;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const log = new Logger('RenderPagina');

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((a) => a.address);
}

/** Domínio registrável da oferta (foo.com.br, foo.vercel.app) — link interno = mesmo domínio ou subdomínio dele. */
function sameOffer(href: string, domain: string): boolean {
  try {
    const u = new URL(href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === domain || h.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

export interface PageSession { browser: Browser; page: Page; status: number | null; finalUrl: string }

/**
 * Sessão de navegador: abre a URL (networkidle2), rola se pedido, entrega a página pro `fn` e fecha tudo no fim.
 * `null` quando não há binário (aviso no log). Lança IntegracaoError quando o navegador não conseguiu abrir/ler.
 */
export async function openPage<T>(rawUrl: string, opts: RenderPageOptions, fn: (s: PageSession) => Promise<T>): Promise<T | null> {
  const executablePath = acharNavegador(opts.browserExecutable);
  if (!executablePath) {
    log.warn('chrome-headless-shell não encontrado (REMOTION_BROWSER_EXECUTABLE): página JS fica sem fallback de render');
    return null;
  }
  const alvo = new URL(rawUrl);
  const navTimeout = opts.timeoutMs ?? NAV_TIMEOUT_MS;
  const scrollTimeout = (opts.scroll ?? true) ? (opts.scrollTimeoutMs ?? SCROLL_TIMEOUT_MS) : 0;
  const resolve = opts.resolve ?? defaultResolve;
  const hostPrivado = async (host: string): Promise<boolean> => {
    const h = host.replace(/^\[|\]$/g, '');
    if (isIP(h)) return isPrivateIp(h);
    const ips = await resolve(h).catch(() => [] as string[]);
    return !ips.length || ips.some(isPrivateIp);
  };

  const puppeteer = await import('puppeteer-core');
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'render-pagina-'));
  const browser = await puppeteer.launch({
    executablePath, headless: true, userDataDir,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run'],
  });
  // relógio de segurança: nada aqui pode passar de navegação + rolagem + folga (telas e imagens cabem na folga)
  let estourou = false;
  const relogio = setTimeout(() => { estourou = true; void browser.close().catch(() => undefined); }, navTimeout + scrollTimeout + 15_000);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: CSS_W, height: CSS_H, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
    if (!opts.allowPrivate) {
      // documento (inclusive redirect) pra host privado e qualquer sub-recurso pra IP privado literal: fora
      await page.setRequestInterception(true);
      page.on('request', (r) => {
        void (async () => {
          try {
            const u = new URL(r.url());
            if (u.protocol === 'http:' || u.protocol === 'https:') {
              const h = u.hostname.replace(/^\[|\]$/g, '');
              const bloqueia = r.resourceType() === 'document' ? await hostPrivado(h) : isIP(h) ? isPrivateIp(h) : false;
              if (bloqueia) return void (await r.abort('blockedbyclient'));
            }
          } catch { /* data:, blob:, about: */ }
          await r.continue();
        })().catch(() => undefined);
      });
    }

    let resp;
    try {
      resp = await page.goto(alvo.href, { waitUntil: 'networkidle2', timeout: navTimeout });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(msg)) throw new IntegracaoError('PAGE_UNREADABLE', 'private address not allowed');
      // a página pode ter carregado e só a rede não assentou (polling, analytics): seguimos com o que tem
      if (!/timeout/i.test(msg)) throw new IntegracaoError('PAGE_UNREADABLE', `render failed: ${msg.slice(0, 200)}`);
    }
    const status = resp?.status() ?? null;
    if (status && [401, 403, 451].includes(status)) throw new IntegracaoError('PAGE_FORBIDDEN', `page returned ${status}`);
    if (status === 429) throw new IntegracaoError('RATE_LIMITED', 'page returned 429');
    if (status && status >= 400) throw new IntegracaoError('PAGE_UNREADABLE', `page returned ${status}`);

    if (scrollTimeout > 0) {
      // 1 viewport por passo, pausa ~300 ms, até a altura parar de crescer (2 passos sem mudar no fim) ou o teto
      await page.evaluate(async (pausa: number, teto: number) => {
        const inicio = Date.now();
        let altura = document.documentElement.scrollHeight;
        let estavel = 0;
        while (Date.now() - inicio < teto) {
          window.scrollBy(0, window.innerHeight);
          await new Promise((r) => setTimeout(r, pausa));
          const nova = document.documentElement.scrollHeight;
          const noFim = window.scrollY + window.innerHeight >= nova - 2;
          if (nova === altura && noFim) { if (++estavel >= 2) break; } else estavel = 0;
          altura = nova;
        }
        window.scrollTo(0, 0);
      }, SCROLL_PAUSE_MS, scrollTimeout).catch(() => undefined);
      await page.waitForNetworkIdle({ idleTime: 400, timeout: 3000 }).catch(() => undefined);
    }
    return await fn({ browser, page, status, finalUrl: page.url() || alvo.href });
  } catch (e) {
    if (e instanceof IntegracaoError) throw e;
    if (estourou) throw new IntegracaoError('PAGE_UNREADABLE', `render passed ${navTimeout + scrollTimeout} ms`);
    const msg = (e as Error).message ?? String(e);
    throw new IntegracaoError('PAGE_UNREADABLE', `render failed: ${msg.slice(0, 200)}`);
  } finally {
    clearTimeout(relogio);
    await browser.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Lê o DOM já carregado (e rolado): texto, links, imagens, player, senha. */
export async function readDom(s: PageSession, opts: { maxChars?: number } = {}): Promise<Omit<RenderedPage, 'screens' | 'screenshotPng'>> {
  const { page } = s;
  const info = await page.evaluate((maxLinks: number, maxImages: number, cssH: number) => {
    const meta = (sel: string) => (document.querySelector(sel) as HTMLMetaElement | null)?.content?.trim() || null;
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const alts = [...document.images].map((i) => i.alt?.trim()).filter((a): a is string => !!a && a.length >= 3).map((a) => `[image: ${a}]`);
    const noscript = [...document.querySelectorAll('noscript')].map((n) => (n.textContent ?? '').replace(/<[^>]+>/g, ' ')).join('\n');
    const links: { href: string; text: string; cta: boolean }[] = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const href = (a as HTMLAnchorElement).href;
      if (!/^https?:/.test(href)) continue;
      const cls = `${a.className} ${a.getAttribute('role') ?? ''}`;
      const cta = /\b(?:btn|button|cta)\b/i.test(cls) || /^button$/i.test(a.getAttribute('role') ?? '') || !!a.closest('button') || !!a.querySelector('button');
      links.push({ href, text: (a.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120), cta });
      if (links.length >= maxLinks * 10) break;
    }
    const images: { src: string; alt: string | null; width: number; height: number }[] = [];
    let bigImgs = 0;
    for (const i of document.images) {
      const src = i.currentSrc || i.src;
      if (!/^https?:/.test(src) || /\.(?:svg|gif)(?:[?#]|$)/i.test(src) || /image\/svg/i.test(src)) continue;
      const w = i.naturalWidth, h = i.naturalHeight;
      if (w >= 400) bigImgs++;
      if (w < 200 || h < 20) continue;
      if (/\b(?:logo|icon|ícone|icone|avatar|badge|selo|seal|flag|bandeira)\b/i.test(`${i.alt ?? ''} ${i.className ?? ''} ${src.split('/').pop() ?? ''}`)) continue;
      images.push({ src, alt: i.alt?.trim() || null, width: w, height: h });
    }
    images.sort((a, b) => b.width * b.height - a.width * a.height);
    const seen = new Set<string>();
    const topImages = images.filter((i) => !seen.has(i.src) && seen.add(i.src)).slice(0, maxImages);
    // player na primeira tela: <video poster>, iframe do youtube (thumb conhecida); vturb/vimeo/wistia/panda → og:image
    let firstScreen = false;
    let poster: string | null = null;
    for (const el of document.querySelectorAll('video, iframe')) {
      const r = el.getBoundingClientRect();
      const src = (el.getAttribute('src') ?? '') + ' ' + (el.getAttribute('data-src') ?? '');
      const isPlayer = el.tagName === 'VIDEO' || /youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|vturb|converteai|wistia|pandavideo/i.test(src);
      if (!isPlayer || r.width < 100 || r.bottom <= 0 || r.top >= cssH) continue;
      firstScreen = true;
      if (el.tagName === 'VIDEO' && (el as HTMLVideoElement).poster) { poster = (el as HTMLVideoElement).poster; break; }
      const yt = /(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([\w-]{6,})/i.exec(src)?.[1];
      if (yt) { poster = `https://img.youtube.com/vi/${yt}/hqdefault.jpg`; break; }
    }
    // resultado-v1 (A2): fundo dos CTAs como o navegador pintou (cor de destaque da marca; o Node escolhe em cor-marca.ts)
    const ctaColors: { color: string; area: number }[] = [];
    const ctaSel = 'button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn" i], a[class*="button" i], a[class*="cta" i]';
    for (const el of document.querySelectorAll(ctaSel)) {
      if (ctaColors.length >= 40) break;
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 24) continue;
      const st = getComputedStyle(el);
      const grad = /rgba?\([^)]+\)/.exec(st.backgroundImage || '')?.[0];
      const color = grad ?? st.backgroundColor;
      if (color) ctaColors.push({ color, area: Math.round(r.width * r.height) });
    }
    const passwordVisible = [...document.querySelectorAll('input[type="password"]')].some(visible);
    return {
      title: document.title || null,
      description: meta('meta[name="description"]') ?? meta('meta[property="og:description"]') ?? meta('meta[name="twitter:description"]'),
      text: document.body?.innerText ?? '',
      alts, noscript, links, images: topImages, bigImgs,
      video: { firstScreen, poster, ogImage: meta('meta[property="og:image"]') },
      passwordVisible, ctaColors,
    };
  }, MAX_LINKS, MAX_IMAGES, CSS_H);

  if (/just a moment|attention required|access denied|verify you are human|captcha/i.test(`${info.title ?? ''} ${info.text.slice(0, 300)}`)) {
    throw new IntegracaoError('PAGE_FORBIDDEN', 'bot challenge page');
  }

  const finalUrl = s.finalUrl;
  const domain = getDomain(new URL(finalUrl).hostname, { allowPrivateDomains: true }) ?? new URL(finalUrl).hostname.toLowerCase();
  const seen = new Set<string>();
  const links: RenderedLink[] = [];
  for (const l of info.links) {
    const href = l.href.replace(/#.*$/, '');
    if (!href || !sameOffer(href, domain)) continue;
    const prev = seen.has(href);
    if (prev) { if (l.cta) { const p = links.find((x) => x.href === href); if (p) p.cta = true; } continue; }
    seen.add(href);
    links.push({ href, text: l.text, cta: l.cta });
    if (links.length >= MAX_LINKS) break;
  }
  const abs = (u: string | null) => { try { return u ? new URL(u, finalUrl).toString() : null; } catch { return null; } };
  const text = tidy([info.text, info.alts.join('\n'), info.noscript].filter((t) => t.trim()).join('\n\n')).slice(0, opts.maxChars ?? MAX_CHARS);
  return {
    url: finalUrl, title: info.title, description: info.description, text, links,
    images: info.images, bigImgs: info.bigImgs,
    video: { firstScreen: info.video.firstScreen, poster: abs(info.video.poster), ogImage: abs(info.video.ogImage) },
    passwordVisible: info.passwordVisible,
    ctaColor: pickCtaColor(info.ctaColors ?? []),
  };
}

/**
 * Telas da página (§3.2 item 1): N primeiras janelas de 390×844 css @2x (780×1688), reduzidas pra lado maior ≤ 1 568, JPEG.
 * Página mais curta que N telas devolve só as que existem.
 */
export async function shootScreens(s: PageSession, n: number): Promise<RenderedShot[]> {
  const altura = await s.page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0)).catch(() => CSS_H);
  const total = Math.max(1, Math.min(n, Math.ceil(altura / CSS_H)));
  const out: RenderedShot[] = [];
  const util = await s.browser.newPage();
  try {
    for (let k = 0; k < total; k++) {
      const png = await s.page.screenshot({ type: 'png', clip: { x: 0, y: k * CSS_H, width: CSS_W, height: CSS_H }, captureBeyondViewport: true });
      const shot = await resizeImage(util, Buffer.from(png), 'image/png', IMAGE_MAX_SIDE);
      if (shot) out.push(shot);
    }
  } finally {
    await util.close().catch(() => undefined);
  }
  return out;
}

/**
 * Redimensiona com o canvas de uma aba em branco (sem CSP da página, sem lib nativa): lado maior ≤ maxSide, JPEG 85.
 * Imagem que o navegador não decodifica → null.
 */
export async function resizeImage(util: Page, bytes: Buffer, mime: string, maxSide: number): Promise<RenderedShot | null> {
  const dataUrl = `data:${mime};base64,${bytes.toString('base64')}`;
  try {
    return await util.evaluate(async (src: string, max: number) => {
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('decode')); img.src = src; });
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, max / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return { data: c.toDataURL('image/jpeg', 0.85).split(',')[1], widthPx: c.width, heightPx: c.height };
    }, dataUrl, maxSide);
  } catch {
    return null;
  }
}

/** Camada (b): abre, rola, lê o DOM (e as telas, se pedidas). `null` = sem binário. */
export async function renderPage(rawUrl: string, opts: RenderPageOptions = {}): Promise<RenderedPage | null> {
  return openPage(rawUrl, opts, async (s) => {
    const dom = await readDom(s, { maxChars: opts.maxChars });
    const out: RenderedPage = { ...dom };
    if (opts.screens && opts.screens > 0) out.screens = await shootScreens(s, opts.screens);
    if (opts.screenshot) out.screenshotPng = Buffer.from(await s.page.screenshot({ type: 'png', fullPage: true }));
    return out;
  });
}

function tidy(s: string): string {
  return s.replace(/[ \t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Leitor pronto pro fetchPage (o módulo monta um com o executável da config). */
export function makePageRenderer(opts: RenderPageOptions = {}): PageRenderer {
  return (url) => renderPage(url, opts);
}
