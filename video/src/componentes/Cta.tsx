import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { alinhamento, ESCALA_TIPO, fonteDoEstilo, raioDoFundo, textoComContorno, type EstiloTemplate } from '../estilos';
import { pct, type LayerStyle, type LayerTransform, type VideoFormat } from '../lib';
import { Seta } from './Seta';

/** Botão de CTA sobre a fala, nos últimos segundos das cenas. Posição = `transform` (centro x/y; boxWidth = largura máx. do botão). */
export const Cta: React.FC<{ texto: string; format: VideoFormat; estilo: EstiloTemplate; transform: LayerTransform; estiloCamada?: LayerStyle }> = ({ texto, format, estilo, transform: t, estiloCamada: s }) => {
  const frame = useCurrentFrame();
  const { height, durationInFrames, fps } = useVideoConfig();
  const fontSize = Math.round(50 * ESCALA_TIPO[format]);
  const folga = s && s.align !== 'center' ? Math.max(0, 0.5 - t.boxWidth / 2) : 0;
  const pulso = 1 + 0.025 * Math.sin(((frame - 10) / fps) * Math.PI * 2 * 1.1) * (frame > 10 ? 1 : 0);
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        data-layer="cta"
        style={{
          position: 'absolute',
          // faixa da largura do canvas centrada em x (padrão: 0..100 %); o botão centra nela e quebra em boxWidth
          left: pct(t.x - 0.5),
          right: pct(0.5 - t.x),
          top: t.y * height,
          translate: '0 -50%',
          display: 'flex',
          justifyContent: s ? alinhamento(s).justifyContent : 'center',
          // align esquerda/direita (editor): a pílula encosta na borda da caixa boxWidth centrada em x, não na da faixa
          ...(folga ? (s!.align === 'left' ? { paddingLeft: pct(folga) } : { paddingRight: pct(folga) }) : {}),
          scale: t.scale !== 1 ? String(t.scale) : undefined,
          rotate: t.rotationDeg ? `${t.rotationDeg}deg` : undefined,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45em',
            ...(s
              ? {
                  backgroundColor: s.background.kind === 'none' ? 'transparent' : (s.background.color ?? 'transparent'),
                  color: s.color,
                  ...fonteDoEstilo(s),
                  textTransform: s.uppercase ? 'uppercase' : 'none',
                  borderRadius: raioDoFundo(s, '0.3em'),
                  boxShadow: s.shadow && s.background.kind !== 'none' ? '0 16px 40px rgba(0,0,0,0.35)' : undefined,
                  textShadow: s.shadow && s.background.kind === 'none' ? '0 4px 18px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.6)' : undefined,
                  ...(s.strokeColor && s.strokeWidthPx > 0 ? textoComContorno(s.strokeColor, s.strokeWidthPx) : {}),
                }
              : {
                  backgroundColor: estilo.cta.fundo,
                  color: estilo.cta.cor,
                  fontFamily: estilo.cta.fontFamily,
                  fontWeight: estilo.cta.fontWeight,
                  textTransform: estilo.cta.upper ? 'uppercase' : 'none',
                  borderRadius: 999,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
                }),
            fontSize,
            // % da faixa sem o padding: continua boxWidth × largura do canvas (sem align, folga 0 = o de sempre)
            maxWidth: pct(t.boxWidth / (1 - folga)),
            padding: '0.5em 0.95em',
            opacity: interpolate(frame, [0, 5, durationInFrames - 4, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            scale:
              interpolate(frame, [0, 9], [0.7, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.34, 1.56, 0.64, 1) }) * pulso,
          }}
        >
          <span style={{ textAlign: s ? alinhamento(s).textAlign : 'center', lineHeight: 1.1 }}>{texto}</span>
          <Seta cor={s ? s.color : estilo.cta.cor} tamanho={Math.round(fontSize * 0.95)} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
