// Entrada do @remotion/player (web): `@maquina/video/player`. Mesmas composições do bundle de render, sem registerRoot.
// O web resolve as props com resolverProps(source, settings, doc) e passa pro <Player> junto dos metadados abaixo.
// Fontes: o web serve video/public/fonts em /fonts (prebuild copia; lista em ARQUIVOS_DE_FONTE) e espera
// `carregarFontes()` antes de mostrar a prévia. Versão do remotion e @remotion/player = 4.0.533 (exata, igual ao video/).
import { FORMATOS, FPS, duracaoAutoEdit, duracaoEmFrames, duracaoMoldura, type AutoEditProps, type CriativoProps, type ListOverlayProps, type MolduraProps, type RemixKeepProps, type VideoFormat } from './lib';

export { Criativo } from './Criativo';
export { RemixKeep } from './RemixKeep';
export { AutoEdit } from './AutoEdit';
// editor universal F-U1 (editor-universal-v1 §5): peça AUTO de moldura no Player; props = resolverPropsMoldura(base, doc, ctx).props
export { Moldura } from './molduras/Moldura';
export { ListOverlay } from './templates/ListOverlay';
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

/** Prévia dos templates de lista no Plan (templates-lista-v1 §5): `<Player component={ListOverlay} inputProps={preview.props} />`.
 *  Duração = o vídeo inteiro do campeão. */
export const metadadosLista = (props: ListOverlayProps, format: VideoFormat = 'VERTICAL_9_16'): MetadadosPlayer => ({
  durationInFrames: Math.max(1, Math.round(props.source.durationSec * FPS)),
  fps: FPS,
  compositionWidth: FORMATOS[format].width,
  compositionHeight: FORMATOS[format].height,
});

/** = calculateMetadata da composição `Moldura` (Root.tsx / molduras/Moldura.tsx): duração = soma do timeline. */
export const metadadosMoldura = (props: MolduraProps): MetadadosPlayer => ({
  durationInFrames: duracaoMoldura(props, FPS),
  fps: FPS,
  compositionWidth: FORMATOS[props.format].width,
  compositionHeight: FORMATOS[props.format].height,
});
