// PROTÓTIPO 28/10 (v2): formato "Chat/DM" (estilo Instagram Direct, modo escuro). A dor/objeção do campeão vira
// pergunta do aluno; prova, mecanismo e oferta viram resposta da marca. Fecha numa cena de motion opaca (promessa +
// números reais + CTA). Tudo desenhado em código: sem print da landing, sem logo recortado, sem pessoa, nada pago.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, type CalculateMetadataFunction } from 'remotion';
import { CHAT, CHAT_FECHO, CHAT_HOOK, CTA_BOTAO, CTA_NOTA, PROVA, type MsgChat } from './roteiros';
import { BotaoCTA, clamp, Contador, DISPLAY, entrada, FPS, FundoMarca, Icone, Monograma, OURO, ROSA, Seta, Sfx, surge, TEXTO, useFontesZh, VERDE, VERMELHO } from './comum';

const W = 1080;
const FS = 52; // fonte da bolha (v2: era 42)
const LH = 1.32;
const PAD_V = 26;
const PAD_H = 36;
const MAX_TXT = 720;
const GAP = 18;
const AREA_TOPO = 450;
const AREA_ALTURA = 1250;
const DIGITANDO = 0.55;
const PERFIL_H = 560; // v2: cabeçalho de perfil no topo da conversa (como no Direct), tira o vazio do começo

const larguraTexto = (s: string, fs: number) => {
  let w = 0;
  for (const c of s) {
    const cp = c.codePointAt(0)!;
    if (cp > 0x1f000) w += fs * 1.15;
    else if (cp > 0x2e80) w += fs;
    else w += fs * 0.56;
  }
  return w;
};
const linhas = (s: string, fs: number, max: number) => Math.max(1, Math.ceil(larguraTexto(s, fs) / max));

const alturaMsg = (m: MsgChat) => {
  if (m.tipo === 'correcao') return 84 + ((m.errado?.length ?? 0) + (m.certo?.length ?? 0)) * 84 + 34;
  if (m.tipo === 'oferta') return 600;
  return linhas(m.zh, FS, MAX_TXT) * FS * LH + PAD_V * 2;
};
const leitura = (m: MsgChat) => {
  const n = m.tipo === 'correcao' ? 34 : m.tipo === 'oferta' ? 44 : [...m.zh].length;
  return Math.min(2.5, Math.max(1.2, n * 0.05));
};

type Agendada = { m: MsgChat; em: number; digitando: number | null; y: number; h: number };
const agenda = (() => {
  let t = 0.25; // v2: a 1ª mensagem entra já no começo (antes ficava 0,55 s de tela vazia)
  let y = PERFIL_H;
  const out: Agendada[] = [];
  CHAT.forEach((m, i) => {
    const anterior = CHAT[i - 1];
    let digitando: number | null = null;
    if (m.de === 'marca') {
      digitando = t;
      t += anterior?.de === 'marca' ? DIGITANDO * 0.6 : DIGITANDO;
    } else if (i > 0) t += 0.3;
    const h = alturaMsg(m);
    out.push({ m, em: t, digitando, y, h });
    y += h + GAP + (CHAT[i + 1] && CHAT[i + 1].de !== m.de ? 14 : 0);
    t += leitura(m);
  });
  return { msgs: out, fim: t };
})();
const FECHO_EM = agenda.fim + 0.1;
const FECHO_DUR = 4.4;
export const CHAT_DURACAO_SEC = FECHO_EM + FECHO_DUR;

export const calcularChat: CalculateMetadataFunction<Record<string, unknown>> = async () => ({
  durationInFrames: Math.round(CHAT_DURACAO_SEC * FPS), fps: FPS, width: 1080, height: 1920,
});

const TODO_TEXTO = [CHAT_HOOK.zh.join(''), ...CHAT.map((m) => m.zh + (m.errado ?? []).join('') + (m.certo ?? []).join('')), CHAT_FECHO.zh.join(''),
  PROVA.map((p) => p.zh).join(''), CTA_BOTAO, CTA_NOTA, 'amnayalife 線上英文老師 正在輸入… 傳送訊息… 今天 21:41 查看個人檔案 FREE'].join('');

