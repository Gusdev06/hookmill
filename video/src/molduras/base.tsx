// Peças comuns da composição Moldura: fontes, vídeo na caixa (timeline + reenquadramento), 2ª fonte, rosto redondo,
// entrada com spring, texto ajustado com destaque. Visual = protótipo aprovado em 25/10 (src/prototipos/molduras/base.tsx).
import React, { useEffect, useState } from 'react';
import {
  continueRender, delayRender, Freeze, Img, interpolate, Loop, OffthreadVideo, Sequence, spring, useCurrentFrame, useVideoConfig,
} from 'remotion';
import { carregarFontes, carregarFonteCatalogo, carregarFontesCJK, INTER, MONTSERRAT } from '../fontes';
import { FONT_CATALOG } from '../lib/remix';
import { resolverSrc } from '../componentes/midia';
import { trechosEmFrames } from '../lib/autoEdit';
import {
  FRAME_FONTS, corDaMarca, pinturaNaCaixa, reframeNaCaixa, type FittedText, type FrameFontKey, type FrameLayout, type FrameReframe, type MolduraProps, type Rect,
} from '../lib/molduras';

export const FONTE = {
  inter: INTER,
  mont: MONTSERRAT,
  anton: FONT_CATALOG['anton-400'].family,
  archivo: FONT_CATALOG['archivo-black-400'].family,
} as const;

/** Segura o primeiro frame até as fontes das molduras estarem carregadas. `texto` = todo o texto da peça: os pedaços CJK
 *  que ele usa (Noto do `language`) são baixados antes do 1º frame. */
export const useFontesMolduras = (texto = '', language = 'en') => {
  const [pronto, setPronto] = useState(false);
  const [handle] = useState(() => delayRender('fontes molduras'));
  useEffect(() => {
    Promise.all([carregarFontes(), carregarFonteCatalogo('anton-400'), carregarFonteCatalogo('archivo-black-400')])
      .then(() => carregarFontesCJK(language, texto))
      .then(() => { setPronto(true); continueRender(handle); })
      .catch((e) => { console.error(e); setPronto(true); continueRender(handle); });
  }, [handle]);
  return pronto;
};

/** Sombra de cartão em camadas. */
export const SOMBRA = {
  cartao: '0 2px 4px rgba(0,0,0,0.18), 0 12px 28px rgba(0,0,0,0.28), 0 40px 80px rgba(0,0,0,0.30)',
  leve: '0 1px 2px rgba(0,0,0,0.12), 0 8px 20px rgba(0,0,0,0.18)',
  texto: '0 2px 2px rgba(0,0,0,0.35), 0 6px 24px rgba(0,0,0,0.55)',
} as const;

/** 0 -> 1 com spring, começando em `atraso` frames. */
export const useEntrada = (atraso = 0, rigidez = 170, amortecimento = 16) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: f - atraso, fps, config: { damping: amortecimento, stiffness: rigidez, mass: 0.7 } });
};

type Direcao = 'baixo' | 'cima' | 'esquerda' | 'direita' | 'escala' | 'pop';
/** Entrada: desliza/escala com spring e aparece (~0,4 s). */
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

/** Texto com trechos *destacados*. */
export const Rico: React.FC<{ texto: string; destaque: React.CSSProperties }> = ({ texto, destaque }) => (
  <>
    {texto.split('*').map((parte, i) => (i % 2 === 1 ? <span key={i} style={destaque}>{parte}</span> : <React.Fragment key={i}>{parte}</React.Fragment>))}
  </>
);

/** Bloco de texto já ajustado pelo fitText (frameLayout). Quebra palavra longa em vez de vazar (nunca corta). */
export const Texto: React.FC<{
  fit: FittedText; fonte: FrameFontKey; largura: number; cor: string; destaque?: React.CSSProperties; caixaAlta?: boolean;
  alinhar?: 'left' | 'center' | 'right'; style?: React.CSSProperties;
}> = ({ fit, fonte, largura, cor, destaque = {}, caixaAlta, alinhar = 'left', style }) => {
  const f = FRAME_FONTS[fonte];
  const css: React.CSSProperties = {
    width: largura, fontFamily: f.family, fontWeight: f.weight, fontSize: fit.size, lineHeight: fit.lineHeight, color: cor, textAlign: alinhar,
    textTransform: caixaAlta ? 'uppercase' : 'none', overflowWrap: 'anywhere', ...style,
  };
  if (!fit.ranges) return <div style={css}><Rico texto={fit.text} destaque={destaque} /></div>;
  // CJK: as linhas do fitText (quebra por caractere + kinsoku), cada uma com a altura exata da linha
  const chars: { c: string; d: boolean }[] = [];
  let d = false;
  for (const c of fit.text) { if (c === '*') d = !d; else for (let k = 0; k < c.length; k++) chars.push({ c: c[k], d }); }
  const alturaLinha = Math.floor(fit.size * fit.lineHeight * 64) / 64;
  return (
    <div style={css}>
      {fit.ranges.map(([a, b], i) => {
        const partes: { t: string; d: boolean }[] = [];
        for (const x of chars.slice(a, b)) { const u = partes[partes.length - 1]; if (u && u.d === x.d) u.t += x.c; else partes.push({ t: x.c, d: x.d }); }
        return (
          <div key={i} style={{ height: alturaLinha, whiteSpace: 'pre' }}>
            {partes.map((p, j) => (p.d ? <span key={j} style={destaque}>{p.t}</span> : <React.Fragment key={j}>{p.t}</React.Fragment>))}
          </div>
        );
      })}
    </div>
  );
};

