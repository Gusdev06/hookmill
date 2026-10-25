// Peças comuns das molduras (protótipo): fontes, vídeo numa caixa, entrada com spring, texto com destaque e ajuste de tamanho.
import React, { useEffect, useState } from 'react';
import { continueRender, delayRender, OffthreadVideo, spring, interpolate, useCurrentFrame, useVideoConfig, Img } from 'remotion';
import { measureText } from '@remotion/layout-utils';
import { carregarFontes, carregarFonteCatalogo, INTER, MONTSERRAT } from '../../fontes';
import { FONT_CATALOG } from '../../lib/remix';
import { resolverSrc } from '../../componentes/midia';

export const W = 1080;
export const H = 1920;
/** D6: 5 % em cima e 10 % embaixo livres de texto/interface no 9:16. Vídeo pode sangrar. */
export const SAFE = { top: 96, bottom: 192 } as const;
export const LIMITE_BAIXO = H - SAFE.bottom; // 1728

export const FONTE = {
  inter: INTER,
  mont: MONTSERRAT,
  anton: FONT_CATALOG['anton-400'].family,
  archivo: FONT_CATALOG['archivo-black-400'].family,
  bebas: FONT_CATALOG['bebas-neue-400'].family,
  oswald: FONT_CATALOG['oswald-700'].family,
  poppins: FONT_CATALOG['poppins-800'].family,
} as const;

/** Segura o primeiro frame até todas as fontes das molduras estarem carregadas (texto é medido com elas). */
export const useFontesMolduras = () => {
  const [pronto, setPronto] = useState(false);
  const [handle] = useState(() => delayRender('fontes molduras'));
  useEffect(() => {
    Promise.all([
      carregarFontes(),
      ...(['anton-400', 'archivo-black-400', 'bebas-neue-400', 'oswald-700', 'poppins-800'] as const).map(carregarFonteCatalogo),
    ])
      .then(() => { setPronto(true); continueRender(handle); })
      .catch((e) => { console.error(e); setPronto(true); continueRender(handle); });
  }, [handle]);
  return pronto;
};

export type Caixa = { x: number; y: number; w: number; h: number };

