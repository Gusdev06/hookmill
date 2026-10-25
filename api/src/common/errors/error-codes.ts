import type { ApiErrorCode } from '@maquina/contratos';

// Códigos de erro HTTP do contrato (docs/contratos/api.md §1). Nenhum código fora desta lista.
export const ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  REFRESH_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  CONFIRM_DOWNSTREAM_RESET: 409,
  OFFER_INCOMPLETE: 422,
  SPEND_CAP_EXCEEDED: 409,
  ESTIMATE_CHANGED: 409,
  INVITE_INVALID: 410,
  EMAIL_TAKEN: 409,
  LAST_OWNER: 409,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
  // feature 2
  AD_LIBRARY_UNAVAILABLE: 503,
  MEDIA_TOO_LARGE: 422,
  MEDIA_TOO_SHORT: 422,
  MEDIA_TOO_LONG: 422,
  MEDIA_INVALID: 422,
  UPLOAD_EXPIRED: 410,
  UPLOAD_INCOMPLETE: 409,
  NO_SPEECH: 422,
  KIND_NOT_ENABLED: 422,
  BATCH_INCOMPLETE: 422,
  // §13
  KEEP_EDIT_UNSUPPORTED: 422,
  LIPSYNC_AUDIO_TOO_LONG: 422,
  // editor-v1 §5.4
  EDIT_CONFLICT: 409,
  EDIT_NOT_SUPPORTED: 422,
  // fase2-agencia.md §7
  ONBOARDING_INCOMPLETE: 422,
  // variacao-auto-v1 §5.3
  OFFER_REQUIRED: 422,
  PLAN_CHANGED: 409,
  NO_PRODUCT_PHOTO: 422,
  // meta-v1 §3.4 (21/10): síncronos do módulo meta
  META_NOT_CONFIGURED: 503,
  META_NOT_CONNECTED: 422,
  META_SELECTION_MISSING: 422,
  META_TOKEN_INVALID: 422,
  META_PERMISSION: 422,
  META_PIXEL_REQUIRED: 422,
  META_ACCOUNT_UNUSABLE: 422,
  META_BUDGET_TOO_LOW: 422,
  META_UNAVAILABLE: 503,
  // campanhas-v1 §4.1 (22/10; entrada do arquiteto no A1 pra manter o tsc verde, B4 usa)
  META_OBJECT_CHANGED: 409,
  META_OBJECT_GONE: 404,
  META_PARENT_PAUSED: 409,
  META_BUDGET_NOT_EDITABLE: 422,
  META_BUDGET_STEP_TOO_LARGE: 422,
  // campanhas-v1 §4.1: ativar anúncio DISAPPROVED/WITH_ISSUES (síncrono; o assíncrono homônimo é da publicação)
  META_POLICY: 422,
  // molduras §B3.1 (25/10): URL colada na troca de b-roll de fonte desligada/fora da v1 (D15)
  BROLL_SOURCE_NOT_SUPPORTED: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

