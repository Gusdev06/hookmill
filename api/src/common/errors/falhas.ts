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
};

/** Normaliza qualquer código vindo de fora pra um AsyncErrorCode do contrato. */
export function asAsyncErrorCode(code: string | null | undefined, fallback: AsyncErrorCode = 'PROVIDER_ERROR'): AsyncErrorCode {
  return code && (ASYNC_ERROR_CODES as readonly string[]).includes(code) ? (code as AsyncErrorCode) : fallback;
}

export function failReasonFor(code: AsyncErrorCode): string {
  return REASON[code];
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
