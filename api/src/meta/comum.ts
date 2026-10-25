// Peças compartilhadas do módulo meta (meta-v1.md): conexão ativa, token (cifra), MetaError → erro HTTP do contrato,
// snapshot → MetaMetrics. Nada aqui fala com a Meta: isso é da porta MetaService (integracoes, maquina-ia).
import type { MetaAction, MetaAsyncErrorCode, MetaMetrics } from '@maquina/contratos';
import type { MetaConnection, Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app-exception';
import { sha256 } from '../common/util/crypto';
import { AppConfig } from '../config/app-config';
import { META_ERROR_ACTION, type MetaAuth, type MetaError, decifrar, isMetaError, metaMode } from '../integracoes';
import { PrismaService } from '../prisma/prisma.service';

export const ZERO_METRICS: MetaMetrics = {
  spend: 0, impressions: 0, clicks: 0, ctr: 0, results: 0, resultType: null, cpa: null, roas: null, plays2s: null, hookRate: null, thruplays: null, frequency: null,
};

export function metricsOf(json: Prisma.JsonValue | null | undefined): MetaMetrics {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ...ZERO_METRICS };
  return { ...ZERO_METRICS, ...(json as unknown as Partial<MetaMetrics>) };
}

/** Chave do cofre do token: META_TOKEN_KEY; em mock sem chave, derivada do segredo do JWT (nunca em live). */
export function tokenKeyOf(config: AppConfig): string {
  const key = config.metaTokenKey;
  if (key) return key;
  if (config.metaMode === 'mock') return sha256(`meta-mock:${config.jwtAccessSecret}`);
  throw new AppException('META_NOT_CONFIGURED', { reason: 'not_configured' });
}

/** Conexão do workspace com token utilizável: 422 META_NOT_CONNECTED sem linha/DISCONNECTED; 422 META_TOKEN_INVALID se o token caiu. */
export function assertUsable(conn: MetaConnection | null): MetaConnection {
  if (!conn || conn.status === 'DISCONNECTED' || !conn.tokenCiphertext) throw new AppException('META_NOT_CONNECTED');
  if (conn.status === 'TOKEN_INVALID') throw new AppException('META_TOKEN_INVALID');
  return conn;
}

/** Conexão com conta e página escolhidas (422 META_SELECTION_MISSING { missing }). */
export function assertSelected(conn: MetaConnection): MetaConnection & { adAccountId: string; pageId: string } {
  const missing: ('adAccount' | 'page')[] = [];
  if (!conn.adAccountId) missing.push('adAccount');
  if (!conn.pageId) missing.push('page');
  if (missing.length) throw new AppException('META_SELECTION_MISSING', { missing });
  return conn as MetaConnection & { adAccountId: string; pageId: string };
}

export function metaAuthOf(conn: MetaConnection, config: AppConfig): MetaAuth {
  if (!conn.tokenCiphertext) throw new AppException('META_NOT_CONNECTED');
  // gargalo de TODA chamada à porta: fora de live, conexão real nunca é lida nem escrita na Meta (incidente 22/10)
  if (isForeignToMode(conn, config.metaMode)) {
    throw new AppException('META_NOT_CONFIGURED', { reason: 'not_configured' }, 'This server runs Meta in mock mode and cannot use a real Meta connection.');
  }
  return { accessToken: decifrar(conn.tokenCiphertext, tokenKeyOf(config)) };
}

/** Códigos assíncronos do contrato (job/publicação); o resto vira META_ERROR. */
const ASYNC: readonly MetaAsyncErrorCode[] = [
  'META_TOKEN_INVALID', 'META_PERMISSION', 'META_ACCOUNT_UNUSABLE', 'META_PAYMENT_REQUIRED', 'META_POLICY',
  'META_BUDGET_TOO_LOW', 'META_VIDEO_REJECTED', 'META_VIDEO_UNAVAILABLE', 'META_RATE_LIMITED', 'META_ERROR',
];
export function asMetaAsyncCode(code: string | null | undefined): MetaAsyncErrorCode {
  return code && (ASYNC as readonly string[]).includes(code) ? (code as MetaAsyncErrorCode) : 'META_ERROR';
}
export function metaActionOf(code: string | null | undefined): MetaAction | null {
  return code ? (META_ERROR_ACTION as Record<string, MetaAction>)[code] ?? null : null;
}

/**
 * MetaError de uma chamada SÍNCRONA (options, selection, health, activate, pause) → erro HTTP do §3.4.
 * Limite de uso = 503 META_UNAVAILABLE { reason: 'rate_limited' } (D14); o resto que não tem código síncrono = 503 down.
 */
