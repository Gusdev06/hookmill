// ads-research-v1 (Ad Radar), C.8: o "mundo" fake compartilhado pelo FakeResearchService (Apify) e pelo
// FakeClaudeService (D1/D4). Determinístico: mesma entrada, mesma saída, mesmos ad_archive_id entre sonda e importação.
//
// 1ª descoberta (sem reuseTerms):
//   D1 → 3 marcas (Rival A, Rival B, Ghost Brand → NOT_FOUND) e 6 termos "mock <tipo> alpha|beta"
//   D3 (promessa 1, produto 1, dor 1, produto 2) → Páginas mock-page-1…9 (Rival A–I)
//   D4 → A–D diretos (≥ 2 anúncios), E–F vizinhos (≥ 2), G direto com 1 anúncio, H none, I descartável (none)
//   D5 (backend) → segue A, B, C, D, E; reserva G, F
// 2ª descoberta (MANUAL, reuseTerms não vazio): termos novos "mock <tipo> gamma|delta"; promessa/dor gamma trazem
//   Rival J e K (mock-page-10/11, diretos) — G/F voltam pela memória do backend.
// Gatilhos no industry: mock-no-competitors · mock-discovery-fail · mock-quota · mock-slow · mock-only-adjacent · mock-diffuse.
// Gatilhos na Página (query do PAGE): mock-empty · mock-suspect · mock-gone (PAGE_PRIVATE) · mock-big (300).
import type { LibraryAdDraft, LibraryAdPlatform, ProposedTermKind } from '../contrato';
import { mockMediaUrl, seedOf } from '../mock/midia';

export interface MockPage {
  pageId: string;
  name: string;
  host: string;
  likes: number;
  relation: 'direct' | 'adjacent' | 'none';
  score: number;
  reason: string;
}

const P = (n: number, letter: string, relation: MockPage['relation'], score: number, reason: string, name?: string): MockPage => ({
  pageId: `mock-page-${n}`,
  name: name ?? `Rival ${letter}`,
  host: `rival-${letter.toLowerCase()}.example`,
  likes: 1000 * (20 - n),
  relation,
  score,
  reason,
});

export const MOCK_PAGES: MockPage[] = [
  P(1, 'A', 'direct', 92, 'Vende o mesmo tipo de produto pro mesmo público, com muitos anúncios ativos.'),
  P(2, 'B', 'direct', 88, 'Mesma oferta e mesmo público; anuncia há meses.'),
  P(3, 'C', 'direct', 84, 'Concorrente direto com promessa parecida.'),
  P(4, 'D', 'direct', 80, 'Mesmo produto, faixa de preço próxima.'),
  P(5, 'E', 'adjacent', 70, 'Mesmo público com produto vizinho: compete pela mesma atenção.'),
  P(6, 'F', 'adjacent', 64, 'Nicho vizinho do mesmo comprador.'),
  P(7, 'G', 'direct', 72, 'Concorrente direto, mas só 1 anúncio na amostra.'),
  P(8, 'H', 'none', 20, 'Outro público: varejista genérico.'),
  P(9, 'I', 'none', 5, 'Página com cara de descartável (nome com alfabetos misturados).', 'Rival I Ѕtore'),
  P(10, 'J', 'direct', 78, 'Concorrente direto achado só na 2ª varredura.'),
  P(11, 'K', 'direct', 74, 'Concorrente direto novo, mesma promessa.'),
];
export const mockPage = (pageId: string) => MOCK_PAGES.find((p) => p.pageId === pageId) ?? null;

export const MOCK_TRIGGERS = {
  noCompetitors: 'mock-no-competitors',
  discoveryFail: 'mock-discovery-fail',
  quota: 'mock-quota',
  slow: 'mock-slow',
  onlyAdjacent: 'mock-only-adjacent',
  diffuse: 'mock-diffuse',
} as const;
export const MOCK_QUOTA_RETRY_AFTER = '2026-12-01';

export const hasTrigger = (industry: string | null | undefined, t: string) => (industry ?? '').toLowerCase().includes(t);

