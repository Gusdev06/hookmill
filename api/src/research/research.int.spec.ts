// Ad Radar (ads-research-v1, Construção 04/11) de ponta a ponta contra o banco LOCAL de teste (maquina_test), com as portas
// em mock (ADS_RESEARCH_MODE=mock: FakeResearchService + FakeClaude do mundo mock-radar.ts, custo fake sem nada pago):
// onboarding → descoberta (A–D diretos + E vizinho seguidos, reserva G, F) → importação → grid/filtros/selo → isolamento →
// CLIENT só lê → remover (entra F, o 1º com ≥ 2 anúncios) → restaurar sem vaga → "Procurar de novo" (2 termos reaproveitados,
// J/K na reserva, removido bloqueado) → atualizar agora (janela) → salvar → teto (scope research) → usar como campeão
// (URL válida e vencida → coleta MEDIA) → fits.
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off';
process.env.ADS_RESEARCH_MODE = 'mock';
process.env.ADS_RESEARCH_DISCOVERY = 'on';
process.env.ADS_RESEARCH_DAILY_GLOBAL_USD = '1000'; // o teto global é do dia inteiro do banco de teste
process.env.TEST_MODE = 'off'; // o api/.env pode ter TEST_MODE=on (todo mundo INTERNAL); aqui o dono é PAID de verdade
const PORT = 3197;
process.env.PUBLIC_API_URL = `http://127.0.0.1:${PORT}`;

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { Competitor, CompetitorDiscoveryView, DismissCompetitorResponse, ResearchAdDetail, ResearchAdPage, ResearchStatus } from '@maquina/contratos';
import { AppModule } from '../app.module';
import { hashPassword } from '../common/util/crypto';
import { CustosService } from '../custos/custos.service';
import { configureApp } from '../main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(240_000);

const RUN = Date.now().toString(36);
const PREFIX = `radar-${RUN}-`;
const PASSWORD = 'senha-teste-1234';
type Who = 'owner' | 'client' | 'other';

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000, every = 300): Promise<T> {
  const end = Date.now() + ms;
  let last: T = await fn();
  while (!ok(last)) {
    if (Date.now() > end) throw new Error(`timeout esperando condição; último valor: ${JSON.stringify(last)?.slice(0, 800)}`);
    await new Promise((r) => setTimeout(r, every));
    last = await fn();
  }
  return last;
}

