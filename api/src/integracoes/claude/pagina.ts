// Camada (a) da leitura da oferta (briefing-leitura-v2 §1): lê a página dentro da API (contrato: "fetch na própria API"),
// vira texto e devolve pro Claude. A URL vem do usuário: bloqueia rede interna (SSRF), segue no máximo 5 redirects
// reconferindo cada um, corta em 3 MB baixados. 401/403/451 ou desafio de bot → PAGE_FORBIDDEN (o web pede o texto
// colado); 429 → RATE_LIMITED; o resto → PAGE_UNREADABLE. Muro de login (§7) → PAGE_UNREADABLE { reason: 'login_wall' }.
// `fetchHtmlPage` devolve o que achou mesmo com pouco texto (a cascata decide o próximo passo); `fetchPage` é o leitor
// completo de UMA página: HTTP e, se vier vazia/SPA, render headless (render-pagina.ts) — é o que as subpáginas usam.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { PageImage, PageRole, ReadMode } from '../contrato';
import { IntegracaoError } from '../erros';
import type { PageRenderer, RenderedLink } from './render-pagina';

/** Página lida (principal ou subpágina), como vai pro prompt e pro `ExtractSources.pages`. */
export interface ReadPage {
  url: string;
  role: PageRole;
  title: string | null;
  text: string;
  truncated: boolean;
  via: 'http' | 'rendered';
  images: PageImage[];
}

/** Link da página com o texto da âncora; `cta` = está num botão (CTA principal vem primeiro dentro da mesma prioridade). */
export interface Anchor { href: string; text: string; cta: boolean }

export interface PageText {
  url: string;
  title: string | null;
  description: string | null;
  text: string;
  /** o texto passou do limite e foi cortado (avisamos o Claude) */
  truncated: boolean;
  /** hrefs/actions absolutos (http/s) da página: de onde saem os subdomínios linkados (subdominios.ts) */
  links?: string[];
  /** links com texto da âncora e flag de CTA (HTML ∪ DOM renderizado): candidatos a subpágina (subpaginas.ts) */
  anchors?: Anchor[];
  /** `<link rel=canonical>`: dedupe de subpágina */
  canonical?: string | null;
  /** só quando o texto veio do render headless: links do mesmo domínio com o texto da âncora */
  internalLinks?: RenderedLink[];
  /** o texto veio do Chromium headless (HTTP puro não tinha texto) */
  rendered?: boolean;
  /** pages[0].role === 'main'; subpáginas entram depois (leitura.ts) */
  pages: ReadPage[];
  readMode: ReadMode;
}

/** O que a camada (a) viu além do texto: a cascata usa pra decidir render (§1 b) e imagens (§3.1). */
export interface HttpPage extends PageText {
  /** esqueleto de app (root/__next) ou `<noscript>` pedindo JS */
  spa: boolean;
  /** `<input type=password>` no HTML */
  passwordInput: boolean;
  /** `<img>` com width declarado ≥ 400 ou sem width (aproximação do gatilho 2 do §3.1 quando não renderizou) */
  bigImgs: number;
  /** `<video>` ou iframe de player (youtube, vimeo, vturb, wistia, panda) no HTML */
  hasVideo: boolean;
  status: number;
}

export interface FetchPageOptions {
  fetchImpl?: typeof fetch;
  /** testes: libera localhost */
  allowPrivate?: boolean;
  timeoutMs?: number;
  /** resolve o host (testes injetam) */
  resolve?: (host: string) => Promise<string[]>;
  /** fallback pra página JS: renderiza no Chromium headless (`makePageRenderer`); ausente/null = sem fallback */
  render?: PageRenderer | null;
}

