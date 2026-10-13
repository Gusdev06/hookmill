import React from 'react';
import { AbsoluteFill, OffthreadVideo, interpolate, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import type { EstiloTemplate } from '../estilos';
import { linhaDoTempo, type CriativoProps } from '../lib';
import { resolverSrc } from './midia';

const CenaClip: React.FC<{ src: string; index: number; durationInFrames: number; trimBefore: number; estilo: EstiloTemplate }> = ({ src, index, durationInFrames, trimBefore, estilo }) => {
  const frame = useCurrentFrame();
  const base = estilo.zoomPorCena[index % 2];
  return (
    <AbsoluteFill
      style={{
        scale: base * interpolate(frame, [0, durationInFrames], [1, estilo.pushIn], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
      }}
    >
      <OffthreadVideo src={src} trimBefore={trimBefore || undefined} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
};

/** Emenda as cenas em corte seco, na ordem, cada uma com a própria duração (o áudio vem do clipe). */
export const Cenas: React.FC<{ scenes: CriativoProps['scenes']; estilo: EstiloTemplate }> = ({ scenes, estilo }) => {
  const { fps } = useVideoConfig();
  const linha = linhaDoTempo(scenes, fps);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000', overflow: 'hidden' }}>
      {linha.map((c) => (
        <Sequence key={c.index} name={`Cena ${c.index + 1}`} from={c.fromFrame} durationInFrames={c.durationInFrames} premountFor={fps}>
          <CenaClip src={resolverSrc(c.clipUrl)} index={c.index} durationInFrames={c.durationInFrames} trimBefore={Math.round((scenes[c.index].clipStartSec ?? 0) * fps)} estilo={estilo} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
