// PROTÓTIPO 28/10 (v2): peças comuns dos formatos programáticos — fontes (latinas + Noto TC), sfx sintetizado e
// motion graphics desenhados em código (ícones, contador, botão de CTA, seta). Nenhuma imagem/print da landing.
import React, { useEffect, useState } from 'react';
import { Audio, Easing, Sequence, continueRender, delayRender, interpolate, spring, staticFile } from 'remotion';
import { carregarFontes, carregarFontesCJK, INTER, MONTSERRAT } from '../../fontes';

export const FPS = 30;
export const TEXTO = `${INTER}, 'Noto Sans TC', sans-serif`;
export const DISPLAY = `${MONTSERRAT}, ${INTER}, 'Noto Sans TC', sans-serif`;
export const ROSA = '#FF4FA3';
export const VERDE = '#3BE38B';
export const VERMELHO = '#FF4D4D';
export const OURO = '#F2C14E';
export const ROXO = '#8B5CF6';
export const FUNDO = '#0B0A10';

export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const SAIDA = Easing.bezier(0.16, 1, 0.3, 1);

/** Fontes do template + pedaços da Noto TC que o texto usa. Segura o render até carregar. */
export const useFontesZh = (texto: string) => {
  const [pronto, setPronto] = useState(false);
  const [handle] = useState(() => delayRender('fontes formatos zh-TW'));
  useEffect(() => {
    carregarFontes()
      .then(() => carregarFontesCJK('zh-TW', texto))
      .catch((e) => console.error(e))
      .finally(() => { setPronto(true); continueRender(handle); });
  }, [handle, texto]);
  return pronto;
};

/** Um efeito sonoro curto em `emSec`. */
export const Sfx: React.FC<{ arquivo: 'pop' | 'envio' | 'ding'; emSec: number; volume?: number }> = ({ arquivo, emSec, volume = 1 }) => (
  <Sequence from={Math.max(0, Math.round(emSec * FPS))} durationInFrames={15} layout="none">
    <Audio src={staticFile(`prototipos/formatos/${arquivo}.wav`)} volume={volume} />
  </Sequence>
);

/** Mola de entrada a partir de `emSec` (0 -> 1). Curta e sem muito overshoot (peça de venda, não brinquedo). */
export const entrada = (t: number, emSec: number, rigidez = 170) =>
  spring({ frame: Math.round((t - emSec) * FPS), fps: FPS, config: { damping: 16, stiffness: rigidez, mass: 0.7 } });

/** Estilo de entrada padrão: sobe 40 px, escala .9 -> 1, opacidade; e sai em 0,2 s antes de `ateSec`. */
export const surge = (t: number, emSec: number, ateSec = 999, dy = 40): React.CSSProperties => {
  const p = entrada(t, emSec);
  const sai = interpolate(t, [ateSec - 0.22, ateSec], [1, 0], clamp);
  return {
    opacity: Math.min(interpolate(p, [0, 0.5], [0, 1], clamp), sai),
    translate: `0px ${interpolate(p, [0, 1], [dy, 0])}px`,
    scale: String(interpolate(p, [0, 1], [0.9, 1]) * interpolate(sai, [0, 1], [0.96, 1])),
  };
};

/** Contador animado (número real, nunca inventado). */
export const Contador: React.FC<{ t: number; emSec: number; valor: number; casas?: number; prefixo?: string; sufixo?: string; dur?: number; estilo?: React.CSSProperties }> = ({
  t, emSec, valor, casas = 0, prefixo = '', sufixo = '', dur = 1.1, estilo,
}) => {
  const v = interpolate(t, [emSec, emSec + dur], [0, valor], { ...clamp, easing: SAIDA });
  const txt = casas > 0 ? v.toFixed(casas) : Math.round(v).toLocaleString('en-US');
  return <span style={{ fontVariantNumeric: 'tabular-nums', ...estilo }}>{prefixo}{txt}{sufixo}</span>;
};

