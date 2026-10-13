import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { alinhamento, ESCALA_TIPO, fonteDoEstilo, raioDoFundo, textoComContorno, type EstiloTemplate } from '../estilos';
import { caixaHorizontal, type LayerStyle, type LayerTransform, type VideoFormat } from '../lib';

/** Gancho escrito nos 3 s iniciais (template headline). Posição = `transform` (padrão: topo, 7 % de margem; layoutPadrao).
 *  `estiloCamada` (editor): fonte, cor, fundo, contorno, sombra, caixa alta e alinhamento; ausente = visual do template. */
export const Gancho: React.FC<{ texto: string; format: VideoFormat; estilo: EstiloTemplate; transform: LayerTransform; estiloCamada?: LayerStyle }> = ({ texto, format, estilo, transform: t, estiloCamada: s }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, height } = useVideoConfig();
  const fontSize = Math.round(64 * ESCALA_TIPO[format] * (texto.length > 60 ? 0.85 : 1));
  const entra = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) } as const;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        data-layer="hook"
        style={{
          position: 'absolute',
          ...caixaHorizontal(t),
          top: t.y * height,
          translate: `0 ${interpolate(frame, [0, 10], [-40, 0], entra) - 50}%`,
          display: 'flex',
          justifyContent: s ? alinhamento(s).justifyContent : 'center',
          opacity: interpolate(frame, [0, 6, durationInFrames - 6, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          scale: interpolate(frame, [0, 10], [0.92, 1], entra) * t.scale,
          rotate: t.rotationDeg ? `${t.rotationDeg}deg` : undefined,
        }}
      >
        <div
          style={
            s
              ? {
                  backgroundColor: s.background.kind === 'none' ? 'transparent' : (s.background.color ?? 'transparent'),
                  color: s.color,
                  ...fonteDoEstilo(s),
                  fontSize,
                  lineHeight: 1.12,
                  letterSpacing: '-0.025em',
                  textAlign: alinhamento(s).textAlign,
                  textTransform: s.uppercase ? 'uppercase' : 'none',
                  padding: '0.42em 0.6em',
                  borderRadius: raioDoFundo(s, 28),
                  boxShadow: s.shadow && s.background.kind !== 'none' ? '0 18px 50px rgba(0,0,0,0.35)' : undefined,
                  textShadow: s.shadow && s.background.kind === 'none' ? '0 4px 18px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.6)' : undefined,
                  ...(s.strokeColor && s.strokeWidthPx > 0 ? textoComContorno(s.strokeColor, s.strokeWidthPx) : {}),
                  borderBottom: s.background.kind === 'box' ? `10px solid ${estilo.endCard.corDestaque === '#FFFFFF' ? '#0A0A0A' : estilo.endCard.corDestaque}` : undefined,
                }
              : {
                  backgroundColor: '#FFFFFF',
                  color: '#0A0A0A',
                  fontFamily: estilo.legenda.fontFamily,
                  fontWeight: 800,
                  fontSize,
                  lineHeight: 1.12,
                  letterSpacing: '-0.025em',
                  textAlign: 'center',
                  padding: '0.42em 0.6em',
                  borderRadius: 28,
                  boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
                  borderBottom: `10px solid ${estilo.endCard.corDestaque === '#FFFFFF' ? '#0A0A0A' : estilo.endCard.corDestaque}`,
                }
          }
        >
          {texto}
        </div>
      </div>
    </AbsoluteFill>
  );
};
