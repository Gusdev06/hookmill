import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, OffthreadVideo, Sequence, continueRender, delayRender, useCurrentFrame, useVideoConfig } from 'remotion';
import { measureText } from '@remotion/layout-utils';
import { resolverSrc } from './componentes/midia';
import { carregarFonteCatalogo } from './fontes';
import { FONT_CATALOG, paginasKaraoke, type RemixKeepProps, type RemixOverlay, type RemixTextLayer, type RemixTextStyle } from './lib/remix';

// Template remix-keep (§13.6): base = campeão; overlays = clipe novo nas regiões do rosto; camadas de texto redesenhadas.
// Ordem de pintura: base → overlays → textLayers (fundo da camada, depois o texto). Tudo em px da grade do campeão.

/** Clipe novo dentro da região: só o `crop` do clipe aparece, escalado pra região (mesmo aspecto, sem barra).
 *  Não precisa saber o tamanho do clipe: a imagem fica no tamanho natural (objectFit none) deslocada pelo crop. */
const Overlay: React.FC<{ o: RemixOverlay }> = ({ o }) => {
  const { fps } = useVideoConfig();
  const s = o.region.w / o.crop.w;
  return (
    <div style={{ position: 'absolute', left: o.region.x, top: o.region.y, width: o.region.w, height: o.region.h, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: o.crop.w, height: o.crop.h, transformOrigin: '0 0', scale: String(s), overflow: 'hidden' }}>
        <OffthreadVideo
          src={resolverSrc(o.clipUrl)}
          muted
          trimBefore={Math.round(o.clipOffsetSec * fps) || undefined}
          style={{ width: o.crop.w, height: o.crop.h, objectFit: 'none', objectPosition: `${-o.crop.x}px ${-o.crop.y}px`, display: 'block' }}
        />
      </div>
    </div>
  );
};

const useFonte = (id: RemixTextStyle['fontId']) => {
  const [pronta, setPronta] = useState(false);
  const [handle] = useState(() => delayRender(`fonte ${id}`));
  useEffect(() => {
    carregarFonteCatalogo(id)
      .then(() => { setPronta(true); continueRender(handle); })
      .catch((e) => { console.error(e); continueRender(handle); });
  }, [id, handle]);
  return pronta;
};

interface Ajuste { fontSize: number; linhas: string[][] }

/** Quebra as palavras em linhas que cabem na largura e reduz a fonte (passos de 4 %) até o bloco caber na caixa. */
export const ajustarTexto = (palavras: string[], st: RemixTextStyle, box: { w: number; h: number }): Ajuste => {
  const f = FONT_CATALOG[st.fontId];
  const larg = (t: string, size: number) => measureText({ text: t, fontFamily: f.family, fontSize: size, fontWeight: f.weight, textTransform: st.uppercase ? 'uppercase' : 'none' }).width;
  const contorno = st.strokeColor ? st.strokeWidthPx * 2 : 0;
  let size = st.fontSizePx;
  for (let tent = 0; tent < 60; tent++) {
    // caixa da palavra atual (box-shadow de 0,14em pros dois lados) também tem que caber na caixa da camada
    const folga = contorno + (st.highlightBackground ? 0.28 * size : 0);
    const espaco = larg(' ', size);
    const linhas: string[][] = [];
    let atual: string[] = [];
    let w = 0;
    let estoura = false;
    for (const p of palavras) {
      const pw = larg(p, size);
      if (pw + folga > box.w) estoura = true;
      if (atual.length && w + espaco + pw + folga > box.w) { linhas.push(atual); atual = [p]; w = pw; } else { w += (atual.length ? espaco : 0) + pw; atual.push(p); }
    }
    if (atual.length) linhas.push(atual);
    if (!estoura && linhas.length * size * st.lineHeight <= box.h + 0.5) return { fontSize: size, linhas };
    size *= 0.96;
  }
  return { fontSize: size, linhas: [palavras] };
};

const estiloTexto = (st: RemixTextStyle, fontSize: number): React.CSSProperties => {
  const f = FONT_CATALOG[st.fontId];
  return {
    fontFamily: f.family,
    fontWeight: f.weight,
    fontSize,
    lineHeight: st.lineHeight,
    color: st.color,
    textTransform: st.uppercase ? 'uppercase' : 'none',
    textAlign: st.align,
    whiteSpace: 'nowrap',
    // contorno por fora: o traço é centrado na borda, então o dobro com o preenchimento pintado por cima
    ...(st.strokeColor && st.strokeWidthPx > 0 ? { WebkitTextStroke: `${st.strokeWidthPx * 2}px ${st.strokeColor}`, paintOrder: 'stroke fill' } : {}),
    textShadow: st.shadow ? `0 ${Math.max(1, fontSize * 0.04)}px ${Math.max(2, fontSize * 0.12)}px rgba(0,0,0,0.55)` : undefined,
  };
};

