// PROTÓTIPO 28/10 (v2): formato "pessoa + motion" (antes "green screen sobre print"; o Gusta vetou o print da landing).
// Em cima, um palco de motion graphics em código (texto cinético, cards errado → certo, esquema, ícones, contadores,
// CTA) sincronizado à legenda palavra a palavra; embaixo, o rosto/voz são 5 recortes do campeão (placeholder: no produto
// seria o avatar de IA). Nenhum print, nenhuma imagem gerada, nada pago.
import React from 'react';
import { AbsoluteFill, Easing, Img, OffthreadVideo, interpolate, staticFile, useCurrentFrame, type CalculateMetadataFunction } from 'remotion';
import { CTA_BOTAO, CTA_NOTA, GS_FALA_SEC, GS_FIM_SEC, GS_FRASES, GS_RECORTES, PROVA, gsTempo } from './roteiros';
import { BotaoCTA, clamp, Contador, DISPLAY, entrada, FPS, FundoMarca, Icone, OURO, ROSA, ROXO, Seta, Sfx, surge, TEXTO, useFontesZh, VERDE, VERMELHO } from './comum';

const W = 1080;
export const GS_DURACAO_SEC = GS_FALA_SEC + GS_FIM_SEC;
const FIM_FALA = GS_FALA_SEC;
const T = gsTempo; // T(recorte, segundoNoCampeão) -> segundo no vídeo novo
const INICIO = GS_RECORTES.map((_, i) => T(i, GS_RECORTES[i][0]));

export const calcularGS: CalculateMetadataFunction<Record<string, unknown>> = async () => ({
  durationInFrames: Math.round(GS_DURACAO_SEC * FPS), fps: FPS, width: 1080, height: 1920,
});

const TODO_TEXTO = GS_FRASES.flatMap((f) => f.palavras.map((p) => p[1])).join('') +
  '你也這樣說嗎有點奇怪正確說法逐字翻譯中文想法一個字一個字英文開口英文邏輯中文邏輯≠直接翻譯意思歪掉我們教你英文背後的思考模式文化語境語言邏輯免費公開課台灣人最常見的英文盲點從根源解決連結在下面' +
  PROVA.map((p) => p.zh).join('') + CTA_BOTAO + CTA_NOTA;

// ───────────── utilidades de cena ─────────────
const Centro: React.FC<{ top: number; children: React.ReactNode; estilo?: React.CSSProperties }> = ({ top, children, estilo }) => (
  <div style={{ position: 'absolute', top, left: 0, width: W, display: 'flex', justifyContent: 'center', ...estilo }}>{children}</div>
);
const Card: React.FC<{ cor: string; children: React.ReactNode; estilo?: React.CSSProperties }> = ({ cor, children, estilo }) => (
  <div style={{ background: 'rgba(20,18,28,0.92)', border: `3px solid ${cor}`, borderRadius: 32, padding: '26px 40px', boxShadow: `0 16px 50px rgba(0,0,0,0.55), 0 0 40px ${cor}33`, ...estilo }}>{children}</div>
);

// ───────────── cena 0: hook ─────────────
const CenaHook: React.FC<{ t: number }> = ({ t }) => {
  const fim = INICIO[1];
  const palavras: [number, string][] = [[T(0, 1.12), "I'm"], [T(0, 1.46), 'not'], [T(0, 1.58), 'convenient']];
  const risco = interpolate(t, [T(0, 2.16), T(0, 2.16) + 0.25], [0, 1], { ...clamp, easing: Easing.bezier(0.6, 0, 0.3, 1) });
  return (
    <>
      <Centro top={250}><div style={{ ...surge(t, 0.05, fim), fontFamily: TEXTO, fontWeight: 800, fontSize: 56, color: '#CFCBDA', padding: '14px 34px', borderRadius: 60, background: 'rgba(255,255,255,0.08)' }}>你跟外國同事說過…</div></Centro>
      <Centro top={460}>
        <div style={{ position: 'relative', display: 'flex', gap: 22, alignItems: 'baseline' }}>
          {palavras.map(([em, w]) => (
            <span key={w} style={{ ...surge(t, em, fim, 60), fontFamily: DISPLAY, fontWeight: 900, fontSize: 96, color: '#fff', display: 'inline-block' }}>{w}</span>
          ))}
          <div style={{ position: 'absolute', left: -10, top: '52%', height: 14, borderRadius: 7, background: VERMELHO, width: `${risco * 104}%`, boxShadow: `0 0 24px ${VERMELHO}`, opacity: interpolate(t, [fim - 0.22, fim], [1, 0], clamp) }} />
        </div>
      </Centro>
      <Centro top={640}><span style={{ ...surge(t, T(0, 2.16), fim, 80), fontFamily: DISPLAY, fontWeight: 900, fontSize: 220, color: ROSA, display: 'inline-block', textShadow: `0 0 50px ${ROSA}88` }}>？</span></Centro>
    </>
  );
};

