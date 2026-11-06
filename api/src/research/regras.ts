// ads-research-v1: regras puras do Ad Radar (selo, termo difuso, Página descartável, trava de 30 %, impressão digital do
// Brain, links da Ad Library). Sem banco nem rede; testadas em regras.spec.ts.
import { createHash } from 'node:crypto';
import type { ResearchAdTier } from '@maquina/contratos';

export const DAY_MS = 86_400_000;

const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Dias inteiros entre duas datas (UTC, por dia de calendário). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((dayStart(to) - dayStart(from)) / DAY_MS));
}

export interface TierRules { winnerDays: number; winnerVersions: number; newDays: number }

/**
 * §5.3 + C.6: `daysRunning` = (hoje ou `stoppedAt`) − `startDate`. winner = ativo e (≥ winnerDays ou ≥ winnerVersions
 * versões); testing = ativo, newDays..winnerDays−1; new = ativo, < newDays; stopped = inativo (killedFast se durou < newDays).
 */
export function tierOf(
  ad: { isActive: boolean; startDate: Date | null; stoppedAt: Date | null; endDate?: Date | null; collationCount: number | null },
  rules: TierRules,
  now = new Date(),
): { tier: ResearchAdTier; daysRunning: number | null; killedFast: boolean } {
  const end = ad.isActive ? now : ad.stoppedAt ?? ad.endDate ?? now;
  const daysRunning = ad.startDate ? daysBetween(ad.startDate, end) : null;
  if (!ad.isActive) return { tier: 'stopped', daysRunning, killedFast: daysRunning != null && daysRunning < rules.newDays };
  const versions = ad.collationCount ?? 0;
  if ((daysRunning != null && daysRunning >= rules.winnerDays) || versions >= rules.winnerVersions) return { tier: 'winner', daysRunning, killedFast: false };
  if (daysRunning != null && daysRunning < rules.newDays) return { tier: 'new', daysRunning, killedFast: false };
  return { tier: 'testing', daysRunning, killedFast: false };
}

/**
 * C.3 D3: termo EMPTY (0–1 Página) ou DIFFUSE (≥ 8 Páginas e ≥ 80 % delas com 1 anúncio) é trocado; senão SEARCHED.
 * `adsPerPage` = anúncios vistos por Página na amostra do termo.
 */
export function termOutcome(adsPerPage: readonly number[]): 'SEARCHED' | 'EMPTY' | 'DIFFUSE' {
  const pages = adsPerPage.length;
  if (pages <= 1) return 'EMPTY';
  const single = adsPerPage.filter((n) => n <= 1).length;
  if (pages >= 8 && single / pages >= 0.8) return 'DIFFUSE';
  return 'SEARCHED';
}

const SCRIPTS: [string, RegExp][] = [
  ['latin', /\p{Script=Latin}/u], ['cyrillic', /\p{Script=Cyrillic}/u], ['greek', /\p{Script=Greek}/u], ['arabic', /\p{Script=Arabic}/u],
  ['hebrew', /\p{Script=Hebrew}/u], ['han', /\p{Script=Han}/u], ['hiragana', /\p{Script=Hiragana}/u], ['katakana', /\p{Script=Katakana}/u],
  ['hangul', /\p{Script=Hangul}/u], ['thai', /\p{Script=Thai}/u], ['devanagari', /\p{Script=Devanagari}/u],
];

/**
 * C.3 D4: Página descartável (regra determinística do backend, não do Claude): 0 anúncios ativos vistos, nome com
 * alfabetos misturados (ex.: latino + cirílico, golpe clássico) ou nome sem sentido (sem letra, ou letra solta com dígitos,
 * ou sequência longa de consoantes sem vogal).
 */
export function suspectDisposable(page: { pageName: string | null; activeAdsSeen: number }): boolean {
  if (page.activeAdsSeen <= 0) return true;
  const name = (page.pageName ?? '').normalize('NFC').trim();
  if (!name) return true;
  const scripts = SCRIPTS.filter(([, re]) => re.test(name)).map(([s]) => s);
  // japonês mistura kana e kanji por natureza; o resto misturado é suspeito
  const cjk = new Set(['han', 'hiragana', 'katakana']);
  const nonCjk = scripts.filter((s) => !cjk.has(s));
  if (nonCjk.length > 1 || (nonCjk.length === 1 && nonCjk[0] !== 'latin' && scripts.some((s) => cjk.has(s)))) return true;
  const letters = name.replace(/[^\p{L}]/gu, '');
  if (!letters) return true;
  const digits = name.replace(/[^\d]/g, '').length;
  if (letters.length <= 2 && digits >= 3) return true;
  if (scripts.length === 1 && scripts[0] === 'latin') {
    const lower = letters.toLowerCase();
    if (lower.length >= 6 && !/[aeiouyáéíóúâêôãõàü]/.test(lower)) return true;
    if (/[bcdfghjklmnpqrstvwxz]{6,}/.test(lower)) return true;
  }
  return false;
}

/** §3: coleta com < 30 % dos ativos da última válida (e a anterior ≥ 10) = SUSPECT (não funde). */
export function isSuspectSync(activeNow: number, lastValidActive: number): boolean {
  return lastValidActive >= 10 && activeNow < 0.3 * lastValidActive;
}

/** Impressão digital do Brain usado na descoberta (§2.1): ramo, mercado, site e a oferta principal. */
export function brainHash(b: { industry: string | null; market: string | null; websiteUrl?: string | null; offer: { id: string; what: string | null; audience: string | null; promise: string | null; kind: string | null } | null }): string {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const parts = [norm(b.industry), norm(b.market), norm(b.websiteUrl), b.offer ? [b.offer.id, norm(b.offer.kind), norm(b.offer.what), norm(b.offer.audience), norm(b.offer.promise)].join('|') : ''];
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32);
}

export const adLibraryAdUrl = (adArchiveId: string) => `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adArchiveId)}`;
export const adLibraryPageUrl = (pageId: string, countryCode: string) =>
  `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${encodeURIComponent(countryCode)}&view_all_page_id=${encodeURIComponent(pageId)}`;

/** Host sem `www.` (minúsculo) ou null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/** Domínio igual ou subdomínio (`app.foo.com` casa com `foo.com`). */
export function sameSite(host: string | null, domain: string | null): boolean {
  const h = hostOf(host);
  const d = hostOf(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`) || d.endsWith(`.${h}`);
}

/**
 * R10 (só equipe): `pageId` direto ou URL com `view_all_page_id=<n>` / `facebook.com/profile.php?id=<n>` / `facebook.com/<n>`.
 * Slug de nome (facebook.com/minhapagina) não resolve: o actor precisa do id (R0). null = inválido.
 */
export function pageIdFrom(input: { pageId?: string; pageUrl?: string }): string | null {
  if (input.pageId) return /^\d{5,25}$/.test(input.pageId.trim()) ? input.pageId.trim() : null;
  if (!input.pageUrl) return null;
  try {
    const u = new URL(input.pageUrl.trim());
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const q = u.searchParams.get('view_all_page_id') ?? u.searchParams.get('id');
    if (q && /^\d{5,25}$/.test(q)) return q;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    return seg && /^\d{5,25}$/.test(seg) ? seg : null;
  } catch {
    return null;
  }
}

/** País ISO-2 (maiúsculo) ou null. */
export const countryOf = (v: string | null | undefined): string | null => (v && /^[A-Za-z]{2}$/.test(v.trim()) ? v.trim().toUpperCase() : null);