/** Vídeo em cover dentro de uma caixa, com push-in lento (1 -> 1.06 na peça). `som` só no principal. */
export const VideoNaCaixa: React.FC<{
  src: string; caixa: Caixa | 'cheia'; som?: boolean; inicioSec?: number; foco?: { x: number; y: number };
  raio?: number; estilo?: React.CSSProperties; zoom?: number; filtro?: string;
}> = ({ src, caixa, som = false, inicioSec = 0, foco = { x: 0.5, y: 0.35 }, raio = 0, estilo, zoom = 1.06, filtro }) => {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const escala = interpolate(f, [0, durationInFrames], [1, zoom]);
  return (
    <div style={{ position: 'absolute', ...(caixa === 'cheia' ? { inset: 0 } : { left: caixa.x, top: caixa.y, width: caixa.w, height: caixa.h }), overflow: 'hidden', borderRadius: raio, backgroundColor: '#111', ...estilo }}>
      <OffthreadVideo
        src={resolverSrc(src)}
        muted={!som}
        trimBefore={Math.round(inicioSec * fps) || undefined}
        style={{
          width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${foco.x * 100}% ${foco.y * 100}%`,
          transform: `scale(${escala})`, transformOrigin: `${foco.x * 100}% ${foco.y * 100}%`, filter: filtro,
        }}
      />
    </div>
  );
};

export const Foto: React.FC<{ src: string; style?: React.CSSProperties }> = ({ src, style }) => (
  <Img src={resolverSrc(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', ...style }} />
);

/** 0 -> 1 com spring, começando em `atraso` frames. */
export const useEntrada = (atraso = 0, rigidez = 170, amortecimento = 16) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - atraso, fps, config: { damping: amortecimento, stiffness: rigidez, mass: 0.7 } });
};

type Direcao = 'baixo' | 'cima' | 'esquerda' | 'direita' | 'escala' | 'pop';
/** Wrapper de entrada: desliza/escala com spring e aparece. Duração efetiva ~0,4 s. */
export const Entra: React.FC<{ atraso?: number; de?: Direcao; dist?: number; style?: React.CSSProperties; children: React.ReactNode; rot?: number }> = ({
  atraso = 0, de = 'baixo', dist = 60, style, children, rot = 0,
}) => {
  const e = useEntrada(atraso, de === 'pop' ? 220 : 170, de === 'pop' ? 11 : 16);
  const o = Math.min(1, Math.max(0, e * 1.6));
  const t =
    de === 'baixo' ? `translateY(${(1 - e) * dist}px)` :
    de === 'cima' ? `translateY(${-(1 - e) * dist}px)` :
    de === 'esquerda' ? `translateX(${-(1 - e) * dist}px)` :
    de === 'direita' ? `translateX(${(1 - e) * dist}px)` :
    de === 'pop' ? `scale(${0.4 + 0.6 * e})` : `scale(${0.88 + 0.12 * e})`;
  return <div style={{ opacity: o, transform: `${t}${rot ? ` rotate(${rot}deg)` : ''}`, ...style }}>{children}</div>;
};

/** Texto com trechos *destacados*. `destaque` = estilo do trecho. */
export const Rico: React.FC<{ texto: string; destaque: React.CSSProperties }> = ({ texto, destaque }) => (
  <>
    {texto.split('*').map((parte, i) => (i % 2 === 1 ? <span key={i} style={destaque}>{parte}</span> : <React.Fragment key={i}>{parte}</React.Fragment>))}
  </>
);

/** Maior tamanho (entre min e max) em que o texto cabe em `largura` com no máximo `linhas` linhas (quebra gulosa por palavra).
 *  Base do `fitText` do B1. Mede sem os asteriscos de destaque. */
export const tamanhoQueCabe = (texto: string, o: { fonte: string; peso: number; largura: number; linhas: number; max: number; min: number; caixaAlta?: boolean; espaco?: number }) => {
  const limpo = texto.replace(/\*/g, '');
  const palavras = limpo.split(/\s+/).filter(Boolean);
  for (let s = o.max; s >= o.min; s -= 2) {
    const m = (t: string) => measureText({ text: t, fontFamily: o.fonte, fontSize: s, fontWeight: String(o.peso), letterSpacing: o.espaco ? `${o.espaco}em` : undefined, textTransform: o.caixaAlta ? 'uppercase' : 'none' }).width;
    let linhas = 1; let atual = '';
    let ok = true;
    for (const p of palavras) {
      const tentativa = atual ? `${atual} ${p}` : p;
      if (m(tentativa) <= o.largura) { atual = tentativa; continue; }
      if (m(p) > o.largura) { ok = false; break; }
      linhas += 1; atual = p;
    }
    if (ok && linhas <= o.linhas) return s;
  }
  return o.min;
};

/** Sombra de cartão em camadas (ar de agência, não drop-shadow único). */
export const SOMBRA = {
  cartao: '0 2px 4px rgba(0,0,0,0.18), 0 12px 28px rgba(0,0,0,0.28), 0 40px 80px rgba(0,0,0,0.30)',
  leve: '0 1px 2px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.18)',
  texto: '0 2px 2px rgba(0,0,0,0.35), 0 6px 24px rgba(0,0,0,0.55)',
} as const;

/** Degradê escuro pra dar leitura ao texto sobre vídeo. */
export const Veu: React.FC<{ de: 'cima' | 'baixo'; altura: number; forca?: number }> = ({ de, altura, forca = 0.75 }) => (
  <div style={{
    position: 'absolute', left: 0, right: 0, height: altura, [de === 'cima' ? 'top' : 'bottom']: 0,
    background: `linear-gradient(${de === 'cima' ? '180deg' : '0deg'}, rgba(0,0,0,${forca}) 0%, rgba(0,0,0,${forca * 0.55}) 45%, rgba(0,0,0,0) 100%)`,
  }} />
);

/** Grão leve (deixa fundos chapados menos "template"). SVG feTurbulence, determinístico. */
export const Grao: React.FC<{ opacidade?: number }> = ({ opacidade = 0.07 }) => (
  <svg width={W} height={H} style={{ position: 'absolute', inset: 0, opacity: opacidade, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
    <filter id="grao"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" /></filter>
    <rect width="100%" height="100%" filter="url(#grao)" />
  </svg>
);

/** Bloco de texto que se ajusta (tamanhoQueCabe) e aceita *destaque*. */
export const TextoAjustado: React.FC<{
  texto: string; fonte: string; peso: number; largura: number; linhas: number; max: number; min: number;
  cor: string; destaque?: React.CSSProperties; caixaAlta?: boolean; espaco?: number; altura?: number;
  alinhar?: 'left' | 'center' | 'right'; style?: React.CSSProperties;
}> = ({ texto, fonte, peso, largura, linhas, max, min, cor, destaque = {}, caixaAlta, espaco, altura = 1.12, alinhar = 'left', style }) => {
  const s = tamanhoQueCabe(texto, { fonte, peso, largura, linhas, max, min, caixaAlta, espaco });
  return (
    <div style={{
      width: largura, fontFamily: fonte, fontWeight: peso, fontSize: s, lineHeight: altura, color: cor, textAlign: alinhar,
      textTransform: caixaAlta ? 'uppercase' : 'none', letterSpacing: espaco ? `${espaco}em` : undefined, ...style,
    }}>
      <Rico texto={texto} destaque={destaque} />
    </div>
  );
};

/** Vídeo principal (com som) e 2ª fonte (muda) a partir das midias. */
export const Principal: React.FC<{ m: import('./tipos').MidiasMoldura; caixa: Caixa | 'cheia'; raio?: number; foco?: { x: number; y: number }; estilo?: React.CSSProperties; filtro?: string; zoom?: number }> = ({ m, caixa, raio, foco, estilo, filtro, zoom }) => (
  <VideoNaCaixa src={m.principal.src} inicioSec={m.principal.inicioSec} foco={foco ?? m.principal.foco} som caixa={caixa} raio={raio} estilo={estilo} filtro={filtro} zoom={zoom} />
);
export const Segunda: React.FC<{ m: import('./tipos').MidiasMoldura; caixa: Caixa | 'cheia'; raio?: number; foco?: { x: number; y: number }; estilo?: React.CSSProperties; filtro?: string }> = ({ m, caixa, raio, foco, estilo, filtro }) => {
  const s = m.segunda ?? m.principal;
  return <VideoNaCaixa src={s.src} inicioSec={m.segunda ? s.inicioSec : (s.inicioSec ?? 0) + 12} foco={foco ?? s.foco} caixa={caixa} raio={raio} estilo={estilo} filtro={filtro} />;
};

/** Seta que quica (CTA "toque no botão"). */
export const useQuique = (amplitude = 10, periodo = 24) => {
  const f = useCurrentFrame();
  return Math.abs(Math.sin((f / periodo) * Math.PI)) * amplitude;
};
