// Legenda automática (headline-e-legenda-v1 §2.2): palavra a palavra no estilo único do lote (H5): Montserrat 800,
// branco com contorno preto, palavra da vez na cor da marca. Posição e tamanho vêm de `caixaDaLegenda` (pura); a página
// é ajustada com o mesmo fitText das molduras. zh/ja: palavras juntas sem espaço, página por caractere, glifos Noto CJK.
import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { MONTSERRAT } from '../fontes';
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
    () => paginasLegendaAuto(palavrasNaPeca(captions.words, timeline, fps), lang, ateSec, caixa.maxPalavras),
    [captions.words, timeline, fps, lang, ateSec, caixa.maxPalavras],
  );
  const t = f / fps;
  const pag = paginas.find((p) => t >= p.startSec && t < p.endSec);
  const ajuste = useMemo(() => (pag ? ajusteDaPagina(textoDaPagina(pag, lang), caixa, lang) : null), [pag, caixa, lang]);
  if (!pag || !ajuste) return null;
  let ativa = -1;
  pag.palavras.forEach((w, i) => { if (t >= w.startSec) ativa = i; });
  const contorno = Math.max(3, Math.round(ajuste.size * 0.09));
  return (
    <div data-layer="captions-auto" style={{
      position: 'absolute', left: caixa.box.x, top: caixa.box.y, width: caixa.box.w, height: caixa.box.h,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'none',
    }}>
      <div style={{
        width: caixa.box.w, textAlign: 'center', fontFamily: MONTSERRAT, fontWeight: 800, fontSize: ajuste.size, lineHeight: LEGENDA_LH,
        color: '#fff', WebkitTextStroke: `${contorno * 2}px #000`, paintOrder: 'stroke fill', lineBreak: 'strict',
        wordBreak: /^ko/i.test(lang) ? 'keep-all' : 'normal', textShadow: '0 4px 14px rgba(0,0,0,0.45)',
      }}>
        {pag.palavras.map((w, i) => (
          <React.Fragment key={i}>
            {espacoAntes(i ? pag.palavras[i - 1].word : null, w.word) ? ' ' : null}
            <span style={{ color: i === ativa ? captions.highlightColor : '#fff' }}>{w.word}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
