import type React from 'react';
import { INTER, MONTSERRAT } from './fontes';
import { FONT_CATALOG, type LayerStyle, type TemplateId } from './lib';

/** Tokens visuais por template. Tudo que muda entre clean/bold/headline mora aqui. */
export interface EstiloTemplate {
  legenda: {
    fontFamily: string;
    fontWeight: number;
    fontSize: number;
    upper: boolean;
    cor: string;
    corAtiva: string;
    /** Palavras ainda não faladas: opacidade (0 = aparecem palavra a palavra). */
    opacidadeFutura: number;
    contorno: string | null;
    sombra: string;
    fundoAtiva: string | null;
    pop: number;
    palavrasPorPagina: { word: number; line: number };
    charsPorPagina: { word: number; line: number };
  };
  cta: { fundo: string; cor: string; fontFamily: string; fontWeight: number; upper: boolean };
  endCard: { fundo: string; cor: string; corDestaque: string; fontFamily: string };
  /** Zoom alternado por cena (esconde o corte seco entre cenas parecidas). */
  zoomPorCena: [number, number];
  /** Push-in lento dentro de cada cena (escala final). */
  pushIn: number;
}

const BRANCO = '#FFFFFF';

export const ESTILOS: Record<TemplateId, EstiloTemplate> = {
  clean: {
    legenda: {
      fontFamily: INTER, fontWeight: 800, fontSize: 66, upper: false, cor: BRANCO, corAtiva: BRANCO,
      opacidadeFutura: 0, contorno: null, sombra: '0 4px 18px rgba(0,0,0,0.55), 0 2px 4px rgba(0,0,0,0.6)',
      fundoAtiva: 'rgba(0,0,0,0.55)', pop: 1.0,
      palavrasPorPagina: { word: 4, line: 7 }, charsPorPagina: { word: 24, line: 36 },
    },
    cta: { fundo: BRANCO, cor: '#0A0A0A', fontFamily: INTER, fontWeight: 800, upper: false },
    endCard: { fundo: '#0A0A0A', cor: BRANCO, corDestaque: BRANCO, fontFamily: INTER },
    zoomPorCena: [1, 1],
    pushIn: 1.035,
  },
  bold: {
    legenda: {
      fontFamily: MONTSERRAT, fontWeight: 900, fontSize: 96, upper: true, cor: BRANCO, corAtiva: '#FFE14D',
      opacidadeFutura: 0, contorno: '#000000', sombra: '0 6px 0 rgba(0,0,0,0.85)', fundoAtiva: null, pop: 1.14,
      palavrasPorPagina: { word: 2, line: 4 }, charsPorPagina: { word: 16, line: 24 },
    },
    cta: { fundo: '#FFE14D', cor: '#0A0A0A', fontFamily: MONTSERRAT, fontWeight: 900, upper: true },
    endCard: { fundo: '#FFE14D', cor: '#0A0A0A', corDestaque: '#0A0A0A', fontFamily: MONTSERRAT },
    zoomPorCena: [1, 1.08],
    pushIn: 1.03,
  },
  headline: {
    legenda: {
      fontFamily: INTER, fontWeight: 800, fontSize: 62, upper: false, cor: BRANCO, corAtiva: '#7CF29A',
      opacidadeFutura: 0.0, contorno: null, sombra: '0 4px 18px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.6)',
      fundoAtiva: null, pop: 1.06,
      palavrasPorPagina: { word: 4, line: 7 }, charsPorPagina: { word: 24, line: 36 },
    },
    cta: { fundo: '#7CF29A', cor: '#0A0A0A', fontFamily: INTER, fontWeight: 800, upper: false },
    endCard: { fundo: '#0B1210', cor: BRANCO, corDestaque: '#7CF29A', fontFamily: INTER },
    zoomPorCena: [1, 1.04],
    pushIn: 1.035,
  },
};

// Zonas e escala de tipografia moram em lib/editor.ts (o layoutPadrao do editor usa as mesmas).
export { ESCALA_TIPO, ZONAS } from './lib';

export const textoComContorno = (cor: string | null, px: number): React.CSSProperties =>
  cor ? { WebkitTextStroke: `${px}px ${cor}`, paintOrder: 'stroke fill' } : {};

// ---- Estilo de camada do editor (LayerStyle, editor-v1 §2). Só entra quando o doc mexeu no estilo da camada. ----------
const FONTES_DO_CATALOGO = FONT_CATALOG;

/** fontFamily/fontWeight de uma fonte do catálogo (já registrada com o mesmo nome em fontes.ts). */
export const fonteDoEstilo = (s: LayerStyle) => ({ fontFamily: FONTES_DO_CATALOGO[s.fontId].family, fontWeight: FONTES_DO_CATALOGO[s.fontId].weight });

/** Alinhamento do bloco (flex) e do texto. */
export const alinhamento = (s: LayerStyle) => ({
  justifyContent: s.align === 'left' ? 'flex-start' : s.align === 'right' ? 'flex-end' : 'center',
  textAlign: s.align,
} as const);

/** Raio do fundo: caixa = cantos suaves (raio dado), pílula = redondo. */
export const raioDoFundo = (s: LayerStyle, raioCaixa: number | string) => (s.background.kind === 'pill' ? 999 : raioCaixa);