type NomeIcone = 'cerebro' | 'globo' | 'elo' | 'chapeu' | 'alvo' | 'raiz' | 'check' | 'x' | 'fala' | 'estrela' | 'pessoas' | 'repetir' | 'livro';
/** Ícones em traço (SVG próprio). `p` 0..1 desenha o traço. */
export const Icone: React.FC<{ nome: NomeIcone; tam?: number; cor?: string; p?: number; largura?: number }> = ({ nome, tam = 96, cor = OURO, p = 1, largura = 6 }) => {
  const d: Record<NomeIcone, string> = {
    cerebro: 'M36 20 C24 20 18 30 22 40 C12 44 12 60 22 64 C20 76 32 84 42 78 L42 22 C40 21 38 20 36 20 Z M64 20 C76 20 82 30 78 40 C88 44 88 60 78 64 C80 76 68 84 58 78 L58 22 C60 21 62 20 64 20 Z M42 40 L32 40 M58 40 L68 40 M42 60 L34 60 M58 60 L66 60',
    globo: 'M50 12 A38 38 0 1 0 50.1 12 Z M12 50 L88 50 M50 12 C34 30 34 70 50 88 M50 12 C66 30 66 70 50 88 M18 30 L82 30 M18 70 L82 70',
    elo: 'M42 58 L58 42 M38 48 L28 58 A12 12 0 0 0 42 72 L52 62 M62 52 L72 42 A12 12 0 0 0 58 28 L48 38',
    chapeu: 'M10 40 L50 22 L90 40 L50 58 Z M28 48 L28 66 C40 78 60 78 72 66 L72 48 M86 42 L86 66',
    alvo: 'M50 14 A36 36 0 1 0 50.1 14 Z M50 30 A20 20 0 1 0 50.1 30 Z M50 44 A6 6 0 1 0 50.1 44 Z',
    raiz: 'M50 12 L50 52 M50 52 C40 60 30 62 20 76 M50 52 C60 60 70 62 80 76 M50 52 L50 86 M38 64 L32 86 M62 64 L68 86 M36 26 C42 18 58 18 64 26',
    check: 'M20 52 L42 72 L82 28',
    x: 'M26 26 L74 74 M74 26 L26 74',
    fala: 'M16 22 L84 22 L84 66 L44 66 L26 82 L28 66 L16 66 Z M30 38 L70 38 M30 50 L58 50',
    estrela: 'M50 12 L61 38 L89 40 L67 58 L74 86 L50 71 L26 86 L33 58 L11 40 L39 38 Z',
    pessoas: 'M36 44 A12 12 0 1 0 36.1 44 Z M14 82 C14 64 58 64 58 82 M68 40 A10 10 0 1 0 68.1 40 Z M62 60 C76 58 88 64 88 78',
    repetir: 'M22 50 A28 28 0 0 1 74 34 M74 18 L74 34 L58 34 M78 50 A28 28 0 0 1 26 66 M26 82 L26 66 L42 66',
    livro: 'M50 26 C40 18 24 18 14 22 L14 80 C24 76 40 76 50 84 C60 76 76 76 86 80 L86 22 C76 18 60 18 50 26 Z M50 26 L50 84',
  };
  return (
    <svg width={tam} height={tam} viewBox="0 0 100 100" style={{ overflow: 'visible', display: 'block' }}>
      <path d={d[nome]} fill="none" stroke={cor} strokeWidth={largura} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
    </svg>
  );
};

/** Seta animada (traço desenhando). `ang` em graus (0 = direita, 90 = baixo). */
export const Seta: React.FC<{ p: number; comp?: number; cor?: string; ang?: number; espessura?: number }> = ({ p, comp = 120, cor = OURO, ang = 0, espessura = 10 }) => (
  <svg width={comp} height={60} viewBox={`0 0 ${comp} 60`} style={{ overflow: 'visible', rotate: `${ang}deg`, display: 'block' }}>
    <path d={`M 6 30 L ${comp - 10} 30 M ${comp - 34} 8 L ${comp - 10} 30 L ${comp - 34} 52`} fill="none" stroke={cor} strokeWidth={espessura} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
  </svg>
);

/** Botão do CTA (texto real do botão da oferta), com pulso. */
export const BotaoCTA: React.FC<{ t: number; emSec: number; texto: string; largura?: number }> = ({ t, emSec, texto, largura = 760 }) => {
  const p = entrada(t, emSec, 200);
  const pulso = t > emSec + 0.4 ? 1 + 0.035 * Math.max(0, Math.sin((t - emSec) * 6)) : 1;
  const anel = ((t - emSec) * 1.3) % 1;
  return (
    <div style={{ position: 'relative', width: largura, height: 140, opacity: interpolate(p, [0, 0.4], [0, 1], clamp), scale: String(interpolate(p, [0, 1], [0.7, 1]) * pulso) }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: 70, border: `5px solid ${OURO}`, opacity: t > emSec ? (1 - anel) * 0.8 : 0, scale: String(1 + anel * 0.18) }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: 70, background: `linear-gradient(135deg, #FFE08A 0%, ${OURO} 55%, #E0A21C 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: TEXTO, fontWeight: 800, fontSize: 54, color: '#16110A', boxShadow: '0 18px 60px rgba(242,193,78,0.45)' }}>{texto}</div>
    </div>
  );
};

/** Avatar da marca desenhado (monograma), no lugar do logo recortado da página. */
export const Monograma: React.FC<{ tam: number }> = ({ tam }) => (
  <div style={{ width: tam, height: tam, borderRadius: '50%', background: `linear-gradient(140deg, #2A2140 0%, #0E0B16 100%)`, border: `3px solid ${OURO}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: DISPLAY, fontWeight: 900, fontSize: tam * 0.48, color: OURO }}>A</div>
);

/** Fundo de marca em movimento (preto + brilho dourado/roxo lento). */
export const FundoMarca: React.FC<{ t: number }> = ({ t }) => (
  <div style={{ position: 'absolute', inset: 0, background: FUNDO, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', width: 1100, height: 1100, borderRadius: '50%', left: -300 + 120 * Math.sin(t * 0.35), top: -380 + 80 * Math.cos(t * 0.3), background: 'radial-gradient(circle, rgba(139,92,246,0.30) 0%, rgba(139,92,246,0) 65%)' }} />
    <div style={{ position: 'absolute', width: 1000, height: 1000, borderRadius: '50%', right: -360 + 100 * Math.cos(t * 0.4), top: 360 + 90 * Math.sin(t * 0.33), background: 'radial-gradient(circle, rgba(242,193,78,0.20) 0%, rgba(242,193,78,0) 65%)' }} />
    <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1.5px, transparent 1.5px)', backgroundSize: '36px 36px' }} />
  </div>
);