// ───────────── cena 1: errado → certo ─────────────
const CenaCorrecao: React.FC<{ t: number }> = ({ t }) => {
  const [de, ate] = [INICIO[1], INICIO[2]];
  const linhaCerta = (txt: string, em: number) => (
    <div style={{ ...surge(t, em, ate), display: 'flex', alignItems: 'center', gap: 22 }}>
      <Icone nome="check" tam={66} cor={VERDE} p={interpolate(t, [em, em + 0.35], [0, 1], clamp)} largura={12} />
      <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 64, color: VERDE }}>{txt}</span>
    </div>
  );
  return (
    <>
      <Centro top={150}>
        <Card cor={VERMELHO} estilo={{ ...surge(t, de + 0.02, ate), display: 'flex', alignItems: 'center', gap: 22 }}>
          <Icone nome="x" tam={60} cor={VERMELHO} largura={12} p={interpolate(t, [de, de + 0.3], [0, 1], clamp)} />
          <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 72, color: VERMELHO, textDecoration: 'line-through', textDecorationThickness: 6 }}>I'm not convenient</span>
        </Card>
      </Centro>
      <div style={{ position: 'absolute', top: 345, right: 90, ...surge(t, T(1, 23.3), ate), rotate: `${-6 + 3 * Math.sin(t * 9)}deg`, fontFamily: TEXTO, fontWeight: 800, fontSize: 52, color: '#1A1205', background: OURO, padding: '10px 28px', borderRadius: 16 }}>有點奇怪…</div>
      <Centro top={440}>
        <div style={{ ...surge(t, T(1, 23.7), ate, 20), display: 'flex', alignItems: 'center', gap: 20 }}>
          <Seta p={interpolate(t, [T(1, 23.7), T(1, 24.5)], [0, 1], clamp)} comp={150} ang={90} cor={OURO} />
          <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 58, color: OURO }}>正確說法</span>
        </div>
      </Centro>
      <Centro top={660}>
        <Card cor={VERDE} estilo={{ ...surge(t, T(1, 25.16), ate), display: 'flex', flexDirection: 'column', gap: 26, padding: '34px 44px' }}>
          {linhaCerta("It's not convenient for me", T(1, 25.16))}
          {linhaCerta("I'm a bit tied up right now", T(1, 26.54))}
        </Card>
      </Centro>
    </>
  );
};

