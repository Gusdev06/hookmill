// Templates `versus` e `value-stack` (docs/contratos/templates-lista-v1.md §3, spec design/templates-ruimbom-lista-2026-11-04.md,
// protótipo aprovado pelo Gusta em 04/11). O vídeo do campeão inteiro, com áudio (em cover no `body`; numa caixa no
// `top`/`side`) e o painel da lista por cima, no lugar que o `posicionarLista` achou. Cada linha entra no tempo da fala
// (mola do `entrada`, ícone desenhando, risco na esquerda do Versus, barra crescendo no Stack), a mais nova brilha 1,2 s
// e nada sai até o fim. Sem a nossa legenda (v1). Geometria e medida = `geometriaLista`/`medirLista` (src/lib).
import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, OffthreadVideo, useCurrentFrame } from 'remotion';
import { resolverSrc } from '../componentes/midia';
import {
  ajustesDosRotulos, entradaDosRotulos, geometriaLista, LISTA_FUNDO, videoDaLista, type CoverFit, type GeoCelula, type ListLineProps, type ListOverlayProps,
} from '../lib/listaOverlay';
import { pinturaNaCaixa, type FittedText } from '../lib/molduras';
import { contraste } from '../lib/cores';
import { coresDaMarca, entrada, FPS, fonte, Icone, Sfx, surge, VERDE, VERMELHO, type Cores } from './comum';

const easeOut = Easing.out(Easing.cubic);
const cl = (x: number) => Math.max(0, Math.min(1, x));

// ───────── vídeo ─────────

const Video: React.FC<{ v: CoverFit; source: ListOverlayProps['source']; fundo: boolean }> = ({ v, source, fundo }) => {
  const pt = pinturaNaCaixa(v.box, source, v.reframe, v.contentBox);
  return (
    <div style={{ position: 'absolute', left: v.box.x, top: v.box.y, width: v.box.w, height: v.box.h, overflow: 'hidden', background: LISTA_FUNDO }}>
      {fundo ? <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1.5px, transparent 1.5px)', backgroundSize: '36px 36px' }} /> : null}
      <div style={{ position: 'absolute', left: pt.area.left, top: pt.area.top, width: pt.area.w, height: pt.area.h, overflow: 'hidden' }}>
        <OffthreadVideo src={resolverSrc(source.videoUrl)} style={{ position: 'absolute', left: pt.video.left, top: pt.video.top, width: pt.video.w, height: pt.video.h, maxWidth: 'none', objectFit: 'fill' }} />
      </div>
    </div>
  );
};

// ───────── texto (linhas medidas, risco animado) ─────────

const Texto: React.FC<{ fit: FittedText; cor: string; font?: 'inter-800' | 'montserrat-900'; risco?: { p: number; cor: string } | null; align?: 'left' | 'center' }> = ({ fit, cor, font = 'inter-800', risco, align = 'left' }) => (
  <div style={{ ...fonte(font), fontSize: fit.size, lineHeight: fit.lineHeight, color: cor, textAlign: align, minWidth: 0 }}>
    {fit.lines.map((l, i) => (
      <div key={i} style={{ whiteSpace: 'pre' }}>
        <span style={{ position: 'relative', display: 'inline-block' }}>
          {l}
          {risco ? <span style={{ position: 'absolute', left: 0, top: '54%', height: Math.max(4, fit.size * 0.12), width: `${risco.p * 100}%`, background: risco.cor, borderRadius: 3 }} /> : null}
        </span>
      </div>
    ))}
  </div>
);

/** Ícones que o catálogo comum não tem (seta pra baixo do CTA, etiqueta do preço). */
const IconeExtra: React.FC<{ nome: 'down' | 'tag'; tam: number; cor: string; p: number; largura: number }> = ({ nome, tam, cor, p, largura }) => (
  <svg width={tam} height={tam} viewBox="0 0 100 100" style={{ overflow: 'visible', display: 'block', flexShrink: 0 }}>
    <path d={nome === 'down' ? 'M50 16 L50 82 M24 58 L50 84 L76 58' : 'M14 14 L52 14 L88 50 L50 88 L14 52 Z M34 34 L34.1 34.1'} fill="none" stroke={cor} strokeWidth={largura}
      strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
  </svg>
);

