// Mundo do mock (C.8) ponta a ponta: um D1–D5 mínimo (a regra da C.2/C.3, sem banco) roda em cima dos fakes e confere
// que a 1ª descoberta segue A, B, C, D, E com reserva G, F, a 2ª traz J e K, e os gatilhos fazem o que o contrato diz.
import type { BrainDigest, JudgePageInput, LibraryAdDraft } from '../contrato';
import { FakeCompetitorAi } from '../mock/fake-concorrentes';
import { FakeResearchService, MOCK_RESEARCH_COST } from './fake-research.service';
import { mockAdArchiveId } from './mock-radar';

const brain = (industry: string): BrainDigest => ({ name: 'Cliente', industry, market: 'United States', websiteUrl: 'https://cliente.example', language: 'en', offers: [] });
const research = new FakeResearchService({ publicApiUrl: 'http://localhost:3001', stepMs: 0, now: () => Date.UTC(2026, 10, 4) });
const ai = new FakeCompetitorAi({ stepMs: 0, slowMs: 0 });

const disposable = (name: string, active: number) => (/[A-Za-z]/.test(name) && /[Ѐ-ӿͰ-Ͽ]/.test(name)) || active === 0;

async function discover(industry: string, reuseTerms: string[] = []) {
  const b = brain(industry);
  const d1 = await ai.proposeCompetitors({ brain: b, blocked: { pageNames: [], domains: [] }, reuseTerms, maxBrands: 6 });
  const pages = new Map<string, { name: string; ads: Map<string, LibraryAdDraft> }>();
  const add = (ads: LibraryAdDraft[]) => {
    for (const a of ads) {
      const p = pages.get(a.pageId!) ?? { name: a.pageName, ads: new Map() };
      p.ads.set(a.adArchiveId, a);
      pages.set(a.pageId!, p);
    }
  };
  const brandStatus: Record<string, string> = {};
  let cost = d1.costUsd;
  for (const br of d1.brands) {
    const r = await research.scrape({ kind: 'KEYWORD', query: br.domain, countryCode: d1.countryCode, limit: 10, ref: 'd2' });
    cost += r.costUsd;
    const owner = [...new Set(r.items.filter((a) => a.linkHost === br.domain).map((a) => a.pageId))][0];
    const mine = r.items.filter((a) => a.pageId === owner);
    brandStatus[br.brand] = !r.items.length ? 'NOT_FOUND' : mine.length < 3 ? 'TOO_FEW_ADS' : 'CONFIRMED';
    if (brandStatus[br.brand] === 'CONFIRMED') add(mine);
  }
  const byKind = (k: string) => d1.terms.filter((t) => t.kind === k).map((t) => t.term);
  const [pr, pd, pa] = [byKind('promise'), byKind('product'), byKind('pain')];
  const searched = reuseTerms.length ? [...reuseTerms.slice(0, 2), pr[0], pa[0]] : [pr[0], pd[0], pa[0], pd[1]];
  const reserveTerms = reuseTerms.length ? [] : [pr[1], pa[1]];
  const outcomes: Record<string, string> = {};
  const runTerm = async (t: string) => {
    const r = await research.scrape({ kind: 'KEYWORD', query: t, searchType: 'exact_phrase', countryCode: d1.countryCode, limit: 30, ref: 'd3' });
    cost += r.costUsd;
    const counts = new Map<string, number>();
    for (const a of r.items) counts.set(a.pageId!, (counts.get(a.pageId!) ?? 0) + 1);
    const singles = [...counts.values()].filter((n) => n === 1).length;
    const empty = counts.size <= 1;
    const diffuse = !empty && counts.size >= 8 && singles / counts.size >= 0.8;
    outcomes[t] = empty ? 'EMPTY' : diffuse ? 'DIFFUSE' : 'SEARCHED';
    if (!diffuse) add(r.items);
    return outcomes[t];
  };
  let swaps = 0;
  for (const t of searched) {
    const o = await runTerm(t);
    if ((o === 'EMPTY' || o === 'DIFFUSE') && swaps < 2 && reserveTerms.length) {
      swaps++;
      await runTerm(reserveTerms.shift()!);
    }
  }
  const judgeIn: JudgePageInput[] = [...pages.entries()].map(([pageId, p]) => {
    const ads = [...p.ads.values()];
    return { pageId, pageName: p.name, likeCount: null, hosts: [], texts: [], adsSeen: ads.length, oldestDays: null, suspectDisposable: disposable(p.name, ads.filter((a) => a.isActive).length) };
  });
  const d4 = await ai.judgeCompetitors({ brain: b, pages: judgeIn });
  cost += d4.costUsd;
  const seen = (id: string) => pages.get(id)!.ads.size;
  const approved = d4.items.filter((v) => v.relation !== 'none' && v.score >= 50)
    .sort((x, y) => (x.relation === y.relation ? 0 : x.relation === 'direct' ? -1 : 1) || Math.floor(y.score / 10) - Math.floor(x.score / 10) || seen(y.pageId) - seen(x.pageId));
  const followable = approved.filter((v) => seen(v.pageId) >= 2);
  const directs = followable.filter((v) => v.relation === 'direct');
  const follow = [...directs, ...followable.filter((v) => v.relation === 'adjacent')].slice(0, 5);
  const reserve = approved.filter((v) => !follow.includes(v)).slice(0, 10);
  const name = (id: string) => pages.get(id)!.name;
  return { d1, brandStatus, outcomes, follow: follow.map((v) => name(v.pageId)), reserve: reserve.map((v) => name(v.pageId)), verdicts: d4.items, cost };
}

