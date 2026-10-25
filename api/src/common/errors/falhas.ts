import type { Action, AsyncErrorCode } from '@maquina/contratos';

/**
 * Falha DENTRO de trabalho assíncrono (job, rosto, cena, render): vira status FAILED + errorCode + failReason + action.
 * O texto humano é do backend (fallback em inglês; o web traduz pelo errorCode). Nunca a mensagem crua do provedor.
 */
export const ASYNC_ERROR_CODES: readonly AsyncErrorCode[] = [
  'PAGE_FORBIDDEN', 'PAGE_UNREADABLE', 'RATE_LIMITED', 'SAFETY_BLOCK', 'PROVIDER_TIMEOUT', 'PROVIDER_ERROR',
  'CANCELLED', 'DOWNLOAD_INVALID', 'INTERRUPTED', 'RENDER_ERROR',
  'AD_LIBRARY_UNAVAILABLE', 'AD_NOT_FOUND', 'AD_HAS_NO_VIDEO', 'MEDIA_INVALID',
  'LIPSYNC_AUDIO_TOO_LONG',
  'VOICE_FIT_OUT_OF_RANGE', 'SPEECH_MISMATCH', 'IDENTITY_DRIFT',
  // meta-v1 §3.3 (21/10): códigos assíncronos do META_SYNC / META_IMPORT / META_PUBLISH
  'META_TOKEN_INVALID', 'META_PERMISSION', 'META_ACCOUNT_UNUSABLE', 'META_PAYMENT_REQUIRED', 'META_POLICY',
  'META_BUDGET_TOO_LOW', 'META_VIDEO_REJECTED', 'META_VIDEO_UNAVAILABLE', 'META_RATE_LIMITED', 'META_ERROR',
];

const REASON: Record<AsyncErrorCode, string> = {
  PAGE_FORBIDDEN: 'The page blocked our reader (403). Paste the page text instead.',
  PAGE_UNREADABLE: 'We could not read any text on that page. Paste the page text or fill the fields manually.',
  RATE_LIMITED: 'The AI provider is busy right now (rate limit). Try again in a minute.',
  SAFETY_BLOCK: 'The model blocked this image. Try a description without real names, minors or explicit details.',
  PROVIDER_TIMEOUT: 'The provider took too long to answer. Try again.',
  PROVIDER_ERROR: 'The provider failed to generate this. Try again.',
  CANCELLED: 'The provider cancelled this task. Try again.',
  DOWNLOAD_INVALID: 'The generated file arrived broken after 3 tries. Try again.',
  INTERRUPTED: 'The server restarted while this was running. Try again.',
  RENDER_ERROR: 'The render failed. Render again.',
  AD_LIBRARY_UNAVAILABLE: 'The Ad Library is unavailable right now. Upload the video file instead.',
  AD_NOT_FOUND: 'We could not find that ad in the Ad Library. Upload the video file instead.',
  AD_HAS_NO_VIDEO: 'That ad has no video. Upload the video file instead.',
  MEDIA_INVALID: 'The video could not be read (broken, too small or not a video). Upload another file.',
  LIPSYNC_AUDIO_TOO_LONG: 'The narration is longer than 600 seconds, the lipsync limit. Shorten the script.',
  VOICE_FIT_OUT_OF_RANGE: "The engine's voice came out too fast or too slow to fit this segment. Redo the segment.",
  SPEECH_MISMATCH: "The engine's voice did not say the segment's words. Redo the segment.",
  IDENTITY_DRIFT: 'The face changed into another person during the clip. Redo the segment.',
  // meta-v1 §3.3/§3.4 (21/10): fallback EN; o módulo meta troca pelo error_user_msg da Meta quando houver
  META_TOKEN_INVALID: 'Your Meta login expired. Reconnect to continue.',
  META_PERMISSION: "You don't have permission to advertise on this account. Ask the account admin to add you.",
  META_ACCOUNT_UNUSABLE: 'This ad account is disabled or under review. Choose another account.',
  META_PAYMENT_REQUIRED: 'This ad account has an unpaid balance or no payment method. Fix it in Ads Manager.',
  META_POLICY: 'Meta rejected the ad for a policy reason. Edit the ad text and try again.',
  META_BUDGET_TOO_LOW: 'The daily budget is below the minimum for this account. Raise it and try again.',
  META_VIDEO_REJECTED: 'Meta could not process this video. Render again and try once more.',
  META_VIDEO_UNAVAILABLE: 'We could not download the video of that ad from Meta. Upload the video file instead.',
  META_RATE_LIMITED: 'Meta asked us to wait a minute. Try again shortly.',
  META_ERROR: 'Meta did not accept this request. Try again.',
};