/** Degradê escuro pra dar leitura ao texto sobre vídeo. */
export const Veu: React.FC<{ de: 'cima' | 'baixo'; altura: number; forca?: number }> = ({ de, altura, forca = 0.75 }) => (
  <div style={{
    position: 'absolute', left: 0, right: 0, height: altura, [de === 'cima' ? 'top' : 'bottom']: 0,
    background: `linear-gradient(${de === 'cima' ? '180deg' : '0deg'}, rgba(0,0,0,${forca}) 0%, rgba(0,0,0,${forca * 0.55}) 45%, rgba(0,0,0,0) 100%)`,
  }} />
);

/** Grão leve (SVG feTurbulence, determinístico). */
export const Grao: React.FC<{ opacidade?: number }> = ({ opacidade = 0.07 }) => {
  const { width, height } = useVideoConfig();
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: opacidade, mixBlendMode: 'overlay', pointerEvents: 'none' }}>
      <filter id="grao"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} stitchTiles="stitch" /></filter>
      <rect width="100%" height="100%" filter="url(#grao)" />
    </svg>
  );
};

/** Seta que quica. */
export const useQuique = (amplitude = 10, periodo = 24) => {
  const f = useCurrentFrame();
  return Math.abs(Math.sin((f / periodo) * Math.PI)) * amplitude;
};

// ───────────────────────── vídeo ─────────────────────────

type Dim = { width: number; height: number };
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Push-in lento (1 -> zoom ao longo da peça), fora das Sequences: não salta na emenda nem no loop. */
const Zoom: React.FC<{ dim: Dim; reframe: FrameReframe; w: number; h: number; zoom: number; cb?: Rect | null; children: React.ReactNode }> = ({ dim, reframe, w, h, zoom, cb, children }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const escala = interpolate(f, [0, durationInFrames], [1, zoom]);
  const o = pinturaNaCaixa({ w, h }, dim, reframe, cb ?? null).origem;
  return <div style={{ position: 'absolute', inset: 0, transform: `scale(${escala})`, transformOrigin: `${o.x}px ${o.y}px` }}>{children}</div>;
};

/** Um vídeo pintado numa caixa w×h (relativa ao pai): só a contentBox (sem letterbox), em cover no foco. Se o zoom foi
 *  limitado pelo rosto, sobra o fundo da caixa (cor da marca); nunca borrado. */
const Pintura: React.FC<{
  src: string; dim: Dim; reframe: FrameReframe; w: number; h: number; trimBefore: number; trimAfter?: number; muted: boolean;
  volume?: (f: number) => number; filtro?: string; cb?: Rect | null;
}> = ({ src, dim, reframe, w, h, trimBefore, trimAfter, muted, volume, filtro, cb }) => {
  const p = pinturaNaCaixa({ w, h }, dim, reframe, cb ?? null);
  return (
    <div style={{ position: 'absolute', left: p.area.left, top: p.area.top, width: p.area.w, height: p.area.h, overflow: 'hidden' }}>
      <OffthreadVideo
        src={src} muted={muted} volume={muted ? undefined : volume} trimBefore={trimBefore || undefined} trimAfter={trimAfter}
        style={{ position: 'absolute', left: p.video.left, top: p.video.top, width: p.video.w, height: p.video.h, objectFit: 'fill', display: 'block', filter: filtro }}
      />
    </div>
  );
};

/** Fundo da caixa quando o vídeo não a preenche (zoom limitado pelo rosto): a cor da marca. */
const fundoDe = (p: MolduraProps, cheio: boolean) => (cheio ? '#111' : corDaMarca(p.frame.brand.color));