/** D1 fake: marcas (domínio) e termos, na ordem promise, promise, product, product, pain, pain. */
export function mockProposal(industry: string | null, second: boolean): { brands: { brand: string; domain: string; why: string }[]; terms: { term: string; kind: ProposedTermKind }[] } {
  if (hasTrigger(industry, MOCK_TRIGGERS.noCompetitors)) {
    return { brands: [], terms: (['promise', 'promise', 'product', 'product', 'pain', 'pain'] as const).map((kind, k) => ({ term: `mock nothing ${kind} ${k}`, kind })) };
  }
  if (hasTrigger(industry, MOCK_TRIGGERS.quota)) {
    return {
      brands: [{ brand: 'Quota Brand', domain: 'mock-quota.example', why: 'mock' }],
      terms: (['promise', 'promise', 'product', 'product', 'pain', 'pain'] as const).map((kind, k) => ({ term: `mock-quota ${kind} ${k}`, kind })),
    };
  }
  const brands = [
    { brand: 'Rival A', domain: 'rival-a.example', why: 'Vende o mesmo produto pro mesmo público e anuncia no país.' },
    { brand: 'Rival B', domain: 'rival-b.example', why: 'Concorrente conhecido do nicho, anuncia no Facebook e Instagram.' },
    { brand: 'Ghost Brand', domain: 'ghost-brand.example', why: 'Marca do nicho (não aparece na Ad Library: testa o NOT_FOUND).' },
  ];
  const [a, b] = second ? ['gamma', 'delta'] : ['alpha', 'beta'];
  const promise1 = !second && hasTrigger(industry, MOCK_TRIGGERS.diffuse) ? 'mock diffuse promise' : `mock promise ${a}`;
  return {
    brands,
    terms: [
      { term: promise1, kind: 'promise' },
      { term: `mock promise ${b}`, kind: 'promise' },
      { term: `mock product ${a}`, kind: 'product' },
      { term: `mock product ${b}`, kind: 'product' },
      { term: `mock pain ${a}`, kind: 'pain' },
      { term: `mock pain ${b}`, kind: 'pain' },
    ],
  };
}

/** D3 fake: termo → [Página, quantos anúncios]. Termo fora da tabela = vazio (EMPTY). */
const TERM_PAGES: Record<string, [number, number][]> = {
  'mock promise alpha': [[3, 3], [4, 2], [7, 1], [8, 2]],
  'mock product alpha': [[1, 2], [5, 3], [9, 2]],
  'mock pain alpha': [[6, 2], [2, 2], [3, 1]],
  'mock product beta': [[4, 1], [5, 1], [6, 1]],
  'mock promise beta': [[1, 1], [3, 2]],
  'mock pain beta': [[2, 1], [6, 1]],
  'mock promise gamma': [[10, 3], [11, 2]],
  'mock pain gamma': [[11, 1], [10, 1]],
  'mock product gamma': [[1, 1]],
  'mock product delta': [[5, 1]],
};

/** D2 fake: domínio → Página dona (6 anúncios ativos) + 1 de ruído (Rival H). */
const DOMAIN_PAGES: Record<string, number> = { 'rival-a.example': 1, 'rival-b.example': 2 };

export interface MockAdsPlan {
  /** [pageId, nome, quantos anúncios] */
  pages: { pageId: string; name: string; count: number }[];
  errors: { code: string; message: string }[];
  quota?: boolean;
}

const pageRef = (n: number) => {
  const p = MOCK_PAGES[n - 1];
  return { pageId: p.pageId, name: p.name };
};

/** Quais anúncios uma coleta devolve (antes de cortar pelo limite). */
export function mockScrapePlan(i: { kind: 'PAGE' | 'KEYWORD'; query: string }): MockAdsPlan {
  const q = i.query.trim().toLowerCase().replace(/^"(.*)"$/, '$1');
  if (q.includes('mock-quota')) return { pages: [], errors: [], quota: true };
  if (i.kind === 'PAGE') {
    const known = mockPage(i.query.trim());
    const name = known?.name ?? `Mock Page ${i.query.trim()}`;
    if (q.includes('mock-gone')) return { pages: [], errors: [{ code: 'PAGE_PRIVATE', message: 'Page is private' }] };
    if (q.includes('mock-empty')) return { pages: [], errors: [] };
    if (q.includes('mock-suspect')) return { pages: [{ pageId: i.query.trim(), name, count: 3 }], errors: [] };
    if (q.includes('mock-big')) return { pages: [{ pageId: i.query.trim(), name, count: 300 }], errors: [] };
    return { pages: [{ pageId: i.query.trim(), name, count: 24 }], errors: [] };
  }
  if (q === 'mock diffuse promise') {
    return { pages: Array.from({ length: 10 }, (_, k) => ({ pageId: `mock-single-${k + 1}`, name: `Single Advertiser ${k + 1}`, count: 1 })), errors: [] };
  }
  const owner = DOMAIN_PAGES[q];
  if (owner) return { pages: [{ ...pageRef(owner), count: 6 }, { ...pageRef(8), count: 1 }], errors: [] };
  const list = TERM_PAGES[q];
  if (list) return { pages: list.map(([n, count]) => ({ ...pageRef(n), count })), errors: [] };
  return { pages: [], errors: [] };
}

