// Lê a página da oferta dentro da API (contrato: "fetch na própria API"), vira texto e devolve pro Claude.
// A URL vem do usuário: bloqueia rede interna (SSRF), segue no máximo 5 redirects reconferindo cada um,
// corta em 3 MB baixados. 401/403/451 ou desafio de bot → PAGE_FORBIDDEN (o web pede o texto colado);
// 429 → RATE_LIMITED; o resto → PAGE_UNREADABLE.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { IntegracaoError } from '../erros';

export interface PageText {
  url: string;
  title: string | null;
  description: string | null;
  text: string;
  /** o texto passou do limite e foi cortado (avisamos o Claude) */
  truncated: boolean;
  /** hrefs/actions absolutos (http/s) da página: de onde saem os subdomínios linkados (subdominios.ts) */
  links?: string[];
  /** subdomínios da mesma oferta lidos junto (checkout., app., members.…): complementam a página principal */
  related?: RelatedPage[];
}

export interface RelatedPage { url: string; title: string | null; text: string; truncated: boolean }

export interface FetchPageOptions {
  fetchImpl?: typeof fetch;
  /** testes: libera localhost */
  allowPrivate?: boolean;
  timeoutMs?: number;
  /** resolve o host (testes injetam) */
  resolve?: (host: string) => Promise<string[]>;
}

const MAX_BYTES = 3 * 1024 * 1024;
/** ~15 mil tokens. Página de venda cabe folgada; acima disso é rodapé, FAQ repetido e lixo de template. */
export const MAX_PAGE_CHARS = 60_000;
/** Menos que isso = página montada por JavaScript (SPA) ou vazia: o texto colado resolve. */
const MIN_TEXT_CHARS = 200;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<PageText> {
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
  const page = type.includes('text/plain') ? { title: null, description: null, text: tidy(body) } : htmlToText(body);
  const links = type.includes('text/plain') ? [] : extractLinks(body, url);
  if (/just a moment|attention required|enable javascript and cookies/i.test(page.title ?? '') && page.text.length < 2000)
    throw new IntegracaoError('PAGE_FORBIDDEN', 'bot challenge page');
  if (page.text.length < MIN_TEXT_CHARS) throw new IntegracaoError('PAGE_UNREADABLE', 'no readable text (page rendered by JavaScript?)');
  const truncated = page.text.length > MAX_PAGE_CHARS;
  return { url: url.toString(), ...page, text: truncated ? page.text.slice(0, MAX_PAGE_CHARS) : page.text, truncated, links };
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

async function assertPublicHost(host: string, resolve?: (h: string) => Promise<string[]>) {
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

async function readCapped(res: Response, max: number): Promise<Uint8Array> {
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

function tidy(s: string): string {
  return s
    .replace(/[ \t\f\v ]+/g, ' ')
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
