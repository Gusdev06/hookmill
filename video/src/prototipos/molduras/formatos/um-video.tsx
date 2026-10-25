// Molduras de 1 vídeo (fase B1 do contrato), protótipo 9:16.
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { resolverSrc } from '../../../componentes/midia';
import { Entra, FONTE, Grao, H, LIMITE_BAIXO, Principal, SAFE, SOMBRA, TextoAjustado, useEntrada, useQuique, Veu, W } from '../base';
import { Balao, Coracao, Compartilhar, Enviar, Fechar, Lua, Mais, Medalha, Repostar, SetaBaixo, Trofeu } from '../icones';
import type { PropsDe } from '../tipos';

const M = 60; // margem lateral padrão

// ---------------------------------------------------------------- 1. Caixinha (question_box)
export const Caixinha: React.FC<PropsDe<'question_box'>> = ({ textos, midias, marca }) => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: H }} />
    <Veu de="baixo" altura={1100} forca={0.7} />
    <div style={{ position: 'absolute', left: 120, top: 1010, width: 840 }}>
      <Entra de="pop" atraso={4} rot={-1.5}>
        <div style={{ borderRadius: 44, overflow: 'visible', boxShadow: SOMBRA.cartao, position: 'relative' }}>
          <div style={{ position: 'absolute', left: '50%', top: -66, marginLeft: -66, width: 132, height: 132, borderRadius: 999, padding: 7, background: `linear-gradient(135deg, ${marca.cor}, #F59E0B)`, boxShadow: SOMBRA.leve, zIndex: 2 }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', border: '5px solid #fff', backgroundColor: '#ddd' }}>
              {midias.rosto ? <Img src={resolverSrc(midias.rosto)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
            </div>
          </div>
          <div style={{ borderRadius: '44px 44px 0 0', background: `linear-gradient(120deg, #1F2A6B 0%, ${marca.cor} 100%)`, padding: '92px 40px 34px', textAlign: 'center' }}>
            <div style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 40, color: '#fff', letterSpacing: '-0.01em' }}>Faça uma pergunta</div>
          </div>
          <div style={{ borderRadius: '0 0 44px 44px', backgroundColor: '#fff', padding: '46px 50px 54px', display: 'flex', justifyContent: 'center' }}>
            <TextoAjustado texto={textos.question} fonte={FONTE.mont} peso={800} largura={740} linhas={4} max={70} min={44} cor="#0F0F12" alinhar="center" altura={1.14} destaque={{ color: marca.cor }} />
          </div>
        </div>
      </Entra>
    </div>
  </AbsoluteFill>
);

