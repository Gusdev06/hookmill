// Molduras de 2 fontes (fase B2 do contrato), protótipo 9:16. 2ª fonte sempre muda; o áudio é do principal.
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { resolverSrc } from '../../../componentes/midia';
import { Entra, FONTE, H, LIMITE_BAIXO, Principal, SAFE, Segunda, SOMBRA, TextoAjustado, useEntrada, W } from '../base';
import { Balao, Brilho, Camera, Check, Coracao, Desligar, Enviar, Estouro, Joinha, Mais, Mao, MicMudo, Microfone, Salvar, Sorriso, Tela } from '../icones';
import type { MidiasMoldura, PropsDe } from '../tipos';
import { MarcaLua } from './um-video';

const M = 60;

/** Foto redonda (face_crop) com borda e sombra, entra com pop. */
const Rosto: React.FC<{ src?: string; d: number; cx: number; cy: number; borda: string; atraso?: number; anel?: string }> = ({ src, d, cx, cy, borda, atraso = 14, anel }) => (
  <div style={{ position: 'absolute', left: cx - d / 2, top: cy - d / 2, width: d, height: d }}>
    <Entra de="pop" atraso={atraso}>
      <div style={{ width: d, height: d, borderRadius: 999, padding: anel ? 8 : 0, background: anel, boxShadow: SOMBRA.cartao }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', border: `8px solid ${borda}`, backgroundColor: '#ccc' }}>
          {src ? <Img src={resolverSrc(src)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
        </div>
      </div>
    </Entra>
  </div>
);

/** 2 vídeos lado a lado (principal à esquerda). */
const LadoALado: React.FC<{ m: MidiasMoldura; y: number; h: number; x?: number; w?: number; gap?: number; raio?: number; borda?: string; atraso?: number }> = ({ m, y, h, x = M, w = W - 2 * M, gap = 16, raio = 24, borda, atraso = 6 }) => {
  const lw = (w - gap) / 2;
  const est: React.CSSProperties = { boxShadow: SOMBRA.cartao, ...(borda ? { border: `8px solid ${borda}` } : {}) };
  return (
    <>
      <Entra de="esquerda" atraso={atraso} dist={80} style={{ position: 'absolute', inset: 0 }}>
        <Principal m={m} caixa={{ x, y, w: lw, h }} raio={raio} foco={{ x: 0.5, y: 0.3 }} estilo={est} />
      </Entra>
      <Entra de="direita" atraso={atraso + 4} dist={80} style={{ position: 'absolute', inset: 0 }}>
        <Segunda m={m} caixa={{ x: x + lw + gap, y, w: lw, h }} raio={raio} foco={{ x: 0.5, y: 0.3 }} estilo={est} />
      </Entra>
    </>
  );
};

// ---------------------------------------------------------------- 2. Choquei (gossip_page), sem selo de verificado (D9)
export const Choquei: React.FC<PropsDe<'gossip_page'>> = ({ textos, midias }) => {
  const iniciais = textos.pageName.split(' ').filter((p) => p.length > 2).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  const cinza = '#A1A1AA';
  return (
    <AbsoluteFill style={{ backgroundColor: '#0B0B0D' }}>
      <div style={{ position: 'absolute', left: M, width: W - 2 * M, top: SAFE.top + 24, display: 'flex', flexDirection: 'column', gap: 34 }}>
        <Entra atraso={0} dist={30}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            <div style={{ width: 96, height: 96, borderRadius: 999, padding: 5, background: 'linear-gradient(135deg, #FACC15, #EF4444)' }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#111', border: '4px solid #0B0B0D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONTE.mont, fontWeight: 900, fontSize: 32, color: '#FACC15' }}>{iniciais}</div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 40, color: '#fff' }}>{textos.pageName}</span>
              <span style={{ fontFamily: FONTE.inter, fontWeight: 600, fontSize: 32, color: cinza }}>agora</span>
            </div>
            <Mais tam={48} cor="#fff" />
          </div>
        </Entra>
        <Entra atraso={4}>
          <TextoAjustado texto={textos.headline} fonte={FONTE.inter} peso={600} largura={W - 2 * M} linhas={5} max={58} min={40} cor="#E4E4E7" altura={1.22} destaque={{ fontWeight: 800, color: '#fff', backgroundColor: 'rgba(250,204,21,0.22)', boxShadow: 'inset 0 -0.18em 0 rgba(250,204,21,0.9)' }} />
        </Entra>
      </div>
      <LadoALado m={midias} y={620} h={940} />
      <Rosto src={midias.rosto} d={230} cx={W / 2} cy={1450} borda="#0B0B0D" anel="linear-gradient(135deg, #FACC15, #EF4444)" />
      <div style={{ position: 'absolute', left: M + 10, right: M + 10, top: 1606, display: 'flex', alignItems: 'center', gap: 40 }}>
        <Coracao tam={54} cor="#fff" /><Balao tam={54} cor="#fff" /><Enviar tam={52} cor="#fff" />
        <div style={{ flex: 1 }} /><Salvar tam={52} cor="#fff" />
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 7. Tela dividida (split_stack)
export const TelaDividida: React.FC<PropsDe<'split_stack'>> = ({ textos, midias }) => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    <Entra de="cima" atraso={0} dist={60} style={{ position: 'absolute', inset: 0 }}>
      <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: H / 2 }} foco={{ x: 0.5, y: 0.25 }} />
    </Entra>
    <Entra de="baixo" atraso={3} dist={60} style={{ position: 'absolute', inset: 0 }}>
      <Segunda m={midias} caixa={{ x: 0, y: H / 2, w: W, h: H / 2 }} foco={{ x: 0.5, y: 0.3 }} />
    </Entra>
    <div style={{ position: 'absolute', left: 0, width: W, top: H / 2 - 120, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Entra de="escala" atraso={8} rot={-2}>
        <div style={{ backgroundColor: '#E5231B', padding: '30px 50px', boxShadow: '0 10px 0 rgba(0,0,0,0.35), 0 24px 60px rgba(0,0,0,0.45)', width: 1000 }}>
          <TextoAjustado texto={textos.headline} fonte={FONTE.mont} peso={900} largura={900} linhas={2} max={70} min={46} caixaAlta cor="#fff" alinhar="center" altura={1.04} style={{ letterSpacing: '-0.01em' }} destaque={{ color: '#FFE14D' }} />
        </div>
      </Entra>
    </div>
  </AbsoluteFill>
);

// ---------------------------------------------------------------- 8. Tela dividida 2 (split_torn): faixa de papel rasgado
const rasgo = (largura: number, altura: number, semente: number) => {
  let s = semente;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const passo = 26;
  const topo: string[] = []; const base: string[] = [];
  for (let x = 0; x <= largura; x += passo) topo.push(`${x},${4 + r() * 18}`);
  for (let x = largura; x >= 0; x -= passo) base.push(`${x},${altura - 4 - r() * 18}`);
  return [...topo, ...base].join(' ');
};
export const TelaDividida2: React.FC<PropsDe<'split_torn'>> = ({ textos, midias }) => {
  const larg = 1120; const alt = 270;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Entra de="cima" atraso={0} dist={60} style={{ position: 'absolute', inset: 0 }}>
        <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: H / 2 }} foco={{ x: 0.5, y: 0.25 }} />
      </Entra>
      <Entra de="baixo" atraso={3} dist={60} style={{ position: 'absolute', inset: 0 }}>
        <Segunda m={midias} caixa={{ x: 0, y: H / 2, w: W, h: H / 2 }} foco={{ x: 0.5, y: 0.3 }} />
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
              <TextoAjustado texto={textos.headline} fonte={FONTE.archivo} peso={400} largura={900} linhas={2} max={68} min={44} cor="#141414" alinhar="center" altura={1.08}
                destaque={{ backgroundColor: '#FFE14D', padding: '0 10px', boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }} />
            </div>
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 9/10. Chamada de vídeo genérica (call, call_dialog)
const CORES_CALL = { fundo: '#1B1C20', tile: '#2A2B31', texto: '#E8EAED', destaque: '#6EE7B7', vermelho: '#EA4335' };

const BarraTopo: React.FC<{ titulo: string }> = ({ titulo }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = 8 * 60 + 41 + Math.floor(f / fps);
  return (
    <Entra de="cima" atraso={0} dist={30} style={{ position: 'absolute', left: 40, right: 40, top: SAFE.top + 6, height: 80, display: 'flex', alignItems: 'center', gap: 18 }}>
      <div style={{ width: 16, height: 16, borderRadius: 99, backgroundColor: CORES_CALL.vermelho }} />
      <span style={{ flex: 1, fontFamily: FONTE.inter, fontWeight: 800, fontSize: 38, color: CORES_CALL.texto, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</span>
      <span style={{ fontFamily: FONTE.inter, fontWeight: 600, fontSize: 34, color: '#9AA0A6', fontVariantNumeric: 'tabular-nums' }}>{`${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`}</span>
    </Entra>
  );
};

const Controles: React.FC = () => {
  const b = (filho: React.ReactNode, fundo = '#3C4043', largura = 104) => (
    <div style={{ width: largura, height: 104, borderRadius: 999, backgroundColor: fundo, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{filho}</div>
  );
  return (
    <Entra atraso={10} dist={40} style={{ position: 'absolute', left: 40, right: 40, top: LIMITE_BAIXO - 116, height: 104, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      {b(<Microfone tam={48} cor="#fff" />)}{b(<Camera tam={48} cor="#fff" />)}{b(<Sorriso tam={48} cor="#fff" />)}
      {b(<Tela tam={48} cor="#fff" />)}{b(<Mao tam={48} cor="#fff" />)}{b(<Desligar tam={54} cor="#fff" />, CORES_CALL.vermelho, 160)}
    </Entra>
  );
};

const Etiqueta: React.FC<{ nome: string; mudo?: boolean }> = ({ nome, mudo }) => (
  <div style={{ position: 'absolute', left: 22, bottom: 22, display: 'flex', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, padding: '10px 20px' }}>
    {mudo ? <MicMudo tam={32} cor="#fff" /> : <Microfone tam={32} cor={CORES_CALL.destaque} />}
    <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 32, color: '#fff' }}>{nome}</span>
  </div>
);

/** Moldura do quadro de quem fala: anel que pulsa leve. */
const anelFala = (f: number, ativo: boolean) => (ativo ? `0 0 0 ${5 + 2 * Math.abs(Math.sin(f / 6))}px ${CORES_CALL.destaque}` : 'none');

const REACOES = [Coracao, Joinha, Brilho, Coracao, Sorriso, Joinha];
const Reacoes: React.FC<{ base: number; x0: number }> = ({ base, x0 }) => {
  const f = useCurrentFrame();
  return (
    <>
      {REACOES.map((Ic, i) => {
        const ini = 30 + i * 28; const d = 70; const t = f - ini;
        if (t < 0 || t > d) return null;
        const p = t / d;
        return (
          <div key={i} style={{ position: 'absolute', left: x0 + ((i * 97) % 220) + Math.sin(p * 6 + i) * 18, top: base - p * 380, opacity: interpolate(p, [0, 0.15, 0.8, 1], [0, 1, 1, 0]) }}>
            <div style={{ width: 84, height: 84, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: SOMBRA.leve }}>
              <Ic tam={46} cor={i % 3 === 0 ? '#E11D48' : i % 3 === 1 ? '#2563EB' : '#D97706'} />
            </div>
          </div>
        );
      })}
    </>
  );
};

export const Meet: React.FC<PropsDe<'call'>> = ({ textos, midias, marca }) => {
  const f = useCurrentFrame();
  const top = 210; const hSlide = 640; const yPessoa = top + hSlide + 18; const hPessoa = LIMITE_BAIXO - 140 - yPessoa;
  return (
    <AbsoluteFill style={{ backgroundColor: CORES_CALL.fundo }}>
      <BarraTopo titulo={textos.title} />
      <Entra de="escala" atraso={3} style={{ position: 'absolute', left: 32, top, width: W - 64, height: hSlide }}>
        <div style={{ width: '100%', height: '100%', borderRadius: 28, overflow: 'hidden', backgroundColor: '#F6F4EF', boxShadow: SOMBRA.cartao, position: 'relative', padding: '50px 56px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 30 }}>
          <MarcaLua nome={marca.nome} cor={marca.cor} />
          <TextoAjustado texto={textos.slideTitle} fonte={FONTE.mont} peso={900} largura={W - 64 - 112} linhas={2} max={66} min={44} cor="#14162B" altura={1.05} style={{ letterSpacing: '-0.02em' }} destaque={{ color: marca.cor }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 30, marginTop: 10 }}>
            {textos.slideSteps.map((p, i) => {
              const e = Math.min(1, Math.max(0, (f - (24 + i * 18)) / 10));
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: 0.35 + 0.65 * e }}>
                  <div style={{ width: 66, height: 66, borderRadius: 18, backgroundColor: e >= 1 ? marca.cor : '#DAD6CC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {e >= 1 ? <Check tam={40} cor="#fff" espessura={3.4} /> : null}
                  </div>
                  <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 46, color: '#24263A' }}>{p}</span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 'auto', height: 14, borderRadius: 99, backgroundColor: '#E2DED3', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${interpolate(f, [20, 220], [8, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}%`, backgroundColor: marca.cor }} />
          </div>
        </div>
      </Entra>
      <Entra de="escala" atraso={6} style={{ position: 'absolute', left: 32, top: yPessoa, width: W - 64, height: hPessoa }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 28, boxShadow: anelFala(f, true) }}>
          <Principal m={midias} caixa="cheia" raio={28} foco={{ x: 0.5, y: 0.3 }} />
          <Etiqueta nome="Convidado" />
        </div>
      </Entra>
      <Reacoes base={yPessoa + hPessoa - 120} x0={W - 340} />
      <Controles />
    </AbsoluteFill>
  );
};

export const MeetDialogo: React.FC<PropsDe<'call_dialog'>> = ({ textos, midias }) => {
  const f = useCurrentFrame();
  const top = 210; const gap = 18; const hTile = (LIMITE_BAIXO - 140 - top - gap) / 2;
  return (
    <AbsoluteFill style={{ backgroundColor: CORES_CALL.fundo }}>
      <BarraTopo titulo={textos.title} />
      <Entra de="escala" atraso={3} style={{ position: 'absolute', left: 32, top, width: W - 64, height: hTile }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 28, boxShadow: anelFala(f, true) }}>
          <Principal m={midias} caixa="cheia" raio={28} foco={{ x: 0.5, y: 0.28 }} />
          <Etiqueta nome={textos.names[0]} />
        </div>
      </Entra>
      <Entra de="escala" atraso={7} style={{ position: 'absolute', left: 32, top: top + hTile + gap, width: W - 64, height: hTile }}>
        <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 28 }}>
          <Segunda m={midias} caixa="cheia" raio={28} foco={{ x: 0.5, y: 0.28 }} />
          <Etiqueta nome={textos.names[1]} mudo />
        </div>
      </Entra>
      <Controles />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 18. Fofoca 1 (gossip_white)
export const Fofoca1: React.FC<PropsDe<'gossip_white'>> = ({ textos, midias }) => {
  const yV = 700; const hV = 830;
  return (
    <AbsoluteFill style={{ backgroundColor: '#FFFFFF' }}>
      <div style={{ position: 'absolute', left: M, width: W - 2 * M, top: SAFE.top + 40, height: yV - SAFE.top - 80, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 26 }}>
        <Entra atraso={0} dist={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 14, height: 14, borderRadius: 99, backgroundColor: '#E5231B' }} />
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 30, color: '#E5231B', letterSpacing: '0.16em' }}>EXCLUSIVO</span>
          </div>
        </Entra>
        <Entra atraso={4}>
          <TextoAjustado texto={textos.headline} fonte={FONTE.mont} peso={900} largura={W - 2 * M} linhas={4} max={74} min={46} cor="#0E0E10" altura={1.06} style={{ letterSpacing: '-0.025em' }} destaque={{ color: '#E5231B' }} />
        </Entra>
      </div>
      <LadoALado m={midias} y={yV} h={hV} raio={30} />
      <Rosto src={midias.rosto} d={250} cx={W / 2} cy={yV + hV} borda="#fff" />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 19. Fofoca 2 (gossip_pink): bordas rosa com retícula + selo estourado
export const Fofoca2: React.FC<PropsDe<'gossip_pink'>> = ({ textos, midias }) => {
  const f = useCurrentFrame();
  const selo = useEntrada(18, 240, 9);
  const balanco = Math.sin(f / 9) * 3;
  const yV = 640; const hV = 940;
  return (
    <AbsoluteFill style={{ backgroundColor: '#FF3EA5' }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(120,0,70,0.45) 22%, transparent 24%)', backgroundSize: '26px 26px', opacity: 0.7 }} />
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(70% 55% at 50% 52%, rgba(255,62,165,0) 0%, rgba(255,62,165,0.35) 60%, rgba(160,0,90,0.35) 100%)' }} />
      <div style={{ position: 'absolute', left: 40, width: W - 80, top: SAFE.top + 70 }}>
        <Entra de="escala" atraso={2} rot={-1.5}>
          <div style={{ backgroundColor: '#fff', padding: '34px 40px', boxShadow: '10px 10px 0 #111' }}>
            <TextoAjustado texto={textos.headline} fonte={FONTE.mont} peso={900} largura={W - 160} linhas={4} max={66} min={42} cor="#111" alinhar="center" altura={1.08} style={{ letterSpacing: '-0.02em' }} destaque={{ color: '#E0007A' }} />
          </div>
        </Entra>
      </div>
      <LadoALado m={midias} y={yV} h={hV} x={40} w={W - 80} gap={20} raio={6} borda="#fff" />
      <div style={{ position: 'absolute', left: W - 340, top: yV - 140, transform: `scale(${Math.max(0, selo)}) rotate(${-12 + balanco}deg)` }}>
        <Estouro tam={300} cor="#FFE600" borda="#111">
          <span style={{ fontFamily: FONTE.anton, fontSize: 70, color: '#111', letterSpacing: '0.01em', transform: 'rotate(-4deg)' }}>FOFOCA!</span>
        </Estouro>
      </div>
    </AbsoluteFill>
  );
};