const MAX_BYTES = 3 * 1024 * 1024;
/** ~15 mil tokens. Página de venda cabe folgada; acima disso é rodapé, FAQ repetido e lixo de template. */
export const MAX_PAGE_CHARS = 60_000;
/** Menos que isso = página montada por JavaScript (SPA) ou vazia: tenta o render headless; sem ele, o texto colado resolve. */
export const MIN_TEXT_CHARS = 200;
/** §1 (b): HTTP puro com menos que isso ainda renderiza (a melhor das duas leituras vence). */
export const RENDER_BELOW_CHARS = 2_000;
/** §7: redirect pra /login ou senha visível com menos texto que isso = muro de login. */
export const LOGIN_WALL_CHARS = 1_000;
export const NO_TEXT_DETAIL = 'no readable text (page rendered by JavaScript?)';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const LOGIN_PATH = /\/(?:login|signin|sign-in|entrar|acesso|minha-conta|my-account|auth)(?:[/?#]|$)/i;

/** Camada (a): HTTP puro. Devolve mesmo com pouco texto; só lança por HTTP/bloqueio/muro de login. */
export async function fetchHtmlPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<HttpPage> {
  const f = opts.fetchImpl ?? fetch;
  let url = parseUrl(rawUrl);
  let res: Response | null = null;
  for (let hop = 0; hop <= 5; hop++) {
    if (!opts.allowPrivate) await assertPublicHost(url.hostname, opts.resolve);
    try {
      res = await f(url.toString(), {
        redirect: 'manual',
        signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'en,pt-BR;q=0.9,es;q=0.8' },
      });
    } catch (e) {
      throw new IntegracaoError('PAGE_UNREADABLE', `fetch failed: ${(e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = parseUrl(new URL(res.headers.get('location')!, url).toString());
      continue;
    }
    break;
  }
  if (!res || (res.status >= 300 && res.status < 400)) throw new IntegracaoError('PAGE_UNREADABLE', 'too many redirects');

  if (res.status === 401 || res.status === 403 || res.status === 451) throw new IntegracaoError('PAGE_FORBIDDEN', `page returned ${res.status}`);
  if (res.status === 429) throw new IntegracaoError('RATE_LIMITED', 'page returned 429');
  if (res.status === 503 && res.headers.get('cf-mitigated')) throw new IntegracaoError('PAGE_FORBIDDEN', 'bot challenge');
  if (!res.ok) throw new IntegracaoError('PAGE_UNREADABLE', `page returned ${res.status}`);

  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (type && !/text\/html|application\/xhtml|text\/plain/.test(type)) throw new IntegracaoError('PAGE_UNREADABLE', `not a web page (${type})`);

  const bytes = await readCapped(res, MAX_BYTES);
  const charset = /charset=([\w-]+)/.exec(type)?.[1] ?? 'utf-8';
  let body: string;
  try {
    body = new TextDecoder(charset).decode(bytes);
  } catch {
    body = new TextDecoder('utf-8').decode(bytes);
  }
  const plain = type.includes('text/plain');
  const page = plain ? { title: null, description: null, text: tidy(body) } : htmlToText(body);
  if (/just a moment|attention required|enable javascript and cookies/i.test(page.title ?? '') && page.text.length < 2000)
    throw new IntegracaoError('PAGE_FORBIDDEN', 'bot challenge page');
  const passwordInput = !plain && /<input\b[^>]*\btype\s*=\s*["']?password/i.test(body);
  if ((LOGIN_PATH.test(url.pathname) || passwordInput) && page.text.length < LOGIN_WALL_CHARS) throw loginWall();

  const anchors = plain ? [] : extractAnchors(body, url);
  const truncated = page.text.length > MAX_PAGE_CHARS;
  const text = truncated ? page.text.slice(0, MAX_PAGE_CHARS) : page.text;
  const main: ReadPage = { url: url.toString(), role: 'main', title: page.title, text, truncated, via: 'http', images: [] };
  return {
    url: url.toString(), ...page, text, truncated,
    links: plain ? [] : extractLinks(body, url),
    anchors,
    canonical: plain ? null : canonicalOf(body, url),
    pages: [main],
    readMode: 'http',
    spa: !plain && looksLikeSpa(body),
    passwordInput,
    bigImgs: plain ? 0 : countBigImgs(body),
    hasVideo: !plain && hasVideoPlayer(body),
    status: res.status,
  };
}

/**
 * Leitor completo de uma página: HTTP e, se vier com menos de MIN_TEXT_CHARS (ou esqueleto de SPA com pouco texto),
 * o render headless; lança PAGE_UNREADABLE só depois disso. É o que subpáginas e testes usam.
 */
export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<PageText> {
  const http = await fetchHtmlPage(rawUrl, opts);
  if (http.text.length >= MIN_TEXT_CHARS && !(http.spa && http.text.length < SPA_TEXT_CHARS)) return stripHttp(http);
  // segundo passo: o Chromium headless executa o JS, rola até o fim e lê o que apareceu (o host já passou na trava de SSRF)
  const r = opts.render ? await opts.render(http.url) : null;
  if (r && r.passwordVisible && r.text.length < LOGIN_WALL_CHARS) throw loginWall();
  if (r && r.text.length >= MIN_TEXT_CHARS) return mergeRendered(http, r);
  if (http.text.length < MIN_TEXT_CHARS) throw new IntegracaoError('PAGE_UNREADABLE', r ? 'empty after render' : NO_TEXT_DETAIL, r ? { reason: 'empty_after_render' } : undefined);
  return stripHttp(http);
}

/** Com cara de SPA (root/__next/noscript) e menos que isso, o HTTP puro provavelmente só pegou o esqueleto: renderiza também. */
const SPA_TEXT_CHARS = 800;

/** A leitura renderizada vira a página (texto, título, links do DOM); o HTML puro só complementa. */
export function mergeRendered(http: HttpPage, r: { url: string; title: string | null; description: string | null; text: string; links: RenderedLink[] }): PageText {
  const url = parseUrl(r.url).toString();
  const truncated = r.text.length > MAX_PAGE_CHARS;
  const text = truncated ? r.text.slice(0, MAX_PAGE_CHARS) : r.text;
  const anchors = dedupeAnchors([...r.links.map((l) => ({ href: l.href, text: l.text, cta: !!l.cta })), ...(http.anchors ?? [])]);
  return {
    url, title: r.title ?? http.title, description: r.description ?? http.description, text, truncated,
    links: [...new Set([...r.links.map((l) => l.href), ...(http.links ?? [])])],
    anchors, canonical: http.canonical, internalLinks: r.links, rendered: true,
    pages: [{ url, role: 'main', title: r.title ?? http.title, text, truncated, via: 'rendered', images: [] }],
    readMode: 'rendered',
  };
}

function stripHttp(h: HttpPage): PageText {
  const { spa: _s, passwordInput: _p, bigImgs: _b, hasVideo: _v, status: _st, ...page } = h;
  return page;
}

export function loginWall(): IntegracaoError {
  return new IntegracaoError('PAGE_UNREADABLE', 'login wall', { reason: 'login_wall' });
}

/** Esqueleto de app (React/Next/Vue) ou aviso "ative o JavaScript": o conteúdo só existe depois de rodar o script. */
export function looksLikeSpa(html: string): boolean {
  return /<(?:div|main)\b[^>]*\bid=["'](?:root|app|__next|__nuxt|___gatsby|svelte)["']|<noscript\b|data-reactroot|__NEXT_DATA__/i.test(html);
}

function countBigImgs(html: string): number {
  let n = 0;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (/\.svg\b/i.test(tag)) continue;
    const w = /\bwidth\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
    if (!w || Number(w) >= 400) n++;
  }
  return n;
}

export const VIDEO_PLAYER = /<video\b|<iframe\b[^>]*\bsrc=["'][^"']*(?:youtube(?:-nocookie)?\.com|youtu\.be|vimeo\.com|vturb|converteai|wistia|pandavideo)/i;
function hasVideoPlayer(html: string): boolean {
  return VIDEO_PLAYER.test(html);
}

function canonicalOf(html: string, base: URL): string | null {
  const tag = /<link\b[^>]*\brel=["']canonical["'][^>]*>/i.exec(html)?.[0];
  const href = tag && /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
  if (!href) return null;
  try {
    return new URL(decodeEntities(href.trim()), base).toString();
  } catch {
    return null;
  }
}

/** href de <a>/<area>/<link> e action de <form>, absolutos e http(s), sem repetir. */
export function extractLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<(?:a|area|form)\b[^>]*?\b(?:href|action)\s*=\s*["']([^"'#][^"']*)["']/gi)) {
    try {
      const u = new URL(decodeEntities(m[1].trim()), base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.toString());
    } catch { /* href quebrado */ }
    if (out.size >= 500) break;
  }
  return [...out];
}

/** `<a href>` com o texto da âncora e se é botão (classe btn/button/cta, role=button, ou dentro de <button>). Uma por href. */
export function extractAnchors(html: string, base: URL): Anchor[] {
  const out: Anchor[] = [];
  for (const m of html.matchAll(/<a\b([^>]*?)\bhref\s*=\s*["']([^"'#][^"']*)["']([^>]*)>([\s\S]{0,600}?)<\/a>/gi)) {
    try {
      const u = new URL(decodeEntities(m[2].trim()), base);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      const attrs = `${m[1]} ${m[3]}`;
      const inner = m[4];
      const text = tidy(decodeEntities(inner.replace(/<[^>]+>/g, ' '))).replace(/\s+/g, ' ').slice(0, 120);
      const cta = /\b(?:btn|button|cta)\b/i.test(attrs) || /\brole\s*=\s*["']button["']/i.test(attrs) || /<button\b/i.test(inner);
      out.push({ href: u.toString(), text, cta });
    } catch { /* href quebrado */ }
    if (out.length >= 500) break;
  }
  return dedupeAnchors(out);
}

export function dedupeAnchors(list: Anchor[]): Anchor[] {
  const seen = new Map<string, Anchor>();
  for (const a of list) {
    const prev = seen.get(a.href);
    if (!prev) seen.set(a.href, a);
    else if (a.cta && !prev.cta) seen.set(a.href, { ...prev, cta: true });
  }
  return [...seen.values()];
}

function parseUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new IntegracaoError('PAGE_UNREADABLE', 'invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new IntegracaoError('PAGE_UNREADABLE', 'only http(s)');
  return u;
}

/** SSRF: host público obrigatório (vale pra cada hop, cada subpágina, cada imagem baixada). */
export async function assertPublicHost(host: string, resolve?: (h: string) => Promise<string[]>) {
  const h = host.replace(/^\[|\]$/g, '');
  const ips = isIP(h) ? [h] : await (resolve ?? defaultResolve)(h).catch(() => [] as string[]);
  if (!ips.length) throw new IntegracaoError('PAGE_UNREADABLE', 'host not found');
  if (ips.some(isPrivateIp)) throw new IntegracaoError('PAGE_UNREADABLE', 'private address not allowed');
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((a) => a.address);
}

export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7));
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
}

/** Lê o corpo até `max` bytes (resposta HTML ou imagem). */
export async function readCapped(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, max);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(size, max));
  let at = 0;
  for (const p of parts) {
    const take = Math.min(p.byteLength, out.length - at);
    out.set(p.subarray(0, take), at);
    at += take;
    if (at >= out.length) break;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', euro: '€', middot: '·', bull: '•' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function meta(html: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${n}["'][^>]*>`, 'i');
    const tag = re.exec(html)?.[0];
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (content?.trim()) return decodeEntities(content.trim());
  }
  return null;
}

export function tidy(s: string): string {
  return s
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlToText(html: string): { title: string | null; description: string | null; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '') || meta(html, ['og:title', 'twitter:title']);
  const description = meta(html, ['description', 'og:description', 'twitter:description']);
  let body = /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<img[^>]*\balt=["']([^"']{3,})["'][^>]*>/gi, ' [image: $1] ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|blockquote|button|a)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ');
  return { title: title || null, description, text: tidy(decodeEntities(body)) };
}