export function toHttp(e: MetaError): AppException {
  const d = e.details ?? {};
  switch (e.code) {
    case 'META_NOT_CONFIGURED': return new AppException('META_NOT_CONFIGURED', { reason: (d.reason as string) ?? 'not_configured' });
    case 'META_TOKEN_INVALID': return new AppException('META_TOKEN_INVALID');
    case 'META_PERMISSION': return new AppException('META_PERMISSION', { reason: 'missing_scope', ...d });
    case 'META_ACCOUNT_UNUSABLE': return new AppException('META_ACCOUNT_UNUSABLE', { accountStatus: 0, label: 'unusable', ...d });
    case 'META_BUDGET_TOO_LOW': return new AppException('META_BUDGET_TOO_LOW', { minimumMinor: 0, currency: 'USD', ...d });
    case 'META_RATE_LIMITED': return new AppException('META_UNAVAILABLE', { reason: 'rate_limited', retryAfterSec: e.retryAfterSec ?? 60 });
    case 'META_UNAVAILABLE': return new AppException('META_UNAVAILABLE', { reason: (d.reason as string) ?? 'down', retryAfterSec: e.retryAfterSec ?? (d.retryAfterSec as number) ?? 30 });
    // campanhas-v1 §4.1: escritas síncronas da Campaigns (a porta pode lançar; o backend também lança direto)
    case 'META_OBJECT_GONE': return new AppException('META_OBJECT_GONE');
    case 'META_OBJECT_CHANGED': return new AppException('META_OBJECT_CHANGED', { current: d.current ?? null });
    case 'META_PARENT_PAUSED': return new AppException('META_PARENT_PAUSED', { parents: d.parents ?? [] });
    case 'META_BUDGET_NOT_EDITABLE': return new AppException('META_BUDGET_NOT_EDITABLE', { budgetLevel: d.budgetLevel ?? null, kind: d.kind ?? null });
    case 'META_BUDGET_STEP_TOO_LARGE': return new AppException('META_BUDGET_STEP_TOO_LARGE', { maxMinor: 0, currency: 'USD', ...d });
    case 'META_POLICY': return new AppException('META_POLICY', d, e.message);
    default: return new AppException('META_UNAVAILABLE', { reason: 'down', retryAfterSec: 30 }, e.message);
  }
}

/** Roda uma chamada síncrona à porta: MetaError vira HTTP; META_TOKEN_INVALID marca a conexão (§3.1 regras). */
export async function viaPorta<T>(prisma: PrismaService, conn: Pick<MetaConnection, 'id'>, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isMetaError(e)) throw e;
    if (e.code === 'META_TOKEN_INVALID') await markTokenInvalid(prisma, conn.id);
    throw toHttp(e);
  }
}

/** `metaUserId` das conexões que o modo mock cria (callback com code=mock). */
export const MOCK_META_USER = 'mock_user';

/**
 * Defesa do incidente 22/10: fora de META_MODE=live a porta é fake e NÃO pode tocar (ler, sincronizar, checar, marcar
 * token inválido) uma conexão real que divide o banco. Real = metaUserId diferente do usuário do mock.
 */
export function isForeignToMode(conn: Pick<MetaConnection, 'metaUserId'>, mode: 'mock' | 'live' | 'off' = metaMode(process.env.META_MODE)): boolean {
  return mode !== 'live' && conn.metaUserId !== MOCK_META_USER;
}

/** Filtro Prisma equivalente (crons e marcação de token): fora de live só conexões do mock. */
export function ownConnectionsWhere(mode: 'mock' | 'live' | 'off' = metaMode(process.env.META_MODE)): { metaUserId?: string } {
  return mode === 'live' ? {} : { metaUserId: MOCK_META_USER };
}

/** Marca TOKEN_INVALID (só ACTIVE; fora de live, nunca numa conexão real). */
export async function markTokenInvalid(prisma: PrismaService, connectionId: string): Promise<void> {
  await prisma.metaConnection.updateMany({ where: { id: connectionId, status: 'ACTIVE', ...ownConnectionsWhere() }, data: { status: 'TOKEN_INVALID' } }).catch(() => undefined);
}

/** Workspace.market (texto livre) → ISO-3166-1 alfa-2 (D9: o usuário confirma na tela; vazio = escolhe). */
const MARKETS: Record<string, string> = {
  'united states': 'US', usa: 'US', us: 'US', 'estados unidos': 'US', eua: 'US', america: 'US',
  brasil: 'BR', brazil: 'BR', br: 'BR',
  'united kingdom': 'GB', uk: 'GB', 'reino unido': 'GB', england: 'GB', inglaterra: 'GB',
  canada: 'CA', canadá: 'CA', australia: 'AU', austrália: 'AU', germany: 'DE', alemanha: 'DE', france: 'FR', frança: 'FR',
  spain: 'ES', espanha: 'ES', españa: 'ES', portugal: 'PT', italy: 'IT', itália: 'IT', mexico: 'MX', méxico: 'MX',
  argentina: 'AR', chile: 'CL', colombia: 'CO', colômbia: 'CO', netherlands: 'NL', holanda: 'NL', india: 'IN', índia: 'IN',
};
export function countriesOf(market: string | null | undefined): string[] {
  const m = (market ?? '').trim().toLowerCase();
  if (!m) return [];
  if (/^[a-z]{2}$/.test(m)) return [m.toUpperCase()];
  const hit = MARKETS[m];
  return hit ? [hit] : [];
}
