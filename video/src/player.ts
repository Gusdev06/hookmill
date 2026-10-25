// Entrada do @remotion/player (web): `@maquina/video/player`. Mesmas composições do bundle de render, sem registerRoot.
// O web resolve as props com resolverProps(source, settings, doc) e passa pro <Player> junto dos metadados abaixo.
// Fontes: o web serve video/public/fonts em /fonts (prebuild copia; lista em ARQUIVOS_DE_FONTE) e espera
// `carregarFontes()` antes de mostrar a prévia. Versão do remotion e @remotion/player = 4.0.533 (exata, igual ao video/).
import { FORMATOS, FPS, duracaoAutoEdit, duracaoEmFrames, type AutoEditProps, type CriativoProps, type RemixKeepProps } from './lib';

export { Criativo } from './Criativo';
export { RemixKeep } from './RemixKeep';
export { AutoEdit } from './AutoEdit';
export { ARQUIVOS_DE_FONTE, carregarFonteCatalogo, carregarFontes } from './fontes';
export * from './lib';

export interface MetadadosPlayer { durationInFrames: number; fps: number; compositionWidth: number; compositionHeight: number }

/** = calculateMetadata da composição `Criativo` (Root.tsx), no formato das props do <Player>. */
export const metadadosCriativo = (props: CriativoProps): MetadadosPlayer => ({
  durationInFrames: duracaoEmFrames(props, FPS),
  fps: FPS,
  compositionWidth: FORMATOS[props.format].width,
  compositionHeight: FORMATOS[props.format].height,
});

/** = calculateMetadata da composição `RemixKeep` (grade do campeão). */
export const metadadosRemix = (props: RemixKeepProps): MetadadosPlayer => ({
  durationInFrames: props.canvas.frameCount,
  fps: props.canvas.fps,
  compositionWidth: props.canvas.width,
  compositionHeight: props.canvas.height,
});

/** = calculateMetadata da composição `AutoEdit` (variacao-auto-v1 §7.2). */
export const metadadosAutoEdit = (props: AutoEditProps): MetadadosPlayer => ({
  durationInFrames: duracaoAutoEdit(props, FPS),
  fps: FPS,
  compositionWidth: FORMATOS[props.format].width,
  compositionHeight: FORMATOS[props.format].height,
});
