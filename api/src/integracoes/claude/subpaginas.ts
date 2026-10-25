// Camada (c) da leitura da oferta (briefing-leitura-v2 §2): subpáginas da mesma oferta, por prioridade.
// Candidatas = links da principal (HTML ∪ DOM renderizado) no domínio da oferta ou subdomínio dele (+ funil do crt.sh);
// SPA/quiz sem link interno → sonda até 4 rotas convencionais (/checkout, /pricing…). Uma exceção externa: o CTA
// principal apontando pra checkout de plataforma (Hotmart, Kiwify, Stripe…) é lido como `checkout`, só ele (§2.3).
// Tetos: 6 páginas, 30 s no total, 2 em paralelo, 8 s cada, 8 000 caracteres por página. Nunca clica, digita nem loga.
// Nada aqui derruba o briefing: subpágina que falha fica de fora.
import type { PageRole } from '../contrato';
import { fetchPage, type Anchor, type FetchPageOptions, type PageText, type ReadPage } from './pagina';
import { bare, certSubdomains, labels, offerDomain, skipHost } from './subdominios';

export const SUBPAGE_LIMITS = {
  maxPages: 6,
  totalMs: 30_000,
  perPageMs: 8_000,
  parallel: 2,
  chars: 8_000,
  conventional: 4,
  conventionalMs: 5_000,
  externalCheckoutMs: 10_000,
  /** §2.1: só entra sondada se vier 200 e ≥ isso de texto */
  conventionalMinChars: 200,
} as const;

/** §2.2: papel pela âncora OU pela URL (sem acento, case-insensitive); primeira regra que casar. */
const ROLE_RULES: { role: PageRole; re: RegExp }[] = [
  { role: 'checkout', re: /\b(?:checkout|comprar|buy|pay|pagamento|carrinho|cart|order|assinar|subscribe|join|get started|quero)\b/ },
  { role: 'pricing', re: /\b(?:pricing|precos?|price|planos|plans|valor|investimento|oferta|offer)\b/ },
  { role: 'about', re: /\b(?:sobre|about|quem somos|who we are|nossa historia|our story|fundador)\b/ },
  { role: 'faq', re: /\b(?:faq|perguntas|duvidas|questions|how it works|como funciona)\b/ },
  { role: 'testimonials', re: /\b(?:depoimentos|testimonials|reviews|resultados|results|cases|alunos)\b/ },
  { role: 'terms', re: /\b(?:garantia|guarantee|reembolso|refund|termos|terms)\b/ },
  { role: 'thankyou', re: /\b(?:obrigado|thank-?you|thanks|confirmacao|success|upsell)\b/ },
];
const ROLE_ORDER: PageRole[] = ['checkout', 'pricing', 'about', 'faq', 'testimonials', 'terms', 'thankyou', 'other'];