// ───────────── cena 2: causa-raiz (逐字翻譯) ─────────────
const No: React.FC<{ t: number; em: number; ate: number; txt: string; cor?: string; apagar?: number }> = ({ t, em, ate, txt, cor = '#fff', apagar }) => (
  <div style={{ ...surge(t, em, ate), opacity: Number(surge(t, em, ate).opacity) * (apagar !== undefined ? interpolate(t, [apagar, apagar + 0.3], [1, 0.35], clamp) : 1), fontFamily: TEXTO, fontWeight: 800, fontSize: 52, color: cor, background: 'rgba(255,255,255,0.07)', border: '2px solid rgba(255,255,255,0.18)', borderRadius: 22, padding: '18px 24px', whiteSpace: 'nowrap' }}>{txt}</div>
);
const CenaRaiz: React.FC<{ t: number }> = ({ t }) => {
  const ate = INICIO[3];
  const apaga = T(2, 50.08);
  const sp = (a: number, b: number) => interpolate(t, [a, b], [0, 1], clamp);
  const torto = interpolate(t, [T(2, 53.64), T(2, 53.64) + 0.35], [0, 1], { ...clamp, easing: Easing.bezier(0.3, 1.6, 0.5, 1) });
  return (
    <>
      <Centro top={110}>
        <div style={{ ...surge(t, T(2, 45.2), ate), display: 'flex', alignItems: 'center', gap: 16, rotate: '-3deg', border: `6px solid ${VERMELHO}`, borderRadius: 18, padding: '10px 30px', fontFamily: DISPLAY, fontWeight: 900, fontSize: 76, color: VERMELHO }}>
          逐字翻譯 <Icone nome="x" tam={60} cor={VERMELHO} largura={14} />
        </div>
      </Centro>
      <div style={{ position: 'absolute', top: 310, left: 0, width: W, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 4 }}>
        <No t={t} em={T(2, 46.94)} ate={ate} txt="中文想法" apagar={apaga} />
        <div style={{ opacity: interpolate(t, [apaga, apaga + 0.3], [1, 0.35], clamp) }}><Seta p={sp(T(2, 47.4), T(2, 47.8))} comp={70} espessura={8} /></div>
        <No t={t} em={T(2, 47.58)} ate={ate} txt="一個字一個字" apagar={apaga} />
        <div style={{ opacity: interpolate(t, [apaga, apaga + 0.3], [1, 0.35], clamp) }}><Seta p={sp(T(2, 48.7), T(2, 49.0))} comp={70} espessura={8} /></div>
        <No t={t} em={T(2, 49.0)} ate={ate} txt="英文" apagar={apaga} />
      </div>
      <div style={{ position: 'absolute', top: 450, right: 90, ...surge(t, T(2, 49.68), ate), opacity: Number(surge(t, T(2, 49.68), ate).opacity) * interpolate(t, [apaga, apaga + 0.3], [1, 0.35], clamp), display: 'flex', alignItems: 'center', gap: 12, fontFamily: TEXTO, fontWeight: 800, fontSize: 48, color: '#CFCBDA' }}>
        <Icone nome="fala" tam={64} cor="#CFCBDA" largura={7} /> 然後才開口
      </div>
      <div style={{ position: 'absolute', top: 620, left: 0, width: W, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 34 }}>
        <Card cor={OURO} estilo={{ ...surge(t, T(2, 50.32), ate), fontFamily: TEXTO, fontWeight: 800, fontSize: 62, color: OURO }}>英文邏輯</Card>
        <span style={{ ...surge(t, T(2, 51.68), ate, 0), scale: String(interpolate(entrada(t, T(2, 51.68), 260), [0, 1], [2.2, 1])), fontFamily: DISPLAY, fontWeight: 900, fontSize: 110, color: ROSA, display: 'inline-block' }}>≠</span>
        <Card cor={ROXO} estilo={{ ...surge(t, T(2, 50.74), ate), fontFamily: TEXTO, fontWeight: 800, fontSize: 62, color: '#C4B5FD' }}>中文邏輯</Card>
      </div>
      <Centro top={880}>
        <div style={{ ...surge(t, T(2, 52.28), ate), display: 'flex', alignItems: 'center', gap: 24 }}>
          <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 64, color: '#fff' }}>直接翻譯</span>
          <Seta p={interpolate(t, [T(2, 52.5), T(2, 52.86)], [0, 1], clamp)} comp={110} />
          <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 76, color: torto > 0 ? VERMELHO : '#fff', display: 'inline-block', rotate: `${torto * 17}deg`, translate: `0px ${torto * 14}px`, opacity: Number(surge(t, T(2, 52.86), ate).opacity) }}>意思</span>
          <span style={{ ...surge(t, T(2, 53.64), ate), fontFamily: DISPLAY, fontWeight: 900, fontSize: 56, color: VERMELHO }}>歪掉</span>
        </div>
      </Centro>
    </>
  );
};

