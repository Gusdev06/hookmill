// Legenda automática (headline-e-legenda-v1 §2.2): palavra a palavra no estilo único do lote (H5): Montserrat 800,
// branco com contorno preto, palavra da vez na cor da marca. Posição e tamanho vêm de `caixaDaLegenda` (pura); a página
// é ajustada com o mesmo fitText das molduras. zh/ja: palavras juntas sem espaço, página por caractere, glifos Noto CJK.
import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { MONTSERRAT } from '../fontes';
import { FONT_CATALOG } from '../lib/remix';
import {
  ajusteDaPagina, espacoAntes, LEGENDA_LH, paginasLegendaAuto, palavrasNaPeca, textoDaPagina, type CaixaLegenda, type CaptionsAuto,
} from '../lib/legendaAuto';

export const LegendaAuto: React.FC<{ captions: CaptionsAuto; timeline: { startSec: number; endSec: number }[]; caixa: CaixaLegenda; ateSec: number }> = ({
  captions, timeline, caixa, ateSec,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lang = captions.language;
  const paginas = useMemo(
    () => paginasLegendaAuto(palavrasNaPeca(captions.words, timeline, fps), lang, ateSec, Math.min(caixa.maxPalavras, captions.style?.wordsPerPage ?? caixa.maxPalavras)),
    [captions.words, timeline, fps, lang, ateSec, caixa.maxPalavras],
  );
  const t = f / fps;
  const pag = paginas.find((p) => t >= p.startSec && t < p.endSec);
  const ajuste = useMemo(() => (pag ? ajusteDaPagina(textoDaPagina(pag, lang), caixa, lang) : null), [pag, caixa, lang]);
  if (!pag || !ajuste) return null;
  let ativa = -1;
  pag.palavras.forEach((w, i) => { if (t >= w.startSec) ativa = i; });
  // legenda-protegida-v1 §2.2: no modo 'replace' a nossa legenda usa o estilo da ORIGINAL (fonte do catálogo, cor,
  // destaque, contorno, caixa alta, sombra); sem fonte do catálogo, Montserrat 800 com o resto da original (D-LP2)
  const st = captions.style;
  const fonte = st?.fontId && st.fontId in FONT_CATALOG ? FONT_CATALOG[st.fontId as keyof typeof FONT_CATALOG] : { family: MONTSERRAT, weight: 800 };
  const contorno = st ? (st.strokeColor ? Math.max(1, Math.round(ajuste.size * st.strokeWidthRel)) : 0) : Math.max(3, Math.round(ajuste.size * 0.09));
  const corTexto = st?.color ?? '#fff';
  const corDestaque = st ? st.highlightColor ?? st.color : captions.highlightColor;
  return (
    <div data-layer="captions-auto" style={{
      position: 'absolute', left: caixa.box.x, top: caixa.box.y, width: caixa.box.w, height: caixa.box.h,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'none',
    }}>
      <div style={{
        width: caixa.box.w, textAlign: 'center', fontFamily: fonte.family, fontWeight: fonte.weight, fontSize: ajuste.size, lineHeight: LEGENDA_LH,
        color: corTexto, WebkitTextStroke: contorno ? `${contorno * 2}px ${st?.strokeColor ?? '#000'}` : undefined, paintOrder: 'stroke fill', lineBreak: 'strict',
        textTransform: st?.uppercase ? 'uppercase' : 'none',
        wordBreak: /^ko/i.test(lang) ? 'keep-all' : 'normal', textShadow: !st || st.shadow ? '0 4px 14px rgba(0,0,0,0.45)' : undefined,
      }}>
        {pag.palavras.map((w, i) => (
          <React.Fragment key={i}>
            {espacoAntes(i ? pag.palavras[i - 1].word : null, w.word) ? ' ' : null}
            <span style={{ color: i === ativa ? corDestaque : corTexto }}>{w.word}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