/** Mensagem padrão em inglês (fallback; o web traduz pelo code). */
export const DEFAULT_ERROR_MESSAGE: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Invalid request.',
  UNAUTHORIZED: 'Authentication required.',
  INVALID_CREDENTIALS: 'Wrong email or password.',
  REFRESH_INVALID: 'Session expired. Sign in again.',
  FORBIDDEN: 'You do not have permission for this action.',
  NOT_FOUND: 'Not found.',
  INVALID_STATE: 'This action is not allowed right now.',
  CONFIRM_DOWNSTREAM_RESET: 'This change discards generated work. Confirm to continue.',
  OFFER_INCOMPLETE: 'The offer is missing required fields.',
  SPEND_CAP_EXCEEDED: 'Monthly spend cap reached.',
  ESTIMATE_CHANGED: 'The estimate changed. Review the new cost.',
  INVITE_INVALID: 'This invite is no longer valid.',
  EMAIL_TAKEN: 'This email is already a member.',
  LAST_OWNER: 'The workspace needs at least one owner.',
  RATE_LIMITED: 'Too many requests. Try again shortly.',
  PROVIDER_UNAVAILABLE: 'The provider is unavailable. Try again shortly.',
  INTERNAL_ERROR: 'Something went wrong.',
  AD_LIBRARY_UNAVAILABLE: 'The Ad Library link is unavailable right now. Upload the video instead.',
  MEDIA_TOO_LARGE: 'The file is too large.',
  MEDIA_TOO_SHORT: 'The video is too short.',
  MEDIA_TOO_LONG: 'The video is too long.',
  MEDIA_INVALID: 'This file is not a valid video.',
  UPLOAD_EXPIRED: 'The upload expired. Start it again.',
  UPLOAD_INCOMPLETE: 'The upload did not finish. Send the file again.',
  NO_SPEECH: 'This variation needs speech and the champion has none.',
  KIND_NOT_ENABLED: 'This variation type is not available yet.',
  BATCH_INCOMPLETE: 'The batch is missing something before launch.',
  KEEP_EDIT_UNSUPPORTED: 'Keeping the original edit is not possible for this champion.',
  LIPSYNC_AUDIO_TOO_LONG: 'The lipsync audio is longer than 600 seconds.',
  EDIT_CONFLICT: 'Someone else saved this edit. Reload to see the latest version.',
  EDIT_NOT_SUPPORTED: 'This part of the video cannot be edited.',
  ONBOARDING_INCOMPLETE: 'Finish the setup first: business type and at least one offer.',
  OFFER_REQUIRED: 'Pick which offer this video is for.',
  PLAN_CHANGED: 'The plan changed. Review the pieces again.',
  NO_PRODUCT_PHOTO: 'Add a product photo to the offer first.',
  META_NOT_CONFIGURED: "Meta isn't set up on this server yet.",
  META_NOT_CONNECTED: 'Connect a Meta account first.',
  META_SELECTION_MISSING: 'Choose an ad account and a Page to continue.',
  META_TOKEN_INVALID: 'Your Meta login expired. Reconnect to continue.',
  META_PERMISSION: "You don't have permission to advertise on this account. Ask the account admin to add you (Business Settings → Ad accounts → Add people).",
  META_PIXEL_REQUIRED: 'This objective needs a pixel. Choose one, or switch to Traffic.',
  META_ACCOUNT_UNUSABLE: 'This ad account cannot run ads right now. Choose another account.',
  META_BUDGET_TOO_LOW: 'Daily budget is below the minimum for this account.',
  META_UNAVAILABLE: "Meta didn't answer. Try again in a moment.",
  META_OBJECT_CHANGED: 'This changed in Ads Manager since the last sync. We refreshed it: check and try again.',
  META_OBJECT_GONE: 'This no longer exists on Meta.',
  META_PARENT_PAUSED: 'Its ad set or campaign is paused. Turn them on too?',
  META_BUDGET_NOT_EDITABLE: "This budget can't be changed here (it's set on another level, or it's a lifetime budget).",
  META_BUDGET_STEP_TOO_LARGE: 'That raise is too big for one step. Raise it in smaller steps.',
  META_POLICY: 'Meta rejected this ad for a policy reason. Fix it in Ads Manager before turning it on.',
  BROLL_SOURCE_NOT_SUPPORTED: 'That link is from a source we cannot use. Paste a Pexels link or pick one of the suggested clips.',
};

/** Códigos de falha DENTRO de trabalho assíncrono (viram status FAILED + errorCode no recurso, nunca erro HTTP). */
export type { AsyncErrorCode } from '@maquina/contratos';

// Checagem em tempo de compilação: a lista bate com o contrato (@maquina/contratos), nos dois sentidos.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
/**
 * variacao-auto-v1 §5.3 (aprovado 13/10): códigos que o contrato já tem mas o `ApiErrorCode` do @maquina/contratos ainda
 * não (pendência do A0, arquiteto). Quando entrarem lá, esta checagem quebra de propósito: aí é só esvaziar a lista.
 */
/** 21/10: os 9 síncronos META_* entraram no `ApiErrorCode` do @maquina/contratos (arquiteto); lista vazia de novo. */
/** 22/10 (A4b): 'META_POLICY' síncrono entrou no `ApiErrorCode` (campanhas-v1 §4.1); lista vazia de novo. */
type PendingInContract = never;
export const ERROR_CODES_MATCH_CONTRACT: Same<Exclude<ErrorCode, PendingInContract>, ApiErrorCode> = true;