// ───────────── cena 3: método ─────────────
const CenaMetodo: React.FC<{ t: number }> = ({ t }) => {
  const [de, ate] = [INICIO[3], INICIO[4]];
  const tiles: { em: number; icone: 'cerebro' | 'globo' | 'elo'; zh: string }[] = [
    { em: T(3, 63.66), icone: 'cerebro', zh: '思考模式' },
    { em: T(3, 64.5), icone: 'globo', zh: '文化語境' },
    { em: T(3, 65.46), icone: 'elo', zh: '語言邏輯' },
  ];
  return (
    <>
      <Centro top={170}><span style={{ ...surge(t, de + 0.02, ate), fontFamily: TEXTO, fontWeight: 800, fontSize: 60, color: '#CFCBDA' }}>我們教你</span></Centro>
      <Centro top={270}><span style={{ ...surge(t, T(3, 62.82), ate), fontFamily: DISPLAY, fontWeight: 900, fontSize: 96, color: '#fff' }}>英文<span style={{ color: OURO }}>背後</span>的思考</span></Centro>
      <div style={{ position: 'absolute', top: 520, left: 0, width: W, display: 'flex', justifyContent: 'center', gap: 30 }}>
        {tiles.map((x) => (
          <div key={x.zh} style={{ ...surge(t, x.em, ate, 70), width: 300, height: 400, borderRadius: 36, background: 'rgba(20,18,28,0.92)', border: `3px solid ${OURO}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28, boxShadow: `0 0 40px ${OURO}22` }}>
            <Icone nome={x.icone} tam={150} p={interpolate(t, [x.em, x.em + 0.6], [0, 1], clamp)} />
            <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 56, color: '#fff' }}>{x.zh}</span>
          </div>
        ))}
      </div>
    </>
  );
};

// ───────────── cena 4: oferta + CTA; fim: prova (números reais) ─────────────
const CenaOferta: React.FC<{ t: number }> = ({ t }) => {
  const ate = FIM_FALA; // título e checklist saem; o botão fica
  const item = (txt: string, em: number, icone: 'alvo' | 'raiz') => (
    <div style={{ ...surge(t, em, ate), display: 'flex', alignItems: 'center', gap: 24 }}>
      <Icone nome={icone} tam={78} p={interpolate(t, [em, em + 0.5], [0, 1], clamp)} />
      <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 58, color: '#fff' }}>{txt}</span>
    </div>
  );
  return (
    <>
      <Centro top={120}>
        <div style={{ ...surge(t, T(4, 74.92), ate), display: 'flex', alignItems: 'center', gap: 22 }}>
          <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 40, color: '#16110A', background: OURO, borderRadius: 14, padding: '6px 18px', rotate: '-6deg', display: 'inline-block' }}>FREE</span>
          <span style={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: 104, color: '#fff' }}>免費<span style={{ color: OURO }}>公開課</span></span>
        </div>
      </Centro>
      <Centro top={330}>
        <Card cor="rgba(255,255,255,0.25)" estilo={{ ...surge(t, T(4, 76.28), ate), display: 'flex', flexDirection: 'column', gap: 30, padding: '36px 48px' }}>
          {item('台灣人最常見的英文盲點', T(4, 77.1), 'alvo')}
          {item('從根源解決', T(4, 79.42), 'raiz')}
        </Card>
      </Centro>
    </>
  );
};
const CenaProva: React.FC<{ t: number }> = ({ t }) => {
  const de = FIM_FALA + 0.05;
  return (
    <div style={{ position: 'absolute', top: 190, left: 0, width: W, display: 'flex', justifyContent: 'center', gap: 26 }}>
      {PROVA.map((p, i) => (
        <div key={p.zh} style={{ ...surge(t, de + i * 0.18, 999, 60), width: 312, height: 420, borderRadius: 36, background: 'rgba(20,18,28,0.92)', border: `3px solid ${i === 1 ? OURO : 'rgba(255,255,255,0.22)'}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
          <Icone nome={i === 0 ? 'pessoas' : i === 1 ? 'estrela' : 'repetir'} tam={90} p={interpolate(t, [de + i * 0.18, de + i * 0.18 + 0.6], [0, 1], clamp)} />
          <Contador t={t} emSec={de + i * 0.18} valor={p.valor} casas={p.casas} prefixo={p.prefixo} sufixo={p.sufixo} dur={1.2} estilo={{ fontFamily: DISPLAY, fontWeight: 900, fontSize: p.valor >= 1000 ? 60 : 84, color: '#fff' }} />
          <span style={{ fontFamily: TEXTO, fontWeight: 800, fontSize: 40, color: '#CFCBDA', textAlign: 'center', padding: '0 16px' }}>{p.zh}</span>
        </div>
      ))}
    </div>
  );
};
const CTAFixo: React.FC<{ t: number }> = ({ t }) => {
  const em = T(4, 80.68);
  if (t < em - 0.05) return null;
  return (
    <>
      <Centro top={760}><BotaoCTA t={t} emSec={em} texto={CTA_BOTAO} /></Centro>
      <Centro top={930}>
        <div style={{ ...surge(t, em + 0.25), display: 'flex', alignItems: 'center', gap: 18 }}>
          <span style={{ fontFamily: TEXTO, fontWeight: 600, fontSize: 38, color: '#CFCBDA' }}>{CTA_NOTA}</span>
        </div>
      </Centro>
      <Centro top={1010}>
        <div style={{ ...surge(t, T(4, 81.1)), translate: `0px ${10 * Math.sin(t * 7)}px`, display: 'flex', alignItems: 'center', gap: 16, fontFamily: TEXTO, fontWeight: 800, fontSize: 42, color: OURO }}>
          <Seta p={1} comp={70} ang={90} espessura={9} /> 連結在下面
        </div>
      </Centro>
    </>
  );
};

// ───────────── legenda palavra a palavra ─────────────
const FRASES = GS_FRASES.map((f) => ({ ...f, ts: f.palavras.map((p) => gsTempo(f.recorte, p[0])) }));
const Legenda: React.FC<{ t: number }> = ({ t }) => {
  const idx = FRASES.findIndex((f, i) => t >= f.ts[0] - 0.05 && (i === FRASES.length - 1 || t < FRASES[i + 1].ts[0] - 0.05));
  if (idx < 0) return null;
  const fr = FRASES[idx];
  if (t > gsTempo(fr.recorte, GS_RECORTES[fr.recorte][1]) && idx !== FRASES.length - 1) return null;
  if (t > FIM_FALA + 0.3) return null; // na prova final a tela é só dos números + CTA
  const temLatino = fr.palavras.some((p) => /[A-Za-z]/.test(p[1]));
  return (
    <div style={{ position: 'absolute', left: 60, width: W - 120, top: 1225, height: 200, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', alignItems: 'baseline', columnGap: temLatino ? 22 : 4, rowGap: 4 }}>
      {fr.palavras.map(([, w], i) => {
        const on = t >= fr.ts[i];
        const atual = on && (i === fr.ts.length - 1 || t < fr.ts[i + 1]);
        const s = entrada(t, fr.ts[i], 220);
        return (
          <span key={i} style={{
            fontFamily: DISPLAY, fontWeight: 900, fontSize: 70, lineHeight: 1.15, color: atual ? ROSA : '#fff', opacity: on ? 1 : 0.3,
            scale: String(atual ? interpolate(s, [0, 1], [1.16, 1.05]) : 1), display: 'inline-block', WebkitTextStroke: '9px #000', paintOrder: 'stroke fill',
          }}>{w}</span>
        );
      })}
    </div>
  );
};

const Conteudo: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const rosto = entrada(t, 0, 140);
  const cena = t < INICIO[1] ? 0 : t < INICIO[2] ? 1 : t < INICIO[3] ? 2 : t < INICIO[4] ? 3 : 4;
  return (
    <AbsoluteFill>
      <FundoMarca t={t} />
      {/* palco de motion: y 0..1150 */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: 1160, overflow: 'hidden' }}>
        {cena === 0 ? <CenaHook t={t} /> : null}
        {cena === 1 ? <CenaCorrecao t={t} /> : null}
        {cena === 2 ? <CenaRaiz t={t} /> : null}
        {cena === 3 ? <CenaMetodo t={t} /> : null}
        {cena === 4 && t < FIM_FALA ? <CenaOferta t={t} /> : null}
        {t >= FIM_FALA - 0.05 ? <CenaProva t={t} /> : null}
        <CTAFixo t={t} />
      </div>
      <Legenda t={t} />
      {/* rosto (recorte do campeão; placeholder do avatar de IA) */}
      <div style={{ position: 'absolute', left: W / 2 - 220, top: 1450, width: 440, height: 440, borderRadius: '50%', overflow: 'hidden', border: `8px solid ${ROSA}`, boxShadow: '0 12px 50px rgba(0,0,0,0.7)', scale: String(rosto) }}>
        <OffthreadVideo src={staticFile('prototipos/formatos/gs-fala.mp4')} style={{ width: 440, height: 440 }} />
        {/* o campeão tem um flash branco de ~0,25 s aqui (corte de cena); no círculo vira glitch, então segura o quadro anterior */}
        {t >= 3.6 && t < 3.88 ? <Img src={staticFile('prototipos/formatos/gs-tapa-flash.jpg')} style={{ position: 'absolute', inset: 0, width: 440, height: 440 }} /> : null}
      </div>
      {/* sfx: troca de cena e momentos-chave */}
      {INICIO.slice(1).map((x) => <Sfx key={x} arquivo="envio" emSec={x - 0.05} volume={0.35} />)}
      {[T(1, 25.16), T(1, 26.54), T(2, 46.08), T(2, 51.68), T(3, 63.66), T(3, 64.5), T(3, 65.46), T(4, 77.1), T(4, 79.42)].map((x) => <Sfx key={x} arquivo="pop" emSec={x} volume={0.45} />)}
      <Sfx arquivo="ding" emSec={T(4, 80.68)} volume={0.6} />
      {PROVA.map((_, i) => <Sfx key={`p${i}`} arquivo="pop" emSec={FIM_FALA + 0.05 + i * 0.18} volume={0.5} />)}
    </AbsoluteFill>
  );
};

export const GreenScreenPrint: React.FC = () => {
  const pronto = useFontesZh(TODO_TEXTO);
  return <AbsoluteFill style={{ background: '#0B0A10' }}>{pronto ? <Conteudo /> : null}</AbsoluteFill>;
};
