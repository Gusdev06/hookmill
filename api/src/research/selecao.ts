// ads-research-v1 C.2 (direto × vizinho) e D5 (escolher). PURO, sem banco.
//  - Aprovado = relation ≠ none e score ≥ MIN_SCORE (quem chama já filtra; aqui chega só aprovado).
//  - Ordem: relation (DIRECT antes de ADJACENT) → faixa de 10 do score → anúncios vistos → anúncio mais antigo.
//  - Seguidos: só Página com ≥ 2 anúncios na amostra; enche as vagas com diretos e só completa com vizinhos se faltar direto
//    (a ordem já põe os diretos na frente). Página com 1 anúncio vai só pra reserva.
//  - Reserva (até reserveMax): o resto dos aprovados, na mesma ordem.
//  - Remover um seguido: entra o 1º da reserva com ≥ 2 anúncios; sem ninguém assim, o 1º da reserva.
import type { CompetitorRelation } from '@maquina/contratos';

export const MIN_ADS_TO_FOLLOW = 2;

export interface RankInput {
  relation: CompetitorRelation;
  score: number;
  adsSeen: number;
  /** dias no ar do anúncio mais antigo visto (null = desconhecido, vai pro fim no desempate) */
  oldestDays: number | null;
}

const band = (score: number) => Math.floor(Math.max(0, Math.min(100, score)) / 10);

/** Comparador do D5 (estável: empate total mantém a ordem de entrada). */
export function compareCandidates(a: RankInput, b: RankInput): number {
  if (a.relation !== b.relation) return a.relation === 'DIRECT' ? -1 : 1;
  if (band(a.score) !== band(b.score)) return band(b.score) - band(a.score);
  if (a.adsSeen !== b.adsSeen) return b.adsSeen - a.adsSeen;
  return (b.oldestDays ?? -1) - (a.oldestDays ?? -1);
}

export function rankCandidates<T extends RankInput>(list: readonly T[]): T[] {
  return list.map((c, i) => ({ c, i })).sort((x, y) => compareCandidates(x.c, y.c) || x.i - y.i).map((x) => x.c);
}

export interface SelectionInput<T extends RankInput> {
  /** aprovados novos desta descoberta (não seguidos nem bloqueados) */
  fresh: readonly T[];
  /** aprovados de descobertas anteriores (origin MEMORY): só disputam a reserva (C.4) */
  memory: readonly T[];
  /** vagas abertas (maxCompetitors − seguidos ativos), ≥ 0 */
  slots: number;
  reserveMax: number;
}

export interface SelectionResult<T> {
  follow: T[];
  reserve: T[];
  /** aprovados que não couberam nem na reserva */
  overflow: T[];
}

/** D5: escolhe quem seguir e quem fica de reserva. Seguido nunca sai: quem já é seguido nem entra aqui. */
export function selectCompetitors<T extends RankInput>(input: SelectionInput<T>): SelectionResult<T> {
  const ranked = rankCandidates(input.fresh);
  const follow: T[] = [];
  const rest: T[] = [];
  for (const c of ranked) {
    if (follow.length < Math.max(0, input.slots) && c.adsSeen >= MIN_ADS_TO_FOLLOW) follow.push(c);
    else rest.push(c);
  }
  const pool = rankCandidates([...rest, ...input.memory]);
  const reserveMax = Math.max(0, input.reserveMax);
  return { follow, reserve: pool.slice(0, reserveMax), overflow: pool.slice(reserveMax) };
}

/** Vaga aberta (remover/aposentar): o 1º da reserva com ≥ 2 anúncios vistos; sem ninguém assim, o 1º da reserva. */
export function pickReplacement<T extends Pick<RankInput, 'adsSeen'>>(reserveInOrder: readonly T[]): T | null {
  return reserveInOrder.find((c) => c.adsSeen >= MIN_ADS_TO_FOLLOW) ?? reserveInOrder[0] ?? null;
}
