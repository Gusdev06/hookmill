// meta-v1.md §3.1: conectar (OAuth pela porta), callback com os 5 códigos de redirect, conexão (nunca o token),
// opções (canManage), seleção (META_PERMISSION), health (níveis) e desconectar. Token cifrado (AES-256-GCM) na linha.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MetaConnectResponse, MetaConnection as MetaConnectionView, MetaHealth, MetaOAuthErrorCode, MetaOAuthStatus, MetaOptions } from '@maquina/contratos';
import { Prisma, type MetaConnection } from '@prisma/client';
import type { AuthContext } from '../common/auth/auth-context';
import { AppException } from '../common/errors/app-exception';
import { initials } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import { META_SERVICE, type MetaAdAccountInfo, type MetaService, cifrar, isMetaError } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';
import { OnboardingService } from '../workspaces/onboarding';
import { assertSelected, assertUsable, isForeignToMode, metaAuthOf, tokenKeyOf, viaPorta } from './comum';
import type { MetaConnectDto, MetaSelectionDto } from './meta.dto';

export const CONNECTION_INCLUDE = { connectedBy: { select: { id: true, name: true } } } satisfies Prisma.MetaConnectionInclude;
export type ConnectionRow = Prisma.MetaConnectionGetPayload<{ include: typeof CONNECTION_INCLUDE }>;

/** O que o backend cacheia junto do MetaHealth (defaults de publicação sem ir à Meta): fica no JSON, sai da resposta. */
export interface StoredHealth extends MetaHealth { _account?: { minimumDailyBudgetMinor: number | null; hasFunding: boolean } }

export function storedHealthOf(json: Prisma.JsonValue | null | undefined): StoredHealth | null {
  if (!json || typeof json !== 'object' || Array.isArray(json) || !('checks' in json)) return null;
  return json as unknown as StoredHealth;
}
export function presentHealth(h: StoredHealth | null): MetaHealth | null {
  if (!h) return null;
  const { _account: _a, ...rest } = h;
  return rest;
}

/** GET /meta/oauth/status (§3.1, 22/10): memória do processo, TTL 15 min; vira tabela `meta_oauth_attempts` se a API ganhar 2+ instâncias. */
export const OAUTH_STATUS_TTL_MS = 15 * 60_000;
type OAuthEntry = MetaOAuthStatus & { touchedAt: number };
const OAUTH_EMPTY: MetaOAuthStatus = { pending: false, expiresAt: null, lastError: null, connectedAt: null };

