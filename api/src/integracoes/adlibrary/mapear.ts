// ads-research-v1 (Ad Radar): item cru do actor `curious_coder~facebook-ads-library-scraper` → LibraryAdDraft.
// Estende o mapAdItem do campeão (ad-library.service.ts) com o que a R0 achou: DCO/DPA, THREADS/WHATSAPP, curtidas e
// foto da Página, cards com mídia, `oe` (validade do fbcdn) e itens de erro separados (PAGE_PRIVATE é cobrado igual).
import type { LibraryAdCardDraft, LibraryAdDraft, LibraryAdFormat, LibraryAdPlatform } from '../contrato';
import { guessLanguage } from '../wavespeed/idioma';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const FORMATS: readonly LibraryAdFormat[] = ['VIDEO', 'IMAGE', 'CAROUSEL', 'DCO', 'DPA'];
const PLATFORMS: readonly LibraryAdPlatform[] = ['FACEBOOK', 'INSTAGRAM', 'MESSENGER', 'AUDIENCE_NETWORK', 'THREADS', 'WHATSAPP'];

function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && typeof (v as Raw).text === 'string') return ((v as Raw).text as string).trim() || null;
  return null;
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoDay = (epoch: unknown) => (typeof epoch === 'number' && epoch > 0 ? new Date(epoch * 1000).toISOString().slice(0, 10) : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Host sem www, minúsculo; null se não for URL. */
export function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** `oe` (hex, epoch em segundos) da URL do fbcdn → ISO; null sem `oe`. */
export function expiresOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (!oe || !/^[0-9a-f]+$/i.test(oe)) return null;
    const sec = parseInt(oe, 16);
    return sec > 0 ? new Date(sec * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

/** Item de erro do actor (`{ error, errorCode }`): não é anúncio, mas é cobrado. */
export function isErrorItem(item: Raw): boolean {
  return !!(item && (item.error || item.errorCode)) && !item.ad_archive_id && !item.adArchiveID;
}

export function errorOf(item: Raw): { code: string; message: string } {
  return { code: String(item.errorCode || 'UNKNOWN'), message: String(item.error || item.errorCode || 'actor error').slice(0, 300) };
}

function searchTermOf(url: unknown): string | null {
  try {
    const q = new URL(String(url)).searchParams.get('q');
    return q ? q.replace(/^"(.*)"$/, '$1').trim() || null : null;
  } catch {
    return null;
  }
}

function cardOf(c: Raw): LibraryAdCardDraft {
  const videoUrl = str(c.video_hd_url) ?? str(c.video_sd_url);
  const imageUrl = str(c.original_image_url) ?? str(c.resized_image_url);
  return {
    headline: text(c.title),
    body: text(c.body),
    linkUrl: text(c.link_url),
    mediaKind: videoUrl ? 'VIDEO' : imageUrl ? 'IMAGE' : null,
    posterUrl: str(c.video_preview_image_url) ?? imageUrl,
    videoUrl,
  };
}

/** Item cru (anúncio, não erro) → rascunho. Devolve null sem `ad_archive_id`. */
export function mapLibraryAd(item: Raw): LibraryAdDraft | null {
  const adArchiveId = String(item.ad_archive_id ?? item.adArchiveID ?? '').trim();
  if (!adArchiveId) return null;
  const s: Raw = item.snapshot ?? {};
  const rawCards: Raw[] = Array.isArray(s.cards) ? s.cards : [];
  const cards = rawCards.map(cardOf);
  const videos: Raw[] = Array.isArray(s.videos) ? s.videos : [];
  const images: Raw[] = Array.isArray(s.images) ? s.images : [];
  const v = videos.find((x) => x?.video_hd_url || x?.video_sd_url) ?? null;
  const cardVideo = cards.find((c) => c.videoUrl) ?? null;
  const videoUrl = v ? (str(v.video_hd_url) ?? str(v.video_sd_url)) : (cardVideo?.videoUrl ?? null);
  const img = images[0] ?? null;
  const posterUrl = v
    ? str(v.video_preview_image_url)
    : (cardVideo?.posterUrl ?? (img ? (str(img.original_image_url) ?? str(img.resized_image_url)) : null) ?? cards.find((c) => c.posterUrl)?.posterUrl ?? null);

  const declared = String(s.display_format ?? '').toUpperCase();
  const format: LibraryAdFormat = (FORMATS as readonly string[]).includes(declared)
    ? (declared as LibraryAdFormat)
    : videos.length ? 'VIDEO' : images.length ? 'IMAGE' : cards.length ? 'CAROUSEL' : 'OTHER';

  const card0 = rawCards[0] ?? null;
  const primaryText = text(s.body) ?? text(card0?.body);
  const headline = text(s.title) ?? text(card0?.title);
  const linkUrl = text(s.link_url) ?? text(card0?.link_url);
  const platformsRaw: unknown[] = Array.isArray(item.publisher_platform) ? item.publisher_platform : [];
  const platforms = [...new Set(platformsRaw.map((p) => String(p).toUpperCase()))].filter((p): p is LibraryAdPlatform => (PLATFORMS as readonly string[]).includes(p));
  const aaa: Raw = item.aaa_info ?? item.transparency_by_location?.eu_transparency ?? {};
  const impress = item.impressions_with_index?.impressions_text ?? null;
  const langText = [primaryText, headline].filter(Boolean).join(' ');

  return {
    adArchiveId,
    pageId: str(String(item.page_id ?? s.page_id ?? '')),
    pageName: String(item.page_name ?? s.page_name ?? '').trim() || '?',
    pageAvatarUrl: str(s.page_profile_picture_url),
    pageLikeCount: num(s.page_like_count),
    format,
    hasVideo: !!videoUrl,
    primaryText,
    headline,
    ctaText: text(s.cta_text) ?? text(card0?.cta_text),
    linkUrl,
    linkHost: hostOf(linkUrl) ?? (str(s.caption) ? String(s.caption).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '') || null : null),
    cards: format === 'DCO' || format === 'CAROUSEL' || format === 'DPA' ? cards : cards.length > 1 ? cards : [],
    platforms,
    startDate: isoDay(item.start_date),
    endDate: isoDay(item.end_date),
    isActive: item.is_active !== false,
    collationCount: num(item.collation_count),
    euReach: num(aaa.eu_total_reach),
    lowImpressions: impress === '<100',
    language: langText.length >= 20 ? guessLanguage(langText) : null,
    videoUrl,
    posterUrl,
    mediaExpiresAt: expiresOf(videoUrl) ?? expiresOf(posterUrl),
    width: v ? num(v.video_width) ?? null : null,
    height: v ? num(v.video_height) ?? null : null,
    durationSec: v ? num(v.video_duration) ?? null : null,
    searchTerm: searchTermOf(item.url),
  };
}

/** Dataset inteiro → anúncios (dedupe por adArchiveId) + erros. */
export function splitItems(raw: unknown[]): { items: LibraryAdDraft[]; errors: { code: string; message: string }[] } {
  const items: LibraryAdDraft[] = [];
  const errors: { code: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    if (isErrorItem(x as Raw)) {
      errors.push(errorOf(x as Raw));
      continue;
    }
    const ad = mapLibraryAd(x as Raw);
    if (!ad || seen.has(ad.adArchiveId)) continue;
    seen.add(ad.adArchiveId);
    items.push(ad);
  }
  return { items, errors };
}
