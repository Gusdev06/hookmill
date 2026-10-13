// Portas da feature 2 que o backend consome de outras pastas.
//  - MEDIA_ANALYSIS: o token da medicao (maquina-video), contrato §6.2.
//  - AD_LIBRARY: alias (useExisting, em campeoes.module.ts) do AD_LIBRARY_SERVICE da integracoes (maquina-ia), §6.1.
// Testes trocam os dois por fakes (overrideProvider) sem tocar nas pastas dos donos.
import type { Rect } from '@maquina/contratos';
import type { AdLibraryService } from '../integracoes';
export type { AdLibraryService };
export type { MediaAnalysisService } from '../medicao';
export { MediaInvalidError, MEDIA_ANALYSIS_SERVICE as MEDIA_ANALYSIS } from '../medicao';

export const AD_LIBRARY = Symbol('BACKEND_AD_LIBRARY');

/**
 * Proposta pro maquina-video (08/10, item (c)): caixa da legenda SEM fundo medida por pixel. A visão erra a caixa do
 * karaokê (podcast: salvou y589, o texto está em y≈955-1041). Nos instantes em que há palavra falada (`atSec`, meio de
 * cada palavra do intervalo da camada), acha a faixa onde o texto aparece por variância/contraste (texto claro com
 * contorno contra o fundo do vídeo) e devolve a caixa em px do campeão; null = não achou (fica a da visão).
 * Enquanto o método não existir na medicao, o refino pula (camada da visão).
 */
export interface CaptionBoxPort {
  captionBox(videoPath: string, atSec: number[], approxBox: Rect | null): Promise<Rect | null>;
}
export const hasCaptionBox = (m: object): m is CaptionBoxPort => typeof (m as Record<string, unknown>).captionBox === 'function';

/** Código de erro de qualquer coisa que a integracoes/medicao lançar (IntegracaoError.code, MediaInvalidError...). */
export function errorCodeOf(e: unknown): string | null {
  const c = (e as { code?: unknown } | null)?.code;
  if (typeof c === 'string') return c;
  if ((e as Error | null)?.name === 'MediaInvalidError') return 'MEDIA_INVALID';
  return null;
}