describe(isLocal ? 'Ad Radar (integração local, mock)' : 'Ad Radar [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base = '';
  const prisma = new PrismaClient();
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1: string;
  let w2: string;
  let offerId: string;

  const req = async <T = unknown>(method: string, path: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, {
      method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined && { 'content-type': 'application/json' }) }, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = r.status === 204 ? null : await r.json().catch(() => null);
    return { status: r.status, data: json?.data as T, error: json?.error as { code: string; details?: Record<string, unknown> } | undefined };
  };
  const owner = () => users.owner.token;
  const discovery = () => req<CompetitorDiscoveryView>('GET', '/research/discovery', owner());
  const competitors = (status = 'active', token = owner()) => req<{ items: Competitor[] }>('GET', `/research/competitors?status=${status}`, token);
  const settled = () => waitFor(async () => prisma.researchSync.count({ where: { requestedByWorkspaceId: w1, status: { in: ['QUEUED', 'RUNNING'] } } }), (n) => n === 0, 90_000);
  const names = (list: Competitor[]) => list.map((c) => c.source.displayName);

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    // mundo mock é global (Páginas mock-page-N): começa limpo pra contagem ser determinística
    await prisma.adSource.deleteMany({ where: { pageId: { startsWith: 'mock-' } } });
    await prisma.libraryAd.deleteMany({ where: { pageId: { startsWith: 'mock-' } } });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(PORT, '127.0.0.1');
    base = `http://127.0.0.1:${PORT}/api/v1`;

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'client', 'other'] as Who[]) {
      const email = `${PREFIX}${k}@teste.local`;
      const u = await prisma.user.create({ data: { access: k === 'client' ? 'SAMPLE' : 'PAID', email, name: `Radar ${k}`, passwordHash: hash, accountMode: 'AGENCY' } });
      users[k] = { id: u.id, email, token: '' };
    }
    w1 = (await prisma.workspace.create({
      data: {
        name: `${PREFIX}app`, shortCode: 'RD', resultType: 'PURCHASE', industry: 'Budgeting app', market: 'United States', monthlySpendCapUsd: 500,
        onboardingStep: 5,
        memberships: { create: [{ userId: users.owner.id, role: 'OWNER', tourCompletedAt: new Date() }, { userId: users.client.id, role: 'CLIENT', tourCompletedAt: new Date() }] },
      },
    })).id;
    w2 = (await prisma.workspace.create({ data: { name: `${PREFIX}outro`, shortCode: 'OT', memberships: { create: [{ userId: users.other.id, role: 'OWNER', tourCompletedAt: new Date() }] } } })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: users[k].email, password: PASSWORD }) });
      expect(r.status).toBe(200);
      users[k].token = (await r.json()).data.accessToken;
    }
    offerId = (await prisma.offer.create({ data: { workspaceId: w1, name: 'Budget', language: 'en', what: 'Budget app', promise: 'Save money', audience: 'Young adults', createdById: users.owner.id } })).id;
  });

  afterAll(async () => {
    if (w1) await settled().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 500));
    await prisma.workspace.deleteMany({ where: { id: { in: [w1, w2].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('antes de tudo: status sem descoberta, grid vazio', async () => {
    const st = await req<ResearchStatus>('GET', '/research/status', owner());
    expect(st.status).toBe(200);
    expect(st.data).toMatchObject({ mode: 'mock', available: true, limits: { access: 'PAID', maxCompetitors: 5, activeCompetitors: 0, reserveMax: 10, maxAdsPerCompetitor: 150 }, discovery: { status: null }, winnerDays: 30, winnerVersions: 5 });
    const d = await discovery();
    expect(d.data).toMatchObject({ last: null, manualAllowed: true, estimateUsd: 0.15 });
  });

  it('fim do onboarding dispara a descoberta: segue A, B, C, D (diretos) + E (vizinho), reserva G, F', async () => {
    const r = await req('POST', '/workspace/onboarding/complete', owner());
    expect(r.status).toBe(200);
    const d = await waitFor(discovery, (x) => !!x.data.last && ['SUCCEEDED', 'EMPTY', 'FAILED'].includes(x.data.last.status));
    expect(d.data.last).toMatchObject({ trigger: 'ONBOARDING', status: 'SUCCEEDED', countryCode: 'US', followed: 5, reserved: 2, stage: null });
    // cliente PAID não vê lista nem custo (só INTERNAL)
    expect(d.data.last!.candidates).toEqual([]);
    expect(d.data.last!.costUsd).toBeNull();
    const list = await competitors();
    expect(list.data.items).toHaveLength(5);
    expect(names(list.data.items).slice(0, 4).sort()).toEqual(['Rival A', 'Rival B', 'Rival C', 'Rival D']); // diretos primeiro
    expect(list.data.items[4]).toMatchObject({ relation: 'ADJACENT', source: { displayName: 'Rival E', countryCode: 'US' } });
    expect(list.data.items.every((c) => c.origin === 'DISCOVERED' && !!c.reason)).toBe(true);

    const cands = await prisma.competitorCandidate.findMany({ where: { workspaceId: w1 }, orderBy: { rank: 'asc' } });
    const by = (n: string) => cands.find((c) => c.pageName === n);
    expect(cands.filter((c) => c.status === 'RESERVE').map((c) => c.pageName)).toEqual(['Rival G', 'Rival F']);
    expect(by('Rival H')).toMatchObject({ status: 'REJECTED_NICHE', relation: null });
    expect(by('Rival I Ѕtore')).toMatchObject({ status: 'REJECTED_NICHE', suspectDisposable: true });
    expect(cands.find((c) => c.brandName === 'Ghost Brand')).toMatchObject({ status: 'NOT_FOUND', pageId: null });
    const terms = await prisma.researchTerm.findMany({ where: { workspaceId: w1 } });
    expect(terms.filter((t) => t.outcome !== 'UNUSED')).toHaveLength(4);
    expect(terms.filter((t) => t.outcome === 'UNUSED')).toHaveLength(2);
    expect(terms.some((t) => t.approvedCount > 0)).toBe(true);

    // custo: 2 chamadas Claude (2 entradas cada) + sondas, tudo no ledger da pesquisa, fora do teto geral
    const llm = await prisma.costEntry.findMany({ where: { workspaceId: w1, provider: 'ANTHROPIC', discoveryId: d.data.last!.id } });
    expect(llm).toHaveLength(4);
    expect(await prisma.costEntry.count({ where: { workspaceId: w1, provider: 'APIFY', discoveryId: d.data.last!.id, researchSync: { kind: 'KEYWORD' } } })).toBe(7); // 3 sondas D2 + 4 D3 (as importações também levam o discoveryId)
    await settled();
    const st = await req<ResearchStatus>('GET', '/research/status', owner());
    expect(st.data.spend.monthUsd).toBeGreaterThan(0.15);
    expect(st.data.limits).toMatchObject({ activeCompetitors: 5, reserveCount: 2 });
    expect(await app.get(CustosService).monthSpent(w1)).toBe(0);
  });

  it('importação: contagens reais (sem "≥"), poster no storage, grid com selo e filtros', async () => {
    await settled();
    const list = await competitors();
    for (const c of list.data.items) {
      expect(c).toMatchObject({ activeIsLowerBound: false, sync: { trigger: 'INITIAL', status: 'SUCCEEDED' }, counts: { active: 24 } });
      expect(c.counts.winners).toBeGreaterThan(0);
    }
    const page = await req<ResearchAdPage>('GET', '/research/ads?limit=60', owner());
    expect(page.status).toBe(200);
    expect(page.data.total).toBe(5 * 24);
    expect(page.data.items).toHaveLength(60);
    expect(page.data.nextCursor).toBeTruthy();
    // padrão longest_running: o mais antigo primeiro
    const starts = page.data.items.map((a) => a.startDate!);
    expect([...starts].sort()).toEqual(starts);
    const ad = page.data.items[0];
    expect(ad).toMatchObject({ isActive: true, tier: 'winner', competitors: [{ id: expect.any(String) }], countryCode: 'US', saved: false, usedInBatches: 0 });
    expect(ad.adLibraryUrl).toContain(ad.adArchiveId);
    const withPoster = await prisma.libraryAd.count({ where: { pageId: { in: ['mock-page-1', 'mock-page-2'] }, posterKey: { not: null } } });
    expect(withPoster).toBeGreaterThan(0);

    const next = await req<ResearchAdPage>('GET', `/research/ads?limit=60&cursor=${page.data.nextCursor}`, owner());
    expect(next.data.items).toHaveLength(60);
    expect(next.data.nextCursor).toBeNull();
    const winners = await req<ResearchAdPage>('GET', '/research/ads?tier=winner&limit=60', owner());
    expect(winners.data.total).toBe(page.data.winners);
    expect(winners.data.items.every((a) => a.tier === 'winner')).toBe(true);
    const images = await req<ResearchAdPage>('GET', '/research/ads?format=IMAGE&limit=60', owner());
    expect(images.data.items.every((a) => a.format === 'IMAGE' && !a.hasVideo && !a.usable)).toBe(true);
    const a = list.data.items.find((c) => c.source.displayName === 'Rival A')!;
    const onlyA = await req<ResearchAdPage>('GET', `/research/ads?competitorId=${a.id}&sort=newest`, owner());
    expect(onlyA.data.total).toBe(24);
    expect(onlyA.data.items.every((x) => x.page.name === 'Rival A')).toBe(true);
    const bad = await req('GET', '/research/ads?format=GIF', owner());
    expect(bad.status).toBe(400);
  });

  it('isolamento: outro workspace não vê nada; CLIENT lê mas não muda', async () => {
    const page = await req<ResearchAdPage>('GET', '/research/ads?limit=1', owner());
    const adId = page.data.items[0].id;
    expect((await req('GET', `/research/ads/${adId}`, users.other.token)).status).toBe(404);
    expect((await req<{ items: Competitor[] }>('GET', '/research/competitors', users.other.token)).data.items).toEqual([]);
    expect((await req<ResearchAdPage>('GET', '/research/ads', users.other.token)).data.total).toBe(0);
    const comp = (await competitors()).data.items[0];
    expect((await req('POST', `/research/competitors/${comp.id}/dismiss`, users.other.token, { reason: 'other' })).status).toBe(404);

    expect((await competitors('active', users.client.token)).data.items).toHaveLength(5);
    expect((await req('POST', `/research/competitors/${comp.id}/dismiss`, users.client.token, { reason: 'other' })).status).toBe(403);
    expect((await req('PUT', `/research/ads/${adId}/save`, users.client.token, {})).status).toBe(403);
    expect((await req('POST', '/research/discovery', users.client.token)).status).toBe(403);
  });

  it('remover: vaga vai pro 1º da reserva com ≥ 2 anúncios (F, não G); restaurar sem vaga = 409', async () => {
    const b = (await competitors()).data.items.find((c) => c.source.displayName === 'Rival B')!;
    const r = await req<DismissCompetitorResponse>('POST', `/research/competitors/${b.id}/dismiss`, owner(), { reason: 'not_competitor' });
    expect(r.status).toBe(200);
    expect(r.data.dismissed).toMatchObject({ status: 'DISMISSED', dismissReason: 'not_competitor' });
    expect(r.data.replacement).toMatchObject({ source: { displayName: 'Rival F' }, relation: 'ADJACENT' });
    expect((await req('POST', `/research/competitors/${b.id}/dismiss`, owner(), { reason: 'other' })).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'not_active' } });
    expect((await req('POST', `/research/competitors/${b.id}/dismiss`, owner(), { reason: 'nope' })).status).toBe(400);
    expect(names((await competitors('dismissed')).data.items)).toEqual(['Rival B']);
    const restore = await req('POST', `/research/competitors/${b.id}/restore`, owner());
    expect(restore.error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'competitor_limit' } });
    await settled();
  });

  it('"Procurar de novo": 7 dias (429) → reaproveita 2 termos, J/K na reserva, removido bloqueado, seguidos ficam', async () => {
    const early = await req('POST', '/research/discovery', owner());
    expect(early.error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfter: expect.any(String) } });
    await prisma.competitorDiscovery.updateMany({ where: { workspaceId: w1 }, data: { createdAt: new Date(Date.now() - 8 * 86_400_000) } });
    const r = await req<CompetitorDiscoveryView>('POST', '/research/discovery', owner());
    expect(r.status).toBe(202);
    expect((await req('POST', '/research/discovery', owner())).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'discovery_running' } });
    const d = await waitFor(discovery, (x) => !!x.data.last && x.data.last.trigger === 'MANUAL' && ['SUCCEEDED', 'EMPTY', 'FAILED'].includes(x.data.last.status));
    expect(d.data.last).toMatchObject({ status: 'SUCCEEDED', followed: 0 });
    const terms = await prisma.researchTerm.findMany({ where: { discoveryId: d.data.last!.id } });
    expect(terms.filter((t) => t.origin === 'REUSED')).toHaveLength(2);
    const reserve = await prisma.competitorCandidate.findMany({ where: { discoveryId: d.data.last!.id, status: 'RESERVE' }, orderBy: { rank: 'asc' } });
    expect(reserve.slice(0, 2).map((c) => c.pageName)).toEqual(['Rival J', 'Rival K']);
    expect(reserve.map((c) => c.pageName)).toContain('Rival G');
    const blocked = await prisma.competitorCandidate.findFirst({ where: { discoveryId: d.data.last!.id, pageName: 'Rival B' } });
    if (blocked) expect(blocked.status).toBe('BLOCKED');
    const list = await competitors();
    expect(names(list.data.items).sort()).toEqual(['Rival A', 'Rival C', 'Rival D', 'Rival E', 'Rival F']);
    await settled();
  });

  it('atualizar agora: 202, depois janela de 24 h (429)', async () => {
    const c = (await competitors()).data.items.find((x) => x.source.displayName === 'Rival C')!;
    const r = await req<Competitor>('POST', `/research/competitors/${c.id}/refresh`, owner());
    expect(r.status).toBe(202);
    await settled();
    const again = await req('POST', `/research/competitors/${c.id}/refresh`, owner());
    expect(again.error).toMatchObject({ code: 'RATE_LIMITED' });
    const after = (await competitors()).data.items.find((x) => x.id === c.id)!;
    expect(after.sync).toMatchObject({ trigger: 'MANUAL', status: 'SUCCEEDED' });
    expect(after.refreshAvailableAt).toBeTruthy();
  });

  it('salvar: PUT idempotente com nota, aparece em saved=true, DELETE 204', async () => {
    const ad = (await req<ResearchAdPage>('GET', '/research/ads?format=VIDEO&limit=1', owner())).data.items[0];
    const s = await req('PUT', `/research/ads/${ad.id}/save`, owner(), { note: 'gancho bom' });
    expect(s.status).toBe(200);
    expect(s.data).toMatchObject({ saved: true });
    const saved = await req<ResearchAdPage>('GET', '/research/ads?saved=true', owner());
    expect(saved.data.items.map((a) => a.id)).toEqual([ad.id]);
    const det = await req<ResearchAdDetail>('GET', `/research/ads/${ad.id}`, owner());
    expect(det.data).toMatchObject({ savedNote: 'gancho bom', saved: true, championId: null });
    expect((await req('DELETE', `/research/ads/${ad.id}/save`, owner())).status).toBe(204);
    expect((await req<ResearchAdPage>('GET', '/research/ads?saved=true', owner())).data.total).toBe(0);
  });

  it('teto da pesquisa estourado = 409 SPEND_CAP_EXCEEDED scope research', async () => {
    const c = (await competitors()).data.items.find((x) => x.source.displayName === 'Rival D')!;
    process.env.ADS_RESEARCH_MONTHLY_CAP_USD = '0.01';
    try {
      const r = await req('POST', `/research/competitors/${c.id}/refresh`, owner());
      expect(r.status).toBe(409);
      expect(r.error).toMatchObject({ code: 'SPEND_CAP_EXCEEDED', details: { scope: 'research', capUsd: 0.01 } });
    } finally {
      delete process.env.ADS_RESEARCH_MONTHLY_CAP_USD;
    }
  });

  it('usar como campeão: URL válida → campeão THIRD_PARTY único; vencida → coleta MEDIA; imagem = 409; fits acha o campeão', async () => {
    const vids = (await req<ResearchAdPage>('GET', '/research/ads?format=VIDEO&limit=3', owner())).data.items;
    const img = (await req<ResearchAdPage>('GET', '/research/ads?format=IMAGE&limit=1', owner())).data.items[0];
    expect((await req('POST', '/iterate', owner(), { researchAdId: img.id, offerId })).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'ad_has_no_video' } });
    expect((await req('POST', '/iterate', owner(), { researchAdId: vids[0].id, championId: 'x' })).error).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await req('POST', '/iterate', users.other.token, { researchAdId: vids[0].id })).status).toBe(404);

    const first = await req<{ id: string }>('POST', '/iterate', owner(), { researchAdId: vids[0].id, offerId });
    expect(first.status).toBe(202);
    const ch = await prisma.champion.findUniqueOrThrow({ where: { workspaceId_researchAdId: { workspaceId: w1, researchAdId: vids[0].id } } });
    expect(ch).toMatchObject({ rights: 'THIRD_PARTY', adArchiveId: vids[0].adArchiveId });
    expect(ch.adLibraryUrl).toContain(vids[0].adArchiveId);
    await waitFor(() => prisma.champion.findUniqueOrThrow({ where: { id: ch.id } }), (c) => c.status !== 'RESOLVING', 90_000);
    const second = await req('POST', '/iterate', owner(), { researchAdId: vids[0].id, offerId });
    expect(second.status).toBe(202);
    expect(await prisma.champion.count({ where: { workspaceId: w1, researchAdId: vids[0].id } })).toBe(1);
    const det = await req<ResearchAdDetail>('GET', `/research/ads/${vids[0].id}`, owner());
    expect(det.data.championId).toBe(ch.id);
    expect(det.data.usedInBatches).toBe(2);

    // a análise mock do 1º termina antes da 2ª começar (duas medições em paralelo no mesmo processo deixam o spec instável)
    await waitFor(() => prisma.champion.findUniqueOrThrow({ where: { id: ch.id } }), (c) => c.status === 'READY' || c.status === 'FAILED', 120_000, 500);
    // URL vencida e sem vídeo guardado: campeão espera em RESOLVING e uma coleta MEDIA busca a URL nova
    await prisma.libraryAd.update({ where: { id: vids[1].id }, data: { videoKey: null, mediaExpiresAt: new Date(Date.now() - 3_600_000) } });
    const exp = await req<ResearchAdDetail>('GET', `/research/ads/${vids[1].id}`, owner());
    expect(exp.data.media).toMatchObject({ status: 'expired', playable: false });
    const third = await req('POST', '/iterate', owner(), { researchAdId: vids[1].id, offerId });
    expect(third.status).toBe(202);
    const media = await prisma.researchSync.findFirst({ where: { targetAdId: vids[1].id, trigger: 'MEDIA' } });
    expect(media).toBeTruthy();
    const ch2 = await waitFor(() => prisma.champion.findUniqueOrThrow({ where: { workspaceId_researchAdId: { workspaceId: w1, researchAdId: vids[1].id } } }), (c) => c.status !== 'RESOLVING', 90_000);
    expect(['ANALYZING', 'READY']).toContain(ch2.status);
    expect(ch2.videoFileId).toBeTruthy();
    expect((await prisma.libraryAd.findUniqueOrThrow({ where: { id: vids[1].id } })).videoKey).toBeTruthy();

    // carregar vídeo de um anúncio vencido: 202 refreshing
    await prisma.libraryAd.update({ where: { id: vids[2].id }, data: { videoKey: null, mediaExpiresAt: new Date(Date.now() - 3_600_000) } });
    const load = await req<ResearchAdDetail>('POST', `/research/ads/${vids[2].id}/media`, owner());
    expect(load.status).toBe(202);
    expect(load.data.media.status).toBe('refreshing');
    expect((await req('POST', `/research/ads/${vids[2].id}/media`, owner())).error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'media_refreshing' } });
    await waitFor(async () => (await req<ResearchAdDetail>('GET', `/research/ads/${vids[2].id}`, owner())).data.media.status, (s) => s === 'stored', 60_000);

    const gallery = await req<{ items: { slug: string }[] }>('GET', '/templates', owner());
    const slug = gallery.data?.items?.[0]?.slug;
    if (slug) {
      const fits = await req<{ items: { championId: string | null }[] }>('POST', '/templates/fits', owner(), { slug, sources: [{ researchAdId: vids[0].id }] });
      expect(fits.status).toBe(200);
      expect(fits.data.items[0].championId).toBe(ch.id);
    }
    await settled();
    // a análise (mock) roda em segundo plano: espera os campeões terminarem antes de fechar o app
    await waitFor(() => prisma.champion.count({ where: { workspaceId: w1, status: { in: ['RESOLVING', 'ANALYZING'] } } }), (n) => n === 0, 120_000, 1000);
  });
});