@Injectable()
export class MetaConexaoService {
  private readonly log = new Logger('Meta');
  private readonly oauth = new Map<string, OAuthEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly onboarding: OnboardingService,
    @Inject(META_SERVICE) private readonly meta: MetaService,
  ) {}

  // ───────── leitura ─────────

  async row(workspaceId: string): Promise<ConnectionRow | null> {
    return this.prisma.metaConnection.findUnique({ where: { workspaceId }, include: CONNECTION_INCLUDE });
  }

  /** Conexão utilizável do workspace (422 META_NOT_CONNECTED / META_TOKEN_INVALID). */
  async usable(workspaceId: string): Promise<MetaConnection> {
    return assertUsable(await this.prisma.metaConnection.findUnique({ where: { workspaceId } }));
  }

  /** Conexão utilizável com conta e página (422 META_SELECTION_MISSING). */
  async selected(workspaceId: string) {
    return assertSelected(await this.usable(workspaceId));
  }

  async present(c: ConnectionRow): Promise<MetaConnectionView> {
    const syncing = (await this.prisma.job.count({ where: { workspaceId: c.workspaceId, type: 'META_SYNC', status: { in: ['QUEUED', 'RUNNING'] } } })) > 0;
    return {
      status: c.status,
      user: { id: c.metaUserId, name: c.metaUserName },
      scopes: c.scopes,
      tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null,
      adAccount: c.adAccountId
        ? { id: c.adAccountId, name: c.adAccountName ?? c.adAccountId, currency: c.currency ?? 'USD', timezoneName: c.timezoneName ?? 'UTC', accountStatus: c.accountStatus ?? 0 }
        : null,
      page: c.pageId ? { id: c.pageId, name: c.pageName ?? c.pageId } : null,
      pixel: c.pixelId ? { id: c.pixelId, name: c.pixelName ?? c.pixelId } : null,
      health: presentHealth(storedHealthOf(c.lastHealth)),
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      syncing,
      connectedBy: { id: c.connectedBy.id, name: c.connectedBy.name, initials: initials(c.connectedBy.name) },
      connectedAt: c.connectedAt.toISOString(),
    };
  }

  // ───────── status do OAuth ("Connect from another browser") ─────────

  private oauthEntry(workspaceId: string, now = Date.now()): OAuthEntry | null {
    const e = this.oauth.get(workspaceId);
    if (!e) return null;
    if (now - e.touchedAt > OAUTH_STATUS_TTL_MS) {
      this.oauth.delete(workspaceId);
      return null;
    }
    return e;
  }

  private oauthPatch(workspaceId: string, patch: Partial<MetaOAuthStatus>, now = Date.now()): void {
    const cur = this.oauthEntry(workspaceId, now) ?? { ...OAUTH_EMPTY, touchedAt: now };
    this.oauth.set(workspaceId, { ...cur, ...patch, touchedAt: now });
  }

  /** GET /meta/oauth/status: `pending` só dentro do `expiresAt` do último connect sem callback. */
  oauthStatus(workspaceId: string, now = Date.now()): MetaOAuthStatus {
    const e = this.oauthEntry(workspaceId, now);
    if (!e) return { ...OAUTH_EMPTY };
    const pending = e.pending && !!e.expiresAt && Date.parse(e.expiresAt) > now;
    return { pending, expiresAt: e.expiresAt, lastError: e.lastError, connectedAt: e.connectedAt };
  }

  /** GET /meta/connection: null quando nunca conectou. */
  async get(auth: AuthContext): Promise<MetaConnectionView | null> {
    const c = await this.row(auth.workspaceId);
    return c ? this.present(c) : null;
  }

  // ───────── OAuth ─────────

  /** POST /meta/connect: URL do diálogo (state = JWT de 10 min; nada no banco). */
  connect(auth: AuthContext, dto: MetaConnectDto): MetaConnectResponse {
    if (this.config.metaMode === 'off') throw new AppException('META_NOT_CONFIGURED', { reason: 'off' });
    try {
      const r = this.meta.buildAuthUrl({ workspaceId: auth.workspaceId, userId: auth.userId, returnTo: dto.returnTo ?? '/onboarding/meta' });
      this.oauthPatch(auth.workspaceId, { pending: true, expiresAt: r.expiresAt, lastError: null });
      return { url: r.url, expiresAt: r.expiresAt };
    } catch (e) {
      if (isMetaError(e) && e.code === 'META_NOT_CONFIGURED') throw new AppException('META_NOT_CONFIGURED', { reason: (e.details?.reason as string) ?? 'not_configured' });
      throw e;
    }
  }

  /**
   * GET /meta/callback (pública): devolve a URL do redirect (302 é do controller). Nunca JSON. Falha = `?meta=error&code=`.
   * Por dentro: state → code → token long-lived cifrado → upsert (seleção mantida se for o mesmo usuário da Meta).
   */
  async callback(q: Record<string, string | undefined>): Promise<string> {
    const web = this.config.webOrigins[0].replace(/\/$/, '');
    let state: { workspaceId: string; userId: string; returnTo: string } | null = null;
    const fail = (returnTo: string, code: MetaOAuthErrorCode, extra: Record<string, string> = {}) => {
      // mesmo code/missing do redirect vão pro GET /meta/oauth/status (a aba de origem, em outro navegador, lê de lá)
      if (state) this.oauthPatch(state.workspaceId, { pending: false, lastError: { code, missing: extra.missing ? extra.missing.split(',') : [], at: new Date().toISOString() } });
      const qs = new URLSearchParams({ meta: 'error', code, ...extra });
      return `${web}${returnTo}?${qs.toString()}`;
    };
    try {
      state = this.meta.verifyState(q.state);
    } catch (e) {
      // sem state válido não há returnTo: volta pro passo 2 do onboarding
      return fail('/onboarding/meta', isMetaError(e) && e.code === 'META_NOT_CONFIGURED' ? 'META_UNAVAILABLE' : 'META_STATE_INVALID');
    }
    try {
      const grant = await this.meta.exchangeCode({ code: q.code, error: q.error, errorReason: q.error_reason, errorDescription: q.error_description });
      const key = tokenKeyOf(this.config);
      const ciphertext = cifrar(grant.accessToken, key);
      const prev = await this.prisma.metaConnection.findUnique({ where: { workspaceId: state.workspaceId } });
      const sameUser = !!prev && prev.metaUserId === grant.user.id;
      const data = {
        status: 'ACTIVE' as const, tokenType: grant.tokenType, tokenCiphertext: ciphertext,
        tokenExpiresAt: grant.expiresAt ? new Date(grant.expiresAt) : null, scopes: grant.scopes,
        metaUserId: grant.user.id, metaUserName: grant.user.name,
        connectedById: state.userId, connectedAt: new Date(), disconnectedAt: null,
      };
      await this.prisma.$transaction(async (tx) => {
        if (!prev) {
          await tx.metaConnection.create({ data: { workspaceId: state.workspaceId, ...data } });
          return;
        }
        if (!sameUser) {
          // outro usuário da Meta: a seleção e os anúncios lidos eram dele
          await tx.metaAdSnapshot.deleteMany({ where: { connectionId: prev.id } });
          await tx.metaCampaignSnapshot.deleteMany({ where: { connectionId: prev.id } });
          await tx.metaAdsetSnapshot.deleteMany({ where: { connectionId: prev.id } });
          await tx.metaConnection.update({
            where: { id: prev.id },
            data: { ...data, adAccountId: null, adAccountName: null, currency: null, timezoneName: null, accountStatus: null, businessId: null, pageId: null, pageName: null, pixelId: null, pixelName: null, lastHealth: Prisma.JsonNull, lastHealthAt: null, lastSyncAt: null, lastSyncJobId: null, lastSyncError: null },
          });
          return;
        }
        await tx.metaConnection.update({ where: { id: prev.id }, data });
      });
      this.oauthPatch(state.workspaceId, { pending: false, lastError: null, connectedAt: data.connectedAt.toISOString() });
      return `${web}${state.returnTo}?meta=connected`;
    } catch (e) {
      if (isMetaError(e)) {
        const code = e.code;
        if (code === 'META_OAUTH_DENIED' || code === 'META_OAUTH_FAILED' || code === 'META_STATE_INVALID' || code === 'META_UNAVAILABLE') return fail(state.returnTo, code);
        if (code === 'META_SCOPES_MISSING') return fail(state.returnTo, code, { missing: ((e.details?.missing as string[]) ?? []).join(',') });
        if (code === 'META_NOT_CONFIGURED') return fail(state.returnTo, 'META_UNAVAILABLE');
        this.log.warn(`callback ${state.workspaceId}: ${code} ${e.message}`);
        return fail(state.returnTo, 'META_OAUTH_FAILED');
      }
      this.log.error(`callback ${state.workspaceId}: ${(e as Error).stack ?? e}`); // motivo técnico só no log, nunca na URL
      return fail(state.returnTo, 'META_OAUTH_FAILED');
    }
  }

  // ───────── opções e seleção ─────────

  /** GET /meta/options: lido ao vivo (contas com canManage/permissionReason; pixels só da conta pedida ou escolhida). */
  async options(auth: AuthContext, adAccountId?: string): Promise<MetaOptions> {
    const c = await this.usable(auth.workspaceId);
    return viaPorta(this.prisma, c, () => this.meta.listOptions(metaAuthOf(c, this.config), { adAccountId: adAccountId ?? c.adAccountId ?? null }));
  }

  /**
   * PUT /meta/selection: conta/página/pixel têm que estar nas opções do usuário (404); conta sem canManage = 422
   * META_PERMISSION; conta diferente apaga os snapshots; roda o health na hora; dispara o 1º sync (quem chama) e marca o setup.
   */
  async select(auth: AuthContext, dto: MetaSelectionDto): Promise<{ connection: ConnectionRow; firstSync: boolean }> {
    const c = await this.usable(auth.workspaceId);
    const auth0 = metaAuthOf(c, this.config);
    const opts = await viaPorta(this.prisma, c, () => this.meta.listOptions(auth0, { adAccountId: dto.adAccountId }));
    const account = opts.adAccounts.find((a) => a.id === dto.adAccountId);
    const page = opts.pages.find((p) => p.id === dto.pageId);
    if (!account || !page) throw new AppException('NOT_FOUND');
    const pixel = dto.pixelId ? opts.pixels.find((p) => p.id === dto.pixelId && (p.adAccountId === null || p.adAccountId === dto.adAccountId)) : null;
    if (dto.pixelId && !pixel) throw new AppException('NOT_FOUND');
    if (!account.canManage) throw new AppException('META_PERMISSION', { adAccountId: account.id, reason: account.permissionReason ?? 'no_advertise_task' });
    const info = await viaPorta(this.prisma, c, () => this.meta.readAdAccount(auth0, dto.adAccountId));
    const changedAccount = c.adAccountId !== dto.adAccountId;
    await this.prisma.$transaction(async (tx) => {
      if (changedAccount) {
        // trocar de conta apaga os 3 snapshots; MetaChange fica (campanhas-v1 §2)
        await tx.metaAdSnapshot.deleteMany({ where: { connectionId: c.id } });
        await tx.metaCampaignSnapshot.deleteMany({ where: { connectionId: c.id } });
        await tx.metaAdsetSnapshot.deleteMany({ where: { connectionId: c.id } });
      }
      await tx.metaConnection.update({
        where: { id: c.id },
        data: {
          adAccountId: info.id, adAccountName: info.name, currency: info.currency, timezoneName: info.timezoneName, accountStatus: info.accountStatus,
          businessId: info.business?.id ?? null, pageId: page.id, pageName: page.name, pixelId: pixel?.id ?? null, pixelName: pixel?.name ?? null,
          ...(changedAccount && { lastSyncAt: null, lastSyncJobId: null, lastSyncError: null }),
        },
      });
    });
    await this.onboarding.touchIfSetup(auth.workspaceId, auth.userId); // onboarding-v2 §1
    const health = await this.runHealth(c.id);
    const firstSync = health.canPublish || c.scopes.includes('ads_read');
    return { connection: (await this.row(auth.workspaceId))!, firstSync };
  }

  // ───────── health ─────────

  /** POST /meta/health: os 8 checks (porta) + contagens dos snapshots; grava lastHealth. Token inválido marca a conexão. */
  async health(auth: AuthContext): Promise<MetaHealth> {
    const c = await this.usable(auth.workspaceId);
    return presentHealth(await this.runHealth(c.id))!;
  }

  /** Roda o health numa conexão (seleção, cron diário, antes de publicar). Lança o erro HTTP do §3.4. */
  async runHealth(connectionId: string): Promise<StoredHealth> {
    const c = await this.prisma.metaConnection.findUniqueOrThrow({ where: { id: connectionId } });
    assertUsable(c);
    // incidente 22/10: fora de live a porta é fake; health de conexão real marcaria TOKEN_INVALID/lastHealth falsos
    if (isForeignToMode(c, this.config.metaMode)) throw new AppException('META_NOT_CONFIGURED', { reason: 'not_configured' }, 'This server runs Meta in mock mode and cannot check a real Meta connection.');
    const [adsCount, activeCount] = await Promise.all([
      // campanhas-v1 D2: o sync guarda imagem também; o cartão de saúde segue contando só vídeo (igual à Home)
      this.prisma.metaAdSnapshot.count({ where: { connectionId: c.id, videoId: { not: null } } }),
      this.prisma.metaAdSnapshot.count({ where: { connectionId: c.id, videoId: { not: null }, effectiveStatus: 'ACTIVE' } }),
    ]);
    const r = await viaPorta(this.prisma, c, () => this.meta.health(metaAuthOf(c, this.config), {
      adAccountId: c.adAccountId, pageId: c.pageId, pixelId: c.pixelId, businessId: c.businessId,
      tokenExpiresAt: c.tokenExpiresAt?.toISOString() ?? null, scopes: c.scopes, counts: { adsCount, activeCount },
    }));
    const stored: StoredHealth = { ...r.health, _account: r.account ? { minimumDailyBudgetMinor: r.account.minimumDailyBudgetMinor, hasFunding: r.account.hasFunding } : undefined };
    await this.prisma.metaConnection.update({
      where: { id: c.id },
      data: {
        lastHealth: stored as unknown as Prisma.InputJsonValue, lastHealthAt: new Date(),
        ...(r.token.isValid ? { tokenExpiresAt: r.token.expiresAt ? new Date(r.token.expiresAt) : null, scopes: r.token.scopes } : { status: 'TOKEN_INVALID' }),
        ...(r.account && this.accountPatch(r.account)),
      },
    });
    return stored;
  }

  private accountPatch(a: MetaAdAccountInfo) {
    return { adAccountName: a.name, currency: a.currency, timezoneName: a.timezoneName, accountStatus: a.accountStatus, businessId: a.business?.id ?? null };
  }

  // ───────── desconectar ─────────

  /** DELETE /meta/connection: revoga (melhor esforço), apaga o token e os snapshots; publicações ficam (histórico). */
  async disconnect(auth: AuthContext): Promise<{ ok: true }> {
    const c = await this.prisma.metaConnection.findUnique({ where: { workspaceId: auth.workspaceId } });
    if (!c || c.status === 'DISCONNECTED') throw new AppException('NOT_FOUND');
    if (c.tokenCiphertext) {
      try {
        await this.meta.revoke(metaAuthOf(c, this.config));
      } catch (e) {
        this.log.warn(`revoke ${c.id}: ${(e as Error).message}`);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.metaAdSnapshot.deleteMany({ where: { connectionId: c.id } });
      await tx.metaCampaignSnapshot.deleteMany({ where: { connectionId: c.id } });
      await tx.metaAdsetSnapshot.deleteMany({ where: { connectionId: c.id } });
      await tx.metaConnection.update({ where: { id: c.id }, data: { status: 'DISCONNECTED', tokenCiphertext: null, disconnectedAt: new Date() } });
    });
    return { ok: true };
  }
}