const Bloco: React.FC<{ layer: RemixTextLayer; ajuste: Ajuste; cor: (linha: number, i: number) => string; caixa?: (linha: number, i: number) => string | null }> = ({ layer, ajuste, cor, caixa }) => {
  const st = layer.style;
  const justify = st.align === 'left' ? 'flex-start' : st.align === 'right' ? 'flex-end' : 'center';
  return (
    <div data-layer={layer.id} style={{ position: 'absolute', left: layer.box.x, top: layer.box.y, width: layer.box.w, height: layer.box.h, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: justify }}>
      {ajuste.linhas.map((l, li) => (
        <div key={li} style={estiloTexto(st, ajuste.fontSize)}>
          {l.map((p, i) => (
            <React.Fragment key={i}>
              {i > 0 ? ' ' : null}
              <PalavraSpan cor={cor(li, i)} caixa={caixa?.(li, i) ?? null}>{p}</PalavraSpan>
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
};

/** Palavra do bloco. Com `caixa`: fundo atrás da palavra que não mexe no layout (box-shadow em vez de padding),
 *  então a quebra de linha do ajustarTexto continua valendo. */
const PalavraSpan: React.FC<{ cor: string; caixa: string | null; children: React.ReactNode }> = ({ cor, caixa, children }) => (
  <span style={caixa
    ? { color: cor, background: caixa, boxShadow: `0 0 0 0.14em ${caixa}`, borderRadius: '0.06em', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone' }
    : { color: cor }}>{children}</span>
);

const Fundo: React.FC<{ layer: RemixTextLayer }> = ({ layer }) => {
  const b = layer.background;
  if (b.kind === 'none' || !b.color) return null;
  const r = b.box ?? layer.box;
  return <div style={{ position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, background: b.color, borderRadius: b.kind === 'pill' ? r.h / 2 : 0 }} />;
};

const TextoEstatico: React.FC<{ layer: RemixTextLayer & { content: { kind: 'static' } } }> = ({ layer }) => {
  const pronta = useFonte(layer.style.fontId);
  const ajuste = useMemo(() => (pronta ? ajustarTexto(layer.content.text.split(/\s+/).filter(Boolean), layer.style, layer.box) : null), [pronta, layer]);
  return (
    <>
      <Fundo layer={layer} />
      {ajuste ? <Bloco layer={layer} ajuste={ajuste} cor={() => layer.style.color} /> : null}
    </>
  );
};

const Karaoke: React.FC<{ layer: RemixTextLayer & { content: { kind: 'karaoke' } } }> = ({ layer }) => {
  const pronta = useFonte(layer.style.fontId);
  const frame = useCurrentFrame() + layer.startFrame;   // frames das palavras são absolutos (grade do campeão)
  const paginas = useMemo(() => paginasKaraoke(layer.content.words, layer.content.wordsPerPage), [layer]);
  const pag = paginas.find((p) => frame >= p.startFrame && frame < p.endFrame);
  const ajuste = useMemo(() => (pronta && pag ? ajustarTexto(pag.words.map((w) => w.word), layer.style, layer.box) : null), [pronta, pag, layer]);
  if (!pag || !ajuste) return <Fundo layer={layer} />;
  let ativa = -1;
  pag.words.forEach((w, i) => { if (frame >= w.startFrame) ativa = i; });
  const idx = (li: number, i: number) => ajuste.linhas.slice(0, li).reduce((n, l) => n + l.length, 0) + i;
  return (
    <>
      <Fundo layer={layer} />
      <Bloco layer={layer} ajuste={ajuste}
        cor={(li, i) => (idx(li, i) === ativa && layer.style.highlightColor ? layer.style.highlightColor : layer.style.color)}
        caixa={(li, i) => (idx(li, i) === ativa ? layer.style.highlightBackground ?? null : null)} />
    </>
  );
};

export const RemixKeep: React.FC<RemixKeepProps> = ({ baseVideoUrl, overlays, textLayers }) => (
  <AbsoluteFill style={{ backgroundColor: '#000' }}>
    <OffthreadVideo src={resolverSrc(baseVideoUrl)} muted style={{ width: '100%', height: '100%', display: 'block' }} />
    {overlays.map((o, i) => (
      <Sequence key={`o${i}`} name={`Rosto ${i + 1}`} from={o.startFrame} durationInFrames={o.endFrame - o.startFrame} layout="none">
        <Overlay o={o} />
      </Sequence>
    ))}
    {textLayers.map((l) => (
      <Sequence key={l.id} name={`Texto ${l.id}`} from={l.startFrame} durationInFrames={l.endFrame - l.startFrame} layout="none">
        {l.content.kind === 'static'
          ? <TextoEstatico layer={l as RemixTextLayer & { content: { kind: 'static' } }} />
          : <Karaoke layer={l as RemixTextLayer & { content: { kind: 'karaoke' } }} />}
      </Sequence>
    ))}
  </AbsoluteFill>
);