/** Entrada da linha (§4): mola, sobe 40 px, escala .9 → 1; preço com pop de +6 %, CTA pulsando 2,5 % depois de 0,5 s. */
const estiloEntrada = (t: number, at: number, extra: 'price' | 'cta' | null): React.CSSProperties => {
  const dt = t - at;
  if (dt < 0) return { opacity: 0 };
  const p = entrada(t, at);
  let k = 1;
  if (extra === 'price') k = 1 + 0.06 * Math.max(0, Math.sin((Math.min(dt, 0.5) * Math.PI) / 0.5));
  if (extra === 'cta' && dt > 0.5) k = 1 + 0.025 * Math.max(0, Math.sin((dt - 0.5) * 6));
  return { opacity: cl(p / 0.5), translate: `0px ${40 * (1 - p)}px`, scale: String((0.9 + 0.1 * p) * k) };
};
const brilha = (t: number, at: number) => t >= at && t < at + 1.2;

// ───────── Versus ─────────

const coresVersus = (look: ListOverlayProps['look'], c: Cores, side: 'bad' | 'good', on: boolean) => {
  if (look === 'paper') return {
    fundo: '#fff', borda: 'none', texto: side === 'bad' ? '#6d6d73' : '#111', icone: side === 'bad' ? '#d62f2a' : '#0f8a50',
    sombra: `0 10px 30px rgba(0,0,0,.3)${on ? ', 0 0 0 6px rgba(255,255,255,.55)' : ''}`,
  };
  if (look === 'brand') return side === 'bad'
    ? { fundo: 'rgba(28,28,34,.86)', borda: 'none', texto: '#9c9ca8', icone: '#8b8b96', sombra: on ? '0 0 0 6px rgba(255,255,255,.5)' : 'none' }
    : { fundo: c.acento, borda: 'none', texto: c.sobre, icone: c.sobre, sombra: `0 14px 40px ${c.acento}66${on ? ', 0 0 0 6px rgba(255,255,255,.5)' : ''}` };
  return {
    fundo: 'rgba(20,18,28,.92)', borda: `3px solid ${side === 'bad' ? VERMELHO : VERDE}`, texto: side === 'bad' ? '#ffb4b4' : '#fff', icone: side === 'bad' ? VERMELHO : VERDE,
    sombra: `0 14px 40px rgba(0,0,0,.45)${on ? ', 0 0 0 8px rgba(255,255,255,.14)' : ''}`,
  };
};

const Celula: React.FC<{ l: ListLineProps; g: GeoCelula; t: number; look: ListOverlayProps['look']; cores: Cores }> = ({ l, g, t, look, cores }) => {
  const side = l.side ?? 'good';
  const k = coresVersus(look, cores, side, brilha(t, l.atSec));
  const dt = t - l.atSec;
  return (
    <div style={{
      position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h, boxSizing: 'border-box', borderRadius: 22, padding: '0 22px', display: 'flex', alignItems: 'center', gap: 16,
      background: k.fundo, border: k.borda, boxShadow: k.sombra, overflow: 'hidden', ...estiloEntrada(t, l.atSec, null),
    }}>
      <Icone nome={side === 'bad' ? 'x' : 'check'} tam={g.icone} cor={k.icone} largura={13} p={cl((dt - 0.05) / 0.3)} />
      <Texto fit={l.fit} cor={k.texto} risco={side === 'bad' ? { p: cl((dt - 0.35) / 0.25), cor: look === 'brand' ? '#8b8b96' : VERMELHO } : null} />
    </div>
  );
};

const Cabecalho: React.FC<{ side: 'bad' | 'good'; fit: FittedText; r: { x: number; y: number; w: number; h: number }; at: number; t: number; look: ListOverlayProps['look']; cores: Cores }> = ({ side, fit, r, at, t, look, cores }) => {
  const k = look === 'paper' ? { fundo: '#fff', texto: side === 'bad' ? '#d62f2a' : '#0f8a50', sombra: '0 10px 30px rgba(0,0,0,.3)' }
    : look === 'brand' ? (side === 'bad' ? { fundo: 'rgba(28,28,34,.9)', texto: '#b9b9c4', sombra: 'none' } : { fundo: '#fff', texto: cores.escuro, sombra: '0 10px 30px rgba(0,0,0,.3)' })
    : side === 'bad' ? { fundo: VERMELHO, texto: '#fff', sombra: 'none' } : { fundo: VERDE, texto: '#06210f', sombra: 'none' };
  return (
    <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 20, background: k.fundo, boxShadow: k.sombra, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, overflow: 'hidden', ...(t < at ? { opacity: 0 } : surge(t, at)) }}>
      <Icone nome={side === 'bad' ? 'x' : 'check'} tam={Math.round(r.h * 0.5)} cor={k.texto} largura={14} p={cl((t - at - 0.05) / 0.3)} />
      <Texto fit={fit} cor={k.texto} font="montserrat-900" />
    </div>
  );
};

