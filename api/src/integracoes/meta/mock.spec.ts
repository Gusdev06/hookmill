import type { MetaPublishInput, MetaPublishIds, MetaService } from '../contrato';
import { MetaError } from './erros';
import { buildMetaService, metaMode } from './modo';
import { FakeMetaService, MOCK_MIN_DAILY_BUDGET_MINOR, MOCK_TOKEN } from './mock.service';
import { DEFAULT_RULE } from './vencedor';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const svc = () => new FakeMetaService({ publicApiUrl: 'http://localhost:3001', jwtSecret: 'test-secret', rule: DEFAULT_RULE, stepMs: 0, now: () => NOW });
const auth = { accessToken: MOCK_TOKEN };
const ids = (p: Partial<MetaPublishIds> = {}): MetaPublishIds => ({ videoId: null, creativeId: null, campaignId: null, adsetId: null, adId: null, ...p });
const input = (over: Partial<MetaPublishInput['settings']> = {}, adAccountId = 'act_mock_1'): MetaPublishInput => ({
  adAccountId, pageId: 'page_mock', pixelId: 'pix_mock', adName: 'HM — Hook A',
  settings: { dailyBudgetMinor: 2000, countries: ['US'], objective: 'OUTCOME_SALES', primaryText: 'Found $300/month', headline: null, description: null, callToAction: 'SHOP_NOW', link: 'https://example.com', specialAdCategories: [], ageMin: 18, ageMax: 65, objectiveReason: 'business_type', ...over },
  video: { fileUrl: 'http://localhost:3001/files/render.mp4', sizeBytes: null, read: null },
  thumbnailUrl: 'http://localhost:3001/files/thumb.jpg',
});
const code = (p: Promise<unknown>) => p.then(() => 'OK', (e) => (e instanceof MetaError ? `${e.code}${e.stage ? '@' + e.stage : ''}` : `other:${e}`));