const PLATFORMS: LibraryAdPlatform[][] = [['FACEBOOK', 'INSTAGRAM'], ['FACEBOOK', 'INSTAGRAM', 'THREADS'], ['INSTAGRAM'], ['FACEBOOK', 'INSTAGRAM', 'MESSENGER', 'AUDIENCE_NETWORK']];

/** id numérico estável por Página × posição (o mesmo na sonda e na importação → fusão por ad_archive_id). */
export function mockAdArchiveId(pageId: string, k: number): string {
  const h = seedOf('radar', pageId, String(k));
  return `9${BigInt('0x' + h).toString().padStart(15, '0').slice(0, 15)}`;
}

/** k-ésimo anúncio da Página (k = 0 é o mais antigo e o de mais impressões). Ciclo de 24: 16 vídeo, 5 imagem, 3 DCO. */
export function mockAd(o: { pageId: string; name: string; k: number; publicApiUrl: string; now: number }): LibraryAdDraft {
  const { pageId, name, k } = o;
  const page = mockPage(pageId);
  const host = page?.host ?? `${pageId.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'mock'}.example`;
  const slot = k % 24;
  const format = slot < 16 ? 'VIDEO' : slot < 21 ? 'IMAGE' : 'DCO';
  const seed = seedOf('radar-media', pageId, String(k));
  const days = Math.max(1, 90 - k * 4);
  const start = new Date(o.now - days * 86_400_000).toISOString().slice(0, 10);
  const today = new Date(o.now).toISOString().slice(0, 10);
  const sec = 12 + (k % 5) * 6;
  const video = format === 'IMAGE' ? null : mockMediaUrl(o.publicApiUrl, { kind: 'video', seed, format: 'VERTICAL_9_16', sec });
  const poster = mockMediaUrl(o.publicApiUrl, { kind: format === 'IMAGE' ? 'static' : 'face', seed });
  const linkUrl = `https://${host}/offer?ad=${k}`;
  const primaryText = `${name}: this is mock ad number ${k + 1}, the kind of message advertisers in this niche run every day.`;
  const headline = `${name} offer ${k + 1}`;
  return {
    adArchiveId: mockAdArchiveId(pageId, k),
    pageId,
    pageName: name,
    pageAvatarUrl: mockMediaUrl(o.publicApiUrl, { kind: 'face', seed: seedOf('radar-page', pageId) }),
    pageLikeCount: page?.likes ?? 1200,
    format,
    hasVideo: !!video,
    primaryText,
    headline,
    ctaText: k % 2 ? 'Learn more' : 'Sign up',
    linkUrl,
    linkHost: host,
    cards: format === 'DCO'
      ? [0, 1, 2].map((c) => ({
          headline: `${headline} · card ${c + 1}`, body: primaryText, linkUrl,
          mediaKind: c === 0 ? ('VIDEO' as const) : ('IMAGE' as const),
          posterUrl: mockMediaUrl(o.publicApiUrl, { kind: 'face', seed: seed + c }),
          videoUrl: c === 0 ? video : null,
        }))
      : [],
    platforms: PLATFORMS[k % PLATFORMS.length],
    startDate: start,
    endDate: today,
    isActive: true,
    collationCount: k % 7 === 3 ? null : k % 5 === 0 ? 6 : 1 + (k % 4),
    euReach: null,
    lowImpressions: false,
    language: 'en',
    videoUrl: video,
    posterUrl: poster,
    mediaExpiresAt: new Date(o.now + 106 * 3_600_000).toISOString(),
    width: video ? 720 : 1080,
    height: video ? 1280 : 1080,
    durationSec: video ? sec : null,
    searchTerm: null,
  };
}
