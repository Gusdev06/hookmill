// Zip do lote AUTO (variacao-auto-v1 §5.1 esclarecimento 5 e §8): nomes, pastas, README e chave. Puro, testado em zip.spec.ts.
import { createHash } from 'node:crypto';
import type { VariationAxis } from '@maquina/contratos';
import { mmddUtc } from '../edicao/pecas';

export type ZipLocale = 'EN' | 'PT_BR';

/** Nomes das pastas no idioma da INTERFACE do workspace (são instrução pro operador). */
export function zipFolders(locale: ZipLocale): { stretch: string; newAudience: string } {
  return locale === 'PT_BR'
    ? { stretch: '1-esticar-a-vida', newAudience: '2-publico-novo' }
    : { stretch: '1-stretch-its-life', newAudience: '2-new-audience' };
}

export function folderFor(axis: VariationAxis | null, locale: ZipLocale): string {
  const f = zipFolders(locale);
  return axis === 'DIVERSITY' ? f.newAudience : f.stretch;
}

/** SLUG = nome do campeão em ASCII maiúsculo com hífen, ≤ 24 caracteres. */
export function slugOf(name: string): string {
  const s = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 24).replace(/-+$/g, '');
  return s || 'VIDEO';
}

/** `<CLIENTE>_<MMDD>_<SLUG>_variations.zip` (PT: `_variacoes.zip`); MMDD = data UTC do launchedAt do lote. */
export function zipFileName(i: { shortCode: string; launchedAt: Date; championName: string; locale: ZipLocale }): string {
  return `${i.shortCode}_${mmddUtc(i.launchedAt)}_${slugOf(i.championName)}_${i.locale === 'PT_BR' ? 'variacoes' : 'variations'}.zip`;
}

/**
 * README.txt de cada pasta: a instrução do conjunto + `arquivo → o que mudou`. 25/10 (D14): peça com texto do anúncio
 * sugerido (moldura "Leia a legenda") ganha a linha seguinte com ele, recuada (sem publicar pelo HookMill, é daqui que sai).
 */
export function readmeFor(axis: VariationAxis, lines: { file: string; change: string; primaryText?: string | null; credit?: string | null }[], locale: ZipLocale): string {
  const head = axis === 'ITERATION'
    ? locale === 'PT_BR'
      ? 'Conjunto de teste do mesmo conceito, separado do conjunto do campeão (que segue rodando). A peça que ganhar migra pro conjunto principal.'
      : 'Test set for the same concept, separate from the winner\'s ad set (which keeps running). The piece that wins moves to the main ad set.'
    : locale === 'PT_BR'
      ? 'Conjunto novo, com todas as peças juntas.'
      : 'New ad set, with all pieces together.';
  const title = locale === 'PT_BR' ? 'Arquivo → o que mudou' : 'File → what changed';
  const label = locale === 'PT_BR' ? 'Texto do anúncio' : 'Ad primary text';
  const body = lines.flatMap((l) => [
    `${l.file} → ${l.change}`,
    ...(l.primaryText?.trim() ? [`    ${label}: ${l.primaryText.trim().replace(/\s*\n\s*/g, ' ')}`] : []),
    ...(l.credit?.trim() ? [`    B-roll: ${l.credit.trim()}`] : []),
  ]);
  return [head, '', title, ...body, ''].join('\n');
}

/** zipKey = sha1 dos (pieceId, fileIds) incluídos, em ordem estável: igual = reaproveita o zip pronto. */
export function zipKeyOf(entries: { pieceId: string; fileIds: string[] }[]): string {
  const canon = [...entries]
    .sort((a, b) => a.pieceId.localeCompare(b.pieceId))
    .map((e) => `${e.pieceId}:${[...e.fileIds].sort().join(',')}`)
    .join('|');
  return createHash('sha1').update(canon).digest('hex');
}

/** Zip apagado do storage depois de 72 h (cron), refeito sob demanda. */
export const ZIP_TTL_MS = 72 * 3_600_000;

/**
 * §B3.1: 1 linha de proveniência do b-roll da 2ª fonte (fonte, autor, licença, link, intervalo). Licença desconhecida
 * aparece como desconhecida (nunca vira domínio público); sem permissão comercial = aviso.
 */
export function creditoDoBroll(p: {
  provider: string; sourceUrl: string; creator: string | null; license: string | null; licenseCommercialOk: boolean; startSec: number; endSec: number;
} | null | undefined, locale: ZipLocale): string | null {
  if (!p?.sourceUrl) return null;
  const pt = locale === 'PT_BR';
  const lic = p.license ?? (pt ? 'licença desconhecida' : 'unknown license');
  const aviso = p.licenseCommercialOk ? '' : pt ? ' · LICENÇA NÃO VERIFICADA pra uso comercial' : ' · LICENSE NOT VERIFIED for commercial use';
  return `${p.provider} · ${p.creator ?? (pt ? 'autor desconhecido' : 'unknown author')} · ${lic} · ${p.sourceUrl} · ${p.startSec.toFixed(1)}-${p.endSec.toFixed(1)} s${aviso}`;
}