/** §2.4: não seguir. */
const EXCLUDE_PATH = /(?:^|\/)(?:login|signin|sign-in|entrar|acesso|minha-conta|my-account|register|cadastro|cadastre-se|signup|sign-up|logout|sair|privacidade|privacy|cookies?|politica-de-cookies|cookie-policy|lgpd|blog|post|posts|noticias|news|artigos?|articles?)(?:[/?#.]|$)/i;
const EXCLUDE_FILE = /\.(?:pdf|zip|rar|mp4|mov|mp3|wav|jpe?g|png|gif|webp|svg|avif|ico|css|js|json|xml|txt)(?:[?#]|$)/i;
const SOCIAL_HOST = /(?:^|\.)(?:instagram\.com|facebook\.com|fb\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|linkedin\.com|whatsapp\.com|wa\.me|t\.me|telegram\.me|pinterest\.com|threads\.net)$/i;
const LANG_PREFIX = /^\/(?:en|es|pt|pt-br|pt-pt|fr|de|it|nl|ja|ko|zh|ru)(?=\/|$)/i;
const PAGINATION = /[?&]page=\d+/i;
const TRACKING = /^(?:utm_|fbclid$|gclid$|ttclid$|msclkid$|ref$|src$)/i;

/** §2.3: hosts de checkout de plataforma (lista em código, editável). */
export const CHECKOUT_HOSTS = [
  'pay.hotmart.com', 'pay.kiwify.com.br', 'checkout.cakto.com.br', 'pay.kirvano.com', 'checkout.stripe.com', 'buy.stripe.com',
  'lemonsqueezy.com', 'gumroad.com', 'ticto.com.br', 'checkout.ticto.app', 'perfectpay.com.br', 'go.perfectpay.com.br',
  'eduzz.com', 'sun.eduzz.com', 'chk.eduzz.com', 'monetizze.com.br', 'app.monetizze.com.br', 'braip.com', 'ev.braip.com',
];
export function isCheckoutHost(host: string): boolean {
  const h = host.toLowerCase();
  return CHECKOUT_HOSTS.some((c) => h === c || h.endsWith(`.${c}`));
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Papel de um link pela âncora ou pelo caminho; `null` = não tem papel (vira `other` se for de 1 nível). */
export function roleOf(anchorText: string, url: string): PageRole | null {
  let path = '/';
  try { path = decodeURIComponent(new URL(url).pathname); } catch { /* fica '/' */ }
  const hay = `${strip(anchorText)} ${strip(path).replace(/[-_/]+/g, ' ')}`;
  // termos ≠ privacidade/cookies (§2.2 linha 6)
  for (const r of ROLE_RULES) if (r.re.test(hay)) return r.role;
  return null;
}

/** §2.4: URL normalizada pro dedupe (sem #, sem utm/fbclid/gclid, sem / final, host minúsculo). */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch {
    return raw;
  }
}

/** Host da oferta: domínio registrável ou, em plataforma (vercel.app, hotmart.com…), só o host colado. */
function offerScope(mainUrl: string): { domain: string | null; host: string } {
  const host = bare(new URL(mainUrl).hostname);
  return { domain: offerDomain(host), host };
}

function inOffer(url: string, scope: { domain: string | null; host: string }): boolean {
  let h: string;
  try { h = bare(new URL(url).hostname); } catch { return false; }
  if (scope.domain) return h === scope.domain || h.endsWith(`.${scope.domain}`);
  return h === scope.host;
}

export function excluded(url: string, mainUrl: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  if (SOCIAL_HOST.test(u.hostname)) return true;
  if (EXCLUDE_PATH.test(u.pathname) || EXCLUDE_FILE.test(u.pathname) || PAGINATION.test(u.search)) return true;
  // alternativa de idioma: prefixo /en/, /es/… diferente do da principal
  const mine = LANG_PREFIX.exec(u.pathname)?.[0].toLowerCase() ?? '';
  const mainPrefix = LANG_PREFIX.exec(new URL(mainUrl).pathname)?.[0].toLowerCase() ?? '';
  if (mine && mine !== mainPrefix) return true;
  // subdomínio de infra/suporte (SKIP do subdominios.ts)
  const scope = offerScope(mainUrl);
  const h = bare(u.hostname);
  if (scope.domain && h !== scope.domain && h.endsWith(`.${scope.domain}`) && skipHost(h, scope.domain)) return true;
  return false;
}

export interface Candidate { url: string; role: PageRole; cta: boolean; order: number }

/** Candidatas internas em ordem de prioridade (§2.2) + o checkout externo do CTA (§2.3), se houver. */
export function pickCandidates(main: PageText, certs: string[] = []): { internal: Candidate[]; externalCheckout: string | null } {
  const scope = offerScope(main.url);
  const mainNorm = normalizeUrl(main.url);
  const anchors: Anchor[] = main.anchors ?? (main.links ?? []).map((href) => ({ href, text: '', cta: false }));
  const byUrl = new Map<string, Candidate>();
  let order = 0;
  let externalCheckout: string | null = null;
  for (const a of anchors) {
    order++;
    let u: URL;
    try { u = new URL(a.href); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    if (!inOffer(a.href, scope)) {
      // §2.3: primeiro CTA (ou link com papel checkout) pra checkout de plataforma
      if (!externalCheckout && isCheckoutHost(u.hostname) && (a.cta || roleOf(a.text, a.href) === 'checkout')) externalCheckout = a.href;
      continue;
    }
    const norm = normalizeUrl(a.href);
    if (norm === mainNorm || excluded(a.href, main.url)) continue;
    const role = roleOf(a.text, a.href) ?? (oneLevel(u) ? 'other' : null);
    if (!role) continue;
    const prev = byUrl.get(norm);
    if (!prev) byUrl.set(norm, { url: a.href, role, cta: a.cta, order });
    else {
      if (ROLE_ORDER.indexOf(role) < ROLE_ORDER.indexOf(prev.role)) prev.role = role;
      if (a.cta) prev.cta = true;
    }
  }
  // crt.sh: subdomínios de funil não linkados; papel pelo rótulo do host
  for (const c of certs) {
    order++;
    const norm = normalizeUrl(c);
    if (byUrl.has(norm) || norm === mainNorm || !inOffer(c, scope) || excluded(c, main.url)) continue;
    const label = scope.domain ? labels(new URL(c).hostname, scope.domain)[0] : '';
    byUrl.set(norm, { url: c, role: roleOf(label, c) ?? 'other', cta: false, order });
  }
  const internal = [...byUrl.values()].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || Number(b.cta) - Number(a.cta) || a.order - b.order);
  return { internal, externalCheckout };
}

/** `/x`, não `/blog/x` (§2.2 linha 8). */
function oneLevel(u: URL): boolean {
  return /^\/[^/]+\/?$/.test(u.pathname) && !u.search;
}

/** §2.1: caminhos convencionais sondados quando a principal não tem link interno (uma rota por grupo, até 4). */
export const CONVENTIONAL_PATHS: { role: PageRole; paths: string[] }[] = [
  { role: 'checkout', paths: ['/checkout'] },
  { role: 'pricing', paths: ['/pricing', '/precos', '/planos', '/plans'] },
  { role: 'pricing', paths: ['/oferta', '/offer'] },
  { role: 'thankyou', paths: ['/obrigado', '/thank-you'] },
];

export interface SubpageOptions extends FetchPageOptions {
  /** crt.sh (testes trocam ou desligam com `async () => []`) */
  certLookup?: (domain: string) => Promise<string[]>;
  /** relógio da leitura inteira (§1: 75 s); passou, não começa página nova */
  deadline?: number;
  now?: () => number;
}

/** Lê as subpáginas da oferta a partir da principal já lida. Nunca lança. */
export async function readSubpages(main: PageText, opts: SubpageOptions = {}): Promise<ReadPage[]> {
  const now = opts.now ?? Date.now;
  const start = now();
  const deadline = Math.min(opts.deadline ?? Infinity, start + SUBPAGE_LIMITS.totalMs);
  const scope = offerScope(main.url);
  const certs = scope.domain
    ? await (opts.certLookup ?? ((d: string) => certSubdomains(d, { fetchImpl: opts.fetchImpl })))(scope.domain).catch(() => [] as string[])
    : [];
  let { internal, externalCheckout } = pickCandidates(main, certs);
  const read: ReadPage[] = [];
  const seenUrl = new Set([normalizeUrl(main.url), ...(main.canonical ? [normalizeUrl(main.canonical)] : [])]);
  const seenText = new Set([main.text.slice(0, 500)]);
  const mainHost = bare(new URL(main.url).hostname);

  const fetchOne = async (url: string, role: PageRole, timeoutMs: number, external = false): Promise<ReadPage | null> => {
    try {
      const p = await fetchPage(url, { ...opts, timeoutMs: Math.min(opts.timeoutMs ?? timeoutMs, timeoutMs) });
      // redirect pra fora da oferta ou de volta pra principal não acrescenta nada
      if (!external && !inOffer(p.url, scope)) return null;
      if (bare(new URL(p.url).hostname) === mainHost && normalizeUrl(p.url) === normalizeUrl(main.url)) return null;
      const key = p.text.slice(0, 500);
      const norm = normalizeUrl(p.url);
      const canon = p.canonical ? normalizeUrl(p.canonical) : null;
      if (seenUrl.has(norm) || (canon && seenUrl.has(canon)) || seenText.has(key)) return null;
      seenUrl.add(norm);
      if (canon) seenUrl.add(canon);
      seenText.add(key);
      const truncated = p.truncated || p.text.length > SUBPAGE_LIMITS.chars;
      return { url: p.url, role, title: p.title, text: p.text.slice(0, SUBPAGE_LIMITS.chars), truncated, via: p.rendered ? 'rendered' : 'http', images: [] };
    } catch {
      return null; // 403, vazio, muro de login, timeout: fica de fora em silêncio
    }
  };

  // §2.1: SPA/quiz sem link interno → rotas convencionais do mesmo host (GET curto, 200 e ≥ 200 caracteres)
  if (!internal.length) {
    const origin = new URL(main.url).origin;
    const probes = CONVENTIONAL_PATHS.map(async (g) => {
      for (const path of g.paths) {
        if (now() > deadline) return null;
        const p = await fetchOne(`${origin}${path}`, g.role, SUBPAGE_LIMITS.conventionalMs);
        if (p && p.text.length >= SUBPAGE_LIMITS.conventionalMinChars) return p;
      }
      return null;
    });
    for (const p of await Promise.all(probes)) if (p && read.length < SUBPAGE_LIMITS.conventional) read.push(p);
  } else {
    // vagas: papéis com prioridade primeiro; `other` só preenche o que sobrar
    const queue = [...internal.filter((c) => c.role !== 'other'), ...internal.filter((c) => c.role === 'other')];
    const started = new Set<string>();
    let idx = 0;
    const worker = async () => {
      while (idx < queue.length && read.length < SUBPAGE_LIMITS.maxPages && now() <= deadline) {
        const c = queue[idx++];
        const norm = normalizeUrl(c.url);
        if (seenUrl.has(norm) || started.has(norm)) continue;
        started.add(norm);
        const p = await fetchOne(c.url, c.role, SUBPAGE_LIMITS.perPageMs);
        if (p && read.length < SUBPAGE_LIMITS.maxPages) read.push(p);
      }
    };
    await Promise.all(Array.from({ length: SUBPAGE_LIMITS.parallel }, worker));
  }

  // §2.3: exatamente uma página externa de checkout, lida por (a) e depois (b), teto 10 s
  if (externalCheckout && now() <= deadline) {
    const p = await fetchOne(externalCheckout, 'checkout', SUBPAGE_LIMITS.externalCheckoutMs, true);
    if (p) read.push(p);
  }

  // ordem final = prioridade do papel (checkout primeiro), estável
  return read.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}