/**
 * briefing-leitura-v2 §4.3 (22/10): frases por DETALHE do IntegracaoError (`details.reason`) quando a página não dá pra ler.
 * `login_wall` = `<input type=password>` visível ou redirect pra /login|/signin|/entrar com pouco texto;
 * `empty_after_render` = (a) HTTP e (b) render headless devolveram < 200 caracteres e não havia imagem pra ler.
 */
export const PAGE_UNREADABLE_DETAILS = ['login_wall', 'empty_after_render'] as const;
export type PageUnreadableDetail = (typeof PAGE_UNREADABLE_DETAILS)[number];
const DETAIL_REASON: Record<PageUnreadableDetail, string> = {
  login_wall: 'This page is behind a login. Paste the page text, or use the public sales page link.',
  empty_after_render: 'The page has no readable text, even after loading it in a browser. Paste the page text or fill the fields manually.',
};

/** Normaliza qualquer código vindo de fora pra um AsyncErrorCode do contrato. */
export function asAsyncErrorCode(code: string | null | undefined, fallback: AsyncErrorCode = 'PROVIDER_ERROR'): AsyncErrorCode {
  return code && (ASYNC_ERROR_CODES as readonly string[]).includes(code) ? (code as AsyncErrorCode) : fallback;
}

export function failReasonFor(code: AsyncErrorCode, detail?: unknown): string {
  if (code === 'PAGE_UNREADABLE' && typeof detail === 'string' && (PAGE_UNREADABLE_DETAILS as readonly string[]).includes(detail)) {
    return DETAIL_REASON[detail as PageUnreadableDetail];
  }
  return REASON[code];
}

/** Detalhe de página ilegível dentro do `details` de um erro da integração (`reason` ou `detail`); outro valor = undefined. */
export function pageUnreadableDetailOf(details: Record<string, unknown> | undefined): PageUnreadableDetail | undefined {
  const d = details?.reason ?? details?.detail;
  return typeof d === 'string' && (PAGE_UNREADABLE_DETAILS as readonly string[]).includes(d) ? (d as PageUnreadableDetail) : undefined;
}

/** Ação sugerida por tipo de recurso. */
export function jobAction(code: string | null): Action | null {
  if (!code) return null;
  if (code === 'PAGE_FORBIDDEN' || code === 'PAGE_UNREADABLE') return 'paste_page_text';
  return 'retry';
}

export function faceAction(code: AsyncErrorCode | null): Action {
  return code === 'SAFETY_BLOCK' ? 'change_description' : 'retry';
}

export function sceneAction(code: AsyncErrorCode | null): Action {
  return code === 'SAFETY_BLOCK' ? 'change_description' : 'regenerate';
}

/** Status final de task da WaveSpeed sem errorCode normalizado → código do contrato. */
export function codeFromTaskStatus(status: string, errorCode: string | null): AsyncErrorCode {
  if (errorCode) return asAsyncErrorCode(errorCode);
  if (status === 'TIMEOUT') return 'PROVIDER_TIMEOUT';
  if (status === 'CANCELLED') return 'CANCELLED';
  return 'PROVIDER_ERROR';
}
