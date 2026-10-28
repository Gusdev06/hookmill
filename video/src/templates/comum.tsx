// Peças comuns dos templates grátis (iterate-v2 F1.4), promovidas do protótipo aprovado de 28/10
// (src/prototipos/formatos/comum.tsx): mola de entrada, SFX, ícones em traço, contador, botão de CTA, monograma da marca,
// fundo em movimento e o texto já ajustado (linhas medidas pelo fitText: o navegador não quebra de outro jeito).
// Fontes: só as do bundle (Inter/Montserrat + Noto CJK registrada por baixo delas): nenhuma fonte de reserva.
import React from 'react';
import { Audio, Easing, Sequence, interpolate, spring } from 'remotion';
import { resolverSrc } from '../componentes/midia';
import { FRAME_FONTS, textoVisivel, type FittedText, type FrameFontKey } from '../lib/molduras';
import { contraste } from '../lib/cores';
import { formatarNumero, TEMPLATE_FPS, type ProofStat, type TemplateIconId, type TemplateProps } from '../lib/templatesFormato';

export const FPS = TEMPLATE_FPS;
export const VERDE = '#3BE38B';
export const VERMELHO = '#FF4D4D';
export const FUNDO = '#0B0A10';
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const SAIDA = Easing.bezier(0.16, 1, 0.3, 1);