// ---------------------------------------------------------------- 3. Meme
export const Meme: React.FC<PropsDe<'meme'>> = ({ textos, midias }) => {
  const q = useQuique(12);
  return (
    <AbsoluteFill style={{ backgroundColor: '#050505' }}>
      <div style={{ position: 'absolute', left: M, top: SAFE.top + 40, width: W - 2 * M, height: 470, display: 'flex', alignItems: 'flex-end' }}>
        <Entra atraso={2}>
          <TextoAjustado texto={`*POV:* ${textos.pov}`} fonte={FONTE.inter} peso={800} largura={W - 2 * M} linhas={5} max={70} min={44} cor="#fff" altura={1.16} destaque={{ fontFamily: FONTE.mont, fontWeight: 900, color: '#FFD43B' }} />
        </Entra>
      </div>
      <Entra de="escala" atraso={6} style={{ position: 'absolute', inset: 0 }}>
        <Principal m={midias} caixa={{ x: 0, y: 640, w: W, h: 880 }} />
      </Entra>
      <div style={{ position: 'absolute', left: 0, width: W, top: 1560, height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        <Entra atraso={12}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 50, color: '#fff' }}>{textos.cta}</span>
            <SetaBaixo tam={58} cor="#FFD43B" espessura={3} style={{ transform: `translateY(${q}px)` }} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 4. Cinema
export const Cinema: React.FC<PropsDe<'cinema'>> = ({ textos, midias, marca }) => {
  const abre = useEntrada(8, 90, 20);
  const alt = 600;
  const y = 900;
  const h = alt * Math.min(1, Math.max(0, abre));
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 45%, #17140F 0%, #050505 70%)' }}>
      <div style={{ position: 'absolute', left: 90, top: 300, width: 900, height: 520, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 34 }}>
        <Entra atraso={2} dist={30}>
          <TextoAjustado texto={textos.question} fonte={FONTE.mont} peso={800} largura={900} linhas={3} max={86} min={52} cor="#F5EFE6" alinhar="center" altura={1.08} style={{ letterSpacing: '-0.02em', textShadow: '0 6px 30px rgba(0,0,0,0.6)' }} destaque={{ color: '#E9B872' }} />
        </Entra>
        <Entra atraso={10} dist={20}>
          <TextoAjustado texto={textos.subtitle} fonte={FONTE.inter} peso={600} largura={820} linhas={3} max={42} min={34} cor="#A69F94" alinhar="center" altura={1.3} />
        </Entra>
      </div>
      <div style={{ position: 'absolute', left: 0, top: y + (alt - h) / 2, width: W, height: h, overflow: 'hidden', boxShadow: '0 30px 90px rgba(0,0,0,0.7)' }}>
        <Principal m={midias} caixa={{ x: 0, y: -(alt - h) / 2, w: W, h: alt }} foco={{ x: 0.5, y: 0.3 }} filtro="contrast(1.08) saturate(0.82) sepia(0.14)" />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(110% 120% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
      </div>
      <Entra atraso={18} style={{ position: 'absolute', left: 0, width: W, top: y + alt + 70, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 120, height: 2, backgroundColor: '#E9B872', opacity: 0.8 }} />
          <span style={{ fontFamily: FONTE.mont, fontWeight: 800, fontSize: 30, letterSpacing: '0.32em', color: '#A69F94', textTransform: 'uppercase' }}>{marca.nome}</span>
        </div>
      </Entra>
      <Grao opacidade={0.09} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 6. Notícia (news)
export const Noticia: React.FC<PropsDe<'news'>> = ({ textos, midias }) => {
  const f = useCurrentFrame();
  const pisca = 0.55 + 0.45 * Math.abs(Math.sin(f / 9));
  const q = useQuique(8);
  return (
    <AbsoluteFill style={{ backgroundColor: '#F3EFE8' }}>
      <div style={{ position: 'absolute', left: M, top: SAFE.top + 10, width: W - 2 * M, bottom: SAFE.bottom, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <Entra de="esquerda" atraso={0}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, backgroundColor: '#D7261E', padding: '18px 28px', borderRadius: 8, boxShadow: SOMBRA.leve }}>
            <div style={{ width: 18, height: 18, borderRadius: 99, backgroundColor: '#fff', opacity: pisca }} />
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 40, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{textos.topic}</span>
          </div>
        </Entra>
        <Entra atraso={5}>
          <TextoAjustado texto={`${textos.headline.lead} *${textos.headline.highlight}*`} fonte={FONTE.mont} peso={900} largura={W - 2 * M} linhas={4} max={78} min={48} cor="#111" altura={1.06} style={{ letterSpacing: '-0.02em' }} destaque={{ color: '#D7261E' }} />
        </Entra>
        <Entra atraso={9}>
          <div style={{ borderLeft: '6px solid #D7261E', paddingLeft: 22 }}>
            <TextoAjustado texto={textos.dek} fonte={FONTE.inter} peso={600} largura={W - 2 * M - 28} linhas={3} max={38} min={32} cor="#3B3B3B" altura={1.3} />
          </div>
        </Entra>
        <Entra de="escala" atraso={12} style={{ flex: 1, position: 'relative', borderRadius: 14, overflow: 'hidden', boxShadow: SOMBRA.cartao }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Principal m={midias} caixa="cheia" />
          </div>
        </Entra>
        <Entra atraso={16}>
          <div style={{ backgroundColor: '#111', borderRadius: 10, padding: '28px 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18 }}>
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 44, color: '#fff', letterSpacing: '0.02em', textTransform: 'uppercase' }}>{textos.cta}</span>
            <SetaBaixo tam={50} cor="#FF4136" espessura={3.2} style={{ transform: `translateY(${q}px)` }} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 11. Ranking
export const Ranking: React.FC<PropsDe<'ranking'>> = ({ textos, midias }) => {
  const n = textos.items.length;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: H }} foco={{ x: 0.5, y: 0.2 }} />
      <Veu de="cima" altura={520} forca={0.5} />
      <Veu de="baixo" altura={1100} forca={0.9} />
      <div style={{ position: 'absolute', left: 90, top: SAFE.top + 34, width: 900 }}>
        <Entra de="pop" atraso={2}>
          <div style={{ backgroundColor: '#fff', borderRadius: 60, padding: '30px 40px 34px', boxShadow: SOMBRA.cartao, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <Trofeu tam={74} />
              <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 76, color: '#0F0F12', letterSpacing: '-0.02em' }}>RANKING</span>
              <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 38, color: '#fff', backgroundColor: '#E5231B', padding: '8px 18px', borderRadius: 14, transform: 'rotate(-3deg)' }}>TOP {n}</span>
            </div>
            <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 42, color: '#4B4B55' }}>{textos.title}</span>
          </div>
        </Entra>
      </div>
      <div style={{ position: 'absolute', left: M, width: W - 2 * M, bottom: SAFE.bottom + 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {textos.items.map((item, i) => (
          <Entra key={i} de="esquerda" dist={120} atraso={10 + i * 6}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, backgroundColor: 'rgba(12,12,16,0.62)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 28, padding: '10px 30px 10px 14px', boxShadow: SOMBRA.leve }}>
              <Medalha n={i + 1} tam={96} />
              <TextoAjustado texto={item} fonte={FONTE.mont} peso={800} largura={W - 2 * M - 180} linhas={1} max={50} min={36} cor="#fff" style={{ textShadow: SOMBRA.texto }} />
            </div>
          </Entra>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 12. Tweet (post_card)
export const Tweet: React.FC<PropsDe<'post_card'>> = ({ textos, midias, marca }) => {
  const cinza = '#8B98A5';
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #10141A 0%, #050608 100%)' }}>
      <div style={{ position: 'absolute', left: 40, top: SAFE.top + 40, width: W - 80 }}>
        <Entra de="escala" atraso={2}>
          <div style={{ backgroundColor: '#15191F', borderRadius: 40, padding: '44px 44px 36px', border: '1.5px solid #252B33', boxShadow: SOMBRA.cartao, display: 'flex', flexDirection: 'column', gap: 30 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
              <div style={{ width: 112, height: 112, borderRadius: 999, background: `linear-gradient(135deg, ${marca.cor}, #1F2A6B)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONTE.mont, fontWeight: 900, fontSize: 44, color: '#fff' }}>{marca.iniciais}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 44, color: '#F1F4F7' }}>{marca.nome}</span>
                <span style={{ fontFamily: FONTE.inter, fontWeight: 600, fontSize: 36, color: cinza }}>@{marca.handle} · 2h</span>
              </div>
              <Mais tam={48} cor={cinza} />
            </div>
            <Entra atraso={8} dist={24}>
              <TextoAjustado texto={textos.copy} fonte={FONTE.inter} peso={600} largura={W - 168} linhas={5} max={54} min={40} cor="#F1F4F7" altura={1.28} destaque={{ fontWeight: 800, color: '#fff' }} />
            </Entra>
            <div style={{ position: 'relative', width: W - 168, height: 880, borderRadius: 30, overflow: 'hidden', border: '1.5px solid #2A3038' }}>
              <Principal m={midias} caixa={{ x: 0, y: 0, w: W - 168, h: 880 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 20px' }}>
              <Balao tam={46} cor={cinza} /><Repostar tam={46} cor={cinza} /><Coracao tam={46} cor={cinza} /><Compartilhar tam={46} cor={cinza} />
            </div>
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 13. Oferta direta (direct_offer)
export const OfertaDireta: React.FC<PropsDe<'direct_offer'>> = ({ textos, midias }) => {
  const risco = useEntrada(22, 120, 22);
  const q = useQuique(10);
  const f = useCurrentFrame();
  const brilho = 0.35 + 0.25 * Math.sin(f / 10);
  const verde = '#3DDC84';
  return (
    <AbsoluteFill style={{ backgroundColor: '#0A0F1E' }}>
      <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: 900 }} foco={{ x: 0.5, y: 0.25 }} />
      <div style={{ position: 'absolute', left: 0, top: 640, width: W, height: 262, background: 'linear-gradient(180deg, rgba(10,15,30,0) 0%, #0A0F1E 100%)' }} />
      <div style={{ position: 'absolute', left: M, width: W - 2 * M, top: 860, bottom: SAFE.bottom, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
        <Entra atraso={4} dist={40}>
          <TextoAjustado texto={textos.promise} fonte={FONTE.anton} peso={400} largura={W - 2 * M} linhas={2} max={150} min={80} caixaAlta cor="#fff" alinhar="center" altura={1.0} style={{ textShadow: '0 8px 40px rgba(0,0,0,0.6)' }} destaque={{ color: verde }} />
        </Entra>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
          {textos.price.from ? (
            <Entra atraso={14}>
              <div style={{ position: 'relative', fontFamily: FONTE.inter, fontWeight: 800, fontSize: 52, color: '#8A93A6' }}>
                De {textos.price.from}
                <div style={{ position: 'absolute', left: -8, right: -8, top: '52%', height: 6, backgroundColor: '#FF4D4D', borderRadius: 3, transform: `scaleX(${Math.max(0, risco)}) rotate(-4deg)`, transformOrigin: 'left center' }} />
              </div>
            </Entra>
          ) : null}
          <Entra de="pop" atraso={26}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
              <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 46, color: '#fff' }}>Por apenas</span>
              <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 168, color: verde, letterSpacing: '-0.03em', textShadow: `0 0 60px rgba(61,220,132,${brilho})` }}>{textos.price.to}</span>
            </div>
          </Entra>
        </div>
        <Entra atraso={32}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, backgroundColor: verde, borderRadius: 999, padding: '30px 56px', boxShadow: '0 12px 40px rgba(61,220,132,0.35)' }}>
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 44, color: '#062814' }}>{textos.cta}</span>
            <SetaBaixo tam={50} cor="#062814" espessura={3.2} style={{ transform: `translateY(${q}px)` }} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 14. Story
export const Story: React.FC<PropsDe<'story'>> = ({ textos, midias, marca }) => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: H }} filtro="brightness(0.8)" />
    <Veu de="cima" altura={700} forca={0.5} />
    <Veu de="baixo" altura={1200} forca={0.85} />
    <div style={{ position: 'absolute', left: M, width: W - 2 * M, top: SAFE.top + 40, bottom: SAFE.bottom, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
      <Entra de="pop" atraso={3} rot={-2}>
        <div style={{ width: 780, borderRadius: 36, overflow: 'hidden', boxShadow: SOMBRA.cartao }}>
          <div style={{ background: `linear-gradient(120deg, #1F2A6B 0%, ${marca.cor} 100%)`, padding: '22px 0', textAlign: 'center', fontFamily: FONTE.inter, fontWeight: 800, fontSize: 34, color: '#fff' }}>Faça uma pergunta</div>
          <div style={{ backgroundColor: '#fff', padding: '30px 40px 36px', display: 'flex', justifyContent: 'center' }}>
            <TextoAjustado texto={textos.question} fonte={FONTE.mont} peso={800} largura={700} linhas={3} max={50} min={38} cor="#111" alinhar="center" />
          </div>
        </div>
      </Entra>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28 }}>
        <Entra de="pop" atraso={12}>
          <div style={{ backgroundColor: '#22C55E', borderRadius: 26, padding: '26px 44px', boxShadow: '0 14px 40px rgba(34,197,94,0.35)', border: '3px solid rgba(255,255,255,0.35)' }}>
            <TextoAjustado texto={textos.headline} fonte={FONTE.mont} peso={900} largura={820} linhas={2} max={60} min={42} cor="#fff" alinhar="center" altura={1.08} style={{ textShadow: '0 2px 0 rgba(0,0,0,0.18)' }} />
          </div>
        </Entra>
        <Entra atraso={18}>
          <TextoAjustado texto={textos.support} fonte={FONTE.inter} peso={800} largura={900} linhas={2} max={44} min={34} cor="#fff" alinhar="center" style={{ textShadow: SOMBRA.texto }} destaque={{ color: '#86EFAC' }} />
        </Entra>
        <Entra atraso={24}>
          <div style={{ backgroundColor: '#fff', borderRadius: 30, padding: '36px 42px', boxShadow: SOMBRA.cartao }}>
            <TextoAjustado texto={textos.copy} fonte={FONTE.inter} peso={600} largura={876} linhas={7} max={38} min={30} cor="#1E1E24" altura={1.36} destaque={{ fontWeight: 800, color: '#0F0F12', backgroundColor: '#FFE98A', padding: '0 6px', borderRadius: 6 }} />
          </div>
        </Entra>
      </div>
    </div>
  </AbsoluteFill>
);

// ---------------------------------------------------------------- 15. Leia a legenda (read_caption)
export const LeiaALegenda: React.FC<PropsDe<'read_caption'>> = ({ textos, midias }) => {
  const q = useQuique(12);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: H }} foco={{ x: 0.5, y: 0.2 }} />
      <Veu de="baixo" altura={1050} forca={0.85} />
      <div style={{ position: 'absolute', left: M, width: W - 2 * M, top: 1040, display: 'flex', justifyContent: 'center' }}>
        <Entra de="escala" atraso={4}>
          <TextoAjustado texto={textos.headline} fonte={FONTE.mont} peso={900} largura={W - 2 * M} linhas={4} max={82} min={52} cor="#fff" alinhar="center" altura={1.12} style={{ letterSpacing: '-0.02em', textShadow: SOMBRA.texto }}
            destaque={{ color: '#111', backgroundColor: '#FFD43B', padding: '0 12px', borderRadius: 10, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', textShadow: 'none' }} />
        </Entra>
      </div>
      <div style={{ position: 'absolute', left: 0, width: W, top: LIMITE_BAIXO - 130, display: 'flex', justifyContent: 'center' }}>
        <Entra atraso={14}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 999, padding: '20px 40px', boxShadow: SOMBRA.cartao }}>
            <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 44, color: '#111' }}>Leia a legenda</span>
            <SetaBaixo tam={48} cor="#111" espessura={3.2} style={{ transform: `translateY(${q * 0.7}px)` }} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 16. POV + depoimento (pov_testimonial)
export const PovDepoimento: React.FC<PropsDe<'pov_testimonial'>> = ({ textos, midias }) => {
  const f = useCurrentFrame();
  const pulso = 1 + 0.025 * Math.sin(f / 7);
  return (
    <AbsoluteFill style={{ backgroundColor: '#FAF8F4' }}>
      <div style={{ position: 'absolute', left: M, width: W - 2 * M, top: SAFE.top + 30, bottom: SAFE.bottom, display: 'flex', flexDirection: 'column', gap: 40 }}>
        <Entra atraso={2}>
          <TextoAjustado texto={`*Pov:* ${textos.pov}`} fonte={FONTE.inter} peso={800} largura={W - 2 * M} linhas={4} max={64} min={44} cor="#16161A" altura={1.16} style={{ letterSpacing: '-0.015em' }} destaque={{ fontFamily: FONTE.mont, fontWeight: 900, color: '#16161A' }} />
        </Entra>
        <Entra de="escala" atraso={8} style={{ flex: 1, position: 'relative', borderRadius: 40, overflow: 'hidden', boxShadow: SOMBRA.cartao }}>
          <div style={{ position: 'absolute', inset: 0 }}>
            <Principal m={midias} caixa="cheia" foco={{ x: 0.5, y: 0.3 }} />
          </div>
        </Entra>
        <Entra atraso={16}>
          <div style={{ transform: `scale(${pulso})`, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, backgroundColor: '#16161A', borderRadius: 999, padding: '32px 0', boxShadow: SOMBRA.cartao }}>
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 42, color: '#fff', letterSpacing: '0.02em', textTransform: 'uppercase' }}>{textos.cta}</span>
            <SetaBaixo tam={46} cor="#FFD43B" espessura={3.2} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- 17. Live (sem número de espectadores, D9)
const CORACOES = [
  { x: 950, atraso: 10, d: 70, cor: '#FF3B6B', t: 54 }, { x: 900, atraso: 26, d: 80, cor: '#FFFFFF', t: 46 },
  { x: 980, atraso: 44, d: 75, cor: '#FF9F1C', t: 50 }, { x: 930, atraso: 70, d: 85, cor: '#FF3B6B', t: 58 },
  { x: 960, atraso: 96, d: 70, cor: '#C084FC', t: 48 }, { x: 910, atraso: 120, d: 80, cor: '#FF3B6B', t: 52 },
  { x: 970, atraso: 150, d: 75, cor: '#FFFFFF', t: 46 }, { x: 925, atraso: 176, d: 80, cor: '#FF9F1C', t: 54 },
];
export const Live: React.FC<PropsDe<'live'>> = ({ midias, marca }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anel = 1 + 0.06 * Math.sin((f / fps) * Math.PI * 2);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal m={midias} caixa={{ x: 0, y: 0, w: W, h: H }} zoom={1.02} />
      <Veu de="cima" altura={420} forca={0.55} />
      <Veu de="baixo" altura={520} forca={0.6} />
      <div style={{ position: 'absolute', left: 44, right: 44, top: SAFE.top + 10, display: 'flex', alignItems: 'center', gap: 20 }}>
        <Entra de="esquerda" atraso={2} style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1 }}>
          <div style={{ width: 100, height: 100, borderRadius: 999, padding: 5, background: 'linear-gradient(135deg, #FF2D55, #FF8A3D)', transform: `scale(${anel})` }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', border: '4px solid #000' }}>
              {midias.rosto ? <Img src={resolverSrc(midias.rosto)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
            </div>
          </div>
          <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: 40, color: '#fff', textShadow: SOMBRA.texto }}>{marca.handle}</span>
          <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 30, color: '#fff', letterSpacing: '0.08em', background: 'linear-gradient(135deg, #FF2D55, #FF5E3A)', padding: '8px 18px', borderRadius: 10 }}>AO VIVO</span>
        </Entra>
        <Entra de="pop" atraso={6}><Fechar tam={60} cor="#fff" espessura={2.6} /></Entra>
      </div>
      {CORACOES.map((c, i) => {
        const t = f - c.atraso;
        if (t < 0 || t > c.d) return null;
        const p = t / c.d;
        const y = interpolate(p, [0, 1], [1600, 1080]);
        const x = c.x + Math.sin(p * Math.PI * 2 + i) * 26;
        const o = interpolate(p, [0, 0.15, 0.75, 1], [0, 1, 1, 0]);
        return <Coracao key={i} cheio tam={c.t} cor={c.cor} style={{ position: 'absolute', left: x - c.t / 2, top: y, opacity: o, transform: `scale(${0.7 + 0.5 * Math.min(1, p * 3)})`, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.35))' }} />;
      })}
      <div style={{ position: 'absolute', left: 44, right: 44, top: LIMITE_BAIXO - 120, height: 104, display: 'flex', alignItems: 'center', gap: 24 }}>
        <Entra atraso={10} style={{ flex: 1 }}>
          <div style={{ height: 100, borderRadius: 999, border: '2.5px solid rgba(255,255,255,0.85)', backgroundColor: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', padding: '0 40px', fontFamily: FONTE.inter, fontWeight: 600, fontSize: 36, color: 'rgba(255,255,255,0.9)' }}>Comentários limitados</div>
        </Entra>
        <Entra atraso={12}><Coracao tam={60} cor="#fff" espessura={2.4} /></Entra>
        <Entra atraso={14}><Enviar tam={58} cor="#fff" espessura={2.4} /></Entra>
      </div>
    </AbsoluteFill>
  );
};

// Ícone da marca pros slides (usado no Meet).
export const MarcaLua: React.FC<{ nome: string; cor: string }> = ({ nome, cor }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <div style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: cor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Lua tam={30} cor="#fff" /></div>
    <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: 34, color: '#14162B' }}>{nome}</span>
  </div>
);
