// Molduras de 1 vídeo (fase B1). Visual = protótipo aprovado (src/prototipos/molduras/formatos/um-video.tsx); posições e
// tamanhos vêm do frameLayout (9:16 = protótipo; 4:5 e 1:1 = layout próprio).
import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { Caixa, Entra, FONTE, Grao, Principal, RostoImg, SOMBRA, Texto, useEntrada, useQuique, Veu, type PropsTpl } from './base';
import { Balao, Coracao, Compartilhar, Enviar, Fechar, Lua, Mais, Medalha, Repostar, SetaBaixo, Trofeu } from './icones';
import { alturaLinhaNormal, iniciais, semArroba } from '../lib/molduras';

const M = 60; // margem lateral padrão

// ---------------------------------------------------------------- Caixinha (question_box)
export const Caixinha: React.FC<PropsTpl<'question_box'>> = ({ p, L, cor, ui }) => {
  const n = L.n;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal p={p} caixa={L.videoBox} />
      <Veu de="baixo" altura={n.veil} forca={0.7} />
      <div style={{ position: 'absolute', left: n.cardX, top: n.cardY, width: n.cardW }}>
        <Entra de="pop" atraso={4} rot={-1.5}>
          <div style={{ borderRadius: n.radius, overflow: 'visible', boxShadow: SOMBRA.cartao, position: 'relative' }}>
            <div style={{ position: 'absolute', left: '50%', top: -n.avatar / 2, marginLeft: -n.avatar / 2, width: n.avatar, height: n.avatar, borderRadius: 999, padding: 7, background: `linear-gradient(135deg, ${cor}, #F59E0B)`, boxShadow: SOMBRA.leve, zIndex: 2 }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', border: '5px solid #fff', backgroundColor: '#ddd' }}>
                <RostoImg p={p} />
              </div>
            </div>
            <div style={{ borderRadius: `${n.radius}px ${n.radius}px 0 0`, background: `linear-gradient(120deg, #1F2A6B 0%, ${cor} 100%)`, padding: `${n.headTop}px ${n.headX}px ${n.headBottom}px`, textAlign: 'center' }}>
              <div style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.titleSize, color: '#fff', letterSpacing: '-0.01em' }}>{ui.askQuestion}</div>
            </div>
            <div style={{ borderRadius: `0 0 ${n.radius}px ${n.radius}px`, backgroundColor: '#fff', padding: `${n.bodyTop}px ${n.bodyX}px ${n.bodyBottom}px`, display: 'flex', justifyContent: 'center' }}>
              <Texto fit={L.text.question} fonte="montserrat-800" largura={n.cardW - 2 * n.bodyX} cor="#0F0F12" alinhar="center" destaque={{ color: cor }} />
            </div>
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Meme
export const Meme: React.FC<PropsTpl<'meme'>> = ({ p, L }) => {
  const q = useQuique(12);
  const n = L.n;
  return (
    <AbsoluteFill style={{ backgroundColor: '#050505' }}>
      <div style={{ position: 'absolute', left: M, top: n.textY, width: L.canvas.w - 2 * M, height: n.textH, display: 'flex', alignItems: 'flex-end' }}>
        <Entra atraso={2}>
          <Texto fit={L.text.pov} fonte="inter-800" largura={L.canvas.w - 2 * M} cor="#fff" destaque={{ fontFamily: FONTE.mont, fontWeight: 900, color: '#FFD43B' }} />
        </Entra>
      </div>
      <Entra de="escala" atraso={6} style={{ position: 'absolute', inset: 0 }}>
        <Principal p={p} caixa={L.videoBox} />
      </Entra>
      {L.slots.cta ? (
        <div style={{ position: 'absolute', left: 0, width: L.canvas.w, top: n.ctaY, height: n.ctaH, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
          <Entra atraso={12}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.ctaSize, color: '#fff' }}>{p.frame.texts.cta}</span>
              <SetaBaixo tam={n.arrow} cor="#FFD43B" espessura={3} style={{ transform: `translateY(${q}px)` }} />
            </div>
          </Entra>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Cinema
export const Cinema: React.FC<PropsTpl<'cinema'>> = ({ p, L }) => {
  const abre = useEntrada(8, 90, 20);
  const { videoBox: v, n } = L;
  const h = v.h * Math.min(1, Math.max(0, abre));
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(120% 80% at 50% 45%, #17140F 0%, #050505 70%)' }}>
      <div style={{ position: 'absolute', left: 90, top: n.textY, width: 900, height: n.textH, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: n.gap }}>
        <Entra atraso={2} dist={30}>
          <Texto fit={L.text.question} fonte="montserrat-800" largura={900} cor="#F5EFE6" alinhar="center" style={{ letterSpacing: '-0.02em', textShadow: '0 6px 30px rgba(0,0,0,0.6)' }} destaque={{ color: '#E9B872' }} />
        </Entra>
        {L.text.subtitle ? (
          <Entra atraso={10} dist={20}>
            <Texto fit={L.text.subtitle} fonte="inter-600" largura={820} cor="#A69F94" alinhar="center" />
          </Entra>
        ) : null}
      </div>
      <div style={{ position: 'absolute', left: 0, top: v.y + (v.h - h) / 2, width: v.w, height: h, overflow: 'hidden', boxShadow: '0 30px 90px rgba(0,0,0,0.7)' }}>
        <Principal p={p} caixa={{ x: 0, y: -(v.h - h) / 2, w: v.w, h: v.h }} filtro="contrast(1.08) saturate(0.82) sepia(0.14)" />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(110% 120% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)' }} />
      </div>
      <Entra atraso={18} style={{ position: 'absolute', left: 0, width: v.w, top: L.slots.brand.y, display: 'flex', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 120, height: 2, backgroundColor: '#E9B872', opacity: 0.8 }} />
          <span style={{ fontFamily: FONTE.mont, fontWeight: 800, fontSize: n.brandSize, letterSpacing: '0.32em', color: '#A69F94', textTransform: 'uppercase' }}>{p.frame.brand.name}</span>
        </div>
      </Entra>
      <Grao opacidade={0.09} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Notícia (news)
export const Noticia: React.FC<PropsTpl<'news'>> = ({ p, L }) => {
  const f = useCurrentFrame();
  const pisca = 0.55 + 0.45 * Math.abs(Math.sin(f / 9));
  const q = useQuique(8);
  const { n, videoBox: v } = L;
  const t = p.frame.texts;
  const larg = L.canvas.w - 2 * M;
  const cta = L.slots.cta;
  return (
    <AbsoluteFill style={{ backgroundColor: '#F3EFE8' }}>
      <div style={{ position: 'absolute', left: M, top: n.top, width: larg, display: 'flex', flexDirection: 'column', gap: n.gap }}>
        <Entra de="esquerda" atraso={0}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, backgroundColor: '#D7261E', padding: `${n.pillPadY}px ${n.pillPadX}px`, borderRadius: 8, boxShadow: SOMBRA.leve }}>
            <div style={{ width: n.pillDot, height: n.pillDot, borderRadius: 99, backgroundColor: '#fff', opacity: pisca }} />
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.pillSize, color: '#fff', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{t.topic}</span>
          </div>
        </Entra>
        <Entra atraso={5}>
          <Texto fit={L.text.headline} fonte="montserrat-900" largura={larg} cor="#111" style={{ letterSpacing: '-0.02em' }} destaque={{ color: '#D7261E' }} />
        </Entra>
        {L.text.dek ? (
          <Entra atraso={9}>
            <div style={{ borderLeft: '6px solid #D7261E', paddingLeft: 22 }}>
              <Texto fit={L.text.dek} fonte="inter-600" largura={larg - 28} cor="#3B3B3B" />
            </div>
          </Entra>
        ) : null}
      </div>
      <Entra de="escala" atraso={12} style={{ position: 'absolute', left: v.x, top: v.y, width: v.w, height: v.h, borderRadius: 14, overflow: 'hidden', boxShadow: SOMBRA.cartao }}>
        <Principal p={p} caixa={{ x: 0, y: 0, w: v.w, h: v.h }} />
      </Entra>
      <Entra atraso={16} style={{ position: 'absolute', left: cta.x, top: cta.y, width: cta.w }}>
        <div style={{ backgroundColor: '#111', borderRadius: 10, padding: `${n.ctaPadY}px 0`, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, boxShadow: L.format === 'VERTICAL_9_16' ? undefined : SOMBRA.cartao }}>
          <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.ctaSize, color: '#fff', letterSpacing: '0.02em', textTransform: 'uppercase' }}>{t.cta}</span>
          <SetaBaixo tam={n.arrow} cor="#FF4136" espessura={3.2} style={{ transform: `translateY(${q}px)` }} />
        </div>
      </Entra>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Ranking
export const Ranking: React.FC<PropsTpl<'ranking'>> = ({ p, L, ui }) => {
  const { n } = L;
  const items = L.items ?? [];
  const card = L.slots.card;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal p={p} caixa={L.videoBox} />
      <Veu de="cima" altura={n.veilTop} forca={0.5} />
      <Veu de="baixo" altura={n.veilBottom} forca={0.9} />
      <div style={{ position: 'absolute', left: card.x, top: card.y, width: card.w }}>
        <Entra de="pop" atraso={2}>
          <div style={{ backgroundColor: '#fff', borderRadius: n.cardRadius, padding: `${n.cardPadT}px 40px ${n.cardPadB}px`, boxShadow: SOMBRA.cartao, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
              <Trofeu tam={n.trophy} />
              <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.rankSize, color: '#0F0F12', letterSpacing: '-0.02em' }}>{ui.ranking}</span>
              <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.topSize, color: '#fff', backgroundColor: '#E5231B', padding: '8px 18px', borderRadius: 14, transform: 'rotate(-3deg)' }}>{ui.top} {items.length}</span>
            </div>
            <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.titleSize, color: '#4B4B55' }}>{p.frame.texts.title}</span>
          </div>
        </Entra>
      </div>
      {/* cobrindo legenda queimada (n.opaco): linhas opacas da largura quase toda, pra não sobrar letra queimada nas pontas */}
      <div style={{ position: 'absolute', left: n.opaco ? 12 : M, width: L.canvas.w - 2 * (n.opaco ? 12 : M), top: n.listY, display: 'flex', flexDirection: 'column', gap: n.itemGap }}>
        {items.map((_item, i) => (
          <Entra key={i} de="esquerda" dist={120} atraso={10 + i * 6}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, backgroundColor: n.opaco ? '#0C0C10' : 'rgba(12,12,16,0.62)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 28, padding: `${n.itemPadY}px 30px ${n.itemPadY}px 14px`, boxShadow: SOMBRA.leve }}>
              <Medalha n={i + 1} tam={n.medal} />
              <Texto fit={L.text[`item${i}`]} fonte="montserrat-800" largura={n.itemW} cor="#fff" style={{ textShadow: SOMBRA.texto }} />
            </div>
          </Entra>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Tweet (post_card)
export const Tweet: React.FC<PropsTpl<'post_card'>> = ({ p, L, cor, ui }) => {
  const cinza = '#8B98A5';
  const { n, videoBox: v } = L;
  const card = L.slots.card;
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg, #10141A 0%, #050608 100%)' }}>
      <div style={{ position: 'absolute', left: card.x, top: card.y, width: card.w }}>
        <Entra de="escala" atraso={2}>
          <div style={{ backgroundColor: '#15191F', borderRadius: n.radius, padding: `${n.padT}px ${n.padX}px ${n.padB}px`, border: '1.5px solid #252B33', boxShadow: SOMBRA.cartao, display: 'flex', flexDirection: 'column', gap: n.gap }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, height: n.headH }}>
              <div style={{ width: n.avatar, height: n.avatar, borderRadius: 999, background: `linear-gradient(135deg, ${cor}, #1F2A6B)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.iniciaisSize, color: '#fff' }}>{p.frame.brand.initials || iniciais(p.frame.brand.name)}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.nameSize, color: '#F1F4F7' }}>{p.frame.brand.name}</span>
                <span style={{ fontFamily: FONTE.inter, fontWeight: 600, fontSize: n.handleSize, color: cinza }}>@{semArroba(p.frame.brand.handle)} · {ui.timeAgo}</span>
              </div>
              <Mais tam={n.dots} cor={cinza} />
            </div>
            <Entra atraso={8} dist={24}>
              <Texto fit={L.text.copy} fonte="inter-600" largura={n.contentW} cor="#F1F4F7" destaque={{ fontWeight: 800, color: '#fff' }} />
            </Entra>
            <div style={{ position: 'relative', width: v.w, height: v.h, borderRadius: n.mediaRadius, overflow: 'hidden', border: '1.5px solid #2A3038' }}>
              <Principal p={p} caixa={{ x: 0, y: 0, w: v.w, h: v.h }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 20px' }}>
              <Balao tam={n.icon} cor={cinza} /><Repostar tam={n.icon} cor={cinza} /><Coracao tam={n.icon} cor={cinza} /><Compartilhar tam={n.icon} cor={cinza} />
            </div>
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Oferta direta (direct_offer)
// Correção do protótipo: o bloco de texto fica preso ao rodapé com espaçamento fixo e o vídeo desce até ele (sem vão).
export const OfertaDireta: React.FC<PropsTpl<'direct_offer'>> = ({ p, L, ui }) => {
  const risco = useEntrada(22, 120, 22);
  const q = useQuique(10);
  const f = useCurrentFrame();
  const brilho = 0.35 + 0.25 * Math.sin(f / 10);
  const verde = '#3DDC84';
  const { n, videoBox: v } = L;
  const t = p.frame.texts;
  const larg = L.canvas.w - 2 * M;
  return (
    <AbsoluteFill style={{ backgroundColor: '#0A0F1E' }}>
      <Principal p={p} caixa={v} />
      <div style={{ position: 'absolute', left: 0, top: v.h - n.fade, width: v.w, height: n.fade + 2, background: 'linear-gradient(180deg, rgba(10,15,30,0) 0%, #0A0F1E 100%)' }} />
      <div style={{ position: 'absolute', left: M, top: n.promiseY, width: larg, display: 'flex', justifyContent: 'center' }}>
        <Entra atraso={4} dist={40}>
          <Texto fit={L.text.promise} fonte="anton-400" largura={larg} caixaAlta cor="#fff" alinhar="center" style={{ textShadow: '0 8px 40px rgba(0,0,0,0.6)' }} destaque={{ color: verde }} />
        </Entra>
      </div>
      <div style={{ position: 'absolute', left: M, top: n.priceY, width: larg, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {t.price.from ? (
          <Entra atraso={14}>
            <div style={{ position: 'relative', fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.fromSize, color: '#8A93A6', whiteSpace: 'nowrap' }}>
              {ui.from} {t.price.from}
              <div style={{ position: 'absolute', left: -8, right: -8, top: '52%', height: 6, backgroundColor: '#FF4D4D', borderRadius: 3, transform: `scaleX(${Math.max(0, risco)}) rotate(-4deg)`, transformOrigin: 'left center' }} />
            </div>
          </Entra>
        ) : null}
        <Entra de="pop" atraso={26}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 22, height: n.priceH }}>
            <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.onlySize, color: '#fff', whiteSpace: 'nowrap' }}>{ui.only}</span>
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.priceSize, color: verde, letterSpacing: '-0.03em', whiteSpace: 'nowrap', textShadow: `0 0 60px rgba(61,220,132,${brilho})` }}>{t.price.to}</span>
          </div>
        </Entra>
      </div>
      <div style={{ position: 'absolute', left: M, top: n.ctaY, width: larg, display: 'flex', justifyContent: 'center' }}>
        <Entra atraso={32}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, backgroundColor: verde, borderRadius: 999, padding: `${n.ctaPadY}px ${n.ctaPadX}px`, boxShadow: '0 12px 40px rgba(61,220,132,0.35)' }}>
            <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.ctaSize, color: '#062814' }}>{t.cta}</span>
            <SetaBaixo tam={n.arrow} cor="#062814" espessura={3.2} style={{ transform: `translateY(${q}px)` }} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Story
export const Story: React.FC<PropsTpl<'story'>> = ({ p, L, cor, ui }) => {
  const { n } = L;
  const col = L.slots.column;
  // bloco de baixo; `cobre` = legenda queimada do campeão no caminho: verde e texto colados (cobrem a faixa), apoio por último
  const verde = (
    <Entra key="verde" de="pop" atraso={12}>
      <div style={{ backgroundColor: '#22C55E', borderRadius: 26, padding: `${n.greenPadY}px ${n.greenPadX}px`, boxShadow: '0 14px 40px rgba(34,197,94,0.35)', border: '3px solid rgba(255,255,255,0.35)' }}>
        <Texto fit={L.text.headline} fonte="montserrat-900" largura={820} cor="#fff" alinhar="center" style={{ textShadow: '0 2px 0 rgba(0,0,0,0.18)' }} />
      </div>
    </Entra>
  );
  const apoio = L.text.support ? (
    <Entra key="apoio" atraso={18}>
      <Texto fit={L.text.support} fonte="inter-800" largura={900} cor="#fff" alinhar="center" style={{ textShadow: SOMBRA.texto }} destaque={{ color: '#86EFAC' }} />
    </Entra>
  ) : null;
  const texto = (
    <Entra key="texto" atraso={24}>
      <div style={{ backgroundColor: '#fff', borderRadius: 30, padding: `${n.copyPadY}px ${n.copyPadX}px`, boxShadow: SOMBRA.cartao }}>
        <Texto fit={L.text.copy} fonte="inter-600" largura={876} cor="#1E1E24" destaque={{ fontWeight: 800, color: '#0F0F12', backgroundColor: '#FFE98A', padding: '0 6px', borderRadius: 6 }} />
      </div>
    </Entra>
  );
  const grupo = (cobre: boolean) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: n.gap }}>
      {cobre ? (<><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>{verde}{texto}</div>{apoio}</>) : (<>{verde}{apoio}{texto}</>)}
    </div>
  );
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal p={p} caixa={L.videoBox} filtro="brightness(0.8)" />
      <Veu de="cima" altura={n.veilTop} forca={0.5} />
      <Veu de="baixo" altura={n.veilBottom} forca={0.85} />
      <div style={{ position: 'absolute', left: col.x, width: col.w, top: col.y, height: col.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between' }}>
        <Entra de="pop" atraso={3} rot={-2}>
          <div style={{ width: n.cardW, borderRadius: 36, overflow: 'hidden', boxShadow: SOMBRA.cartao }}>
            <div style={{ background: `linear-gradient(120deg, #1F2A6B 0%, ${cor} 100%)`, padding: `${n.headPad}px 0`, textAlign: 'center', fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.headSize, color: '#fff' }}>{ui.askQuestion}</div>
            <div style={{ backgroundColor: '#fff', padding: `${n.bodyPadY}px ${n.bodyPadX}px ${n.bodyPadY + 6}px`, display: 'flex', justifyContent: 'center' }}>
              <Texto fit={L.text.question} fonte="montserrat-800" largura={n.cardW - 80} cor="#111" alinhar="center" />
            </div>
          </div>
        </Entra>
        {n.storyTop >= 0 ? <div /> : grupo(false)}
      </div>
      {n.storyTop >= 0 ? <div style={{ position: 'absolute', left: col.x, width: col.w, top: n.storyTop }}>{grupo(n.storyCobre === 1)}</div> : null}
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Leia a legenda (read_caption)
export const LeiaALegenda: React.FC<PropsTpl<'read_caption'>> = ({ p, L, ui }) => {
  const q = useQuique(12);
  const { n } = L;
  const larg = L.canvas.w - 2 * M;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal p={p} caixa={L.videoBox} />
      <Veu de="baixo" altura={n.veil} forca={0.85} />
      <div style={{ position: 'absolute', left: M, width: larg, top: n.headlineY, display: 'flex', justifyContent: 'center' }}>
        <Entra de="escala" atraso={4}>
          <Texto fit={L.text.headline} fonte="montserrat-900" largura={larg} cor="#fff" alinhar="center" style={{ letterSpacing: '-0.02em', textShadow: SOMBRA.texto }}
            destaque={{ color: '#111', backgroundColor: '#FFD43B', padding: '0 12px', borderRadius: 10, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone', textShadow: 'none' }} />
        </Entra>
      </div>
      <div style={{ position: 'absolute', left: 0, width: L.canvas.w, top: n.pillY, display: 'flex', justifyContent: 'center' }}>
        <Entra atraso={14}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 999, padding: `${n.pillPadY}px ${n.pillPadX}px`, boxShadow: SOMBRA.cartao }}>
            <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.pillSize, color: '#111' }}>{ui.readCaption}</span>
            <SetaBaixo tam={n.arrow} cor="#111" espessura={3.2} style={{ transform: `translateY(${q * 0.7}px)` }} />
          </div>
        </Entra>
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- POV + depoimento (pov_testimonial)
export const PovDepoimento: React.FC<PropsTpl<'pov_testimonial'>> = ({ p, L }) => {
  const f = useCurrentFrame();
  const pulso = 1 + 0.025 * Math.sin(f / 7);
  const { n, videoBox: v } = L;
  const cta = L.slots.cta;
  return (
    <AbsoluteFill style={{ backgroundColor: '#FAF8F4' }}>
      <div style={{ position: 'absolute', left: M, top: n.top, width: L.canvas.w - 2 * M }}>
        <Entra atraso={2}>
          <Texto fit={L.text.pov} fonte="inter-800" largura={L.canvas.w - 2 * M} cor="#16161A" style={{ letterSpacing: '-0.015em' }} destaque={{ fontFamily: FONTE.mont, fontWeight: 900, color: '#16161A' }} />
        </Entra>
      </div>
      <Entra de="escala" atraso={8} style={{ position: 'absolute', left: v.x, top: v.y, width: v.w, height: v.h, borderRadius: n.radius, overflow: 'hidden', boxShadow: SOMBRA.cartao }}>
        <Principal p={p} caixa={{ x: 0, y: 0, w: v.w, h: v.h }} />
      </Entra>
      <Entra atraso={16} style={{ position: 'absolute', left: cta.x, top: cta.y, width: cta.w }}>
        <div style={{ transform: `scale(${pulso})`, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, backgroundColor: '#16161A', borderRadius: 999, padding: `${n.ctaPadY}px 0`, boxShadow: SOMBRA.cartao }}>
          <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.ctaSize, color: '#fff', letterSpacing: '0.02em', textTransform: 'uppercase' }}>{p.frame.texts.cta}</span>
          <SetaBaixo tam={n.arrow} cor="#FFD43B" espessura={3.2} />
        </div>
      </Entra>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------- Live (sem número de espectadores, D9)
const CORACOES = [
  { x: 950, atraso: 10, d: 70, cor: '#FF3B6B', t: 54 }, { x: 900, atraso: 26, d: 80, cor: '#FFFFFF', t: 46 },
  { x: 980, atraso: 44, d: 75, cor: '#FF9F1C', t: 50 }, { x: 930, atraso: 70, d: 85, cor: '#FF3B6B', t: 58 },
  { x: 960, atraso: 96, d: 70, cor: '#C084FC', t: 48 }, { x: 910, atraso: 120, d: 80, cor: '#FF3B6B', t: 52 },
  { x: 970, atraso: 150, d: 75, cor: '#FFFFFF', t: 46 }, { x: 925, atraso: 176, d: 80, cor: '#FF9F1C', t: 54 },
];
export const Live: React.FC<PropsTpl<'live'>> = ({ p, L, ui }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const anel = 1 + 0.06 * Math.sin((f / fps) * Math.PI * 2);
  const { n } = L;
  // os corações recomeçam a cada 9 s (o protótipo tinha 8 s de peça; o campeão inteiro é bem mais longo)
  const ciclo = 9 * fps;
  const fc = f % ciclo;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Principal p={p} caixa={L.videoBox} zoom={1.02} />
      <Veu de="cima" altura={n.veilTop} forca={0.55} />
      <Veu de="baixo" altura={n.veilBottom} forca={0.6} />
      <div style={{ position: 'absolute', left: 44, right: 44, top: n.headTop, display: 'flex', alignItems: 'center', gap: 20 }}>
        <Entra de="esquerda" atraso={2} style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1 }}>
          <div style={{ width: n.avatar, height: n.avatar, borderRadius: 999, padding: 5, background: 'linear-gradient(135deg, #FF2D55, #FF8A3D)', transform: `scale(${anel})` }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', border: '4px solid #000' }}>
              <RostoImg p={p} />
            </div>
          </div>
          <span style={{ fontFamily: FONTE.inter, fontWeight: 800, fontSize: n.handleSize, color: '#fff', textShadow: SOMBRA.texto }}>{semArroba(p.frame.brand.handle)}</span>
          <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: n.badgeSize, color: '#fff', letterSpacing: '0.08em', background: 'linear-gradient(135deg, #FF2D55, #FF5E3A)', padding: '8px 18px', borderRadius: 10 }}>{ui.live}</span>
        </Entra>
        <Entra de="pop" atraso={6}><Fechar tam={n.close} cor="#fff" espessura={2.6} /></Entra>
      </div>
      {CORACOES.map((c, i) => {
        const t = fc - c.atraso;
        if (t < 0 || t > c.d) return null;
        const pr = t / c.d;
        const y = interpolate(pr, [0, 1], [n.heartFrom, n.heartTo]);
        const x = c.x + Math.sin(pr * Math.PI * 2 + i) * 26;
        const tam = c.t * n.heartScale;
        const o = interpolate(pr, [0, 0.15, 0.75, 1], [0, 1, 1, 0]);
        return <Coracao key={i} cheio tam={tam} cor={c.cor} style={{ position: 'absolute', left: x - tam / 2, top: y, opacity: o, transform: `scale(${0.7 + 0.5 * Math.min(1, pr * 3)})`, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.35))' }} />;
      })}
      <div style={{ position: 'absolute', left: 44, right: 44, top: n.barY, height: n.barH, display: 'flex', alignItems: 'center', gap: 24 }}>
        <Entra atraso={10} style={{ flex: 1 }}>
          <div style={{ height: n.barH - 4, borderRadius: 999, border: '2.5px solid rgba(255,255,255,0.85)', backgroundColor: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', padding: '0 40px', fontFamily: FONTE.inter, fontWeight: 600, fontSize: n.pillSize, color: 'rgba(255,255,255,0.9)' }}>{ui.comments}</div>
        </Entra>
        <Entra atraso={12}><Coracao tam={n.icon} cor="#fff" espessura={2.4} /></Entra>
        <Entra atraso={14}><Enviar tam={n.icon - 2} cor="#fff" espessura={2.4} /></Entra>
      </div>
    </AbsoluteFill>
  );
};

// Ícone da marca pros slides (usado no Meet).
export const MarcaLua: React.FC<{ nome: string; cor: string; h?: number; tam?: number }> = ({ nome, cor, h = 52, tam = 34 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: h }}>
    <div style={{ width: h, height: h, borderRadius: h * 0.27, backgroundColor: cor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Lua tam={h * 0.58} cor="#fff" /></div>
    <span style={{ fontFamily: FONTE.mont, fontWeight: 900, fontSize: tam, color: '#14162B' }}>{nome}</span>
  </div>
);

/** Altura de uma linha de label com line-height normal (pra quem precisa empilhar). */
export const linhaNormal = alturaLinhaNormal;
/** Caixa do vídeo com moldura própria (sombra/borda) — reexport pra duas-fontes. */
export { Caixa };
