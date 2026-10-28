// Template `chat-dm` (iterate-v2 F1.1/F1.4), promovido do protótipo aprovado de 28/10 (src/prototipos/formatos/ChatDM.tsx).
// Conversa estilo Direct, modo escuro: a dor/objeção do campeão vira pergunta de quem quer comprar; prova, mecanismo e
// oferta viram resposta da marca. Fecha numa cena de motion opaca (promessa + números reais do Brain + CTA).
// Tudo desenhado em código: sem print da landing, sem logo (monograma), sem pessoa, sem vídeo do campeão. Áudio: só SFX.
// A agenda (quando cada mensagem entra, altura, y) vem PRONTA do builder (chatTimeline, mesma medida do fitText).
import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import { CHAT_AREA_H, CHAT_GEO, PROOF_ROW, fechoChatGeo, TEMPLATE_H, TEMPLATE_SAFE, TEMPLATE_W, chatLayout, type ChatDmProps, type ChatMessageProps, type TemplateProps } from '../lib/templatesFormato';
import type { FittedText } from '../lib/molduras';
import { BotaoCTA, clamp, Contador, coresDaMarca, entrada, FPS, fonte, FundoMarca, Icone, iconeDaProva, Linhas, Monograma, Seta, Sfx, surge, VERDE, VERMELHO, type Cores } from './comum';

const W = TEMPLATE_W;
type Fits = Map<string, FittedText>;
type Comum = Pick<TemplateProps, 'brand' | 'language' | 'sfx'>;