describe('FakeMetaService (meta-v1 §8)', () => {
  it('status/buildAuthUrl/verifyState: url volta pro callback com code=mock e state assinado', () => {
    const s = svc();
    expect(s.status()).toEqual({ mode: 'mock', configured: true, appIdMasked: 'mock', graphVersion: 'v25.0' });
    const r = s.buildAuthUrl({ workspaceId: 'w1', userId: 'u1', returnTo: '/settings' });
    expect(r.url.startsWith('http://localhost:3001/api/v1/meta/callback?code=mock&state=')).toBe(true);
    expect(r.expiresAt).toBe(new Date(NOW.getTime() + 600_000).toISOString());
    const st = s.verifyState(r.state, { workspaceId: 'w1', userId: 'u1' });
    expect(st).toMatchObject({ workspaceId: 'w1', userId: 'u1', returnTo: '/settings' });
    expect(st.nonce.length).toBeGreaterThan(8);
    // allowlist do returnTo: /settings/connections (Settings › Connections, onde o MetaConnect lê ?meta=) e /settings como alias; fora da lista cai no onboarding
    expect(s.verifyState(s.buildAuthUrl({ workspaceId: 'w1', userId: 'u1', returnTo: '/settings/connections' }).state).returnTo).toBe('/settings/connections');
    expect(s.verifyState(s.buildAuthUrl({ workspaceId: 'w1', userId: 'u1', returnTo: '/evil' as never }).state).returnTo).toBe('/onboarding/meta');
  });
  it('verifyState: faltando, assinatura errada, expirado, outro usuário/workspace = META_STATE_INVALID', () => {
    const s = svc();
    const { state } = s.buildAuthUrl({ workspaceId: 'w1', userId: 'u1', returnTo: '/onboarding/meta' });
    const bad = (st: string | undefined, expect?: { workspaceId?: string; userId?: string }) => {
      try {
        s.verifyState(st, expect);
        return 'OK';
      } catch (e) {
        return (e as MetaError).code + ':' + (e as MetaError).details?.why;
      }
    };
    expect(bad(undefined)).toBe('META_STATE_INVALID:missing');
    expect(bad(state.slice(0, -2) + 'xx')).toBe('META_STATE_INVALID:signature');
    expect(bad(state, { userId: 'u2' })).toBe('META_STATE_INVALID:user');
    expect(bad(state, { workspaceId: 'w2' })).toBe('META_STATE_INVALID:workspace');
    const later = new FakeMetaService({ publicApiUrl: 'x', jwtSecret: 'test-secret', rule: DEFAULT_RULE, stepMs: 0, now: () => new Date(NOW.getTime() + 601_000) });
    expect(() => later.verifyState(state)).toThrow(expect.objectContaining({ code: 'META_STATE_INVALID' }));
    const other = new FakeMetaService({ publicApiUrl: 'x', jwtSecret: 'other', rule: DEFAULT_RULE, stepMs: 0 });
    expect(() => other.verifyState(state)).toThrow(expect.objectContaining({ code: 'META_STATE_INVALID' }));
  });
  it('exchangeCode: mock ok (user mock_user, 4 escopos, 60 d); mock-denied / mock-scopes / mock-failed / error=access_denied', async () => {
    const s = svc();
    const g = await s.exchangeCode({ code: 'mock' });
    expect(g).toMatchObject({ tokenType: 'USER_LONG_LIVED', user: { id: 'mock_user', name: 'Mock User' } });
    // token próprio por conexão (escopo das escritas mock); continua válido como "mock"
    expect(g.accessToken).toMatch(/^mock\.[0-9a-f]{12}$/);
    expect((await s.exchangeCode({ code: 'mock' })).accessToken).not.toBe(g.accessToken);
    expect(await s.inspectToken({ accessToken: g.accessToken })).toMatchObject({ isValid: true });
    expect(g.scopes).toEqual(['ads_management', 'ads_read', 'business_management', 'pages_show_list']);
    expect(g.expiresAt).toBe(new Date(NOW.getTime() + 60 * 86_400_000).toISOString());
    await expect(code(s.exchangeCode({ code: 'mock-denied' }))).resolves.toBe('META_OAUTH_DENIED');
    await expect(code(s.exchangeCode({ error: 'access_denied', errorReason: 'user_denied' }))).resolves.toBe('META_OAUTH_DENIED');
    await expect(s.exchangeCode({ code: 'mock-scopes' })).rejects.toMatchObject({ code: 'META_SCOPES_MISSING', details: { missing: ['ads_management'] } });
    await expect(code(s.exchangeCode({ code: 'mock-failed' }))).resolves.toBe('META_OAUTH_FAILED');
    await expect(code(s.exchangeCode({ code: '' }))).resolves.toBe('META_OAUTH_FAILED');
    // nunca devolve action (erro de OAuth volta por redirect)
    await s.exchangeCode({ code: 'mock-denied' }).catch((e: MetaError) => expect(e.action).toBeNull());
  });
  it('inspectToken: "mock" válido; outro token inválido (e as rotas com auth lançam META_TOKEN_INVALID)', async () => {
    const s = svc();
    expect(await s.inspectToken(auth)).toMatchObject({ isValid: true, missingScopes: [] });
    expect(await s.inspectToken({ accessToken: 'stale' })).toMatchObject({ isValid: false, missingScopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list'] });
    await expect(code(s.listOptions({ accessToken: 'stale' }, {}))).resolves.toBe('META_TOKEN_INVALID');
    await expect(code(s.health({ accessToken: 'stale' }, { adAccountId: null, pageId: null, pixelId: null, businessId: null, tokenExpiresAt: null, scopes: [], counts: { adsCount: 0, activeCount: 0 } }))).resolves.toBe('META_TOKEN_INVALID');
    await expect(s.revoke(auth)).resolves.toBeUndefined();
  });
  it('listOptions: 3 contas (act_mock_2 status 2, act_mock_3 canManage=false), 1 página, pixel só com adAccountId', async () => {
    const s = svc();
    const o = await s.listOptions(auth, {});
    expect(o.adAccounts.map((a) => [a.id, a.currency, a.accountStatus, a.canManage, a.permissionReason])).toEqual([
      ['act_mock_1', 'USD', 1, true, null],
      ['act_mock_2', 'BRL', 2, true, null],
      ['act_mock_3', 'USD', 1, false, 'no_advertise_task'],
    ]);
    expect(o.pages).toEqual([{ id: 'page_mock', name: 'Mock Page' }]);
    expect(o.pixels).toEqual([]);
    const o2 = await s.listOptions(auth, { adAccountId: 'act_mock_1' });
    expect(o2.pixels).toEqual([{ id: 'pix_mock', name: 'Mock Pixel', adAccountId: 'act_mock_1', lastFiredAt: new Date(NOW.getTime() - 86_400_000).toISOString() }]);
  });
  it('readAdAccount: dados da conta (mínimo 500) e META_PERMISSION pra conta desconhecida', async () => {
    const s = svc();
    expect(await s.readAdAccount(auth, 'act_mock_2')).toMatchObject({ id: 'act_mock_2', currency: 'BRL', accountStatus: 2, accountStatusLabel: 'disabled', minimumDailyBudgetMinor: MOCK_MIN_DAILY_BUDGET_MINOR, hasFunding: true, canManage: true });
    await expect(s.readAdAccount(auth, 'act_999')).rejects.toMatchObject({ code: 'META_PERMISSION', details: { adAccountId: 'act_999', reason: 'no_advertise_task' } });
  });
  it('health: act_mock_1 = tudo ok menos verified warn (canPublish); act_mock_2 = account bad (não publica); sem seleção = bad', async () => {
    const s = svc();
    const base = { businessId: 'biz_mock', tokenExpiresAt: new Date(NOW.getTime() + 60 * 86_400_000).toISOString(), scopes: [] as string[], counts: { adsCount: 8, activeCount: 6 } };
    const h1 = await s.health(auth, { ...base, adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
    expect(h1.health.checks.map((c) => `${c.key}:${c.level}`)).toEqual(['token:ok', 'scopes:ok', 'account:ok', 'funding:ok', 'page:ok', 'pixel:ok', 'budget:ok', 'verified:warn']);
    expect(h1.health).toMatchObject({ level: 'warn', canPublish: true, adsCount: 8, activeCount: 6, checkedAt: NOW.toISOString() });
    expect(h1.account?.id).toBe('act_mock_1');
    const h2 = await s.health(auth, { ...base, adAccountId: 'act_mock_2', pageId: 'page_mock', pixelId: null });
    expect(h2.health.checks.find((c) => c.key === 'account')).toEqual({ key: 'account', level: 'bad', detail: 'Account disabled, choose another' });
    expect(h2.health.checks.find((c) => c.key === 'pixel')).toMatchObject({ level: 'warn' });
    expect(h2.health).toMatchObject({ level: 'bad', canPublish: false });
    const h3 = await s.health(auth, { ...base, adAccountId: null, pageId: null, pixelId: null });
    expect(h3.health.canPublish).toBe(false);
    expect(h3.account).toBeNull();
    // token expirando em < 7 d = warn, mas ainda publica
    const h4 = await s.health(auth, { ...base, tokenExpiresAt: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(), adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
    expect(h4.health.checks[0]).toEqual({ key: 'token', level: 'warn', detail: `Reconnect before ${new Date(NOW.getTime() + 3 * 86_400_000).toISOString().slice(0, 10)}` });
    expect(h4.health.canPublish).toBe(true);
    // escopo faltando gravado na conexão = bad
    const h5 = await s.health(auth, { ...base, scopes: ['ads_read'], adAccountId: 'act_mock_1', pageId: 'page_mock', pixelId: 'pix_mock' });
    expect(h5.health.checks[1]).toEqual({ key: 'scopes', level: 'bad', detail: 'Missing permissions: ads_management, business_management, pages_show_list' });
  });
  it('syncAds: 8 anúncios de vídeo + 2 de imagem (D2), 2 WINNER de vídeo, 1 WORKING, 1 TIRING, 2 novos com trend null, 1 DISAPPROVED; progresso; determinístico', async () => {
    const s = svc();
    const steps: string[] = [];
    const r = await s.syncAds(auth, { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true }, (p) => steps.push(`${p.stage}:${p.done}/${p.total}`));
    expect(steps).toEqual(['listing_campaigns:0/3', 'listing_adsets:0/6', 'listing_ads:0/10', 'reading_insights:5/10', 'reading_insights:10/10', 'scoring:10/10']);
    expect(r.ads).toHaveLength(10);
    expect(r.listed).toBe(10);
    const videos = r.ads.filter((a) => a.videoId);
    expect(videos).toHaveLength(8);
    expect(r.rule).toEqual({ minSpendUsd: 50, minResults: 3 });
    expect(r.medianCpa).toBeCloseTo(27.375, 3);
    expect(r.syncedAt).toBe(NOW.toISOString());
    const by = Object.fromEntries(r.ads.map((a) => [a.metaAdId, a]));
    expect(videos.filter((a) => a.verdict === 'WINNER').map((a) => a.metaAdId)).toEqual(['mock_ad_1', 'mock_ad_2']); // Pick from Meta: mesmos vencedores
    // imagem julgada pela régua dos vídeos (mediana 27,375): CPA 23,33 → WINNER; a outra sem dado → LOW_DATA
    expect(by.mock_ad_img_1).toMatchObject({ videoId: null, verdict: 'WINNER' });
    expect(by.mock_ad_img_1.metrics).toMatchObject({ plays2s: null, hookRate: null });
    expect(by.mock_ad_img_2).toMatchObject({ videoId: null, verdict: 'LOW_DATA' });
    expect(by.mock_ad_1.trend).toBe('WORKING');
    expect(by.mock_ad_3.trend).toBe('TIRING');
    expect(by.mock_ad_3.verdict).toBe('OK');
    expect([by.mock_ad_5.trend, by.mock_ad_6.trend]).toEqual([null, null]);
    expect(r.ads.filter((a) => a.trend === null).map((a) => a.metaAdId).sort()).toEqual(['mock_ad_5', 'mock_ad_6', 'mock_ad_img_2']);
    expect(by.mock_ad_7.effectiveStatus).toBe('DISAPPROVED');
    expect(by.mock_ad_novideo).toMatchObject({ verdict: 'LOW_DATA', videoId: 'mock_video_novideo' });
    // ordem padrão: WINNER primeiro, depois gasto desc
    expect(videos.slice(0, 4).map((a) => a.metaAdId)).toEqual(['mock_ad_1', 'mock_ad_2', 'mock_ad_3', 'mock_ad_4']);
    expect(r.ads.every((a) => a.thumbnailUrl?.includes('/api/v1/mock-media/face/'))).toBe(true);
    expect(by.mock_ad_1.metrics).toMatchObject({ spend: 420, results: 21, cpa: 20, resultType: 'omni_purchase', ctr: 2.5, hookRate: 40, frequency: null });
    expect(by.mock_ad_1.metrics7d.frequency).toBe(2);
    expect(by.mock_ad_1.metrics.roas).toBeGreaterThan(0);
    expect(by.mock_ad_5.adCreatedTime).toBe(new Date(NOW.getTime() - 3 * 86_400_000).toISOString());
    // mesma entrada = mesma saída
    const r2 = await svc().syncAds(auth, { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true });
    expect(r2.ads).toEqual(r.ads);
    // sem pixel: resultado por clique
    const r3 = await s.syncAds(auth, { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: false });
    expect(r3.ads[0].metrics.resultType).toBe('link_click');
    expect(r3.ads[0].metrics.roas).toBeNull();
    // conta BRL com taxa: mínimo vira 275 e a régua muda
    const brl = new FakeMetaService({ publicApiUrl: 'x', jwtSecret: 's', rule: { ...DEFAULT_RULE, usdRates: { BRL: 5.5 } }, stepMs: 0, now: () => NOW });
    const r4 = await brl.syncAds(auth, { adAccountId: 'act_mock_2', currency: 'BRL', businessType: 'ONLINE_STORE', hasPixel: true });
    expect(r4.ads.filter((a) => a.verdict === 'WINNER').map((a) => a.metaAdId)).toEqual(['mock_ad_1', 'mock_ad_2']); // 420, 380, 310, 260 ≥ 275 → 3 elegíveis → mediana 23,75
    expect(r4.ads.find((a) => a.metaAdId === 'mock_ad_4')?.verdict).toBe('LOW_DATA');
  });
  it('campanhas-v1 §6: 3 campanhas (CBO diário, ABO, CBO vitalício), 6 conjuntos, anúncios distribuídos, effective_status de pai pausado', async () => {
    const r = await svc().syncAds(auth, { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true });
    expect(r.truncated).toBe(false);
    const c = Object.fromEntries((r.campaigns ?? []).map((x) => [x.campaignId, x]));
    expect(c.mock_cmp_cbo).toMatchObject({ dailyBudgetMinor: 5000, lifetimeBudgetMinor: null, status: 'ACTIVE' });
    expect(c.mock_cmp_abo).toMatchObject({ dailyBudgetMinor: null, lifetimeBudgetMinor: null });
    expect(c.mock_cmp_life).toMatchObject({ dailyBudgetMinor: null, lifetimeBudgetMinor: 30000 });
    const a = Object.fromEntries((r.adsets ?? []).map((x) => [x.adsetId, x]));
    expect(Object.keys(a)).toHaveLength(6);
    expect(a.mock_adset_cbo_2.learningStage).toBe('LEARNING');
    expect(a.mock_adset_abo_paused).toMatchObject({ status: 'PAUSED', dailyBudgetMinor: 1500 });
    expect(a.mock_adset_abo_stale.name).toContain('[mock:stale]');
    const ad5 = r.ads.find((x) => x.metaAdId === 'mock_ad_5')!;
    expect(ad5).toMatchObject({ status: 'ACTIVE', effectiveStatus: 'ADSET_PAUSED', adset: { id: 'mock_adset_abo_paused' }, campaign: { id: 'mock_cmp_abo' } });
    // métricas de campanha = soma dos anúncios dela (no mock), com frequência
    const spend = r.ads.filter((x) => x.campaign.id === 'mock_cmp_cbo').reduce((t, x) => t + x.metrics.spend, 0);
    expect(c.mock_cmp_cbo.metrics.spend).toBeCloseTo(spend, 2);
    expect(c.mock_cmp_cbo.metrics.frequency).toBeGreaterThan(1);
  });
  it('campanhas-v1 §6 escritas: gatilhos do QA e o estado muda de verdade (leitura e próximo sync)', async () => {
    const s = svc();
    // conjunto pausado com anúncio ativo dentro: os pais vêm na leitura ao vivo (o backend responde META_PARENT_PAUSED)
    const ad5 = await s.readObject(auth, { level: 'ad', id: 'mock_ad_5' });
    expect(ad5.adset).toMatchObject({ id: 'mock_adset_abo_paused', status: 'PAUSED' });
    expect(ad5.campaign).toMatchObject({ id: 'mock_cmp_abo', status: 'ACTIVE' });
    // [mock:stale]: leitura ao vivo difere do snapshot
    const snap = (await s.syncAds(auth, { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true })).adsets!.find((x) => x.adsetId === 'mock_adset_abo_stale')!;
    const stale = await s.readObject(auth, { level: 'adset', id: 'mock_adset_abo_stale' });
    expect([stale.status, stale.dailyBudgetMinor]).not.toEqual([snap.status, snap.dailyBudgetMinor]);
    // DISAPPROVED não ativa
    await expect(s.setStatus(auth, { objectIds: ['mock_ad_7'], status: 'ACTIVE' })).rejects.toMatchObject({ code: 'META_POLICY' });
    // orçamento: conjunto de CBO e campanha vitalícia não editam; abaixo do mínimo; ok muda
    await expect(s.setDailyBudget(auth, { level: 'adset', id: 'mock_adset_cbo_1', dailyBudgetMinor: 3000 })).rejects.toMatchObject({ code: 'META_BUDGET_NOT_EDITABLE', options: { details: { budgetLevel: 'campaign', kind: 'daily' } } });
    await expect(s.setDailyBudget(auth, { level: 'campaign', id: 'mock_cmp_life', dailyBudgetMinor: 3000 })).rejects.toMatchObject({ code: 'META_BUDGET_NOT_EDITABLE', options: { details: { kind: 'lifetime' } } });
    await expect(s.setDailyBudget(auth, { level: 'adset', id: 'mock_adset_abo_1', dailyBudgetMinor: 400 })).rejects.toMatchObject({ code: 'META_BUDGET_TOO_LOW', options: { details: { minimumMinor: 500 } } });
    await s.setDailyBudget(auth, { level: 'adset', id: 'mock_adset_abo_1', dailyBudgetMinor: 3000 });
    expect((await s.readObject(auth, { level: 'adset', id: 'mock_adset_abo_1' })).dailyBudgetMinor).toBe(3000);
    // ativar o conjunto pausado muda o effective_status do anúncio no próximo sync
    await s.setStatus(auth, { objectIds: ['mock_adset_abo_paused'], status: 'ACTIVE' });
    const r = await s.syncAds(auth, { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true });
    expect(r.ads.find((x) => x.metaAdId === 'mock_ad_5')!.effectiveStatus).toBe('ACTIVE');
    expect(r.adsets!.find((x) => x.adsetId === 'mock_adset_abo_1')!.dailyBudgetMinor).toBe(3000);
    // pausar a campanha: filhos viram CAMPAIGN_PAUSED / ADSET_PAUSED
    await s.setStatus(auth, { objectIds: ['mock_cmp_cbo'], status: 'PAUSED' });
    const r2 = await s.syncAds(auth, { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE', hasPixel: true });
    expect(r2.adsets!.find((x) => x.adsetId === 'mock_adset_cbo_1')!.effectiveStatus).toBe('CAMPAIGN_PAUSED');
    expect(r2.ads.find((x) => x.metaAdId === 'mock_ad_1')!.effectiveStatus).toBe('CAMPAIGN_PAUSED');
    // [mock:meta-rate] / [mock:meta-token] no nome; objeto que não existe = GONE
    await expect(s.setStatus(auth, { objectIds: ['mock_ad_img_1'], status: 'PAUSED' })).rejects.toMatchObject({ code: 'META_UNAVAILABLE', options: { details: { reason: 'rate_limited' } } });
    await expect(s.readObject(auth, { level: 'ad', id: 'mock_ad_img_2' })).rejects.toMatchObject({ code: 'META_TOKEN_INVALID' });
    await expect(s.readObject(auth, { level: 'campaign', id: 'nope' })).rejects.toMatchObject({ code: 'META_OBJECT_GONE' });
    // ids da publicação mock continuam aceitos (activate/pause da tela Send)
    await expect(s.setStatus(auth, { objectIds: ['mock_ad_abc12345', 'mock_campaign_abc'], status: 'ACTIVE' })).resolves.toBeUndefined();
    expect(s.objectUrl('act_mock_1', 'campaign', 'mock_cmp_cbo')).toBe('#');
    expect(s.usage()).toBeNull();
  });
  it('QA 23/10 bug E: publicação mock entra no snapshot (selo = campaignId da publicação), activate liga os 3, nomes dos pais legíveis', async () => {
    const s = svc();
    const tok = { accessToken: (await s.exchangeCode({ code: 'mock' })).accessToken };
    const syncIn = { adAccountId: 'act_mock_1', currency: 'USD', businessType: 'ONLINE_STORE' as const, hasPixel: true };
    const before = await s.syncAds(tok, syncIn);
    const i = input();
    const v = await s.uploadVideo(tok, i);
    const c = await s.createCampaign(tok, i);
    const d = await s.createAdSet(tok, i, ids({ videoId: v.videoId, campaignId: c.campaignId }));
    const e = await s.createAdCreative(tok, i, ids({ videoId: v.videoId, campaignId: c.campaignId, adsetId: d.adsetId }));
    const f = await s.createAd(tok, i, ids({ videoId: v.videoId, campaignId: c.campaignId, adsetId: d.adsetId, creativeId: e.creativeId }));
    // recém-publicada: PAUSED nos 3 níveis, ids iguais aos devolvidos (é por eles que o backend põe o selo HookMill)
    const r1 = await s.syncAds(tok, syncIn);
    expect(r1.campaigns!.map((x) => x.campaignId)).toEqual([...before.campaigns!.map((x) => x.campaignId), c.campaignId]);
    expect(r1.campaigns!.find((x) => x.campaignId === c.campaignId)).toMatchObject({ name: 'HM — Hook A', status: 'PAUSED', effectiveStatus: 'PAUSED', objective: 'OUTCOME_SALES', dailyBudgetMinor: null, lifetimeBudgetMinor: null });
    expect(r1.adsets!.find((x) => x.adsetId === d.adsetId)).toMatchObject({ campaignId: c.campaignId, name: 'HM — Hook A', status: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED', dailyBudgetMinor: 2000 });
    expect(r1.ads.find((x) => x.metaAdId === f.adId)).toMatchObject({ status: 'PAUSED', effectiveStatus: 'PAUSED', videoId: v.videoId, verdict: 'LOW_DATA', campaign: { id: c.campaignId, name: 'HM — Hook A' }, adset: { id: d.adsetId, name: 'HM — Hook A' }, adCreatedTime: NOW.toISOString() });
    // vencedores de antes intactos (o anúncio novo, sem gasto, não entra na mediana)
    expect(r1.medianCpa).toBe(before.medianCpa);
    expect(r1.ads.filter((x) => x.verdict === 'WINNER' && x.videoId).map((x) => x.metaAdId)).toEqual(['mock_ad_1', 'mock_ad_2']);
    // activate da tela Send: ACTIVE em [ad, adset, campaign] → o próximo sync mostra tudo ativo
    await s.setStatus(tok, { objectIds: [f.adId, d.adsetId, c.campaignId], status: 'ACTIVE' });
    const r2 = await s.syncAds(tok, syncIn);
    expect(r2.campaigns!.find((x) => x.campaignId === c.campaignId)!.effectiveStatus).toBe('ACTIVE');
    expect(r2.adsets!.find((x) => x.adsetId === d.adsetId)!.effectiveStatus).toBe('ACTIVE');
    expect(r2.ads.find((x) => x.metaAdId === f.adId)!.effectiveStatus).toBe('ACTIVE');
    // a Campaigns opera a publicada: leitura ao vivo com os pais nomeados, pausa e orçamento ABO
    const live = await s.readObject(tok, { level: 'ad', id: f.adId });
    expect(live).toMatchObject({ status: 'ACTIVE', campaign: { id: c.campaignId, name: 'HM — Hook A', status: 'ACTIVE' }, adset: { id: d.adsetId, name: 'HM — Hook A', status: 'ACTIVE', dailyBudgetMinor: 2000 } });
    await s.setDailyBudget(tok, { level: 'adset', id: d.adsetId, dailyBudgetMinor: 3000 });
    await s.setStatus(tok, { objectIds: [c.campaignId], status: 'PAUSED' });
    const r3 = await s.syncAds(tok, syncIn);
    expect(r3.adsets!.find((x) => x.adsetId === d.adsetId)).toMatchObject({ dailyBudgetMinor: 3000, effectiveStatus: 'CAMPAIGN_PAUSED' });
    expect(s.objectUrl('act_mock_1', 'campaign', c.campaignId)).toBe('#');
    // republicar o mesmo anúncio (retry) não duplica nem reseta o estado
    await s.createCampaign(tok, i);
    expect((await s.syncAds(tok, syncIn)).campaigns!.filter((x) => x.campaignId === c.campaignId)).toHaveLength(1);
  });
  it('QA 23/10 bug B: escritas mock por conexão + conta (não vazam pra outro workspace nem pra outra conta)', async () => {
    const s = svc();
    const a = { accessToken: (await s.exchangeCode({ code: 'mock' })).accessToken };
    const b = { accessToken: (await s.exchangeCode({ code: 'mock' })).accessToken };
    const syncIn = (adAccountId: string) => ({ adAccountId, currency: 'USD', businessType: 'ONLINE_STORE' as const, hasPixel: true });
    await s.syncAds(a, syncIn('act_mock_1'));
    await s.syncAds(b, syncIn('act_mock_1'));
    // A pausa a campanha CBO, muda orçamento e publica; B (mesma conta mock, outra conexão) não vê nada disso
    await s.setStatus(a, { objectIds: ['mock_cmp_cbo'], status: 'PAUSED' });
    await s.setDailyBudget(a, { level: 'adset', id: 'mock_adset_abo_1', dailyBudgetMinor: 3000 });
    const pubA = await s.createCampaign(a, input());
    expect((await s.readObject(a, { level: 'campaign', id: 'mock_cmp_cbo' })).status).toBe('PAUSED');
    expect((await s.readObject(b, { level: 'campaign', id: 'mock_cmp_cbo' })).status).toBe('ACTIVE'); // antes: PAUSED → 409 META_OBJECT_CHANGED
    expect((await s.readObject(b, { level: 'adset', id: 'mock_adset_abo_1' })).dailyBudgetMinor).toBe(2000);
    await expect(s.readObject(b, { level: 'campaign', id: pubA.campaignId })).rejects.toMatchObject({ code: 'META_OBJECT_GONE' });
    const rb = await s.syncAds(b, syncIn('act_mock_1'));
    expect(rb.campaigns!.find((x) => x.campaignId === 'mock_cmp_cbo')!.status).toBe('ACTIVE');
    expect(rb.campaigns!.some((x) => x.campaignId === pubA.campaignId)).toBe(false);
    // B escreve no próprio escopo sem afetar A
    await s.setStatus(b, { objectIds: ['mock_cmp_cbo'], status: 'PAUSED' });
    await s.setStatus(b, { objectIds: ['mock_cmp_cbo'], status: 'ACTIVE' });
    expect((await s.readObject(a, { level: 'campaign', id: 'mock_cmp_cbo' })).status).toBe('PAUSED');
    // mesma conexão, outra conta: estado limpo; voltar pra conta 1 reencontra o que A fez lá
    const r2 = await s.syncAds(a, syncIn('act_mock_3'));
    expect(r2.campaigns!.find((x) => x.campaignId === 'mock_cmp_cbo')!.status).toBe('ACTIVE');
    expect((await s.readObject(a, { level: 'campaign', id: 'mock_cmp_cbo' })).status).toBe('ACTIVE');
    await s.readAdAccount(a, 'act_mock_1');
    expect((await s.readObject(a, { level: 'campaign', id: 'mock_cmp_cbo' })).status).toBe('PAUSED');
    const r1 = await s.syncAds(a, syncIn('act_mock_1'));
    expect(r1.campaigns!.some((x) => x.campaignId === pubA.campaignId)).toBe(true);
  });
  it('videoSource: URL do mock-media; mock_video_novideo = META_VIDEO_UNAVAILABLE (action upload_video)', async () => {
    const s = svc();
    const v = await s.videoSource(auth, 'mock_video_1');
    expect(v.sourceUrl).toMatch(/\/api\/v1\/mock-media\/video\/[0-9a-f]{16}\.mp4\?format=VERTICAL_9_16&sec=20$/);
    expect(v.lengthSec).toBe(20);
    await expect(s.videoSource(auth, 'mock_video_novideo')).rejects.toMatchObject({ code: 'META_VIDEO_UNAVAILABLE', action: 'upload_video' });
  });
  it('publicação feliz: 6 etapas, ids mock_ determinísticos, adsManagerUrl "#"', async () => {
    const s = svc();
    const i = input();
    const a = await s.uploadVideo(auth, i);
    expect(a.videoId).toMatch(/^mock_video_[0-9a-f]{8}$/);
    const polls: string[] = [];
    await s.waitVideoReady(auth, i, ids({ videoId: a.videoId }), { onPoll: (st) => polls.push(st) });
    expect(polls).toEqual(['processing', 'ready']);
    const c = await s.createCampaign(auth, i);
    const d = await s.createAdSet(auth, i, ids({ videoId: a.videoId, campaignId: c.campaignId }));
    const e = await s.createAdCreative(auth, i, ids({ videoId: a.videoId, campaignId: c.campaignId, adsetId: d.adsetId }));
    const f = await s.createAd(auth, i, ids({ videoId: a.videoId, campaignId: c.campaignId, adsetId: d.adsetId, creativeId: e.creativeId }));
    expect([c.campaignId, d.adsetId, e.creativeId, f.adId].every((x) => x.startsWith('mock_'))).toBe(true);
    expect(f.previewUrl).toBeNull();
    await s.setStatus(auth, { objectIds: [f.adId, d.adsetId, c.campaignId], status: 'ACTIVE' });
    await s.setStatus(auth, { objectIds: [f.adId], status: 'PAUSED' });
    expect(s.adsManagerUrl('act_mock_1', f.adId)).toBe('#');
    // idempotente: mesma entrada = mesmos ids (retry não duplica)
    expect((await s.createCampaign(auth, i)).campaignId).toBe(c.campaignId);
  });
  it('etapa sem o id anterior = META_ERROR (bug de chamada, não do usuário)', async () => {
    const s = svc();
    await expect(code(s.waitVideoReady(auth, input(), ids()))).resolves.toBe('META_ERROR@processing_video');
    await expect(code(s.createAdSet(auth, input(), ids()))).resolves.toBe('META_ERROR@creating_adset');
    await expect(code(s.createAdCreative(auth, input(), ids()))).resolves.toBe('META_ERROR@creating_creative');
    await expect(code(s.createAd(auth, input(), ids({ adsetId: 'x' })))).resolves.toBe('META_ERROR@creating_ad');
  });
  it('gatilhos: [mock:meta-policy] em creating_creative; payment/token/rate/error em creating_campaign; orçamento < 500; conta 2/3', async () => {
    const s = svc();
    await expect(s.createAdCreative(auth, input({ primaryText: 'x [mock:meta-policy]' }), ids({ videoId: 'v' }))).rejects.toMatchObject({ code: 'META_POLICY', action: 'edit_ad_text', stage: 'creating_creative' });
    await expect(code(s.createCampaign(auth, input({ primaryText: '[mock:meta-policy]' })))).resolves.toBe('OK');
    for (const [t, c, action] of [['meta-payment', 'META_PAYMENT_REQUIRED', 'fix_payment'], ['meta-token', 'META_TOKEN_INVALID', 'reconnect_meta'], ['meta-rate', 'META_RATE_LIMITED', 'retry'], ['meta-error', 'META_ERROR', 'retry']] as const) {
      await expect(s.createCampaign(auth, input({ primaryText: `hi [mock:${t}]` }))).rejects.toMatchObject({ code: c, action, stage: 'creating_campaign' });
    }
    const rate = await s.createCampaign(auth, input({ primaryText: '[mock:meta-rate]' })).catch((e: MetaError) => e);
    expect((rate as MetaError).retryAfterSec).toBe(60);
    await expect(s.createAdSet(auth, input({ dailyBudgetMinor: 499 }), ids({ campaignId: 'c' }))).rejects.toMatchObject({ code: 'META_BUDGET_TOO_LOW', action: 'raise_budget', details: { minimumMinor: 500, currency: 'USD' } });
    await expect(code(s.createAdSet(auth, input({ dailyBudgetMinor: 500 }), ids({ campaignId: 'c' })))).resolves.toBe('OK');
    await expect(s.uploadVideo(auth, input({}, 'act_mock_2'))).rejects.toMatchObject({ code: 'META_ACCOUNT_UNUSABLE', action: 'choose_account', details: { accountStatus: 2, label: 'disabled' } });
    await expect(s.createCampaign(auth, input({}, 'act_mock_3'))).rejects.toMatchObject({ code: 'META_PERMISSION', details: { adAccountId: 'act_mock_3', reason: 'no_advertise_task' } });
    await expect(code(s.uploadVideo(auth, { ...input(), video: { fileUrl: null, sizeBytes: null, read: null } }))).resolves.toBe('META_VIDEO_REJECTED@uploading_video');
  });
  it('[mock:meta-slow] no headline: processing_video faz 10 polls (30 s com stepMs=500); upload resumable aceito', async () => {
    const slept: number[] = [];
    const s = new FakeMetaService({ publicApiUrl: 'x', jwtSecret: 's', rule: DEFAULT_RULE, stepMs: 500, now: () => NOW, sleep: async (ms) => { slept.push(ms); } });
    const polls: string[] = [];
    await s.waitVideoReady(auth, input({ headline: 'H [mock:meta-slow]' }), ids({ videoId: 'v' }), { onPoll: (st) => polls.push(st) });
    expect(polls.filter((p) => p === 'processing')).toHaveLength(10);
    expect(slept.reduce((a, b) => a + b, 0)).toBe(30_000);
    const up = await s.uploadVideo(auth, { ...input(), video: { fileUrl: null, sizeBytes: 1000, read: async () => Buffer.alloc(10) } });
    expect(up.videoId).toMatch(/^mock_video_/);
  });
  it('buildMetaService: mock por padrão; off = META_NOT_CONFIGURED reason off; live sem chave = reason not_configured com a lista; live completo = LiveMetaService', async () => {
    expect(metaMode(undefined)).toBe('mock');
    expect(metaMode('LIVE')).toBe('live');
    const base = { publicApiUrl: 'http://localhost:3001' };
    expect(buildMetaService({ META_MODE: 'mock', JWT_ACCESS_SECRET: 's' } as NodeJS.ProcessEnv, base)).toBeInstanceOf(FakeMetaService);
    const off = buildMetaService({ META_MODE: 'off' } as NodeJS.ProcessEnv, base);
    expect(off.status()).toMatchObject({ mode: 'off', configured: false });
    await expect(off.listOptions(auth, {})).rejects.toMatchObject({ code: 'META_NOT_CONFIGURED', details: { reason: 'off' } });
    expect(() => off.buildAuthUrl({ workspaceId: 'w', userId: 'u', returnTo: '/settings' })).toThrow(expect.objectContaining({ code: 'META_NOT_CONFIGURED' }));
    const nc = buildMetaService({ META_MODE: 'live', META_APP_ID: '123', JWT_ACCESS_SECRET: 's' } as NodeJS.ProcessEnv, base);
    expect(nc.status()).toMatchObject({ mode: 'live', configured: false, appIdMasked: null });
    const e = await nc.syncAds(auth, { adAccountId: 'a', currency: 'USD', businessType: null, hasPixel: false }).catch((x: MetaError) => x);
    expect(e).toMatchObject({ code: 'META_NOT_CONFIGURED', details: { reason: 'not_configured' } });
    expect((e as MetaError).message).toContain('META_APP_SECRET, META_CONFIG_ID, META_TOKEN_KEY');
    await expect(nc.revoke(auth)).resolves.toBeUndefined();
    const live: MetaService = buildMetaService({ META_MODE: 'live', META_APP_ID: '1234567890', META_APP_SECRET: 'sec', META_CONFIG_ID: 'cfg', META_TOKEN_KEY: 'k', JWT_ACCESS_SECRET: 's', META_GRAPH_VERSION: 'v26.0' } as NodeJS.ProcessEnv, base);
    expect(live.status()).toEqual({ mode: 'live', configured: true, appIdMasked: '******7890', graphVersion: 'v26.0' });
    const u = new URL(live.buildAuthUrl({ workspaceId: 'w', userId: 'u', returnTo: '/meta/done' }).url);
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/v26.0/dialog/oauth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: '1234567890', config_id: 'cfg', redirect_uri: 'http://localhost:3001/api/v1/meta/callback', response_type: 'code', override_default_response_type: 'true' });
    expect(u.searchParams.get('state')!.split('.')).toHaveLength(3);
  });
});