// ───────── cores a partir da marca ─────────
const hex = (h: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const s = m ? m[1] : 'F2C14E';
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const mistura = (a: string, b: string, k: number) => {
  const x = hex(a), y = hex(b);
  return '#' + x.map((v, i) => Math.round(v * (1 - k) + y[i] * k).toString(16).padStart(2, '0')).join('');
};
const lumRel = (h: string) => {
  const l = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = hex(h);
  return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
};
/** A cor da marca clareada até ler sobre o fundo escuro (contraste ≥ 4,5:1): marca azul-escura vira azul legível. */
export const legivelNoEscuro = (cor: string) => {
  let c = /^#[0-9a-f]{6}$/i.test(cor) ? cor : '#F2C14E';
  const fundo = lumRel(FUNDO);
  for (let k = 0; k < 10 && (lumRel(c) + 0.05) / (fundo + 0.05) < 4.5; k++) c = mistura(c, '#ffffff', 0.18);
  return c;
};
/** Acento (cor da marca, legível no fundo escuro), versões clara/escura e o texto que contrasta com ela. */
export const coresDaMarca = (cor: string) => {
  const acento = legivelNoEscuro(cor);
  return { acento, claro: mistura(acento, '#ffffff', 0.45), escuro: mistura(acento, '#000000', 0.25), sobre: contraste(acento) };
};
export type Cores = ReturnType<typeof coresDaMarca>;

/** Um efeito sonoro curto em `emSec`. */
export const Sfx: React.FC<{ sfx: TemplateProps['sfx']; arquivo: 'pop' | 'send' | 'ding'; emSec: number; volume?: number }> = ({ sfx, arquivo, emSec, volume = 1 }) =>
  sfx ? (
    <Sequence from={Math.max(0, Math.round(emSec * FPS))} durationInFrames={15} layout="none">
      <Audio src={resolverSrc(sfx[arquivo])} volume={volume} />
    </Sequence>
  ) : null;

/** Mola de entrada a partir de `emSec` (0 -> 1). Curta e sem muito overshoot. */
export const entrada = (t: number, emSec: number, rigidez = 170) =>
  spring({ frame: Math.round((t - emSec) * FPS), fps: FPS, config: { damping: 16, stiffness: rigidez, mass: 0.7 } });

/** Entrada padrão: sobe `dy` px, escala .9 -> 1, opacidade; sai em 0,22 s antes de `ateSec`. */
export const surge = (t: number, emSec: number, ateSec = 999, dy = 40): React.CSSProperties => {
  const p = entrada(t, emSec);
  const sai = interpolate(t, [ateSec - 0.22, ateSec], [1, 0], clamp);
  return {
    opacity: Math.min(interpolate(p, [0, 0.5], [0, 1], clamp), sai),
    translate: `0px ${interpolate(p, [0, 1], [dy, 0])}px`,
    scale: String(interpolate(p, [0, 1], [0.9, 1]) * interpolate(sai, [0, 1], [0.96, 1])),
  };
};

/** Família/peso CSS de uma chave da tabela de medida. */
export const fonte = (k: FrameFontKey): React.CSSProperties => ({ fontFamily: FRAME_FONTS[k].family, fontWeight: FRAME_FONTS[k].weight });

/**
 * Texto ajustado: as linhas do fitText desenhadas uma a uma (sem quebra do navegador), no tamanho medido. `destaque` =
 * trecho do texto pintado na cor `corDestaque` (a manchete do chat). Alinhamento por `align`.
 */
export const Linhas: React.FC<{ fit: FittedText; font: FrameFontKey; cor: string; align?: 'left' | 'center'; destaque?: string | null; corDestaque?: string; estilo?: React.CSSProperties; riscado?: boolean }> = ({
  fit, font, cor, align = 'center', destaque, corDestaque, estilo, riscado,
}) => {
  const visivel = textoVisivel(fit.text);
  const hl = destaque ? visivel.indexOf(destaque) : -1;
  let cursor = 0;
  return (
    <div style={{ ...fonte(font), fontSize: fit.size, lineHeight: fit.lineHeight, color: cor, textAlign: align, ...estilo }}>
      {fit.lines.map((l, i) => {
        const ini = fit.ranges ? fit.ranges[i][0] : Math.max(cursor, visivel.indexOf(l, cursor));
        const fim = fit.ranges ? fit.ranges[i][1] : ini + l.length;
        cursor = fim;
        const partes: React.ReactNode[] = [];
        if (hl >= 0 && destaque && hl < fim && hl + destaque.length > ini) {
          const a = Math.max(hl, ini) - ini, b = Math.min(hl + destaque.length, fim) - ini;
          partes.push(l.slice(0, a), <span key="h" style={{ color: corDestaque }}>{l.slice(a, b)}</span>, l.slice(b));
        } else partes.push(l);
        return (
          <div key={i} style={{ whiteSpace: 'pre', textDecoration: riscado ? 'line-through' : undefined, textDecorationThickness: riscado ? Math.max(4, fit.size * 0.09) : undefined }}>
            {partes}
          </div>
        );
      })}
    </div>
  );
};

/** Contador animado (número real do Brain, nunca inventado). */
export const Contador: React.FC<{ t: number; emSec: number; p: ProofStat; fit: FittedText; cor: string; dur?: number }> = ({ t, emSec, p, fit, cor, dur = 1.1 }) => {
  const v = interpolate(t, [emSec, emSec + dur], [0, p.value], { ...clamp, easing: SAIDA });
  return <span style={{ ...fonte('montserrat-900'), fontSize: fit.size, color: cor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'pre' }}>{formatarNumero(p, v)}</span>;
};

/** Ícones em traço (SVG próprio, catálogo fixo). `p` 0..1 desenha o traço. */
const ICONES: Record<TemplateIconId, string> = {
  check: 'M20 52 L42 72 L82 28',
  x: 'M26 26 L74 74 M74 26 L26 74',
  arrow: 'M14 50 L84 50 M60 26 L84 50 L60 74',
  brain: 'M36 20 C24 20 18 30 22 40 C12 44 12 60 22 64 C20 76 32 84 42 78 L42 22 C40 21 38 20 36 20 Z M64 20 C76 20 82 30 78 40 C88 44 88 60 78 64 C80 76 68 84 58 78 L58 22 C60 21 62 20 64 20 Z M42 40 L32 40 M58 40 L68 40 M42 60 L34 60 M58 60 L66 60',
  globe: 'M50 12 A38 38 0 1 0 50.1 12 Z M12 50 L88 50 M50 12 C34 30 34 70 50 88 M50 12 C66 30 66 70 50 88 M18 30 L82 30 M18 70 L82 70',
  chat: 'M16 22 L84 22 L84 66 L44 66 L26 82 L28 66 L16 66 Z M30 38 L70 38 M30 50 L58 50',
  clock: 'M50 12 A38 38 0 1 0 50.1 12 Z M50 28 L50 52 L66 62',
  star: 'M50 12 L61 38 L89 40 L67 58 L74 86 L50 71 L26 86 L33 58 L11 40 L39 38 Z',
  gift: 'M14 40 L86 40 L86 54 L14 54 Z M20 54 L20 86 L80 86 L80 54 M50 40 L50 86 M50 40 C40 22 24 26 30 36 C34 42 50 40 50 40 M50 40 C60 22 76 26 70 36 C66 42 50 40 50 40',
  lock: 'M26 46 L74 46 L74 86 L26 86 Z M36 46 L36 32 C36 14 64 14 64 32 L64 46 M50 60 L50 72',
  heart: 'M50 84 C20 62 10 46 18 30 C26 16 44 18 50 32 C56 18 74 16 82 30 C90 46 80 62 50 84 Z',
  bolt: 'M56 10 L22 56 L46 56 L40 90 L78 40 L54 40 Z',
};
export const Icone: React.FC<{ nome: TemplateIconId; tam?: number; cor: string; p?: number; largura?: number }> = ({ nome, tam = 96, cor, p = 1, largura = 6 }) => (
  <svg width={tam} height={tam} viewBox="0 0 100 100" style={{ overflow: 'visible', display: 'block', flexShrink: 0 }}>
    <path d={ICONES[nome]} fill="none" stroke={cor} strokeWidth={largura} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
  </svg>
);
/** Ícone pra cada linha de prova (sem inventar: só enfeite neutro). */
export const iconeDaProva = (i: number): TemplateIconId => (['star', 'heart', 'bolt'] as const)[i % 3];

/** Seta animada (traço desenhando). `ang` em graus (0 = direita, 90 = baixo). */
export const Seta: React.FC<{ p: number; comp?: number; cor: string; ang?: number; espessura?: number }> = ({ p, comp = 120, cor, ang = 0, espessura = 10 }) => (
  <svg width={comp} height={60} viewBox={`0 0 ${comp} 60`} style={{ overflow: 'visible', rotate: `${ang}deg`, display: 'block', flexShrink: 0 }}>
    <path d={`M 6 30 L ${comp - 10} 30 M ${comp - 34} 8 L ${comp - 10} 30 L ${comp - 34} 52`} fill="none" stroke={cor} strokeWidth={espessura} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
  </svg>
);

/** Botão do CTA (texto real da oferta), com pulso e anel; a seta é desenhada (as fontes não têm "→"). */
export const BotaoCTA: React.FC<{ t: number; emSec: number; fit: FittedText; cores: Cores; largura?: number; altura?: number }> = ({ t, emSec, fit, cores, largura = 820, altura = 140 }) => {
  const p = entrada(t, emSec, 200);
  const pulso = t > emSec + 0.4 ? 1 + 0.035 * Math.max(0, Math.sin((t - emSec) * 6)) : 1;
  const anel = ((t - emSec) * 1.3) % 1;
  return (
    <div style={{ position: 'relative', width: largura, height: altura, opacity: interpolate(p, [0, 0.4], [0, 1], clamp), scale: String(interpolate(p, [0, 1], [0.7, 1]) * pulso) }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: altura / 2, border: `5px solid ${cores.acento}`, opacity: t > emSec ? (1 - anel) * 0.8 : 0, scale: String(1 + anel * 0.18) }} />
      <div style={{ position: 'absolute', inset: 0, borderRadius: altura / 2, background: `linear-gradient(135deg, ${cores.claro} 0%, ${cores.acento} 55%, ${cores.escuro} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, boxShadow: `0 18px 60px ${cores.acento}66` }}>
        <Linhas fit={fit} font="inter-800" cor={cores.sobre} />
        <Seta p={1} comp={56} cor={cores.sobre} espessura={8} />
      </div>
    </div>
  );
};

/** Avatar da marca desenhado (monograma das iniciais), nunca logo. */
export const Monograma: React.FC<{ tam: number; iniciais: string; cores: Cores }> = ({ tam, iniciais, cores }) => (
  <div style={{ width: tam, height: tam, borderRadius: '50%', background: 'linear-gradient(140deg, #2A2140 0%, #0E0B16 100%)', border: `3px solid ${cores.acento}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...fonte('montserrat-900'), fontSize: tam * (iniciais.length > 1 ? 0.38 : 0.48), color: cores.acento }}>{iniciais}</div>
);

/** Fundo de marca em movimento (preto + brilho lento na cor da marca). */
export const FundoMarca: React.FC<{ t: number; cores: Cores }> = ({ t, cores }) => (
  <div style={{ position: 'absolute', inset: 0, background: FUNDO, overflow: 'hidden' }}>
    <div style={{ position: 'absolute', width: 1100, height: 1100, borderRadius: '50%', left: -300 + 120 * Math.sin(t * 0.35), top: -380 + 80 * Math.cos(t * 0.3), background: 'radial-gradient(circle, rgba(139,92,246,0.28) 0%, rgba(139,92,246,0) 65%)' }} />
    <div style={{ position: 'absolute', width: 1000, height: 1000, borderRadius: '50%', right: -360 + 100 * Math.cos(t * 0.4), top: 360 + 90 * Math.sin(t * 0.33), background: `radial-gradient(circle, ${cores.acento}33 0%, ${cores.acento}00 65%)` }} />
    <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1.5px, transparent 1.5px)', backgroundSize: '36px 36px' }} />
  </div>
);