// ───────── Value stack ─────────

const coresBarra = (look: ListOverlayProps['look'], c: Cores, kind: ListLineProps['kind'], tom: number) => {
  if (look === 'paper') {
    if (kind === 'price') return { fundo: '#FFE14D', borda: 'none', texto: '#111', numFundo: '#111', numTexto: '#FFE14D', sombra: '0 10px 30px rgba(0,0,0,.28)' };
    if (kind === 'cta') return { fundo: '#111', borda: 'none', texto: '#fff', numFundo: '#fff', numTexto: '#111', sombra: '0 10px 30px rgba(0,0,0,.28)' };
    return { fundo: '#fff', borda: 'none', texto: '#111', numFundo: kind === 'proof' ? '#0f8a50' : '#111', numTexto: '#fff', sombra: '0 10px 30px rgba(0,0,0,.28)' };
  }
  if (look === 'brand') {
    if (kind === 'price') return { fundo: '#fff', borda: 'none', texto: c.escuro, numFundo: c.escuro, numTexto: '#fff', sombra: '0 10px 30px rgba(0,0,0,.3)' };
    if (kind === 'cta') return { fundo: '#FFC53D', borda: 'none', texto: '#1a1200', numFundo: '#1a1200', numTexto: '#FFC53D', sombra: '0 10px 30px rgba(0,0,0,.3)' };
    const f = [c.escuro, c.acento, c.claro][tom % 3];
    return { fundo: f, borda: 'none', texto: contraste(f), numFundo: 'rgba(255,255,255,.95)', numTexto: c.escuro, sombra: '0 10px 30px rgba(0,0,0,.3)' };
  }
  if (kind === 'price') return { fundo: '#fff', borda: '3px solid #fff', texto: '#111', numFundo: '#111', numTexto: '#fff', sombra: '0 14px 40px rgba(0,0,0,.45)' };
  if (kind === 'cta') return { fundo: c.acento, borda: `3px solid ${c.claro}`, texto: c.sobre, numFundo: '#fff', numTexto: c.escuro, sombra: '0 14px 40px rgba(0,0,0,.45)' };
  if (kind === 'proof') return { fundo: 'rgba(20,18,28,.92)', borda: `3px solid ${VERDE}`, texto: '#fff', numFundo: VERDE, numTexto: '#06210f', sombra: '0 14px 40px rgba(0,0,0,.45)' };
  return { fundo: 'rgba(20,18,28,.92)', borda: '3px solid rgba(255,255,255,.2)', texto: '#fff', numFundo: c.acento, numTexto: c.sobre, sombra: '0 14px 40px rgba(0,0,0,.45)' };
};

const Barra: React.FC<{ l: ListLineProps; g: GeoCelula; n: number; tom: number; t: number; look: ListOverlayProps['look']; cores: Cores }> = ({ l, g, n, tom, t, look, cores }) => {
  const k = coresBarra(look, cores, l.kind, tom);
  const dt = t - l.atSec;
  const raio = Math.round(g.h * 0.28);
  const on = brilha(t, l.atSec);
  const pIcone = cl((dt - 0.05) / 0.3);
  const icone = Math.round(g.h * 0.36);
  return (
    <div style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h, display: 'flex', alignItems: 'center', gap: 18, padding: '0 26px 0 14px', boxSizing: 'border-box', ...estiloEntrada(t, l.atSec, l.kind === 'price' ? 'price' : l.kind === 'cta' ? 'cta' : null) }}>
      <div style={{ position: 'absolute', inset: 0, borderRadius: raio, background: k.fundo, border: k.borda, boxSizing: 'border-box', transformOrigin: '0 50%', scale: `${easeOut(cl(dt / 0.35))} 1`,
        boxShadow: `${k.sombra}${on ? ', 0 0 0 8px rgba(255,255,255,.16)' : ''}` }} />
      <div style={{ position: 'relative', width: g.icone, height: g.icone, borderRadius: '50%', background: k.numFundo, color: k.numTexto, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...fonte('montserrat-900'), fontSize: Math.round(g.h * 0.32) }}>
        {l.kind === 'price' ? <IconeExtra nome="tag" tam={icone} cor={k.numTexto} p={pIcone} largura={11} />
          : l.kind === 'cta' ? <IconeExtra nome="down" tam={icone} cor={k.numTexto} p={pIcone} largura={13} />
          : l.kind === 'proof' ? <Icone nome="check" tam={icone} cor={k.numTexto} p={pIcone} largura={13} />
          : String(n)}
      </div>
      <div style={{ position: 'relative', opacity: cl((dt - 0.12) / 0.2) }}>
        <Texto fit={l.fit} cor={k.texto} />
      </div>
    </div>
  );
};

