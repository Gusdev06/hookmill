// Molduras de 2 fontes (fase B2). Visual = protótipo aprovado (src/prototipos/molduras/formatos/duas-fontes.tsx); a 2ª
// fonte é sempre muda, o áudio é do campeão. Posições e tamanhos vêm do frameLayout.
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { resolverSrc } from '../componentes/midia';
import { Entra, FONTE, Principal, RostoImg, Segunda, SOMBRA, Texto, useEntrada, type PropsTpl } from './base';
import { Balao, Brilho, Camera, Check, Coracao, Desligar, Enviar, Estouro, Joinha, Mais, Mao, MicMudo, Microfone, Salvar, Sorriso, Tela } from './icones';
import { MarcaLua } from './um-video';
import type { FrameLayout, MolduraProps, Rect } from '../lib/molduras';

const M = 60;

/** Foto redonda (face_crop) com borda e sombra, entra com pop. */
const Rosto: React.FC<{ p: MolduraProps; caixa: Rect; borda: string; atraso?: number; anel?: string }> = ({ p, caixa, borda, atraso = 14, anel }) => {
  const d = caixa.w;
  return (
    <div style={{ position: 'absolute', left: caixa.x, top: caixa.y, width: d, height: d }}>
      <Entra de="pop" atraso={atraso}>
        <div style={{ width: d, height: d, borderRadius: 999, padding: anel ? 8 : 0, background: anel, boxShadow: SOMBRA.cartao }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', border: `8px solid ${borda}`, backgroundColor: '#ccc' }}>
            <RostoImg p={p} />
          </div>
        </div>
      </Entra>
    </div>
  );
};

/** 2 vídeos lado a lado (campeão à esquerda), nas caixas do layout. */
const LadoALado: React.FC<{ p: MolduraProps; L: FrameLayout; raio?: number; borda?: string; atraso?: number }> = ({ p, L, raio = 24, borda, atraso = 6 }) => {
  const est: React.CSSProperties = { boxShadow: SOMBRA.cartao, ...(borda ? { border: `8px solid ${borda}` } : {}) };
  return (
    <>
      <Entra de="esquerda" atraso={atraso} dist={80} style={{ position: 'absolute', inset: 0 }}>
        <Principal p={p} caixa={L.videoBox} raio={raio} estilo={est} />
      </Entra>
      <Entra de="direita" atraso={atraso + 4} dist={80} style={{ position: 'absolute', inset: 0 }}>
        <Segunda p={p} caixa={L.secondBox!} raio={raio} estilo={est} />
      </Entra>
    </>
  );
};

// ---------------------------------------------------------------- Choquei (gossip_page), sem selo de verificado (D9)
export const Choquei: React.FC<PropsTpl<'gossip_page'>> = ({ p, L, ui }) => {
  const t = p.frame.texts;
  const ini = t.pageName.split(' ').filter((x) => x.length > 2).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const cinza = '#A1A1AA';
  const { n } = L;
  const ic = L.slots.icons;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B0B0D' }}>
      <div style={{ position: 'absolute', left: M, width: L.canvas.w - 2 * M, top: n.top, display: 'flex', flexDirection: 'column', gap: n.gap }}>
        <Entra atraso={0} dist={30}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <div style={{ width: n.avatar, height: n.avatar, borderRadius: 999, padding: 5, background: 'linear-gradient(135deg, #FACC15, #EF4444)' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#111', border: '4px solid #0B0B0D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.initSize, color: '#FACC15' }}>{ini}</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.nameSize, color: '#fff' }}>{t.pageName}</span>
              <span style={{ fontFamily: FONTE.inter, fontWeight: 600, fontSize: n.subSize, color: cinza }}>{ui.now}</span>
            </div>
            <Mais tam={n.dots} cor="#fff" />
          </div>
        </Entra>
        <Entra atraso={4}>
          <Texto fit={L.text.headline} fonte="inter-600" largura={L.canvas.w - 2 * M} cor="#E4E4E7" destaque={{ fontWeight: 800, color: '#fff', backgroundColor: 'rgba(250,204,21,0.22)', boxShadow: 'inset 0 -0.18em 0 rgba(250,204,21,0.9)' }} />
        </Entra>
      </div>
      <LadoALado p={p} L={L} raio={n.radius} />
      <Rosto p={p} caixa={L.faceBox!} borda="#0B0B0D" anel="linear-gradient(135deg, #FACC15, #EF4444)" />
      <div style={{ position: 'absolute', left: ic.x, width: ic.w, top: ic.y, display: 'flex', alignItems: 'center', gap: 40 }}>
        <Coracao tam={n.icon} cor="#fff" /><Balao tam={n.icon} cor="#fff" /><Enviar tam={n.icon - 2} cor="#fff" />
        <div style={{ flex: 1 }} /><Salvar tam={n.icon - 2} cor="#fff" />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Tela dividida (split_stack)
export const TelaDividida: React.FC<PropsTpl<'split_stack'>> = ({ p, L }) => {
  const H = L.canvas.h, W = L.canvas.w;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Entra de="cima" atraso={0} dist={60} style={{ position: 'absolute', inset: 0 }}>
        <Principal p={p} caixa={L.videoBox} />
      </Entra>
      <Entra de="baixo" atraso={3} dist={60} style={{ position: 'absolute', inset: 0 }}>
        <Segunda p={p} caixa={L.secondBox!} />
      </Entra>
      <div style={{ position: 'absolute', left: 0, width: W, top: H / 2 - 150, height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Entra de="escala" atraso={8} rot={-2}>
          <div style={{ backgroundColor: '#E5231B', padding: `${L.n.bandPadY}px 50px`, boxShadow: '0 10px 0 rgba(0,0,0,0.35), 0 24px 60px rgba(0,0,0,0.45)', width: 1000 }}>
            <Texto fit={L.text.headline} fonte="montserrat-900" largura={900} caixaAlta cor="#fff" alinhar="center" style={{ letterSpacing: '-0.01em' }} destaque={{ color: '#FFE14D' }} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Tela dividida 2 (split_torn): faixa de papel rasgado
const rasgo = (largura: number, altura: number, semente: number) => {
  let s = semente;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const passo = 26;
  const topo: string[] = []; const base: string[] = [];
  for (let x = 0; x <= largura; x += passo) topo.push(`${x},${4 + r() * 18}`);
  for (let x = largura; x >= 0; x -= passo) base.push(`${x},${altura - 4 - r() * 18}`);
  return [...topo, ...base].join(' ');
};
export const TelaDividida2: React.FC<PropsTpl<'split_torn'>> = ({ p, L }) => {
  const larg = L.n.stripW; const alt = L.n.stripH;
  const W = L.canvas.w, H = L.canvas.h;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Entra de="cima" atraso={0} dist={60} style={{ position: 'absolute', inset: 0 }}>
        <Principal p={p} caixa={L.videoBox} />
      </Entra>
      <Entra de="baixo" atraso={3} dist={60} style={{ position: 'absolute', inset: 0 }}>
        <Segunda p={p} caixa={L.secondBox!} />
      </Entra>
      <div style={{ position: 'absolute', left: (W - larg) / 2, top: H / 2 - alt / 2, width: larg, height: alt }}>
        <Entra de="escala" atraso={8} rot={1.6}>
          <div style={{ position: 'relative', width: larg, height: alt, filter: 'drop-shadow(0 14px 22px rgba(0,0,0,0.5))' }}>
            <svg width={larg} height={alt} style={{ position: 'absolute', inset: 0 }}>
              <defs>
                <linearGradient id="papel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FBF8F1" /><stop offset="1" stopColor="#EDE6D6" /></linearGradient>
              </defs>
              <polygon points={rasgo(larg, alt, 7)} fill="url(#papel)" />
            </svg>
            <div style={{ position: 'absolute', left: 150, top: -14, width: 130, height: 46, backgroundColor: 'rgba(255,240,170,0.75)', transform: 'rotate(-8deg)' }} />
            <div style={{ position: 'absolute', right: 150, bottom: -12, width: 130, height: 46, backgroundColor: 'rgba(255,240,170,0.75)', transform: 'rotate(6deg)' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Texto fit={L.text.headline} fonte="archivo-black-400" largura={900} cor="#141414" alinhar="center"
                destaque={{ backgroundColor: '#FFE14D', padding: '0 10px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }} />
            </div>
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Chamada de vídeo genérica (call, call_dialog)
const CORES_CALL = { fundo: '#1B1C20', tile: '#2A2B31', texto: '#E8EAED', destaque: '#6EE7B7', vermelho: '#EA4335' };

const BarraTopo: React.FC<{ titulo: string; L: FrameLayout }> = ({ titulo, L }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = 8 * 60 + 41 + Math.floor(f / fps);
  const { n } = L;
  return (
    <Entra de="cima" atraso={0} dist={30} style={{ position: 'absolute', left: 40, right: 40, top: n.barTop, height: n.barH, display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ width: 16, height: 16, borderRadius: 99, backgroundColor: CORES_CALL.vermelho }} />
      <span style={{ flex: 1, fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.titleSize, color: CORES_CALL.texto, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</span>
      <span style={{ fontFamily: FONTE.inter, fontWeight: 600, fontSize: n.timerSize, color: '#9AA0A6', fontVariantNumeric: 'tabular-nums' }}>{`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`}</span>
    </Entra>
  );
};

const Controles: React.FC<{ L: FrameLayout }> = ({ L }) => {
  const { n } = L;
  const ic = n.ctrlIcon;
  const b = (filho: React.ReactNode, fundo = '#3C4043', largura = n.ctrl) => (
    <div style={{ width: largura, height: n.ctrl, borderRadius: 999, backgroundColor: fundo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{filho}</div>
  );
  return (
    <Entra atraso={10} dist={40} style={{ position: 'absolute', left: 40, right: 40, top: n.ctrlY, height: n.ctrl, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      {b(<Microfone tam={ic} cor="#fff" />)}{b(<Camera tam={ic} cor="#fff" />)}{b(<Sorriso tam={ic} cor="#fff" />)}
      {b(<Tela tam={ic} cor="#fff" />)}{b(<Mao tam={ic} cor="#fff" />)}{b(<Desligar tam={ic + 6} cor="#fff" />, CORES_CALL.vermelho, n.hangW)}
    </Entra>
  );
};

const Etiqueta: React.FC<{ nome: string; mudo?: boolean; menor?: boolean }> = ({ nome, mudo, menor }) => (
  <div style={{ position: 'absolute', left: 22, bottom: 22, display: 'flex', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, padding: '10px 20px' }}>
    {mudo ? <MicMudo tam={menor ? 28 : 32} cor="#fff" /> : <Microfone tam={menor ? 28 : 32} cor={CORES_CALL.destaque} />}
    <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: menor ? 28 : 32, color: '#fff' }}>{nome}</span>
  </div>
);

/** Moldura do quadro de quem fala: anel que pulsa leve. */
const anelFala = (f: number, ativo: boolean) => (ativo ? `0 0 0 ${5 + 2 * Math.abs(Math.sin(f / 6))}px ${CORES_CALL.destaque}` : 'none');

const REACOES = [Coracao, Joinha, Brilho, Coracao, Sorriso, Joinha];
const Reacoes: React.FC<{ base: number; x0: number; subida: number }> = ({ base, x0, subida }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fc = f % (8 * fps); // recomeça a cada 8 s
  return (
    <>
      {REACOES.map((Ic, i) => {
        const ini = 30 + i * 28; const d = 70; const t = fc - ini;
        if (t < 0 || t > d) return null;
        const pr = t / d;
        return (
          <div key={i} style={{ position: 'absolute', left: x0 + ((i * 97) % 220) + Math.sin(pr * 6 + i) * 18, top: base - pr * subida, opacity: interpolate(pr, [0, 0.15, 0.8, 1], [0, 1, 1, 0]) }}>
            <div style={{ width: 84, height: 84, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: SOMBRA.leve }}>
              <Ic tam={46} cor={i % 3 === 0 ? '#E11D48' : i % 3 === 1 ? '#2563EB' : '#D97706'} />
            </div>
          </div>
        );
      })}
    </>
  );
};

/** Foto do produto / captura da página dentro do slide (a "apresentação" da chamada, 2ª fonte do §B3). */
const SlideImagem: React.FC<{ p: MolduraProps; style?: React.CSSProperties }> = ({ p, style }) => {
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const s = p.second;
  if (!s || (s.kind !== 'product_photo' && s.kind !== 'page_capture')) return null;
  const foto = s.kind === 'product_photo';
  const y = !foto && s.scroll ? interpolate(f, [15, durationInFrames - 15], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  return (
    <Entra de="escala" atraso={14} style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: '#fff', border: '1.5px solid #E2DED3', boxShadow: SOMBRA.leve, position: 'relative', flexShrink: 0, ...style }}>
      <Img src={resolverSrc(s.fileUrl)} style={{ position: 'absolute', inset: foto ? '7%' : 0, width: foto ? '86%' : '100%', height: foto ? '86%' : '100%', objectFit: foto ? 'contain' : 'cover', objectPosition: foto ? '50% 50%' : `50% ${y}%` }} />
    </Entra>
  );
};

// Correção do protótipo: o slide tem a altura do conteúdo (sem a faixa vazia entre os passos e a barra) e a pessoa
// ganha o resto. No 1:1, slide e pessoa lado a lado.
export const Meet: React.FC<PropsTpl<'call'>> = ({ p, L, cor, ui }) => {
  const f = useCurrentFrame();
  const t = p.frame.texts;
  const { n, videoBox: v } = L;
  const sl = L.slots.slide;
  const lado = L.format === 'SQUARE_1_1';
  return (
    <AbsoluteFill style={{ backgroundColor: CORES_CALL.fundo }}>
      <BarraTopo titulo={t.title} L={L} />
      <Entra de="escala" atraso={3} style={{ position: 'absolute', left: sl.x, top: sl.y, width: sl.w, height: sl.h }}>
        <div style={{ width: '100%', height: '100%', borderRadius: n.radius, overflow: 'hidden', backgroundColor: '#F6F4EF', boxShadow: SOMBRA.cartao, position: 'relative', padding: `${n.padY}px ${n.padX}px`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: n.inner }}>
          <MarcaLua nome={p.frame.brand.name} cor={cor} h={n.brandH} tam={n.brandSize} />
          <Texto fit={L.text.title} fonte="montserrat-900" largura={sl.w - 2 * n.padX} cor="#14162B" style={{ letterSpacing: '-0.02em' }} destaque={{ color: cor }} />
          {(() => {
            const comImg = !!L.slots.slideImage;
            const passos = (
              <div style={{ display: 'flex', flexDirection: 'column', gap: n.stepGap, ...(comImg ? { width: n.stepsW, justifyContent: 'center' } : { marginTop: 10 }), ...(lado && !comImg ? { flex: 1, justifyContent: 'space-evenly' } : {}) }}>
                {t.slideSteps.map((_s, i) => {
                  const e = Math.min(1, Math.max(0, (f - (24 + i * 18)) / 10));
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: n.stepGapX, opacity: 0.35 + 0.65 * e }}>
                      <div style={{ width: n.stepBox, height: n.stepBox, flexShrink: 0, borderRadius: n.stepBox * 0.27, backgroundColor: e >= 1 ? cor : '#DAD6CC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {e >= 1 ? <Check tam={n.stepBox * 0.6} cor="#fff" espessura={3.4} /> : null}
                      </div>
                      <Texto fit={L.text[`step${i}`]} fonte="inter-800" largura={n.stepsW - n.stepBox - n.stepGapX} cor="#24263A" />
                    </div>
                  );
                })}
              </div>
            );
            if (!comImg) return passos;
            if (lado) return <>{passos}<SlideImagem p={p} style={{ flex: 1, minHeight: 0, marginTop: n.imgGap - n.inner }} /></>;
            return (
              <div style={{ display: 'flex', gap: n.imgGap, marginTop: 10, height: n.blocoH }}>
                {passos}
                <SlideImagem p={p} style={{ width: n.imgW, height: n.blocoH }} />
              </div>
            );
          })()}
          <div style={{ marginTop: lado ? 'auto' : 10, height: n.progress, flexShrink: 0, borderRadius: 99, backgroundColor: '#E2DED3', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${interpolate(f, [20, 220], [8, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}%`, backgroundColor: cor }} />
          </div>
        </div>
      </Entra>
      <Entra de="escala" atraso={6} style={{ position: 'absolute', left: v.x, top: v.y, width: v.w, height: v.h }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: n.radius, boxShadow: anelFala(f, true) }}>
          <Principal p={p} caixa={{ x: 0, y: 0, w: v.w, h: v.h }} raio={n.radius} />
          <Etiqueta nome={ui.guest} menor={L.format !== 'VERTICAL_9_16'} />
        </div>
      </Entra>
      <Reacoes base={v.y + v.h - 120} x0={v.x + v.w - 308} subida={Math.min(380, v.h - 160)} />
      <Controles L={L} />
    </AbsoluteFill>
  );
};

export const MeetDialogo: React.FC<PropsTpl<'call_dialog'>> = ({ p, L }) => {
  const f = useCurrentFrame();
  const t = p.frame.texts;
  const a = L.videoBox, b = L.secondBox!;
  const menor = L.format !== 'VERTICAL_9_16';
  return (
    <AbsoluteFill style={{ backgroundColor: CORES_CALL.fundo }}>
      <BarraTopo titulo={t.title} L={L} />
      <Entra de="escala" atraso={3} style={{ position: 'absolute', left: a.x, top: a.y, width: a.w, height: a.h }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: L.n.radius, boxShadow: anelFala(f, true) }}>
          <Principal p={p} caixa={{ x: 0, y: 0, w: a.w, h: a.h }} raio={L.n.radius} />
          <Etiqueta nome={t.names[0]} menor={menor} />
        </div>
      </Entra>
      <Entra de="escala" atraso={7} style={{ position: 'absolute', left: b.x, top: b.y, width: b.w, height: b.h }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: L.n.radius }}>
          <Segunda p={p} caixa={{ x: 0, y: 0, w: b.w, h: b.h }} raio={L.n.radius} />
          <Etiqueta nome={t.names[1]} mudo menor={menor} />
        </div>
      </Entra>
      <Controles L={L} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Fofoca 1 (gossip_white)
export const Fofoca1: React.FC<PropsTpl<'gossip_white'>> = ({ p, L, ui }) => {
  const { n } = L;
  const hd = L.slots.header;
  return (
    <AbsoluteFill style={{ backgroundColor: '#FFFFFF' }}>
      <div style={{ position: 'absolute', left: hd.x, width: hd.w, top: hd.y, height: hd.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: n.gap }}>
        <Entra atraso={0} dist={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: n.dot, height: n.dot, borderRadius: 99, backgroundColor: '#E5231B' }} />
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.labelSize, color: '#E5231B', letterSpacing: '0.16em' }}>{ui.exclusive}</span>
          </div>
        </Entra>
        <Entra atraso={4}>
          <Texto fit={L.text.headline} fonte="montserrat-900" largura={hd.w} cor="#0E0E10" style={{ letterSpacing: '-0.025em' }} destaque={{ color: '#E5231B' }} />
        </Entra>
      </div>
      <LadoALado p={p} L={L} raio={n.radius} />
      <Rosto p={p} caixa={L.faceBox!} borda="#fff" />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Fofoca 2 (gossip_pink): bordas rosa com retícula + selo estourado
export const Fofoca2: React.FC<PropsTpl<'gossip_pink'>> = ({ p, L, ui }) => {
  const f = useCurrentFrame();
  const selo = useEntrada(18, 240, 9);
  const balanco = Math.sin(f / 9) * 3;
  const { n } = L;
  const card = L.slots.card, seal = L.slots.seal;
  return (
    <AbsoluteFill style={{ backgroundColor: '#FF3EA5' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(120,0,70,0.45) 22%, transparent 24%)', backgroundSize: '26px 26px', opacity: 0.7 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(70% 55% at 50% 52%, rgba(255,62,165,0) 0%, rgba(255,62,165,0.35) 60%, rgba(160,0,90,0.35) 100%)' }} />
      <div style={{ position: 'absolute', left: card.x, width: card.w, top: card.y }}>
        <Entra de="escala" atraso={2} rot={-1.5}>
          <div style={{ backgroundColor: '#fff', padding: `${n.padY}px 40px`, boxShadow: '10px 10px 0 #111' }}>
            <Texto fit={L.text.headline} fonte="montserrat-900" largura={card.w - 80} cor="#111" alinhar="center" style={{ letterSpacing: '-0.02em' }} destaque={{ color: '#E0007A' }} />
          </div>
        </Entra>
      </div>
      <LadoALado p={p} L={L} raio={6} borda="#fff" />
      <div style={{ position: 'absolute', left: seal.x, top: seal.y, transform: `scale(${Math.max(0, selo)}) rotate(${-12 + balanco}deg)` }}>
        <Estouro tam={seal.w} cor="#FFE600" borda="#111">
          <span style={{ fontFamily: FONTE.anton, fontSize: n.sealSize, color: '#111', letterSpacing: '0.01em', transform: 'rotate(-4deg)' }}>{ui.gossip}</span>
        </Estouro>
      </div>
    </AbsoluteFill>
  );
};
