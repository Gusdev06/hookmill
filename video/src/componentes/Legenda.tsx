import React, { useMemo } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { alinhamento, ESCALA_TIPO, fonteDoEstilo, raioDoFundo, textoComContorno, type EstiloTemplate } from '../estilos';
import { caixaHorizontal, paginar, paginasLegendaAuto, palavrasGlobais, semEspaco, type CriativoProps, type LayerStyle, type LayerTransform } from '../lib';

type Props = Pick<CriativoProps, 'scenes' | 'captionStyle' | 'format'> & {
  estilo: EstiloTemplate;
  /** Posição no frame (sem transform no doc, o Criativo troca 'top' por 'middle' enquanto o gancho ocupa o topo). */
  transformNoFrame: (frame: number) => LayerTransform;
  ateSec: number;
  /** Janela de visibilidade [de, até) em frames (timing do editor). As páginas e o destaque continuam vindo das palavras. */
  janela?: { de: number; ate: number };
  /** Estilo da camada (editor). Ausente = visual do template (caminho de hoje). */
  estiloCamada?: LayerStyle;
  /** idioma da fala: zh/ja = palavras sem espaço e página por caractere (≤ 8) */
  language?: string;
};

/** Legenda a partir dos tempos por palavra da transcrição. 'word' = aparece palavra a palavra com destaque; 'line' = frase inteira. */
export const Legenda: React.FC<Props> = ({ scenes, captionStyle, format, estilo, transformNoFrame, ateSec, janela, estiloCamada: s, language = 'en' }) => {
  const cjk = semEspaco(language);
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const modo = captionStyle === 'line' ? 'line' : 'word';
  const paginas = useMemo(
    () =>
      cjk
        ? paginasLegendaAuto(palavrasGlobais(scenes), language, ateSec)
        : paginar(palavrasGlobais(scenes), {
          maxPalavras: estilo.legenda.palavrasPorPagina[modo],
          maxChars: estilo.legenda.charsPorPagina[modo],
          ateSec,
        }),
    [scenes, estilo, modo, ateSec, cjk, language],
  );
  if (captionStyle === 'off') return null;
  if (janela && (frame < janela.de || frame >= janela.ate)) return null;

  const t = frame / fps;
  const pagina = paginas.find((p) => t >= p.startSec && t < p.endSec);
  if (!pagina) return null;

  const T = estilo.legenda;
  const fontSize = Math.round(T.fontSize * ESCALA_TIPO[format]);
  // Com estilo do editor: fonte, cores, contorno, sombra, fundo e caixa alta vêm do LayerStyle; ritmo (pop, paginação) do template.
  const L = s
    ? {
        ...T,
        ...fonteDoEstilo(s),
        upper: s.uppercase,
        cor: s.color,
        corAtiva: s.highlightColor ?? s.color,
        contorno: s.strokeColor && s.strokeWidthPx > 0 ? s.strokeColor : null,
        sombra: s.shadow ? T.sombra : 'none',
        fundoAtiva: s.background.kind === 'word' ? s.background.color : null,
      }
    : T;
  const larguraContorno = s ? s.strokeWidthPx : Math.max(4, Math.round(fontSize * 0.09));
  const fundoBloco = s && (s.background.kind === 'box' || s.background.kind === 'pill') && s.background.color ? s.background.color : null;
  const tr = transformNoFrame(frame);
  const y = tr.y * height;
  const framesNaPagina = frame - Math.round(pagina.startSec * fps);
  // índice da palavra "da vez": a última que já começou (segura o destaque nos silêncios curtos)
  let ativa = -1;
  pagina.palavras.forEach((w, i) => {
    if (t >= w.startSec) ativa = i;
  });

  // fundo Caixa/Pílula: um bloco atrás da página inteira, abraçando o texto (as palavras quebram dentro dele)
  const embrulha = (palavras: React.ReactNode) =>
    fundoBloco ? (
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: alinhamento(s!).justifyContent, alignItems: 'center',
          columnGap: cjk ? 0 : '0.26em', rowGap: '0.08em', backgroundColor: fundoBloco, padding: '0.2em 0.45em', borderRadius: raioDoFundo(s!, '0.28em'),
        }}
      >
        {palavras}
      </div>
    ) : (
      palavras
    );

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        data-layer="caption"
        style={{
          position: 'absolute',
          ...caixaHorizontal(tr),
          top: y,
          translate: `0 -50%`,
          scale: tr.scale !== 1 ? String(tr.scale) : undefined,
          rotate: tr.rotationDeg ? `${tr.rotationDeg}deg` : undefined,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: s ? alinhamento(s).justifyContent : 'center',
          alignItems: 'center',
          columnGap: cjk ? 0 : '0.26em',
          rowGap: '0.08em',
          fontFamily: L.fontFamily,
          fontWeight: L.fontWeight,
          fontSize,
          lineHeight: 1.12,
          textAlign: s ? alinhamento(s).textAlign : 'center',
          textTransform: L.upper ? 'uppercase' : 'none',
          letterSpacing: L.upper ? '-0.01em' : '-0.02em',
          opacity: interpolate(framesNaPagina, [0, 3], [0.4, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      >
        {embrulha(pagina.palavras.map((w, i) => {
          const daVez = modo === 'word' && i === ativa;
          const falada = modo === 'line' || t >= w.startSec;
          // opacidadeFutura 0 = a palavra só entra quando é falada (bloco recentraliza a cada palavra)
          if (!falada && L.opacidadeFutura === 0) return null;
          const framesDesdeInicio = frame - Math.round(w.startSec * fps);
          return (
            <span
              key={`${w.startSec}-${i}`}
              style={{
                display: 'inline-block',
                color: daVez ? L.corAtiva : L.cor,
                opacity: falada ? 1 : L.opacidadeFutura,
                textShadow: L.sombra,
                ...textoComContorno(L.contorno, larguraContorno),
                backgroundColor: daVez && L.fundoAtiva ? L.fundoAtiva : 'transparent',
                borderRadius: '0.18em',
                padding: '0 0.12em',
                scale: daVez
                  ? interpolate(framesDesdeInicio, [0, 3, 6], [1, L.pop * 1.04, L.pop], {
                      extrapolateLeft: 'clamp',
                      extrapolateRight: 'clamp',
                      easing: Easing.bezier(0.16, 1, 0.3, 1),
                    })
                  : 1,
              }}
            >
              {w.word}
            </span>
          );
        }))}
      </div>
    </AbsoluteFill>
  );
};