const Bolha: React.FC<{ m: ChatMessageProps; i: number; t: number; fits: Fits; cores: Cores; brand: Comum['brand']; cta: ChatDmProps['cta'] }> = ({ m, i, t, fits, cores, brand, cta }) => {
  const eu = m.from === 'prospect';
  const s = entrada(t, m.atSec, 190);
  const f = (k: string) => fits.get(`messages.${i}.${k}`)!;
  const base: React.CSSProperties = {
    position: 'absolute', top: m.y, [eu ? 'right' : 'left']: eu ? 36 : 112,
    opacity: interpolate(s, [0, 0.4], [0, 1], clamp),
    scale: String(interpolate(s, [0, 1], [0.84, 1])),
    translate: `0px ${interpolate(s, [0, 1], [26, 0])}px`,
    transformOrigin: eu ? 'right bottom' : 'left bottom',
  };
  let corpo: React.ReactNode;
  if (m.kind === 'correction') {
    corpo = (
      <div style={{ background: '#1C1C1E', border: '2px solid #2E2E30', borderRadius: 36, padding: '24px 36px 28px', width: CHAT_GEO.cardW, boxSizing: 'border-box' }}>
        <div style={{ height: 56, letterSpacing: 2 }}><Linhas fit={f('title')} font="inter-800" cor={cores.acento} align="left" /></div>
        {m.wrong.map((_, k) => (
          <div key={`w${k}`} style={{ minHeight: 76, display: 'flex', alignItems: 'center', gap: 18, padding: '10px 0' }}>
            <Icone nome="x" tam={46} cor={VERMELHO} largura={13} />
            <Linhas fit={f(`wrong.${k}`)} font="inter-800" cor={VERMELHO} align="left" riscado />
          </div>
        ))}
        {m.right.map((_, k) => {
          const em = m.atSec + 0.3 + k * 0.4;
          return (
            <div key={`r${k}`} style={{ minHeight: 76, display: 'flex', alignItems: 'center', gap: 18, padding: '10px 0', ...surge(t, em, 999, 0), translate: `${interpolate(entrada(t, em), [0, 1], [-30, 0])}px 0px` }}>
              <Icone nome="check" tam={46} cor={VERDE} largura={13} p={interpolate(t, [em, em + 0.3], [0, 1], clamp)} />
              <Linhas fit={f(`right.${k}`)} font="inter-800" cor={VERDE} align="left" />
            </div>
          );
        })}
      </div>
    );
  } else if (m.kind === 'offer') {
    // card da oferta desenhado em código (nunca print, nunca imagem do produto)
    corpo = (
      <div style={{ width: CHAT_GEO.cardW, borderRadius: 36, overflow: 'hidden', background: '#16141E', border: `3px solid ${cores.acento}` }}>
        <div style={{ minHeight: 190, position: 'relative', background: 'linear-gradient(135deg, #2A2140 0%, #120F1C 70%)', display: 'flex', alignItems: 'center', padding: '24px 40px', gap: 30, overflow: 'hidden', boxSizing: 'border-box' }}>
          <div style={{ position: 'absolute', right: -60, top: -80, width: 320, height: 320, borderRadius: '50%', background: `radial-gradient(circle, ${cores.acento}55 0%, ${cores.acento}00 65%)` }} />
          <Icone nome="gift" tam={110} cor={cores.acento} p={interpolate(t, [m.atSec, m.atSec + 0.6], [0, 1], clamp)} largura={6} />
          <Linhas fit={f('title')} font="montserrat-900" cor="#fff" align="left" />
        </div>
        <div style={{ padding: '26px 40px 30px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {m.right.map((_, k) => (
            <div key={k} style={{ ...surge(t, m.atSec + 0.3 + k * 0.3, 999, 16), display: 'flex', alignItems: 'center', gap: 16 }}>
              <Icone nome="check" tam={44} cor={VERDE} largura={13} p={interpolate(t, [m.atSec + 0.3 + k * 0.3, m.atSec + 0.6 + k * 0.3], [0, 1], clamp)} />
              <Linhas fit={f(`right.${k}`)} font="inter-800" cor="#fff" align="left" />
            </div>
          ))}
          <div style={{ marginTop: 10, height: 104, borderRadius: 52, background: `linear-gradient(135deg, ${cores.claro} 0%, ${cores.acento} 55%, ${cores.escuro} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, ...surge(t, m.atSec + 0.9, 999, 10) }}>
            <Linhas fit={f('button')} font="inter-800" cor={cores.sobre} />
            <Seta p={1} comp={48} cor={cores.sobre} espessura={7} />
          </div>
          {cta.note ? <Linhas fit={f('note')} font="inter-600" cor="#A9A6B4" /> : null}
        </div>
      </div>
    );
  } else {
    corpo = (
      <div style={{
        padding: `${CHAT_GEO.padV}px ${CHAT_GEO.padH}px`, borderRadius: 48,
        background: eu ? 'linear-gradient(135deg, #7B3FF2 0%, #4F5BD5 55%, #3797F0 100%)' : '#262626',
      }}>
        <Linhas fit={f('text')} font="inter-600" cor="#fff" align="left" />
      </div>
    );
  }
  return (
    <div style={base}>
      {!eu ? <div style={{ position: 'absolute', left: -82, bottom: 0 }}><Monograma tam={62} iniciais={brand.initials} cores={cores} /></div> : null}
      {corpo}
    </div>
  );
};

const Perfil: React.FC<{ t: number; brand: Comum['brand']; status: FittedText; cores: Cores }> = ({ t, brand, status, cores }) => (
  <div style={{ position: 'absolute', top: 10, left: 0, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, opacity: interpolate(t, [0, 0.2], [0.4, 1], clamp) }}>
    <Monograma tam={180} iniciais={brand.initials} cores={cores} />
    <div style={{ ...fonte('inter-800'), fontSize: 48, color: '#fff', marginTop: 8, whiteSpace: 'pre' }}>{brand.name}</div>
    {brand.handle ? <div style={{ ...fonte('inter-600'), fontSize: 34, color: '#8E8E93', whiteSpace: 'pre' }}>{brand.handle}</div> : null}
    <Linhas fit={status} font="inter-600" cor="#8E8E93" />
  </div>
);

const Digitando: React.FC<{ y: number; t: number; brand: Comum['brand']; cores: Cores }> = ({ y, t, brand, cores }) => (
  <div style={{ position: 'absolute', top: y, left: 112, background: '#262626', borderRadius: 48, padding: '34px 38px', display: 'flex', gap: 14 }}>
    <div style={{ position: 'absolute', left: -82, bottom: 0 }}><Monograma tam={62} iniciais={brand.initials} cores={cores} /></div>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ width: 20, height: 20, borderRadius: 10, background: '#9A9A9F', translate: `0px ${-9 * Math.max(0, Math.sin(t * 9 - i * 0.9))}px`, opacity: 0.6 + 0.4 * Math.max(0, Math.sin(t * 9 - i * 0.9)) }} />
    ))}
  </div>
);

/** Cena final opaca (cobre tudo, nada de texto sobre bolha): promessa + números reais do Brain + CTA. */
const Fecho: React.FC<{ t: number; p: ChatDmProps; fits: Fits; cores: Cores; sfx: Comum['sfx'] }> = ({ t, p, fits, cores }) => {
  const de = p.close.atSec;
  const e = entrada(t, de, 120);
  const linhas = p.close.lines.map((_, k) => fits.get(`close.lines.${k}`)!);
  const nota = p.cta.note ? fits.get('cta.note')! : null;
  const geo = fechoChatGeo(linhas.map((x) => x.height), p.proof.length, nota ? nota.height : null);
  return (
    <div style={{ position: 'absolute', inset: 0, translate: `0px ${interpolate(e, [0, 1], [TEMPLATE_H, 0])}px` }}>
      <FundoMarca t={t} cores={cores} />
      <div style={{ position: 'absolute', top: geo.topoLinhas, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        {linhas.map((f, k) => <div key={k} style={surge(t, de + 0.25 + k * 0.25)}><Linhas fit={f} font="montserrat-900" cor={k === 1 ? cores.acento : '#fff'} /></div>)}
      </div>
      <ProvaEmLinhas t={t} de={de + 0.8} top={geo.topoProva} proof={p.proof} fits={fits} slot="proof" cores={cores} />
      <div style={{ position: 'absolute', top: geo.topoCta, width: W, display: 'flex', justifyContent: 'center' }}>
        <BotaoCTA t={t} emSec={de + 0.8 + p.proof.length * 0.18 + 0.4} fit={fits.get('cta.button')!} cores={cores} />
      </div>
      {nota ? (
        <div style={{ position: 'absolute', top: geo.topoNota, width: W, display: 'flex', justifyContent: 'center', ...surge(t, de + 1.9) }}>
          <Linhas fit={nota} font="inter-600" cor="#CFCBDA" />
        </div>
      ) : null}
    </div>
  );
};

/** Números reais (Brain › proof) em linhas: ícone, contador e rótulo. */
export const ProvaEmLinhas: React.FC<{ t: number; de: number; top: number; proof: ChatDmProps['proof']; fits: Fits; slot: string; cores: Cores }> = ({ t, de, top, proof, fits, slot, cores }) => (
  <div style={{ position: 'absolute', top, left: (W - PROOF_ROW.w) / 2, width: PROOF_ROW.w, display: 'flex', flexDirection: 'column', gap: 22 }}>
    {proof.map((pp, i) => {
      const em = de + i * 0.18;
      return (
        <div key={i} style={{ ...surge(t, em, 999, 60), height: PROOF_ROW.h, borderRadius: 36, background: 'rgba(20,18,28,0.92)', border: `3px solid ${i === 0 ? cores.acento : 'rgba(255,255,255,0.22)'}`, display: 'flex', alignItems: 'center', padding: '0 36px', gap: 26, boxSizing: 'border-box' }}>
          <Icone nome={iconeDaProva(i)} tam={78} cor={cores.acento} p={interpolate(t, [em, em + 0.6], [0, 1], clamp)} />
          <div style={{ width: PROOF_ROW.numW, flexShrink: 0 }}><Contador t={t} emSec={em} p={pp} fit={fits.get(`${slot}.${i}.value`)!} cor="#fff" /></div>
          <Linhas fit={fits.get(`${slot}.${i}.label`)!} font="inter-800" cor="#CFCBDA" align="left" />
        </div>
      );
    })}
  </div>
);

const Conteudo: React.FC<{ p: ChatDmProps; c: Comum }> = ({ p, c }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const cores = useMemo(() => coresDaMarca(c.brand.color), [c.brand.color]);
  const fits = useMemo(() => new Map(chatLayout(p, c.language).map((x) => [x.slot, x.fit])), [p, c.language]);
  const msgs = p.messages;
  const visiveis = msgs.map((m, i) => ({ m, i })).filter(({ m }) => m.atSec <= t + 0.001);
  const digitandoAgora = msgs.find((m) => m.typingSec !== null && t >= m.typingSec && t < m.atSec);
  const alvo = (tt: number) => {
    const vis = msgs.filter((m) => m.atSec <= tt);
    const dig = msgs.find((m) => m.typingSec !== null && tt >= m.typingSec && tt < m.atSec);
    const ult = vis[vis.length - 1];
    const fundo = dig ? dig.y + 120 : ult ? ult.y + ult.h : 0;
    return Math.max(0, fundo - CHAT_AREA_H + 40);
  };
  const eventos = [0, ...msgs.flatMap((m) => (m.typingSec !== null ? [m.typingSec, m.atSec] : [m.atSec]))].sort((x, y) => x - y);
  let rolagem = 0;
  for (const e of eventos) {
    if (e > t) break;
    rolagem = interpolate(t, [e, e + 0.35], [alvo(e - 0.001), alvo(e)], { ...clamp, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  }
  const hookP = entrada(t, 0.02, 220);
  const hook = fits.get('hook')!;
  const g = CHAT_GEO;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* manchete fixa: o gancho do campeão */}
      <div style={{ position: 'absolute', top: g.hookTop, left: 0, width: W, height: g.hookH, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: hookP, translate: `0px ${interpolate(hookP, [0, 1], [30, 0])}px` }}>
        <Linhas fit={hook} font="montserrat-900" cor="#fff" destaque={p.hook.highlight} corDestaque={cores.acento} />
      </div>
      {/* cabeçalho do Direct */}
      <div style={{ position: 'absolute', top: g.headerTop, left: 0, width: W, height: g.headerH, borderBottom: '1px solid #262626', borderTop: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', padding: '0 36px', gap: 24, background: '#000', boxSizing: 'border-box' }}>
        <Seta p={1} comp={44} cor="#fff" ang={180} espessura={7} />
        <Monograma tam={82} iniciais={c.brand.initials} cores={cores} />
        <div>
          <div style={{ ...fonte('inter-800'), fontSize: 40, color: '#fff', whiteSpace: 'pre' }}>{c.brand.name}</div>
          <Linhas fit={digitandoAgora ? fits.get('chrome.typing')! : fits.get('chrome.profileStatus')!} font="inter-600" cor="#8E8E93" align="left" />
        </div>
      </div>
      {/* mensagens */}
      <div style={{ position: 'absolute', top: g.areaTop, left: 0, width: W, height: CHAT_AREA_H, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 24, left: 0, width: W, translate: `0px ${-rolagem}px` }}>
          <Perfil t={t} brand={c.brand} status={fits.get('chrome.profileStatus')!} cores={cores} />
          {visiveis.map(({ m, i }) => <Bolha key={i} m={m} i={i} t={t} fits={fits} cores={cores} brand={c.brand} cta={p.cta} />)}
          {digitandoAgora ? <Digitando y={digitandoAgora.y} t={t} brand={c.brand} cores={cores} /> : null}
        </div>
      </div>
      {/* barra de digitar */}
      <div style={{ position: 'absolute', top: TEMPLATE_H - TEMPLATE_SAFE.bottom - g.inputH, left: 36, width: W - 72, height: g.inputH, borderRadius: g.inputH / 2, background: '#1C1C1E', display: 'flex', alignItems: 'center', padding: '0 40px', boxSizing: 'border-box' }}>
        <Linhas fit={fits.get('chrome.inputPlaceholder')!} font="inter-600" cor="#8E8E93" align="left" />
      </div>
      {t >= p.close.atSec - 0.05 ? <Fecho t={t} p={p} fits={fits} cores={cores} sfx={c.sfx} /> : null}
      {msgs.map((m, i) => <Sfx key={`s${i}`} sfx={c.sfx} arquivo={m.from === 'prospect' ? 'send' : 'pop'} emSec={m.atSec} volume={m.from === 'prospect' ? 0.7 : 0.8} />)}
      <Sfx sfx={c.sfx} arquivo="send" emSec={p.close.atSec} volume={0.6} />
      {p.proof.map((_, i) => <Sfx key={`p${i}`} sfx={c.sfx} arquivo="pop" emSec={p.close.atSec + 0.8 + i * 0.18} volume={0.5} />)}
      <Sfx sfx={c.sfx} arquivo="ding" emSec={p.close.atSec + 0.8 + p.proof.length * 0.18 + 0.4} />
    </AbsoluteFill>
  );
};

export const ChatDM: React.FC<{ p: ChatDmProps; c: Comum }> = ({ p, c }) => <Conteudo p={p} c={c} />;
