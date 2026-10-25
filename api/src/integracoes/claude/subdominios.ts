// Subdomínios da oferta (pedido do Gusta, 16/10): o funil raramente mora só na URL colada. Preço, garantia, bônus e
// upsell costumam estar no checkout., pay., app., members. do mesmo domínio. Dois caminhos pra achá-los:
//   1. links da própria página (botão de compra, login, área de membros): o funil real, vem primeiro;
//   2. certificados públicos (crt.sh): pega o que não está linkado. Lento e instável, então tem teto curto e é opcional.
// Desde a leitura v2 (22/10) quem lê as páginas é o subpaginas.ts; aqui ficam só as regras de domínio/subdomínio.
import { getDomain, getHostname } from 'tldts';

/** Plataformas onde o domínio é de todo mundo: subdomínio de lá é da plataforma, não da oferta. */
const PLATFORM_DOMAINS = new Set([
  'hotmart.com', 'kiwify.com.br', 'kiwify.app', 'eduzz.com', 'monetizze.com.br', 'cakto.com.br', 'kirvano.com', 'perfectpay.com.br',
  'braip.com', 'ticto.com.br', 'greenn.com.br', 'yampi.com.br', 'clickbank.net', 'digistore24.com', 'gumroad.com', 'stripe.com',
  'lemonsqueezy.com', 'paddle.com', 'shopify.com', 'wordpress.com', 'wixsite.com', 'wix.com', 'squarespace.com', 'carrd.co',
  'systeme.io', 'clickfunnels.com', 'myclickfunnels.com', 'kajabi.com', 'teachable.com', 'thinkific.com', 'webflow.io', 'framer.website',
  'notion.site', 'linktr.ee', 'beacons.ai', 'google.com', 'sites.google.com', 'instagram.com', 'facebook.com', 'youtube.com', 'tiktok.com',
  'whatsapp.com', 'wa.me', 'apple.com', 'typeform.com', 'calendly.com', 'github.io', 'vercel.app', 'netlify.app', 'pages.dev',
]);

/** Infra, e-mail, ambientes internos e suporte/docs/vagas: não dizem nada da oferta. */
export const SKIP = /^(?:help|support|suporte|ajuda|faq|docs?|documentation|developers?|feedback|community|comunidade|forum|careers|jobs|vagas|press|imprensa|investors?|ir|legal|privacy|trust|security|changelog|www\d*|mail\d*|webmail|smtp|imap|pop3?|mx\d*|email|e|ftp|sftp|cpanel|whm|webdisk|autodiscover|autoconfig|ns\d*|dns\d*|api\d*|cdn\d*|static|assets|img|images|media|files|uploads|s3|dev|develop|staging|stage|stg|test|testing|qa|uat|sandbox|preview|beta|admin|vpn|remote|git|gitlab|jira|status|grafana|metrics|monitor|sso|auth|login|id|track|tracking|click|links?|em\d*|bounce|sendgrid|mailgun|k8s|db|sql|redis|internal|intranet|localhost)$/i;

/** Nomes de etapa de funil: no crt.sh (que pode listar centenas) só vale a pena o que tem cara de funil. */
const FUNNEL = /^(?:checkout|pay|pagamento|pagar|compra|comprar|buy|order|cart|carrinho|shop|loja|store|app|members?|membros|area|aluno|alunos|portal|go|lp|oferta|offer|vendas|sales|quiz|start|join|get|try|trial|pricing|precos|upsell|obrigado|thanks|bonus|vip|clube|club|curso|course|academy|academia|plataforma)\d*$/i;

/** Domínio da oferta (foo.com.br, a.vercel.app) ou null se for de plataforma/IP. */
export function offerDomain(host: string): string | null {
  const d = getDomain(host, { allowPrivateDomains: true });
  if (!d || PLATFORM_DOMAINS.has(d)) return null;
  return d;
}

export const bare = (host: string) => host.toLowerCase().replace(/^www\./, '');
/** Rótulos antes do domínio: checkout.foo.com.br → ['checkout']; app.eu.foo.com → ['app', 'eu']. */
export const labels = (host: string, domain: string) => bare(host).slice(0, -(domain.length + 1)).split('.');
export const skipHost = (host: string, domain: string) => labels(host, domain).some((l) => SKIP.test(l));
const funnel = (host: string, domain: string) => FUNNEL.test(labels(host, domain)[0]);

/** URLs de subdomínios da mesma oferta linkados na página (uma por host, a primeira que aparece; os de funil primeiro). */
export function linkedSubdomains(pageUrl: string, links: string[]): string[] {
  const main = bare(new URL(pageUrl).hostname);
  const domain = offerDomain(main);
  if (!domain) return [];
  const byHost = new Map<string, string>();
  for (const l of links) {
    const host = bare(getHostname(l) ?? '');
    if (!host || host === main || host === domain || !host.endsWith(`.${domain}`) || byHost.has(host)) continue;
    if (skipHost(host, domain)) continue;
    byHost.set(host, l);
  }
  const hosts = [...byHost.keys()];
  return [...hosts.filter((h) => funnel(h, domain)), ...hosts.filter((h) => !funnel(h, domain))].map((h) => byHost.get(h)!);
}

const CT_TIMEOUT_MS = 6_000;

/** Subdomínios com cara de funil dos certificados públicos (crt.sh), como https://host/. Falha/lento → []. */
export async function certSubdomains(domain: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<string[]> {
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json&exclude=expired`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? CT_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as { name_value?: string }[];
    const hosts = new Set<string>();
    for (const r of rows) {
      for (const n of (r.name_value ?? '').split('\n')) {
        const host = bare(n.trim());
        if (!host || host.includes('*') || host === domain || !host.endsWith(`.${domain}`)) continue;
        // só um nível (checkout.foo.com): app.linux-packages.foo.com é infra com nome bonito
        if (labels(host, domain).length === 1 && !skipHost(host, domain) && funnel(host, domain)) hosts.add(host);
      }
    }
    return [...hosts].sort().map((h) => `https://${h}/`);
  } catch {
    return [];
  }
}
