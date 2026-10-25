// MetaService live (META_MODE=live): compõe cliente.ts + oauth.ts + leitura.ts + publicacao.ts + vencedor.ts.
// Sem chamada real validada ainda (o app do Gusta está em dev; sonda = sondas/sonda-meta.ts, só com ok).
import type {
  MetaAdAccountInfo, MetaAuth, MetaHealthInput, MetaHealthResult, MetaOAuthState, MetaPublishIds, MetaPublishInput, MetaReturnTo, MetaService,
  MetaServiceStatus, MetaSyncInput, MetaSyncResult, MetaSyncStage, MetaTokenGrant, MetaTokenInfo, MetaWinnerRule,
  MetaLiveObject, MetaObjectLevelPort, MetaUsage,
} from '../contrato';
import * as campanhas from './campanhas';
import { GraphClient } from './cliente';
import { MetaError, isMetaError } from './erros';
import { signState, verifyState } from './estado';
import * as leitura from './leitura';
import { type OAuthConfig, debugToken, dialogUrl, exchangeCode } from './oauth';
import * as pub from './publicacao';
import { buildHealth } from './saude';
import { scoreAllAds } from './vencedor';

export interface LiveMetaOptions {
  appId: string; appSecret: string; configId: string;
  /** PUBLIC_API_URL/api/v1/meta/callback */
  redirectUri: string;
  jwtSecret: string;
  graphVersion?: string;
  rule: MetaWinnerRule;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export function maskAppId(id: string): string {
  return id.length <= 4 ? '****' : `${'*'.repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

export class LiveMetaService implements MetaService {
  readonly graph: GraphClient;
  private readonly cfg: OAuthConfig;
  private readonly now: () => Date;
  constructor(private readonly opts: LiveMetaOptions) {
    this.graph = new GraphClient({ appId: opts.appId, appSecret: opts.appSecret, version: opts.graphVersion, fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl, sleep: opts.sleep });
    this.cfg = { appId: opts.appId, appSecret: opts.appSecret, configId: opts.configId, redirectUri: opts.redirectUri };
    this.now = opts.now ?? (() => new Date());
  }

  status(): MetaServiceStatus {
    return { mode: 'live', configured: true, appIdMasked: maskAppId(this.opts.appId), graphVersion: this.graph.version };
  }
  buildAuthUrl(i: { workspaceId: string; userId: string; returnTo: MetaReturnTo }) {
    const { state, expiresAt } = signState(i, this.opts.jwtSecret, this.now().getTime());
    return { url: dialogUrl(this.cfg, this.graph.version, state), state, expiresAt };
  }
  verifyState(state: string | undefined | null, expect?: { workspaceId?: string; userId?: string }): MetaOAuthState {
    return verifyState(state, this.opts.jwtSecret, expect, this.now().getTime());
  }
  exchangeCode(q: Parameters<MetaService['exchangeCode']>[0]): Promise<MetaTokenGrant> {
    return exchangeCode(this.graph, this.cfg, q);
  }
  async inspectToken(auth: MetaAuth): Promise<MetaTokenInfo> {
    const { userId: _u, ...info } = await debugToken(this.graph, this.cfg, auth.accessToken);
    return info;
  }
  async revoke(auth: MetaAuth): Promise<void> {
    try {
      await this.graph.delete('me/permissions', auth.accessToken);
    } catch {
      /* melhor esforço */
    }
  }

  listOptions(auth: MetaAuth, q: { adAccountId?: string | null }) {
    return leitura.listOptions(this.graph, auth.accessToken, q);
  }
  readAdAccount(auth: MetaAuth, adAccountId: string): Promise<MetaAdAccountInfo> {
    return leitura.readAdAccount(this.graph, auth.accessToken, adAccountId);
  }
  async health(auth: MetaAuth, i: MetaHealthInput): Promise<MetaHealthResult> {
    const token = await this.inspectToken(auth);
    if (!token.isValid) throw new MetaError('META_TOKEN_INVALID', null, { failDetail: 'debug_token is_valid=false' });
    const t = auth.accessToken;
    let account: MetaAdAccountInfo | null = null;
    let readFailed = false;
    if (i.adAccountId) {
      try {
        account = await leitura.readAdAccount(this.graph, t, i.adAccountId);
      } catch (e) {
        if (isMetaError(e) && (e.code === 'META_TOKEN_INVALID' || e.code === 'META_UNAVAILABLE' || e.code === 'META_RATE_LIMITED')) throw e;
        readFailed = true;
      }
    }
    const businessId = account?.business?.id ?? i.businessId;
    const [reachable, pixel, verification] = await Promise.all([
      i.pageId ? leitura.pageReachable(this.graph, t, i.pageId) : Promise.resolve(null),
      i.pixelId ? leitura.pixelLastFired(this.graph, t, i.pixelId) : Promise.resolve({ lastFiredAt: null, readFailed: false }),
      businessId ? leitura.businessVerification(this.graph, t, businessId) : Promise.resolve(null),
    ]);
    const health = buildHealth({
      token: { isValid: true, expiresAt: token.expiresAt ?? i.tokenExpiresAt, scopes: token.scopes.length ? token.scopes : i.scopes },
      account: { selected: !!i.adAccountId, accountStatus: account?.accountStatus ?? null, hasFunding: account ? account.hasFunding : null, minimumDailyBudgetMinor: account?.minimumDailyBudgetMinor ?? null, readFailed },
      page: { selected: !!i.pageId, reachable },
      pixel: { selected: !!i.pixelId, lastFiredAt: pixel.lastFiredAt, readFailed: pixel.readFailed },
      business: { present: !!businessId, verificationStatus: verification },
      counts: i.counts, now: this.now(),
    });
    return { health, account, token };
  }

  rule(): MetaWinnerRule {
    return this.opts.rule;
  }
  async syncAds(auth: MetaAuth, i: MetaSyncInput, onProgress?: (p: { stage: MetaSyncStage; done: number; total: number }) => void): Promise<MetaSyncResult> {
    const r = await leitura.syncAds(this.graph, auth.accessToken, { ...i, now: i.now ?? this.now() }, onProgress);
    // D2: todos os formatos, régua (mediana) só dos vídeos
    const { ads, medianCpa } = scoreAllAds(r.ads, this.opts.rule, i.currency);
    onProgress?.({ stage: 'scoring', done: ads.length, total: ads.length });
    return {
      ads, medianCpa, rule: { minSpendUsd: this.opts.rule.minSpendUsd, minResults: this.opts.rule.minResults }, listed: r.listed, syncedAt: (i.now ?? this.now()).toISOString(),
      campaigns: r.campaigns, adsets: r.adsets, truncated: r.truncated,
    };
  }
  videoSource(auth: MetaAuth, videoId: string, ctx?: { adAccountId?: string | null; pageId?: string | null }) {
    return leitura.videoSource(this.graph, auth.accessToken, videoId, ctx);
  }

  uploadVideo(auth: MetaAuth, i: MetaPublishInput) {
    return pub.uploadVideo(this.graph, auth.accessToken, i);
  }
  waitVideoReady(auth: MetaAuth, _i: MetaPublishInput, ids: MetaPublishIds, opts?: { timeoutMs?: number; onPoll?: (status: string) => void }) {
    return pub.waitVideoReady(this.graph, auth.accessToken, ids, { ...opts, sleep: this.opts.sleep, now: this.opts.now ? () => this.now().getTime() : undefined });
  }
  createCampaign(auth: MetaAuth, i: MetaPublishInput) {
    return pub.createCampaign(this.graph, auth.accessToken, i);
  }
  async createAdSet(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds) {
    let account: { currency: string | null; minimumDailyBudgetMinor: number | null } = { currency: null, minimumDailyBudgetMinor: null };
    try {
      return await pub.createAdSet(this.graph, auth.accessToken, i, ids, account);
    } catch (e) {
      if (isMetaError(e) && e.code === 'META_BUDGET_TOO_LOW' && e.details?.minimumMinor == null) {
        account = await leitura.readAdAccount(this.graph, auth.accessToken, i.adAccountId).catch(() => account);
        throw new MetaError('META_BUDGET_TOO_LOW', e.message, { ...e.options, details: { minimumMinor: account.minimumDailyBudgetMinor, currency: account.currency } });
      }
      throw e;
    }
  }
  createAdCreative(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds) {
    return pub.createAdCreative(this.graph, auth.accessToken, i, ids);
  }
  createAd(auth: MetaAuth, i: MetaPublishInput, ids: MetaPublishIds) {
    return pub.createAd(this.graph, auth.accessToken, i, ids);
  }
  setStatus(auth: MetaAuth, i: { objectIds: string[]; status: 'ACTIVE' | 'PAUSED' }) {
    return pub.setStatus(this.graph, auth.accessToken, i);
  }
  adsManagerUrl(adAccountId: string, adId: string): string {
    return pub.adsManagerUrl(adAccountId, adId);
  }

  // ---------- campanhas-v1 §4 ----------
  readObject(auth: MetaAuth, i: { level: MetaObjectLevelPort; id: string }): Promise<MetaLiveObject> {
    return campanhas.readObject(this.graph, auth.accessToken, i);
  }
  setDailyBudget(auth: MetaAuth, i: { level: 'campaign' | 'adset'; id: string; dailyBudgetMinor: number }): Promise<void> {
    return campanhas.setDailyBudget(this.graph, auth.accessToken, i);
  }
  objectUrl(adAccountId: string, level: MetaObjectLevelPort, id: string): string {
    return campanhas.objectUrl(adAccountId, level, id);
  }
  usage(): MetaUsage | null {
    const u = this.graph.lastUsage;
    return u ? { pct: u.pct, regainSec: u.regainSec ?? null, at: (this.graph.lastUsageAt ?? this.now()).toISOString() } : null;
  }
}
