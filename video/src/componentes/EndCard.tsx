import React from 'react';
import { AbsoluteFill, OffthreadVideo, Easing, Freeze, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { ESCALA_TIPO, type EstiloTemplate } from '../estilos';
import type { VideoFormat } from '../lib';
import { resolverSrc } from './midia';
import { Seta } from './Seta';

/** Cartão final: último quadro congelado e desfocado ao fundo + CTA grande. Sem áudio.
 *  `trimBefore` = clipStartSec da última cena em frames (fatia de take ou corte do editor), igual à CenaClip: sem ele o
 *  quadro congelado vinha do começo do clipe, não do fim da cena. */
export const EndCard: React.FC<{ texto: string; format: VideoFormat; estilo: EstiloTemplate; ultimoClipe: string; ultimoFrame: number; trimBefore?: number }> = ({
  texto,
  format,
  estilo,
  ultimoClipe,
  ultimoFrame,
  trimBefore,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fontSize = Math.round(86 * ESCALA_TIPO[format] * (texto.length > 28 ? 0.8 : 1));
  const curva = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;
  return (
    <AbsoluteFill style={{ backgroundColor: estilo.endCard.fundo, overflow: 'hidden' }}>
      <AbsoluteFill style={{ filter: 'blur(36px)', scale: 1.15 }}>
        <Freeze frame={ultimoFrame}>
          <OffthreadVideo src={resolverSrc(ultimoClipe)} trimBefore={trimBefore || undefined} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Freeze>
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: estilo.endCard.fundo, opacity: interpolate(frame, [0, 8], [0.3, 0.84], curva) }} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 9%' }}>
        <div
          style={{
            color: estilo.endCard.cor,
            fontFamily: estilo.endCard.fontFamily,
            fontWeight: 900,
            fontSize,
            lineHeight: 1.05,
            letterSpacing: '-0.03em',
            textAlign: 'center',
            textTransform: estilo.cta.upper ? 'uppercase' : 'none',
            opacity: interpolate(frame, [3, 12], [0, 1], curva),
            translate: `0 ${interpolate(frame, [3, 14], [40, 0], curva)}px`,
          }}
        >
          {texto}
        </div>
        <div
          style={{
            marginTop: fontSize * 0.6,
            width: fontSize * 1.5,
            height: fontSize * 1.5,
            borderRadius: 999,
            backgroundColor: estilo.endCard.corDestaque,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: interpolate(frame, [8, 16], [0, 1], curva),
            scale: interpolate(frame, [8, 18], [0.5, 1], { ...curva, easing: Easing.bezier(0.34, 1.56, 0.64, 1) }),
            translate: `${Math.sin((frame / fps) * Math.PI * 2) * 8}px 0`,
          }}
        >
          <Seta cor={estilo.endCard.fundo} tamanho={Math.round(fontSize * 0.8)} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
