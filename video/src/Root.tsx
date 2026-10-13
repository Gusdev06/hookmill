import React from 'react';
import { Composition, Folder, type CalculateMetadataFunction } from 'remotion';
import amostra from '../public/fixtures/amostra.json';
import { Criativo } from './Criativo';
import { RemixKeep } from './RemixKeep';
import { AutoEdit } from './AutoEdit';
import { AUTO_EDIT_COMPOSITION_ID, AUTO_EDIT_STILL_COMPOSITION_ID, autoEditSchema, duracaoAutoEdit, SAFE_AREA, type AutoEditProps, COMPOSITION_ID, criativoSchema, duracaoEmFrames, FORMATOS, FPS, REMIX_COMPOSITION_ID, remixKeepSchema, type CriativoProps, type RemixKeepProps } from './lib';

// Tamanho e duração saem das props (formato + soma das cenas + end card).
const calcular: CalculateMetadataFunction<CriativoProps> = async ({ props }) => ({
  durationInFrames: duracaoEmFrames(props, FPS),
  fps: FPS,
  ...FORMATOS[props.format],
});

// Props de exemplo com a mídia de teste local (public/fixtures, ver LEIAME.md). Nada pago.
const base: CriativoProps = {
  templateId: 'clean',
  format: 'VERTICAL_9_16',
  language: 'en',
  scenes: amostra.scenes,
  captionStyle: 'word',
  captionPosition: 'bottom',
  headline: null,
  ctaText: 'Try it free today',
  endCard: true,
};

const AMOSTRAS: { id: string; props: CriativoProps }[] = [
  { id: 'Amostra-clean-9x16', props: base },
  { id: 'Amostra-bold-9x16', props: { ...base, templateId: 'bold' } },
  { id: 'Amostra-headline-9x16', props: { ...base, templateId: 'headline', headline: 'I found out without touching their phone' } },
  { id: 'Amostra-bold-4x5', props: { ...base, templateId: 'bold', format: 'PORTRAIT_4_5', captionStyle: 'line' } },
  { id: 'Amostra-headline-1x1', props: { ...base, templateId: 'headline', format: 'SQUARE_1_1', captionPosition: 'top', headline: 'I found out without touching their phone' } },
];

// remix-keep: tamanho, fps e nº de frames = os do campeão (canvas), sem reescalar.
const calcularRemix: CalculateMetadataFunction<RemixKeepProps> = async ({ props }) => ({
  durationInFrames: props.canvas.frameCount,
  fps: props.canvas.fps,
  width: props.canvas.width,
  height: props.canvas.height,
});

// Exemplo pro Studio com a mídia de teste local (fixtures): cena 1 de fundo, cena 2 colada num quadrado, 1 headline.
const remixExemplo: RemixKeepProps = {
  canvas: { width: 704, height: 1280, fps: 30, frameCount: 120 },
  baseVideoUrl: 'fixtures/cena-1.mp4',
  overlays: [{ startFrame: 30, endFrame: 120, region: { x: 0, y: 200, w: 352, h: 352 }, clipUrl: 'fixtures/cena-2.mp4', clipOffsetSec: 0, crop: { x: 0, y: 200, w: 704, h: 704 } }],
  textLayers: [{
    id: 'headline', startFrame: 0, endFrame: 120, box: { x: 40, y: 40, w: 624, h: 140 },
    background: { kind: 'solid', color: 'linear-gradient(180deg, #f00800 0px, #c10a09 60px, #4f0403 140px)', box: { x: 0, y: 30, w: 704, h: 160 } },
    style: { fontId: 'montserrat-800', uppercase: true, fontSizePx: 44, lineHeight: 1.1, color: '#ffffff', highlightColor: null, strokeColor: null, strokeWidthPx: 0, shadow: false, align: 'center' },
    content: { kind: 'static', text: 'I found this out while she was saying she was working late.' },
  }],
};

// auto-edit (variacao-auto-v1 §7.2): tamanho do formato, duração = soma do timeline (+2 s no ENDCARD); still = 1 frame.
const calcularAuto: CalculateMetadataFunction<AutoEditProps> = async ({ props }) => ({
  durationInFrames: duracaoAutoEdit(props, FPS),
  fps: FPS,
  ...FORMATOS[props.format],
});

// Exemplo pro Studio com a mídia de teste local: take de 31 s (real-take.mp4, 960x960 24 fps), gancho + CTA.
const autoExemplo: AutoEditProps = {
  output: 'video', format: 'VERTICAL_9_16', language: 'en',
  source: { videoUrl: 'fixtures/real-take.mp4', width: 960, height: 960, fps: 24, durationSec: 31.04, hasAudio: true },
  reframe: { mode: 'cover', focus: { x: 0.5, y: 0.42 } },
  timeline: [{ startSec: 0, endSec: 6.71 }, { startSec: 20.74, endSec: 26.35 }],
  joinFadeMs: 40, safeArea: SAFE_AREA.VERTICAL_9_16, palette: ['#1b1b1b', '#c8a27a', '#d21f1f'], brandName: 'Acme',
  type: 'HOOK_TEXT',
  params: { type: 'HOOK_TEXT', text: 'I found out without touching her phone', endSec: 3, box: { x: 90, y: 300, w: 900, h: 300 }, cover: null },
};
const stillExemplo: AutoEditProps = {
  ...autoExemplo, output: 'still', type: 'STATIC',
  params: { type: 'STATIC', atSec: 16, headline: 'It showed absolutely everything', box: { x: 90, y: 300, w: 900, h: 300 } },
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id={AUTO_EDIT_COMPOSITION_ID}
      component={AutoEdit}
      schema={autoEditSchema}
      defaultProps={autoExemplo}
      calculateMetadata={calcularAuto}
      durationInFrames={300}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id={AUTO_EDIT_STILL_COMPOSITION_ID}
      component={AutoEdit}
      schema={autoEditSchema}
      defaultProps={stillExemplo}
      calculateMetadata={calcularAuto}
      durationInFrames={1}
      fps={30}
      width={1080}
      height={1920}
    />
    <Composition
      id={REMIX_COMPOSITION_ID}
      component={RemixKeep}
      schema={remixKeepSchema}
      defaultProps={remixExemplo}
      calculateMetadata={calcularRemix}
      durationInFrames={120}
      fps={30}
      width={704}
      height={1280}
    />
    <Composition
      id={COMPOSITION_ID}
      component={Criativo}
      schema={criativoSchema}
      defaultProps={base}
      calculateMetadata={calcular}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
    />
    <Folder name="Amostras">
      {AMOSTRAS.map((a) => (
        <Composition
          key={a.id}
          id={a.id}
          component={Criativo}
          schema={criativoSchema}
          defaultProps={a.props}
          calculateMetadata={calcular}
          durationInFrames={900}
          fps={30}
          width={1080}
          height={1920}
        />
      ))}
    </Folder>
  </>
);
