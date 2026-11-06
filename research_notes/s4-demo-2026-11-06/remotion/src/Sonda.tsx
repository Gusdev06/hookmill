// Composição só da sonda S4 (fora do produto). Copia o que o F1b pede ao RemixKeep: base de vídeo, placa 2D, texto por linha com
// linha de base, sombra medida, sublinhado, emoji recortado e karaokê. Tudo em px da grade do campeão.
import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, Img, OffthreadVideo, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';

export interface Fonte { family: string; weight: number; file: string }
export interface Linha { text: string; cx: number; base: number }
export interface Bloco {
  start: number; end: number;
  family: string; weight: number; size: number; color: string; tracking?: number;
  lines: Linha[];
  sombra?: { dx: number; dy: number; blur: number; color: string };
  suaviza?: number;
  sublinhados?: { linha: number; de: number; ate: number; dy: number; esp: number; extra?: number }[];
  placa?: { uri: string; x: number; y: number; w: number; h: number };
  emoji?: { src: string; linha: number; gap: number; w: number; h: number; y: number; margemEsq: number; recorteW: number; sombra?: string };
}
export interface Pagina { start: number; end: number; linhas: { pal: string[]; base: number }[]; tempos: number[] }
export interface Legenda {
  family: string; weight: number; size: number; cx: number; espaco: number; traco: number; tracoCor: string; sombra: [number, number];
  cor: string; ativa?: string; caixa?: { c0: string; c1: string; acima: number; abaixo: number; pad: number; raio: number; sombra: number };
  suaviza?: number; tracoModo?: 'webkit' | 'sombras'; tracking?: number; paginas: Pagina[];
}
export interface SondaProps { w: number; h: number; frames: number; base?: string; offset?: number; fontes: Fonte[]; blocos: Bloco[]; legenda?: Legenda; fundo?: string; toneMapped?: boolean; baseTransparente?: boolean }

const useFontes = (fontes: Fonte[]) => {
  const [h] = useState(() => delayRender('fontes'));
  const [ok, setOk] = useState(false);
  useEffect(() => {
    Promise.all(fontes.map(async (f) => {
      const ff = new FontFace(f.family, `url(${staticFile(f.file)})`, { weight: String(f.weight) });
      document.fonts.add(await ff.load());
    })).then(() => { setOk(true); continueRender(h); }).catch((e) => { console.error(e); continueRender(h); });
  }, [fontes, h]);
  return ok;
};

// Sem suavização do sistema: mesma rasterização em Mac e Linux até onde o Chrome deixa; posição x fracionária de verdade.
const BASE: React.CSSProperties = { textRendering: 'geometricPrecision', WebkitFontSmoothing: 'antialiased', fontKerning: 'normal', whiteSpace: 'pre', position: 'absolute' };

const metricas = (family: string, weight: number, size: number, text: string, tracking = 0) => {
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `${weight} ${size}px "${family}"`;
  (c as unknown as { fontKerning: string }).fontKerning = 'normal';
  (c as unknown as { textRendering: string }).textRendering = 'geometricPrecision';
  const m = c.measureText(text);
  return { w: m.width + tracking * size * Math.max(0, text.length - 1), asc: m.fontBoundingBoxAscent, desc: m.fontBoundingBoxDescent };
};

const BlocoTexto: React.FC<{ b: Bloco }> = ({ b }) => {
  const sombra = b.sombra ? `${b.sombra.dx}px ${b.sombra.dy}px ${b.sombra.blur}px ${b.sombra.color}` : undefined;
  return (
    <>
      {b.placa ? <div style={{ position: 'absolute', left: b.placa.x, top: b.placa.y, width: b.placa.w, height: b.placa.h, backgroundImage: `url(${b.placa.uri})`, backgroundSize: '100% 100%' }} /> : null}
      <div style={{ position: 'absolute', inset: 0, filter: b.suaviza ? `blur(${b.suaviza}px)` : undefined }}>
        {b.lines.map((l, i) => {
          const m = metricas(b.family, b.weight, b.size, l.text, b.tracking);
          const em = b.emoji && b.emoji.linha === i ? b.emoji : null;
          const extra = em ? em.gap + em.w : 0;
          const left = l.cx - (m.w + extra) / 2;
          return (
            <React.Fragment key={i}>
              <div style={{ ...BASE, left, top: l.base - m.asc, fontFamily: b.family, fontWeight: b.weight, fontSize: b.size, lineHeight: `${m.asc + m.desc}px`, color: b.color, textShadow: sombra, letterSpacing: b.tracking ? `${b.tracking}em` : undefined }}>{l.text}</div>
              {(b.sublinhados ?? []).filter((s) => s.linha === i).map((s, k) => {
                const pre = metricas(b.family, b.weight, b.size, l.text.slice(0, s.de), b.tracking).w;
                const ate = metricas(b.family, b.weight, b.size, l.text.slice(0, s.ate), b.tracking).w;
                return <div key={k} style={{ position: 'absolute', left: left + pre, top: l.base + s.dy, width: ate - pre + (s.extra ?? 0), height: s.esp, background: b.color, boxShadow: sombra ? `${b.sombra!.dx}px ${b.sombra!.dy}px ${b.sombra!.blur}px ${b.sombra!.color}` : undefined }} />;
              })}
            </React.Fragment>
          );
        })}
      </div>
      {b.emoji ? (() => {
        const e = b.emoji; const l = b.lines[e.linha];
        const w = metricas(b.family, b.weight, b.size, l.text, b.tracking).w;
        const left = Math.round(l.cx - (w + e.gap + e.w) / 2 + w + e.gap - e.margemEsq);
        const y = l.base + e.y;
        return <Img src={staticFile(e.src)} style={{ position: 'absolute', left, top: y, width: e.recorteW, height: e.h, imageRendering: 'pixelated', filter: e.sombra }} />;
      })() : null}
    </>
  );
};