const Bolha: React.FC<{ a: Agendada; t: number }> = ({ a, t }) => {
  const { m } = a;
  const eu = m.de === 'eu';
  const s = entrada(t, a.em, 190);
  const base: React.CSSProperties = {
    position: 'absolute', top: a.y, [eu ? 'right' : 'left']: eu ? 36 : 112,
    opacity: interpolate(s, [0, 0.4], [0, 1], clamp),
    scale: String(interpolate(s, [0, 1], [0.84, 1])),
    translate: `0px ${interpolate(s, [0, 1], [26, 0])}px`,
    transformOrigin: eu ? 'right bottom' : 'left bottom',
  };
  let corpo: React.ReactNode;
  if (m.tipo === 'correcao') {
    corpo = (
      <div style={{ background: '#1C1C1E', border: '2px solid #2E2E30', borderRadius: 36, padding: '24px 36px 28px', width: 800 }}>
        <div style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 36, color: OURO, letterSpacing: 2, height: 60 }}>{m.zh}</div>
        {(m.errado ?? []).map((l) => (
          <div key={l} style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 52, color: VERMELHO, height: 84, display: 'flex', alignItems: 'center', gap: 18 }}>
            <Icone nome="x" tam={46} cor={VERMELHO} largura={13} /><span style={{ textDecoration: 'line-through', textDecorationThickness: 5 }}>{l}</span>
          </div>
        ))}
        {(m.certo ?? []).map((l, i) => {
          const em = a.em + 0.3 + i * 0.4;
          return (
            <div key={l} style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 52, color: VERDE, height: 84, display: 'flex', alignItems: 'center', gap: 18, ...surge(t, em, 999, 0), translate: `${interpolate(entrada(t, em), [0, 1], [-30, 0])}px 0px` }}>
              <Icone nome="check" tam={46} cor={VERDE} largura={13} p={interpolate(t, [em, em + 0.3], [0, 1], clamp)} /><span>{l}</span>
            </div>
          );
        })}
      </div>
    );
  } else if (m.tipo === 'oferta') {
    // card da oferta desenhado em código (no lugar do card de link com print)
    corpo = (
      <div style={{ width: 800, borderRadius: 36, overflow: 'hidden', background: '#16141E', border: `3px solid ${OURO}` }}>
        <div style={{ height: 190, position: 'relative', background: 'linear-gradient(135deg, #2A2140 0%, #120F1C 70%)', display: 'flex', alignItems: 'center', padding: '0 40px', gap: 30, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: -60, top: -80, width: 320, height: 320, borderRadius: '50%', background: 'radial-gradient(circle, rgba(242,193,78,0.35) 0%, rgba(242,193,78,0) 65%)' }} />
          <Icone nome="chapeu" tam={110} p={interpolate(t, [a.em, a.em + 0.6], [0, 1], clamp)} largura={6} />
          <div>
            <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 30, color: '#16110A', background: OURO, borderRadius: 10, padding: '3px 12px' }}>FREE</span>
            <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 70, color: '#fff', marginTop: 6 }}>{m.zh}</div>
          </div>
        </div>
        <div style={{ padding: '26px 40px 30px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {(m.certo ?? []).map((l, i) => (
            <div key={l} style={{ ...surge(t, a.em + 0.3 + i * 0.3, 999, 16), display: 'flex', alignItems: 'center', gap: 16, fontFamily: TEXTO, fontWeight: 800, fontSize: 44, color: '#fff' }}>
              <Icone nome="check" tam={44} cor={VERDE} largura={13} p={interpolate(t, [a.em + 0.3 + i * 0.3, a.em + 0.6 + i * 0.3], [0, 1], clamp)} />{l}
            </div>
          ))}
          <div style={{ marginTop: 10, height: 104, borderRadius: 52, background: `linear-gradient(135deg, #FFE08A 0%, ${OURO} 55%, #E0A21C 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: TEXTO, fontWeight: 800, fontSize: 46, color: '#16110A', ...surge(t, a.em + 0.9, 999, 10) }}>{CTA_BOTAO}</div>
          <div style={{ textAlign: 'center', fontFamily: TEXTO, fontWeight: 600, fontSize: 30, color: '#A9A6B4' }}>{CTA_NOTA}</div>
        </div>
      </div>
    );
  } else {
    corpo = (
      <div style={{
        maxWidth: MAX_TXT + PAD_H * 2, padding: `${PAD_V}px ${PAD_H}px`, borderRadius: 48, fontFamily: TEXTO, fontWeight: 600, fontSize: FS, lineHeight: LH, color: '#fff',
        background: eu ? 'linear-gradient(135deg, #7B3FF2 0%, #4F5BD5 55%, #3797F0 100%)' : '#262626', wordBreak: 'break-word',
      }}>{m.zh}</div>
    );
  }
  return (
    <div style={base}>
      {!eu ? <div style={{ position: 'absolute', left: -82, bottom: 0 }}><Monograma tam={62} /></div> : null}
      {corpo}
    </div>
  );
};

const Perfil: React.FC<{ t: number }> = ({ t }) => (
  <div style={{ position: 'absolute', top: 10, left: 0, width: W, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, opacity: interpolate(t, [0, 0.2], [0.4, 1], clamp) }}>
    <Monograma tam={190} />
    <div style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 50, color: '#fff', marginTop: 8 }}>amnayalife</div>
    <div style={{ fontFamily: TEXTO, fontWeight: 600, fontSize: 34, color: '#8E8E93' }}>線上英文老師</div>
    <div style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 32, color: '#fff', background: '#262626', borderRadius: 18, padding: '12px 30px', marginTop: 6 }}>查看個人檔案</div>
    <div style={{ fontFamily: TEXTO, fontWeight: 600, fontSize: 28, color: '#6E6E73', marginTop: 18 }}>今天 21:41</div>
  </div>
);

const Digitando: React.FC<{ y: number; t: number }> = ({ y, t }) => (
  <div style={{ position: 'absolute', top: y, left: 112, background: '#262626', borderRadius: 48, padding: '34px 38px', display: 'flex', gap: 14 }}>
    <div style={{ position: 'absolute', left: -82, bottom: 0 }}><Monograma tam={62} /></div>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ width: 20, height: 20, borderRadius: 10, background: '#9A9A9F', translate: `0px ${-9 * Math.max(0, Math.sin(t * 9 - i * 0.9))}px`, opacity: 0.6 + 0.4 * Math.max(0, Math.sin(t * 9 - i * 0.9)) }} />
    ))}
  </div>
);

/** Cena final opaca (cobre tudo, nada de texto sobre bolha): promessa + números reais + CTA. */
const Fecho: React.FC<{ t: number }> = ({ t }) => {
  const e = entrada(t, FECHO_EM, 120);
  const de = FECHO_EM;
  return (
    <div style={{ position: 'absolute', inset: 0, translate: `0px ${interpolate(e, [0, 1], [1920, 0])}px` }}>
      <FundoMarca t={t} />
      <div style={{ position: 'absolute', top: 170, width: W, textAlign: 'center' }}>
        <div style={{ ...surge(t, de + 0.25), fontFamily: DISPLAY, fontWeight: 900, fontSize: 84, color: '#fff' }}>{CHAT_FECHO.zh[0]}</div>
        <div style={{ ...surge(t, de + 0.5), fontFamily: DISPLAY, fontWeight: 900, fontSize: 84, color: ROSA, marginTop: 10 }}>{CHAT_FECHO.zh[1]}</div>
      </div>
      <div style={{ position: 'absolute', top: 520, left: 0, width: W, display: 'flex', justifyContent: 'center', gap: 26 }}>
        {PROVA.map((p, i) => {
          const em = de + 0.8 + i * 0.18;
          return (
            <div key={p.zh} style={{ ...surge(t, em, 999, 60), width: 312, height: 400, borderRadius: 36, background: 'rgba(20,18,28,0.92)', border: `3px solid ${i === 1 ? OURO : 'rgba(255,255,255,0.22)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
              <Icone nome={i === 0 ? 'pessoas' : i === 1 ? 'estrela' : 'repetir'} tam={86} p={interpolate(t, [em, em + 0.6], [0, 1], clamp)} />
              <Contador t={t} emSec={em} valor={p.valor} casas={p.casas} prefixo={p.prefixo} sufixo={p.sufixo} dur={1.1} estilo={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: p.valor >= 1000 ? 58 : 82, color: '#fff' }} />
              <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 34, color: '#CFCBDA', textAlign: 'center', padding: '0 14px' }}>{p.zh}</span>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', top: 1080, width: W, display: 'flex', justifyContent: 'center' }}><BotaoCTA t={t} emSec={de + 1.7} texto={CTA_BOTAO} /></div>
      <div style={{ position: 'absolute', top: 1255, width: W, textAlign: 'center', ...surge(t, de + 1.9), fontFamily: TEXTO, fontWeight: 600, fontSize: 38, color: '#CFCBDA' }}>{CTA_NOTA}</div>
      <div style={{ position: 'absolute', top: 1370, width: W, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18, ...surge(t, de + 2.1), translate: `0px ${10 * Math.sin(t * 7)}px`, fontFamily: DISPLAY, fontWeight: 900, fontSize: 54, color: OURO }}>
        <Seta p={1} comp={80} ang={90} espessura={10} /> {CHAT_FECHO.zh[2]}
      </div>
    </div>
  );
};

