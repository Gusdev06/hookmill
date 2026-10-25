// Erros da integração Meta (meta-v1.md §3.3 tabela + §3.4). O backend traduz `code` pra HTTP/i18n; a integração nunca
// devolve texto cru da Meta como mensagem principal a não ser o `error_user_msg` (que a Meta escreve pro usuário).
// NUNCA inclua o access token em mensagem/detalhe: `scrubToken` passa em toda string vinda de erro de rede/URL.
import type { MetaAsyncErrorCode, MetaOAuthErrorCode, MetaWriteErrorCode } from '@maquina/contratos';

export type MetaErrorCode =
  | MetaAsyncErrorCode
  | MetaOAuthErrorCode
  | MetaWriteErrorCode   // campanhas-v1 §4.1 (22/10): escritas síncronas da tela Campaigns
  | 'META_NOT_CONFIGURED'
  | 'META_UNAVAILABLE'
  | 'META_STATE_INVALID';

export type MetaErrorAction = 'reconnect_meta' | 'choose_account' | 'fix_payment' | 'edit_ad_text' | 'raise_budget' | 'retry' | 'render_again' | 'upload_video' | 'contact_support' | 'refresh';

/** Ação sugerida pros erros de escrita da Campaigns (campanhas-v1 §4.1). */
export const META_WRITE_ERROR_ACTION: Record<MetaWriteErrorCode, MetaErrorAction | null> = {
  META_OBJECT_CHANGED: 'refresh',
  META_OBJECT_GONE: 'refresh',
  META_PARENT_PAUSED: null,
  META_BUDGET_NOT_EDITABLE: null,
  META_BUDGET_STEP_TOO_LARGE: null,
};

export const META_ERROR_ACTION: Record<MetaAsyncErrorCode, MetaErrorAction> = {
  META_TOKEN_INVALID: 'reconnect_meta',
  META_PERMISSION: 'reconnect_meta',
  META_ACCOUNT_UNUSABLE: 'choose_account',
  META_PAYMENT_REQUIRED: 'fix_payment',
  META_POLICY: 'edit_ad_text',
  META_BUDGET_TOO_LOW: 'raise_budget',
  META_VIDEO_REJECTED: 'render_again',
  META_VIDEO_UNAVAILABLE: 'upload_video',
  META_RATE_LIMITED: 'retry',
  META_ERROR: 'retry',
};

/** Frase humana padrão (EN) por código; o web traduz pelo `code`. */
export const META_ERROR_TEXT: Record<MetaErrorCode, string> = {
  META_TOKEN_INVALID: 'Your Meta login expired. Reconnect to continue.',
  META_PERMISSION: "You don't have permission to advertise on this account. Ask the account admin to add you (Business Settings → Ad accounts → Add people).",
  META_ACCOUNT_UNUSABLE: 'This ad account cannot run ads right now. Choose another account.',
  META_PAYMENT_REQUIRED: 'This ad account has a payment problem. Fix it in Ads Manager and try again.',
  META_POLICY: 'Meta rejected the ad text or creative for a policy reason. Edit it and try again.',
  META_BUDGET_TOO_LOW: 'Daily budget is below the minimum for this account.',
  META_VIDEO_REJECTED: 'Meta could not process this video. Render it again.',
  META_VIDEO_UNAVAILABLE: 'This ad video cannot be downloaded from Meta. Upload the MP4 instead.',
  META_RATE_LIMITED: 'Meta asked us to wait a minute. Try again shortly.',
  META_ERROR: "Meta didn't answer as expected. Try again.",
  META_OAUTH_DENIED: 'The Meta window was closed before it finished, or a popup blocker stopped it. Try again.',
  META_OAUTH_FAILED: 'Meta login failed. Try again; if it keeps happening, contact support.',
  META_STATE_INVALID: 'This login link expired. Start again from HookMill.',
  META_SCOPES_MISSING: 'HookMill needs these permissions to work. Try again and keep them checked.',
  META_UNAVAILABLE: "Meta didn't answer. Try again in a moment.",
  META_NOT_CONFIGURED: "Meta isn't set up on this server yet.",
  META_OBJECT_CHANGED: 'This changed in Ads Manager since the last sync. Refresh and try again.',
  META_OBJECT_GONE: 'This no longer exists on Meta. It was removed from the list.',
  META_PARENT_PAUSED: 'Its campaign or ad set is paused. Turn them on too to start spending.',
  META_BUDGET_NOT_EDITABLE: 'This budget is set on another level, or is a lifetime budget. Edit it there or in Ads Manager.',
  META_BUDGET_STEP_TOO_LARGE: 'That raise is too big for one step. Raise it in smaller steps, or in Ads Manager.',
};

