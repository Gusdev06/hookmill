// Logo da marca pela leitura (lacunas-home-eddy-v1 §2, 31/10): só do HTML que o passo (a) já baixou, sem chamada nova.
// Ordem: <img> de logo no cabeçalho → apple-touch-icon → icon (maior `sizes`, SVG primeiro) → og:image. A URL não é
// baixada nem testada (o web carrega e, se falhar, deixa o slot vazio). Nada de `data:`; só http(s) absoluto.

export type LogoSource = 'header' | 'icon' | 'og_image';
export interface LogoPick { url: string; source: LogoSource }

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  const v = m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
  return v == null ? null : v.replace(/&amp;/g, '&').trim();
};

function absolute(raw: string | null | undefined, base: URL): string | null {
  if (!raw || /^data:/i.test(raw)) return null;
  try {
    const u = new URL(raw, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Maior lado declarado em `sizes="180x180 32x32"` (`any` = SVG escalável = grande). */
function sizeOf(sizes: string | null, href: string): number {
  if (/\.svg(?:$|\?)/i.test(href) || /\bany\b/i.test(sizes ?? '')) return 10_000;
  const all = [...(sizes ?? '').matchAll(/(\d+)x(\d+)/gi)].map((m) => Math.max(Number(m[1]), Number(m[2])));
  return all.length ? Math.max(...all) : 0;
}

const LOGO_HINT = /logo|brand|marca/i;

/** <img> de logo: dentro de <header>/<nav> (ou nos primeiros 30 000 caracteres do <body>) com "logo" em class/id/alt/src. */
function headerLogo(html: string, base: URL): string | null {
  const zones = [...html.matchAll(/<(header|nav)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const body = /<body\b[\s\S]*/i.exec(html)?.[0]?.slice(0, 30_000);
  if (body) zones.push(body);
  for (const zone of zones) {
    for (const m of zone.matchAll(/<img\b[^>]*>/gi)) {
      const tag = m[0];
      const src = attr(tag, 'src') ?? attr(tag, 'data-src') ?? attr(tag, 'srcset')?.split(/\s+/)[0] ?? null;
      const hint = [attr(tag, 'class'), attr(tag, 'id'), attr(tag, 'alt'), src].filter(Boolean).join(' ');
      if (!LOGO_HINT.test(hint)) continue;
      const url = absolute(src, base);
      if (url) return url;
    }
  }
  return null;
}

export function logoOf(html: string, baseUrl: string): LogoPick | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  const head = html.slice(0, 400_000);
  const header = headerLogo(head, base);
  if (header) return { url: header, source: 'header' };

  const icons: { url: string; rank: number }[] = [];
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (attr(tag, 'rel') ?? '').toLowerCase();
    if (!/\b(?:apple-touch-icon(?:-precomposed)?|icon|shortcut icon|mask-icon)\b/.test(rel)) continue;
    const href = attr(tag, 'href');
    const url = absolute(href, base);
    if (!url || !href) continue;
    // apple-touch-icon é sempre ≥ 120 px: vem antes do favicon comum
    const apple = rel.includes('apple-touch-icon') ? 100_000 : 0;
    icons.push({ url, rank: apple + sizeOf(attr(tag, 'sizes'), href) });
  }
  icons.sort((a, b) => b.rank - a.rank);
  if (icons[0]) return { url: icons[0].url, source: 'icon' };

  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const prop = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase();
    if (prop !== 'og:image' && prop !== 'og:image:url' && prop !== 'og:image:secure_url') continue;
    const url = absolute(attr(tag, 'content'), base);
    if (url) return { url, source: 'og_image' };
  }
  return null;
}