/** Largura da borda do estilo (o Remotion usa box-sizing: border-box: a borda come a caixa por dentro). */
const bordaDe = (e?: React.CSSProperties) => { const m = typeof e?.border === 'string' ? /([\d.]+)px/.exec(e.border) : null; return m ? Number(m[1]) : 0; };
/** Área interna da caixa (sem a borda). */
export const interna = (c: Rect, e?: React.CSSProperties): Rect => { const b = bordaDe(e); return { x: c.x, y: c.y, w: c.w - 2 * b, h: c.h - 2 * b }; };

/** Caixa do vídeo (posição absoluta no pai). `caixa` = rect no pai; estilo = sombra/borda/raio do template. */
export const Caixa: React.FC<{ caixa: Rect; raio?: number; estilo?: React.CSSProperties; fundo?: string; children: React.ReactNode }> = ({ caixa, raio = 0, estilo, fundo = '#111', children }) => (
  <div style={{ position: 'absolute', left: caixa.x, top: caixa.y, width: caixa.w, height: caixa.h, overflow: 'hidden', borderRadius: raio, backgroundColor: fundo, ...estilo }}>{children}</div>
);

/** O campeão (com áudio) emendado pelo timeline, dentro de uma caixa w×h. */
export const Principal: React.FC<{ p: MolduraProps; caixa: Rect; raio?: number; estilo?: React.CSSProperties; filtro?: string; zoom?: number; reframe?: FrameReframe }> = ({
  p, caixa, raio, estilo, filtro, zoom = 1.06, reframe,
}) => {
  const { fps } = useVideoConfig();
  const trechos = trechosEmFrames(p.video.timeline, fps);
  const src = resolverSrc(p.video.source.videoUrl);
  const rampa = (p.video.joinFadeMs / 1000) * fps;
  const dim = p.video.source;
  const r = reframe ?? p.video.reframe;
  const ci = interna(caixa, estilo);
  const cb = p.video.contentBox ?? null;
  const cheio = pinturaNaCaixa(ci, dim, r, cb).cheio;
  return (
    <Caixa caixa={caixa} raio={raio} estilo={estilo} fundo={fundoDe(p, cheio)}>
      <Zoom dim={dim} reframe={r} w={ci.w} h={ci.h} zoom={zoom} cb={cb}>
        {trechos.map((t, i) => (
          <Sequence key={i} from={t.at} durationInFrames={t.frames} layout="none" name={`Trecho ${i + 1}`}>
            <Pintura
              src={src} dim={dim} reframe={r} w={ci.w} h={ci.h} trimBefore={t.from} muted={!p.video.source.hasAudio} filtro={filtro} cb={cb}
              volume={rampa > 0 && trechos.length > 1 ? (f) => Math.min(interpolate(f, [0, rampa], [0, 1], clamp), interpolate(f, [t.frames - 1 - rampa, t.frames - 1], [1, 0], clamp)) : undefined}
            />
          </Sequence>
        ))}
      </Zoom>
    </Caixa>
  );
};

/** 2ª fonte (sempre muda): trecho do campeão, outro clipe, captura da página ou foto do produto. Sem `second`, o
 *  campeão 12 s à frente. Vídeo curto entra em loop. */