describe('FakeResearchService + FakeCompetitorAi (mundo do mock, C.8)', () => {
  it('1ª descoberta: segue A, B, C, D (diretos) + E (vizinho); reserva G, F; Ghost = NOT_FOUND; H e I fora', async () => {
    const r = await discover('Prayer apps');
    expect(r.d1.countryCode).toBe('US');
    expect(r.d1.terms).toHaveLength(6);
    expect(r.brandStatus).toEqual({ 'Rival A': 'CONFIRMED', 'Rival B': 'CONFIRMED', 'Ghost Brand': 'NOT_FOUND' });
    expect(r.follow).toEqual(['Rival A', 'Rival B', 'Rival C', 'Rival D', 'Rival E']);
    expect(r.reserve).toEqual(['Rival G', 'Rival F']);
    const v = Object.fromEntries(r.verdicts.map((x) => [x.pageId, x.relation]));
    expect(v['mock-page-8']).toBe('none');
    expect(v['mock-page-9']).toBe('none');
    // custo fake: 2 chamadas Claude + 3 sondas D2 + 4 D3 (contrato C.8)
    expect(r.cost).toBeCloseTo(0.02 * 2 + MOCK_RESEARCH_COST.d2 * 3 + MOCK_RESEARCH_COST.d3 * 4, 6);
  });

  it('2ª descoberta (MANUAL, com termos da memória): Rival J e K novos, diretos', async () => {
    const r = await discover('Prayer apps', ['mock promise alpha', 'mock product alpha']);
    expect(r.d1.terms.map((t) => t.term)).not.toContain('mock promise alpha');
    // A/B voltam pela sonda de marca (já seguidos: o backend mantém); os novos aprovados são J e K, diretos
    const v = Object.fromEntries(r.verdicts.map((x) => [x.pageId, x.relation]));
    expect(v['mock-page-10']).toBe('direct');
    expect(v['mock-page-11']).toBe('direct');
    expect([...r.follow, ...r.reserve]).toEqual(expect.arrayContaining(['Rival J', 'Rival K']));
  });

  it('mock-only-adjacent: segue 5 vizinhos', async () => {
    const r = await discover('mock-only-adjacent');
    expect(r.follow).toHaveLength(5);
    expect(r.verdicts.filter((x) => r.follow.length && x.relation === 'direct')).toHaveLength(0);
  });

  it('mock-diffuse: 1º termo difuso é trocado pelo reserva', async () => {
    const r = await discover('x mock-diffuse');
    expect(r.outcomes['mock diffuse promise']).toBe('DIFFUSE');
    expect(r.outcomes['mock promise beta']).toBe('SEARCHED');
  });

  it('mock-no-competitors: nada aprovado (EMPTY)', async () => {
    const r = await discover('mock-no-competitors');
    expect(r.follow).toEqual([]);
    expect(r.reserve).toEqual([]);
  });

  it('mock-discovery-fail / mock-quota', async () => {
    await expect(discover('mock-discovery-fail')).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(discover('mock-quota')).rejects.toMatchObject({ code: 'AD_LIBRARY_UNAVAILABLE', details: { reason: 'quota' } });
  });

  it('coleta de Página: 24 anúncios (16 vídeo, 5 imagem, 3 DCO), mesmos ids da sonda, limite respeitado; gatilhos', async () => {
    const page = await research.scrape({ kind: 'PAGE', query: 'mock-page-1', countryCode: 'US', limit: 150, ref: 'imp' });
    expect(page.items).toHaveLength(24);
    expect(page.items.filter((a) => a.format === 'VIDEO')).toHaveLength(16);
    expect(page.items.filter((a) => a.format === 'IMAGE')).toHaveLength(5);
    expect(page.items.filter((a) => a.format === 'DCO' && a.hasVideo)).toHaveLength(3);
    expect(page.items[0].adArchiveId).toBe(mockAdArchiveId('mock-page-1', 0));
    expect(page.costUsd).toBeCloseTo(24 * 0.00075 + 0.00005, 6);
    const probe = await research.scrape({ kind: 'KEYWORD', query: 'rival-a.example', countryCode: 'US', limit: 10, ref: 'd2' });
    expect(probe.items.filter((a) => a.pageId === 'mock-page-1').map((a) => a.adArchiveId)).toEqual(page.items.slice(0, 6).map((a) => a.adArchiveId));

    expect((await research.scrape({ kind: 'PAGE', query: 'mock-big', countryCode: 'US', limit: 150, ref: 'x' })).items).toHaveLength(150);
    expect((await research.scrape({ kind: 'PAGE', query: 'mock-empty', countryCode: 'US', limit: 150, ref: 'x' })).items).toHaveLength(0);
    expect((await research.scrape({ kind: 'PAGE', query: 'mock-suspect', countryCode: 'US', limit: 150, ref: 'x' })).items).toHaveLength(3);
    const gone = await research.scrape({ kind: 'PAGE', query: 'mock-gone', countryCode: 'US', limit: 150, ref: 'x' });
    expect(gone.items).toHaveLength(0);
    expect(gone.errors).toEqual([{ code: 'PAGE_PRIVATE', message: 'Page is private' }]);
    expect(gone.costUsd).toBeGreaterThan(0);
  });

  it('zeroCost zera o custo', async () => {
    const z = new FakeResearchService({ publicApiUrl: 'http://x', stepMs: 0, zeroCost: true });
    expect((await z.scrape({ kind: 'KEYWORD', query: 'mock promise alpha', searchType: 'exact_phrase', countryCode: 'US', limit: 30, ref: 'x' })).costUsd).toBe(0);
  });
});
