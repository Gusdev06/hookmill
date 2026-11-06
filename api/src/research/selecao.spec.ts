// ads-research-v1 C.2/D5: seleção direto × vizinho, reserva e reposição (puro).
import { compareCandidates, pickReplacement, rankCandidates, selectCompetitors, type RankInput } from './selecao';

type C = RankInput & { id: string };
const c = (id: string, relation: 'DIRECT' | 'ADJACENT', score: number, adsSeen: number, oldestDays: number | null = 30): C => ({ id, relation, score, adsSeen, oldestDays });

// o mundo do mock (C.8): A–D diretos ≥ 2, E–F vizinhos ≥ 2, G direto com 1 anúncio
const A = c('A', 'DIRECT', 92, 6), B = c('B', 'DIRECT', 88, 6), Cc = c('C', 'DIRECT', 84, 3), D = c('D', 'DIRECT', 80, 2);
const E = c('E', 'ADJACENT', 70, 4), F = c('F', 'ADJACENT', 64, 2), G = c('G', 'DIRECT', 72, 1);

describe('ordem do D5', () => {
  it('direto antes de vizinho, mesmo com nota menor', () => {
    expect(compareCandidates(c('x', 'DIRECT', 51, 2), c('y', 'ADJACENT', 99, 9))).toBeLessThan(0);
  });
  it('faixa de 10 do score, depois anúncios vistos, depois o mais antigo', () => {
    expect(rankCandidates([c('a', 'DIRECT', 81, 2), c('b', 'DIRECT', 89, 5)]).map((x) => x.id)).toEqual(['b', 'a']); // mesma faixa 8: mais anúncios
    expect(rankCandidates([c('a', 'DIRECT', 79, 9), c('b', 'DIRECT', 80, 2)]).map((x) => x.id)).toEqual(['b', 'a']); // faixa 8 > 7
    expect(rankCandidates([c('a', 'DIRECT', 85, 3, 10), c('b', 'DIRECT', 85, 3, 60)]).map((x) => x.id)).toEqual(['b', 'a']); // mais antigo
    expect(rankCandidates([c('a', 'DIRECT', 85, 3, null), c('b', 'DIRECT', 85, 3, 1)]).map((x) => x.id)).toEqual(['b', 'a']); // desconhecido vai pro fim
  });
});

describe('selectCompetitors', () => {
  it('mock PAID: segue A, B, C, D, E (G tem 1 anúncio) e reserva G, F (diretos primeiro)', () => {
    const r = selectCompetitors({ fresh: [F, G, E, D, Cc, B, A], memory: [], slots: 5, reserveMax: 10 });
    expect(r.follow.map((x) => x.id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(r.reserve.map((x) => x.id)).toEqual(['G', 'F']);
  });
  it('só completa com vizinho se faltar direto', () => {
    const r = selectCompetitors({ fresh: [E, A, B, F], memory: [], slots: 3, reserveMax: 10 });
    expect(r.follow.map((x) => x.id)).toEqual(['A', 'B', 'E']);
    expect(r.reserve.map((x) => x.id)).toEqual(['F']);
  });
  it('sem vaga (seguido nunca sai): direto novo vai pro topo da reserva; memória disputa a reserva', () => {
    const J = c('J', 'DIRECT', 78, 3), K = c('K', 'DIRECT', 74, 2);
    const r = selectCompetitors({ fresh: [K, J], memory: [F, G], slots: 0, reserveMax: 10 });
    expect(r.follow).toEqual([]);
    expect(r.reserve.map((x) => x.id)).toEqual(['J', 'K', 'G', 'F']);
  });
  it('reserva respeita o teto; SAMPLE (1 vaga, reserva 0)', () => {
    const r = selectCompetitors({ fresh: [A, B, Cc], memory: [], slots: 1, reserveMax: 1 });
    expect(r.follow.map((x) => x.id)).toEqual(['A']);
    expect(r.reserve.map((x) => x.id)).toEqual(['B']);
    expect(r.overflow.map((x) => x.id)).toEqual(['C']);
    expect(selectCompetitors({ fresh: [A, B], memory: [], slots: 1, reserveMax: 0 }).reserve).toEqual([]);
  });
  it('slots negativo vira 0', () => {
    expect(selectCompetitors({ fresh: [A], memory: [], slots: -2, reserveMax: 10 }).follow).toEqual([]);
  });
});

describe('pickReplacement', () => {
  it('1º da reserva com ≥ 2 anúncios; sem ninguém assim, o 1º', () => {
    expect(pickReplacement([G, F])?.id).toBe('F');
    expect(pickReplacement([G, c('H', 'DIRECT', 60, 1)])?.id).toBe('G');
    expect(pickReplacement([])).toBeNull();
  });
});