const Conteudo: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const visiveis = agenda.msgs.filter((a) => a.em <= t + 0.001);
  const digitandoAgora = agenda.msgs.find((a) => a.digitando !== null && t >= a.digitando && t < a.em);
  const alvo = (tt: number) => {
    const vis = agenda.msgs.filter((a) => a.em <= tt);
    const dig = agenda.msgs.find((a) => a.digitando !== null && tt >= a.digitando && tt < a.em);
    const ult = vis[vis.length - 1];
    const fundo = dig ? dig.y + 120 : ult ? ult.y + ult.h : 0;
    return Math.max(0, fundo - AREA_ALTURA + 40);
  };
  const eventos = [0, ...agenda.msgs.flatMap((a) => (a.digitando !== null ? [a.digitando, a.em] : [a.em]))].sort((x, y) => x - y);
  let rolagem = 0;
  for (const e of eventos) {
    if (e > t) break;
    rolagem = interpolate(t, [e, e + 0.35], [alvo(e - 0.001), alvo(e)], { ...clamp, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
  }
  const hookP = (i: number) => entrada(t, 0.02 + i * 0.12, 220);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* manchete fixa do campeão (hook), com entrada cinética */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: W, height: 300, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: 36 }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 66, color: '#fff', lineHeight: 1.2, opacity: hookP(0), translate: `0px ${interpolate(hookP(0), [0, 1], [30, 0])}px` }}>
          <span style={{ color: ROSA }}>「我不方便」</span>你還在說
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 76, color: ROSA, lineHeight: 1.2, opacity: hookP(1), scale: String(interpolate(hookP(1), [0, 1], [0.6, 1])) }}>I'm not convenient？</div>
      </div>
      {/* cabeçalho do Direct */}
      <div style={{ position: 'absolute', top: 300, left: 0, width: W, height: 130, borderBottom: '1px solid #262626', display: 'flex', alignItems: 'center', padding: '0 36px', gap: 24, background: '#000' }}>
        <div style={{ fontFamily: TEXTO, fontSize: 58, color: '#fff', marginRight: 4 }}>‹</div>
        <Monograma tam={86} />
        <div>
          <div style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 40, color: '#fff' }}>amnayalife</div>
          <div style={{ fontFamily: TEXTO, fontWeight: 600, fontSize: 30, color: '#8E8E93' }}>{digitandoAgora ? '正在輸入…' : '線上英文老師'}</div>
        </div>
      </div>
      {/* mensagens */}
      <div style={{ position: 'absolute', top: AREA_TOPO, left: 0, width: W, height: AREA_ALTURA, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: 24, left: 0, width: W, translate: `0px ${-rolagem}px` }}>
          <Perfil t={t} />
          {visiveis.map((a) => <Bolha key={a.y} a={a} t={t} />)}
          {digitandoAgora ? <Digitando y={digitandoAgora.y} t={t} /> : null}
        </div>
      </div>
      {/* barra de digitar */}
      <div style={{ position: 'absolute', top: 1740, left: 36, width: W - 72, height: 110, borderRadius: 55, background: '#1C1C1E', display: 'flex', alignItems: 'center', padding: '0 40px', fontFamily: TEXTO, fontWeight: 600, fontSize: 36, color: '#8E8E93' }}>傳送訊息…</div>
      {t >= FECHO_EM - 0.05 ? <Fecho t={t} /> : null}
      {/* sfx */}
      {agenda.msgs.map((a) => <Sfx key={`s${a.y}`} arquivo={a.m.de === 'eu' ? 'envio' : 'pop'} emSec={a.em} volume={a.m.de === 'eu' ? 0.7 : 0.8} />)}
      <Sfx arquivo="envio" emSec={FECHO_EM} volume={0.6} />
      {PROVA.map((_, i) => <Sfx key={`p${i}`} arquivo="pop" emSec={FECHO_EM + 0.8 + i * 0.18} volume={0.5} />)}
      <Sfx arquivo="ding" emSec={FECHO_EM + 1.7} />
    </AbsoluteFill>
  );
};

export const ChatDM: React.FC = () => {
  const pronto = useFontesZh(TODO_TEXTO);
  return <AbsoluteFill style={{ background: '#000' }}>{pronto ? <Conteudo /> : null}</AbsoluteFill>;
};