export class MetaError extends Error {
  readonly name = 'MetaError';
  constructor(
    public readonly code: MetaErrorCode,
    message?: string | null,
    public readonly options: {
      /** `details` do envelope da API (ex.: { missing }, { minimumMinor, currency }, { reason, retryAfterSec }) */
      details?: Record<string, unknown>;
      action?: MetaErrorAction | null;
      /** code/subcode/fbtrace_id da Meta (debug; vai pro failDetail) */
      failDetail?: string | null;
      retryAfterSec?: number | null;
      /** etapa em que estourou (publicação) */
      stage?: string | null;
    } = {},
  ) {
    super(scrubToken(message || META_ERROR_TEXT[code]));
    // failDetail passa pelo mesmo scrub da mensagem: pode vir de URL/erro de rede (OAuth: code, token, client_secret)
    if (options.failDetail) this.options = { ...options, failDetail: scrubToken(options.failDetail) };
  }
  get details(): Record<string, unknown> | undefined { return this.options.details; }
  get action(): MetaErrorAction | null {
    if (this.options.action !== undefined) return this.options.action;
    return (META_ERROR_ACTION as Record<string, MetaErrorAction>)[this.code] ?? null;
  }
  get failDetail(): string | null { return this.options.failDetail ?? null; }
  get retryAfterSec(): number | null { return this.options.retryAfterSec ?? null; }
  get stage(): string | null { return this.options.stage ?? null; }
}

export function isMetaError(e: unknown): e is MetaError {
  return e instanceof MetaError;
}