const CamadaLegenda: React.FC<{ L: Legenda; frame: number }> = ({ L, frame }) => {
  const p = L.paginas.find((x) => frame >= x.start && frame < x.end);
  if (!p) return null;
  let ativa = -1; p.tempos.forEach((t, i) => { if (frame >= t) ativa = i; });
  ativa = Math.max(0, ativa);
  const tr = L.tracking ?? 0;
  // Pillow escreveu letra a letra, sem kerning: igual aqui, para a comparação valer
  const larg = (t: string) => t.split('').reduce((n, ch) => n + metricas(L.family, L.weight, L.size, ch).w, 0) + tr * L.size * (t.length - 1);
  const esp = metricas(L.family, L.weight, L.size, ' ').w * L.espaco;
  let o = 0;
  const pec: React.ReactNode[] = [];
  const estilo: React.CSSProperties = { ...BASE, fontFamily: L.family, fontWeight: L.weight, fontSize: L.size, fontKerning: 'none', letterSpacing: tr ? `${tr}em` : undefined };
  p.linhas.forEach((lin, li) => {
    const ws = lin.pal.map(larg);
    const tot = ws.reduce((a, b) => a + b, 0) + esp * (lin.pal.length - 1);
    let x = L.cx - tot / 2;
    const m = metricas(L.family, L.weight, L.size, 'Hg');
    const top = lin.base - m.asc;
    const altura = `${m.asc + m.desc}px`;
    const itens = lin.pal.map((w, i) => { const it = { w, x, largura: ws[i], idx: o + i }; x += ws[i] + esp; return it; });
    o += lin.pal.length;
    // ordem da Pillow: caixa da palavra ativa, sombra (texto + traço deslocados), traço + preenchimento
    itens.forEach((it) => {
      if (L.caixa && it.idx === ativa) {
        const c = L.caixa; const bx0 = Math.floor(it.x - c.pad), bx1 = Math.floor(it.x + it.largura + c.pad);
        pec.push(<div key={`s${li}-${it.idx}`} style={{ position: 'absolute', left: bx0 + c.sombra, top: lin.base - c.acima + c.sombra, width: bx1 - bx0 + 1, height: c.acima + c.abaixo + 1, borderRadius: c.raio, background: L.tracoCor }} />);
        pec.push(<div key={`c${li}-${it.idx}`} style={{ position: 'absolute', left: bx0, top: lin.base - c.acima, width: bx1 - bx0 + 1, height: c.acima + c.abaixo + 1, borderRadius: c.raio, background: `linear-gradient(90deg, ${c.c0}, ${c.c1})` }} />);
      }
    });
    const traco = (cor: string, dx: number, dy: number, key: string) => itens.map((it) => (
      L.tracoModo === 'sombras'
        ? <div key={`${key}-${it.idx}`} style={{ ...estilo, left: it.x + dx, top: top + dy, lineHeight: altura, color: cor, textShadow: anelSombras(L.traco, cor) }}>{it.w}</div>
        : <div key={`${key}-${it.idx}`} style={{ ...estilo, left: it.x + dx, top: top + dy, lineHeight: altura, color: cor, WebkitTextStroke: `${L.traco * 2}px ${cor}`, paintOrder: 'stroke fill' }}>{it.w}</div>
    ));
    if (L.sombra[0] || L.sombra[1]) pec.push(...traco(L.tracoCor, L.sombra[0], L.sombra[1], `so${li}`));
    pec.push(...traco(L.tracoCor, 0, 0, `tr${li}`));
    pec.push(...itens.map((it) => <div key={`f${li}-${it.idx}`} style={{ ...estilo, left: it.x, top, lineHeight: altura, color: !L.caixa && L.ativa && it.idx === ativa ? L.ativa : L.cor }}>{it.w}</div>));
  });
  return <div style={{ position: 'absolute', inset: 0, filter: L.suaviza ? `blur(${L.suaviza}px)` : undefined }}>{pec}</div>;
};

// Traço redondo como o da Pillow: anel de sombras duras. text-stroke do Chrome tem junção em esquadro (pontas).
const anelSombras = (r: number, cor: string) => {
  const s: string[] = [];
  for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; s.push(`${(Math.cos(a) * r).toFixed(2)}px ${(Math.sin(a) * r).toFixed(2)}px 0 ${cor}`); }
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; s.push(`${(Math.cos(a) * r * 0.55).toFixed(2)}px ${(Math.sin(a) * r * 0.55).toFixed(2)}px 0 ${cor}`); }
  return s.join(',');
};

export const Sonda: React.FC<SondaProps> = (p) => {
  const frame = useCurrentFrame();
  const fontes = useMemo(() => p.fontes, [p.fontes]);
  const ok = useFontes(fontes);
  return (
    <AbsoluteFill style={{ background: p.fundo ?? '#000' }}>
      {p.base ? <OffthreadVideo src={staticFile(p.base)} muted toneMapped={p.toneMapped ?? true} transparent={p.baseTransparente ?? false} trimBefore={p.offset || undefined} style={{ width: p.w, height: p.h, display: 'block' }} /> : null}
      {ok ? p.blocos.filter((b) => frame >= b.start && frame < b.end).map((b, i) => <BlocoTexto key={i} b={b} />) : null}
      {ok && p.legenda ? <CamadaLegenda L={p.legenda} frame={frame + (p.offset ?? 0)} /> : null}
    </AbsoluteFill>
  );
};