export const Segunda: React.FC<{ p: MolduraProps; caixa: Rect; raio?: number; estilo?: React.CSSProperties; zoom?: number }> = ({ p, caixa, raio, estilo, zoom = 1.06 }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const s = p.second;
  const ci = interna(caixa, estilo);
  const pinta = (url: string, dim: Dim, ini: number, fim: number, reframe: FrameReframe | undefined, cb: Rect | null) => {
    const r = reframe ?? reframeNaCaixa(ci, dim, null, 1080, cb);
    const a = Math.round(ini * fps), b = Math.round(fim * fps);
    const n = Math.max(1, b - a);
    const corpo = <Pintura src={resolverSrc(url)} dim={dim} reframe={r} w={ci.w} h={ci.h} trimBefore={a} trimAfter={b} muted cb={cb} />;
    return (
      <Caixa caixa={caixa} raio={raio} estilo={estilo} fundo={fundoDe(p, pinturaNaCaixa(ci, dim, r, cb).cheio)}>
        <Zoom dim={dim} reframe={r} w={ci.w} h={ci.h} zoom={zoom} cb={cb}>{n >= durationInFrames ? corpo : <Loop durationInFrames={n} layout="none">{corpo}</Loop>}</Zoom>
      </Caixa>
    );
  };
  const cbCampeao = p.video.contentBox ?? null;
  if (!s) {
    const d = p.video.source.durationSec;
    const ini = (p.video.timeline[0].startSec + 12) % d;
    return pinta(p.video.source.videoUrl, p.video.source, ini, d, undefined, cbCampeao);
  }
  if (s.kind === 'champion_segment') return pinta(p.video.source.videoUrl, p.video.source, s.startSec, s.endSec, s.reframe, cbCampeao);
  if (s.kind === 'clip') return pinta(s.videoUrl, s, s.startSec ?? 0, s.durationSec, s.reframe, null);
  if (s.kind === 'stock_broll') {
    // b-roll (Pexels etc.): com medidas, o mesmo cover/push-in do campeão; sem elas, cover pelo CSS com o mesmo push-in
    if (s.width && s.height) return pinta(s.fileUrl, { width: s.width, height: s.height }, 0, s.durationSec ?? p.video.source.durationSec, undefined, null);
    return <Broll url={s.fileUrl} durationSec={s.durationSec} caixa={caixa} raio={raio} estilo={estilo} zoom={zoom} />;
  }
  if (s.kind === 'product_photo') {
    return (
      <Caixa caixa={caixa} raio={raio} estilo={estilo} fundo="#F6F4EF">
        <Img src={resolverSrc(s.fileUrl)} style={{ position: 'absolute', inset: '6%', width: '88%', height: '88%', objectFit: 'contain' }} />
      </Caixa>
    );
  }
  return <Captura url={s.fileUrl} scroll={s.scroll} caixa={caixa} raio={raio} estilo={estilo} />;
};

/** b-roll sem medidas: cover pelo CSS, mudo, em loop se a duração for conhecida e menor que a peça. */
const Broll: React.FC<{ url: string; durationSec?: number; caixa: Rect; raio?: number; estilo?: React.CSSProperties; zoom: number }> = ({ url, durationSec, caixa, raio, estilo, zoom }) => {
  const f = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const n = durationSec ? Math.max(1, Math.floor(durationSec * fps)) : durationInFrames;
  const escala = interpolate(f, [0, durationInFrames], [1, zoom]);
  const v = <OffthreadVideo src={resolverSrc(url)} muted style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 40%' }} />;
  return (
    <Caixa caixa={caixa} raio={raio} estilo={estilo}>
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${escala})`, transformOrigin: '50% 40%' }}>{n >= durationInFrames ? v : <Loop durationInFrames={n} layout="none">{v}</Loop>}</div>
    </Caixa>
  );
};

const Captura: React.FC<{ url: string; scroll: boolean; caixa: Rect; raio?: number; estilo?: React.CSSProperties }> = ({ url, scroll, caixa, raio, estilo }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const y = scroll ? interpolate(f, [15, durationInFrames - 15], [0, 100], clamp) : 0;
  return (
    <Caixa caixa={caixa} raio={raio} estilo={estilo} fundo="#fff">
      <Img src={resolverSrc(url)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: `50% ${y}%` }} />
    </Caixa>
  );
};

/** Conteúdo do rosto redondo (preenche o pai): foto, ou frame do campeão recortado no rosto (face_crop). */
export const RostoImg: React.FC<{ p: MolduraProps }> = ({ p }) => {
  const { fps } = useVideoConfig();
  const r = p.face;
  if (!r) return null;
  if (r.kind === 'image') return <Img src={resolverSrc(r.url)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
  // quadrado de 1,7x o rosto, centrado nele (preso ao quadro): o rosto ocupa ~60 % do círculo
  const { width: sw, height: sh } = p.video.source;
  const lado = Math.min(sw, sh, 1.7 * Math.max(r.box.w * sw, r.box.h * sh));
  const cx = (r.box.x + r.box.w / 2) * sw, cy = (r.box.y + r.box.h / 2) * sh;
  const x0 = Math.min(sw - lado, Math.max(0, cx - lado / 2)), y0 = Math.min(sh - lado, Math.max(0, cy - lado / 2));
  const pct = (v: number) => `${(v / lado) * 100}%`;
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <Freeze frame={0}>
        <OffthreadVideo
          src={resolverSrc(p.video.source.videoUrl)} muted trimBefore={Math.round(r.atSec * fps) || undefined}
          style={{ position: 'absolute', left: pct(-x0), top: pct(-y0), width: pct(sw), height: pct(sh), objectFit: 'fill' }}
        />
      </Freeze>
    </div>
  );
};

/** Props comuns de cada template. */
export type PropsTpl<K extends MolduraProps['frame']['id']> = { p: MolduraProps & { frame: Extract<MolduraProps['frame'], { id: K }> }; L: FrameLayout; cor: string; ui: import('../lib/molduras').FrameUi };