/** Tira tokens/segredos de qualquer texto (URL, mensagem de rede, corpo de erro): access/exchange/input token, client_secret, `code` do OAuth, Bearer. */
export function scrubToken(s: string): string {
  return s
    .replace(/\b(access_token|fb_exchange_token|input_token|client_secret|code)=[^&\s"']+/gi, '$1=***')
    .replace(/\bBearer\s+[A-Za-z0-9._\-|]+/g, 'Bearer ***')
    .replace(/\b(EAA[A-Za-z0-9]{20,})\b/g, 'EAA***');
}

export function notConfigured(reason: 'not_configured' | 'off', what?: string): MetaError {
  return new MetaError('META_NOT_CONFIGURED', what ? `${META_ERROR_TEXT.META_NOT_CONFIGURED} (${what})` : undefined, { details: { reason }, action: null });
}

/** Corpo de erro da Graph API: { error: { message, type, code, error_subcode, error_user_title, error_user_msg, fbtrace_id, is_transient } } */
export interface GraphErrorBody {
  message?: string; type?: string; code?: number; error_subcode?: number;
  error_user_title?: string; error_user_msg?: string; fbtrace_id?: string; is_transient?: boolean;
  error_data?: unknown;
}

export const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending risk review', 8: 'pending settlement', 9: 'in grace period',
  100: 'pending closure', 101: 'closed', 201: 'any active', 202: 'any closed',
};
export const accountStatusLabel = (s: number) => ACCOUNT_STATUS_LABEL[s] ?? `status ${s}`;
/** account_status que impede publicar/ativar (D5). 7 (risk review) só avisa. */
export const accountUnusable = (s: number | null | undefined) => s != null && s !== 1 && s !== 7;
/** 3 UNSETTLED / 9 IN_GRACE_PERIOD = problema de pagamento. */
export const accountUnpaid = (s: number | null | undefined) => s === 3 || s === 9;

const RATE_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
const PERMISSION_CODES = new Set([10, 3, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299]);
/** subcódigos 1487xxx que a sonda deve confirmar (meta-v1 §3.3). Palavras-chave cobrem o que faltar. */
const BUDGET_SUBCODES = new Set([1487005, 1487014, 1487015, 1487039, 1885193, 1885194]);
const POLICY_SUBCODES = new Set([1815016, 1815017, 1815018, 1815105, 1815162, 1815380, 1885183]);
const ACCOUNT_SUBCODES = new Set([1487019, 1487020, 1487390, 1487396, 1815020]);
const PAYMENT_SUBCODES = new Set([1487008, 1487035, 1487040, 1815052]);

/**
 * Mapa Meta → nosso (§3.3). Fixa só o CÓDIGO nosso e a AÇÃO; subcódigos exatos são confirmados na sonda.
 * `httpStatus` ajuda quando o corpo vem sem `error` (5xx cru).
 */
export function mapGraphError(err: GraphErrorBody | null | undefined, ctx: { httpStatus?: number; stage?: string | null; retryAfterSec?: number | null } = {}): MetaError {
  const code = err?.code ?? null;
  const sub = err?.error_subcode ?? null;
  const text = `${err?.error_user_title ?? ''} ${err?.error_user_msg ?? ''} ${err?.message ?? ''}`.toLowerCase();
  // scrub ANTES do corte: cortar primeiro podia deixar um pedaço de token que o regex não reconhece
  const failDetail = err ? `${code ?? '-'}/${sub ?? '-'}/${err.fbtrace_id ?? '-'}${err.message ? ` ${scrubToken(err.message).slice(0, 160)}` : ''}` : (ctx.httpStatus ? `http ${ctx.httpStatus}` : null);
  const userMsg = err?.error_user_msg ? scrubToken(err.error_user_msg) : null;
  const mk = (c: MetaErrorCode, msg?: string | null, details?: Record<string, unknown>, extra: { action?: MetaErrorAction | null; retryAfterSec?: number | null } = {}) =>
    new MetaError(c, msg ?? userMsg, { details, failDetail, stage: ctx.stage ?? null, retryAfterSec: extra.retryAfterSec ?? ctx.retryAfterSec ?? null, action: extra.action });

  if (code === 190 || (code === 102 && !sub)) return mk('META_TOKEN_INVALID', null);
  if (code !== null && RATE_CODES.has(code)) return mk('META_RATE_LIMITED', null, { reason: 'rate_limited', retryAfterSec: ctx.retryAfterSec ?? 60 }, { retryAfterSec: ctx.retryAfterSec ?? 60 });
  if (sub !== null && BUDGET_SUBCODES.has(sub) || /budget.*(too low|minimum|at least|below)|minimum.*budget/.test(text)) {
    const minor = minimumFromText(text);
    return mk('META_BUDGET_TOO_LOW', null, minor != null ? { minimumMinor: minor } : undefined);
  }
  // orçamento no nível errado (CBO no conjunto, ABO na campanha) ou vitalício ↔ diário: a Meta recusa a escrita
  if (/campaign budget optimi[sz]ation|advantage campaign budget|budget (is|must be) (set|managed) (at|on) the (campaign|ad set) level|can(no|')t (set|change|update|edit) (a |the )?(daily )?budget|lifetime budget.*daily budget|daily budget.*lifetime budget|switch.*budget type/.test(text))
    return mk('META_BUDGET_NOT_EDITABLE', null);
  if (sub !== null && POLICY_SUBCODES.has(sub) || /polic|ad review|disapprov|not compliant|prohibited content/.test(text)) return mk('META_POLICY', null);
  if (sub !== null && PAYMENT_SUBCODES.has(sub) || /payment|funding|unsettled|billing|credit card|unpaid/.test(text)) return mk('META_PAYMENT_REQUIRED', null);
  if (sub !== null && ACCOUNT_SUBCODES.has(sub) || /account (is|has been) (disabled|closed|deactivated)|account.*(under review|in review|restricted)|ad account (is )?inactive/.test(text)) return mk('META_ACCOUNT_UNUSABLE', null);
  if (code !== null && PERMISSION_CODES.has(code)) return mk('META_PERMISSION', null, { reason: 'missing_scope', ...(scopeFromText(text) ? { scope: scopeFromText(text) } : {}) });
  if (code === 100 && /permission|not authorized|does not have access|cannot access|unsupported (get|post) request/.test(text)) return mk('META_PERMISSION', null, { reason: 'missing_scope' });
  if (/video.*(fail|error|invalid|unsupported|corrupt|could not be processed)|unsupported video|invalid video/.test(text)) return mk('META_VIDEO_REJECTED', null);
  // code 1 "Please reduce the amount of data you're asking for": conta grande demais pra uma página (o paginate encolhe o limit sozinho)
  if (code === 1 && /reduce the amount of data/.test(text))
    return mk('META_UNAVAILABLE', "This ad account has too much data for Meta to send at once, even in small pages. Try syncing again in a few minutes.", { reason: 'too_much_data', retryAfterSec: 60 }, { action: 'retry', retryAfterSec: 60 });
  if (ctx.httpStatus != null && ctx.httpStatus >= 500) return mk('META_UNAVAILABLE', null, { reason: 'down', retryAfterSec: 30 }, { action: 'retry', retryAfterSec: 30 });
  if (err?.is_transient) return mk('META_UNAVAILABLE', null, { reason: 'down', retryAfterSec: 30 }, { action: 'retry', retryAfterSec: 30 });
  return mk('META_ERROR', null);
}

function minimumFromText(text: string): number | null {
  // "minimum daily budget is $5.00" / "at least 500" → centavos quando vier com símbolo de moeda
  const money = /(?:\$|usd|brl|r\$|eur|€)\s?(\d+(?:[.,]\d{1,2})?)/.exec(text);
  if (money) return Math.round(parseFloat(money[1].replace(',', '.')) * 100);
  return null;
}
function scopeFromText(text: string): string | null {
  const m = /(ads_management|ads_read|business_management|pages_show_list|pages_read_engagement|pages_manage_ads)/.exec(text);
  return m ? m[1] : null;
}
