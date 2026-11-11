// Troca de legenda (troca-texto §15.6, F2): base = a PLACA (legenda antiga apagada, sem áudio), por cima a legenda nova com as mesmas
// palavras, uma página por trecho, karaokê (palavra da vez na cor/caixa de destaque), traço e SOMBRA DURA [dx, dy] medidos.
// Texto em SVG: posição pela linha de base e pelo centro medidos (baseY/centroX), sem depender do line-height do navegador.
import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, cancelRender, continueRender, delayRender, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/fonts';
import { resolverSrc } from './componentes/midia';
import { LEGENDA_FONTES, paginasDaLegenda, palavraDaVez, posicoesDasPalavras, type LegendaSwapProps } from './lib/legendaSwap';

const familia = (id: string) => `HM-leg-${id}`;

const useFonteLegenda = (id: string) => {
  const [pronta, setPronta] = useState(false);
  const [h] = useState(() => delayRender(`fonte da legenda ${id}`));
  useEffect(() => {
    const f = LEGENDA_FONTES[id];
    if (!f) { cancelRender(new Error(`fontId da legenda fora do catálogo: ${id}`)); return; }
    loadFont({ family: familia(id), url: staticFile(f.arquivo), weight: f.variavel ? '100 900' : String(f.peso) })
      .then(() => { setPronta(true); continueRender(h); })
      .catch((e) => cancelRender(e));
  }, [id, h]);
  return pronta;
};

const larguraDe = (texto: string, id: string, px: number, trk: number): number => {
  const f = LEGENDA_FONTES[id];
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `${f.peso} ${px}px "${familia(id)}"`;
  if (f.variavel) (ctx as unknown as { fontVariationSettings?: string }).fontVariationSettings = `"wght" ${f.peso}`;
  return ctx.measureText(texto).width + trk * px * Math.max(0, [...texto].length - 1);
};

export const LegendaSwap: React.FC<LegendaSwapProps> = (p) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pronta = useFonteLegenda(p.estilo.fontId);
  const paginas = useMemo(() => paginasDaLegenda(p), [p]);
  const e = p.estilo, f = LEGENDA_FONTES[e.fontId];
  const pg = paginas.find((x) => frame >= x.iniFrame && frame < x.fimFrame);
  const geo = useMemo(() => {
    if (!pronta || !pg) return null;
    const larg = pg.palavras.map((w) => larguraDe(w.texto, e.fontId, e.tamPx, e.tracking));
    const esp = larguraDe(' ', e.fontId, e.tamPx, 0) * e.espaco;
    return { larg, ...posicoesDasPalavras(larg, esp, e.centroX) };
  }, [pronta, pg, e.fontId, e.tamPx, e.tracking, e.espaco, e.centroX]);
  const [dx, dy] = e.sombra;
  const t = frame / fps;
  const ativa = pg ? palavraDaVez(pg, t) : -1;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <OffthreadVideo src={resolverSrc(p.baseVideoUrl)} muted style={{ width: '100%', height: '100%', display: 'block' }} />
      {pg && geo && f ? (
        <svg width={p.canvas.width} height={p.canvas.height} style={{ position: 'absolute', inset: 0, filter: dx || dy ? `drop-shadow(${dx}px ${dy}px 0 ${e.corTraco})` : undefined }}>
          {pg.palavras.map((w, i) => {
            const on = i === ativa;
            const cx = geo.x[i];
            return (
              <g key={i}>
                {on && e.caixaDestaque ? (
                  <rect x={cx - 6} y={e.baseY - e.tamPx * 0.78} width={geo.larg[i] + 12} height={e.tamPx * 1.0} rx={e.caixaDestaque.raioPx} fill={e.caixaDestaque.cor} />
                ) : null}
                <text x={cx} y={e.baseY} fontFamily={`"${familia(e.fontId)}"`} fontWeight={f.peso} fontSize={e.tamPx} letterSpacing={e.tracking * e.tamPx}
                  style={f.variavel ? { fontVariationSettings: `"wght" ${f.peso}` } : undefined}
                  fill={on && !e.caixaDestaque && e.corDestaque ? e.corDestaque : e.corTexto}
                  stroke={e.strokePx ? e.corTraco : 'none'} strokeWidth={e.strokePx * 2} strokeLinejoin="round" paintOrder="stroke fill">
                  {w.texto}
                </text>
              </g>
            );
          })}
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};