// ───────── composição ─────────

export const ListOverlay: React.FC<ListOverlayProps & { language?: string }> = (p) => {
  const t = useCurrentFrame() / FPS;
  const cores = useMemo(() => coresDaMarca(p.brandColor), [p.brandColor]);
  const pl = p.placement;
  const geo = useMemo(() => (pl.mode === 'none' ? null : geometriaLista({ mode: p.mode, placement: pl, lines: p.lines })), [p.mode, pl, p.lines]);
  const rotulos = useMemo(() => (geo ? ajustesDosRotulos(p, geo) : null), [p, geo]);
  if (pl.mode === 'none' || !geo || !rotulos) {
    // não chega aqui (o build barra `none`); por segurança, só o vídeo inteiro
    return <AbsoluteFill style={{ background: '#000' }}><OffthreadVideo src={resolverSrc(p.source.videoUrl)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></AbsoluteFill>;
  }
  const v = videoDaLista(pl);
  const P = pl.panel;
  const quando = entradaDosRotulos(p.lines);
  const porId = new Map(geo.cells.map((c) => [c.id, c]));
  const sfx = p.sfx ? { pop: p.sfx.pop, send: p.sfx.pop, ding: p.sfx.ding } : null;
  let nItem = 0;
  return (
    <AbsoluteFill style={{ background: LISTA_FUNDO }}>
      <Video v={v} source={p.source} fundo={pl.mode !== 'body'} />
      <div style={{ position: 'absolute', left: P.x, top: P.y, width: P.w, height: P.h }}>
        {geo.heads && rotulos.heads ? (
          <>
            <Cabecalho side="bad" fit={rotulos.heads.bad} r={geo.heads.bad} at={quando.bad} t={t} look={p.look} cores={cores} />
            <Cabecalho side="good" fit={rotulos.heads.good} r={geo.heads.good} at={quando.good} t={t} look={p.look} cores={cores} />
          </>
        ) : null}
        {geo.title && rotulos.title ? (
          <div style={{ position: 'absolute', left: 0, top: geo.title.y, height: geo.title.h, display: 'flex', alignItems: 'center', ...(t < quando.title ? { opacity: 0 } : surge(t, quando.title)) }}>
            <div style={p.look === 'paper' ? { background: '#fff', padding: '4px 22px', borderRadius: 14 } : { filter: 'drop-shadow(0 6px 18px rgba(0,0,0,.7))' }}>
              <Texto fit={rotulos.title} cor={p.look === 'paper' ? '#111' : '#fff'} font="montserrat-900" />
            </div>
          </div>
        ) : null}
        {p.lines.map((l) => {
          const g = porId.get(l.id)!;
          if (p.mode === 'stack') {
            const n = l.kind === 'item' ? ++nItem : 0;
            return <Barra key={l.id} l={l} g={g} n={n} tom={Math.max(0, n - 1)} t={t} look={p.look} cores={cores} />;
          }
          return <Celula key={l.id} l={l} g={g} t={t} look={p.look} cores={cores} />;
        })}
      </div>
      {p.lines.map((l) => (l.kind === 'price' || l.kind === 'cta'
        ? <Sfx key={`s${l.id}`} sfx={sfx} arquivo="ding" emSec={l.atSec} volume={0.6} />
        : <Sfx key={`s${l.id}`} sfx={sfx} arquivo="pop" emSec={l.atSec} volume={0.35} />))}
    </AbsoluteFill>
  );
};
