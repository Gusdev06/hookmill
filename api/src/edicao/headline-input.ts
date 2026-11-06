// Ponte entre a fila (backend) e o `buildHeadlineInput` do maquina-video (headline-e-legenda-v1 §1.3, api/src/render/
// headline.ts): HeadlineSpec + contexto do campeão → RemixKeepRenderInput. Token de DI pra o teste poder trocar.
import type { HeadlineSpec, OpcoesHeadline } from '../render/headline';
import type { RemixKeepRenderInput } from '../render/contrato';
import type { AutoEditContext } from './auto-edit-input';

export const HEADLINE_BUILDER = Symbol('HEADLINE_BUILDER');
/** Lança `HeadlineError` (`HEADLINE_TOO_LONG` / `_NO_FIT` / `_NO_ROOM` / `_OVER_FACE` / `_LOW_CONFIDENCE` / `_PENDING`): peça
 *  `failed`, Leave out. `opts.plateUrl` (F1b): a placa READY do campeão, só no `loose` copiado. */
export type HeadlineBuilder = (spec: HeadlineSpec, ctx: AutoEditContext, opts?: OpcoesHeadline) => RemixKeepRenderInput;
