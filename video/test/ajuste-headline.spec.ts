// ajustarHeadlineCopia (troca-texto-queimado-v1 §16.3, §16.2 A4 e A6, §14.4; aceite da V1 do F1b na §16.6):
// aprovada E 0,029 ± 0,01; curta e 1 linha `too_short`; longa `over_chin`.
//
// Fixture = a headline solta aprovada da S4 (research_notes/s4-demo-2026-11-06, quadro 464 × 832). De onde vem cada número:
// - fonte, corpo, entrelinha, 1ª base, centro: jobs-solto.json (Arimo 600, 26,75 px, bases 557 e 590,25, cx 233);
// - linhas apagadas: tinta branca do quadro original (research_notes/g0-2026-11-06/ref/solto-original-q0.png, ROI
//   60,528): linha 0 x 87-379, y 538-562; linha 1 x 82-350, y 571-594 (o emoji, x 360-384, fica de fora);
// - emoji: placa-solta.json (27 px de largura usada no centro, espaço 6,12, fim da 2ª linha);
// - queixo: §16.2 A6 diz "aprovada ~40 px, longa de 3 linhas ~7 px, lidos a olho"; chinY = 497 reproduz os dois
//   (o faceTrack real deste vídeo não foi conferido: a V2 grava `chinY` no look).
import type { HeadlineFitLook as FitLookContrato, HeadlineFitResult as FitResultContrato } from '../../contratos/src/troca-texto';
import type { FontId as FontIdContrato } from '../../contratos/src/index';
import {
  EXPOSICAO_MAX, FONT_CATALOG, FONT_IDS, ajustarHeadlineCopia, exposicaoDeLinhas, larguraCopia, tintaCopia,
  type FontId, type HeadlineFitLook, type HeadlineFitResult,
} from '../src/lib';

type Igual<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const fontIdIgual: Igual<FontId, FontIdContrato> = true;
const lookIgual: Igual<HeadlineFitLook, FitLookContrato> = true;
const resultadoIgual: Igual<HeadlineFitResult, FitResultContrato> = true;

const SOLTO: HeadlineFitLook = {
  kind: 'loose',
  canvas: { width: 464, height: 832 },
  fontId: 'arimo-600', sizePx: 26.75, letterSpacingEm: 0, linePitchPx: 33.25, firstBaselineY: 557,
  align: 'center', centerX: 233, caseStyle: 'sentence',
  originalLines: [{ chars: 22, widthPx: 293 }, { chars: 22, widthPx: 269 }],
  erasedRects: [{ x: 87, y: 538, w: 293, h: 25 }, { x: 82, y: 571, w: 269, h: 24 }],
  bottomLimitY: null,
  chinY: 497,
  sideMarginPx: 0.05 * 464,
  emoji: { widthPx: 27, gapPx: 6.12, lineIndex: 1, side: 'end' },
  box: null,
};

describe('ajustarHeadlineCopia: aceite da V1 (solto aprovado da S4)', () => {
  it('tipos iguais aos do contrato e catálogo com tabela para toda fonte', () => {
    expect([fontIdIgual, lookIgual, resultadoIgual]).toEqual([true, true, true]);
    expect(FONT_IDS).toHaveLength(27);
    for (const id of FONT_IDS) {
      expect(larguraCopia(id, 'Hamburgefonstiv', 40)).toBeGreaterThan(100);
      expect(tintaCopia(id, 'Hg', 40).top).toBeGreaterThan(20);
      expect(FONT_CATALOG[id].weight).toBe(Number(id.slice(id.lastIndexOf('-') + 1)));
    }
  });

  it('mesmas palavras: same, E = 0, quebra do original', () => {
    const r = ajustarHeadlineCopia(SOLTO, 'How to view your man’s recent following on IG');
    expect(r).toMatchObject({ fits: true, step: 'same', reject: null, exposure: 0, sizePx: 26.75, firstBaselineY: 557 });
    expect(r.lines).toEqual(['How to view your man’s', 'recent following on IG']);
  });

  // §16.3 registra E = 0,029 para a aprovada, sem o script nem os retângulos usados. Com os retângulos tirados dos pixels
  // do original (linha 0 = 293 px, a mesma largura que o Chrome dá à Arimo 600 nas palavras originais) a função dá 0,060;
  // com as larguras 269/270 da régua do G0 (que corta a linha 0), 0,017. O 0,029 fica entre os dois: quem fecha é a
  // medida da V2 (`erasedRects`), e o limite de 0,15 separa a aprovada da curta nos dois casos.
  it('aprovada: cabe (same), E 0,060 com os retângulos do pixel, abaixo do limite', () => {
    const r = ajustarHeadlineCopia(SOLTO, 'Tired of scrolling his endless following list?');
    expect(r).toMatchObject({ fits: true, step: 'same', reject: null });
    expect(r.lines).toEqual(['Tired of scrolling his', 'endless following list?']);
    expect(r.exposure).toBeCloseTo(0.06, 2);
    expect(r.exposure).toBeLessThan(EXPOSICAO_MAX);
    const regua = ajustarHeadlineCopia({ ...SOLTO, erasedRects: [{ x: 98.5, y: 538, w: 269, h: 25 }, { x: 81.44, y: 571, w: 270, h: 24 }] }, 'Tired of scrolling his endless following list?');
    expect(Math.abs(regua.exposure - 0.029)).toBeLessThanOrEqual(0.015);
    expect(r.chinGapPx).toBeGreaterThan(35); // ~40 a olho
  });

  it('curta: too_short (E bem acima do limite; §16.3 mediu 0,334, a função dá 0,45)', () => {
    const r = ajustarHeadlineCopia(SOLTO, 'Who is he following now?');
    expect(r.reject).toBe('too_short');
    expect(r.fits).toBe(false);
    expect(r.exposure).toBeGreaterThan(EXPOSICAO_MAX);
    expect(r.lines).toHaveLength(2);
    expect(r.lines).toEqual(['Who is he', 'following now?']); // a mesma quebra da S4
    expect(r.exposure).toBeCloseTo(0.45, 2);
  });

  it('1 linha: too_short (§16.3 mediu 0,532), com a quebra pedida ou automática', () => {
    expect(Math.abs(exposicaoDeLinhas(SOLTO, ['Who is he following?']) - 0.532)).toBeLessThanOrEqual(0.03);
    const auto = ajustarHeadlineCopia(SOLTO, 'Who is he following?');
    expect(auto.reject).toBe('too_short');
    const umaPalavra = ajustarHeadlineCopia(SOLTO, 'Following?');
    expect(umaPalavra).toMatchObject({ reject: 'too_short', lines: ['Following?'] });
    expect(umaPalavra.exposure).toBeGreaterThan(0.5);
  });

  it('longa: grow sobe 1 linha e encosta no queixo, over_chin', () => {
    const r = ajustarHeadlineCopia(SOLTO, 'Tired of scrolling his endless following list just to find out who he added last night?');
    expect(r.reject).toBe('over_chin');
    expect(r.lines).toHaveLength(3);
    expect(r.firstBaselineY).toBeCloseTo(523.75, 1); // a última base fica em 590,25
    expect(r.chinGapPx!).toBeLessThan(0.5 * 26.75);
    expect(r.chinGapPx!).toBeGreaterThan(0); // ~7 a olho
    // sem rosto, a mesma longa passa no degrau grow
    expect(ajustarHeadlineCopia({ ...SOLTO, chinY: null }, 'Tired of scrolling his endless following list just to find out who he added last night?'))
      .toMatchObject({ fits: true, step: 'grow', exposure: 0 });
  });

  it('longa2: rewrap até a margem de 5 % (§16.3: 32 px em 464 passa)', () => {
    const r = ajustarHeadlineCopia(SOLTO, 'Tired of scrolling his endless list just to see who he followed?');
    expect(r).toMatchObject({ fits: true, step: 'rewrap', exposure: 0, sizePx: 26.75 });
    expect(r.lines).toEqual(['Tired of scrolling his endless list', 'just to see who he followed?']);
  });

  it('não cabe nem em 3 linhas a 90 %: too_long', () => {
    const r = ajustarHeadlineCopia({ ...SOLTO, chinY: null }, 'Tired of scrolling his endless following list every single night just to find out who he added, who he liked and who he messaged?');
    expect(r).toMatchObject({ fits: false, reject: 'too_long', step: null });
  });
});

describe('ajustarHeadlineCopia: A4 e caixa', () => {
  it('A4: um centro só para todas as linhas; o emoji entra na largura da linha dele', () => {
    const longa2 = 'Tired of scrolling his endless list just to see who he followed?';
    // no centro medido (233) cabe a 26,75; com o centro deslocado a mesma linha bate na margem e tem de encolher
    expect(ajustarHeadlineCopia(SOLTO, longa2)).toMatchObject({ step: 'rewrap', sizePx: 26.75 });
    expect(ajustarHeadlineCopia({ ...SOLTO, centerX: 200 }, longa2).step).not.toBe('rewrap');
    // o emoji pesa: sem ele, a mesma frase longa cabe numa margem mais apertada
    const apertada = { ...SOLTO, sideMarginPx: 40, chinY: null };
    const com = ajustarHeadlineCopia(apertada, 'Tired of scrolling his endless list, just to see who he followed today');
    const sem = ajustarHeadlineCopia({ ...apertada, emoji: null }, 'Tired of scrolling his endless list, just to see who he followed today');
    const ordem = ['same', 'rewrap', 'shrink', 'grow'];
    expect(ordem.indexOf(sem.step!)).toBeLessThan(ordem.indexOf(com.step!));
  });

  // caixa do 06 da S4 (Montserrat 500, aprovada pelo Gusta em §16.11): não expõe nada; curta não é recusada
  const CAIXA: HeadlineFitLook = {
    kind: 'box', canvas: { width: 720, height: 1280 }, fontId: 'montserrat-500', sizePx: 34, letterSpacingEm: 0, linePitchPx: 44,
    firstBaselineY: 300, align: 'center', centerX: 360, caseStyle: 'sentence',
    originalLines: [{ chars: 26, widthPx: 470 }, { chars: 24, widthPx: 440 }],
    erasedRects: [], bottomLimitY: 1000, chinY: null, sideMarginPx: 24, emoji: null,
    box: { x: 100, y: 260, w: 520, h: 110 },
  };
  it('caixa: curta cabe com E = 0 e sem crescer', () => {
    const r = ajustarHeadlineCopia(CAIXA, 'Ele mudou de ideia');
    expect(r).toMatchObject({ fits: true, exposure: 0, boxGrowPx: 0 });
  });
  it('caixa: longa cresce pros dois lados com a entrelinha', () => {
    const r = ajustarHeadlineCopia(CAIXA, 'Se em sete dias ele não voltar a te escrever, nunca foi pra você');
    expect(r.step).toBe('grow');
    expect(r.lines).toHaveLength(3);
    expect(r.boxGrowPx).toBeGreaterThan(30);
  });
  it('caixa em cima: cresce pra baixo e respeita bottomLimitY', () => {
    const topo = { ...CAIXA, box: { x: 100, y: 10, w: 520, h: 110 }, firstBaselineY: 50 };
    const r = ajustarHeadlineCopia(topo, 'Se em sete dias ele não voltar a te escrever, nunca foi pra você');
    expect(r).toMatchObject({ step: 'grow', firstBaselineY: 50 });
    expect(r.boxGrowPx).toBeGreaterThan(30);
    expect(ajustarHeadlineCopia({ ...topo, bottomLimitY: 125 }, 'Se em sete dias ele não voltar a te escrever, nunca foi pra você').reject).toBe('too_long');
    expect(ajustarHeadlineCopia(topo, 'Se em sete dias ele não voltar a te escrever, nunca foi pra você, e tudo bem seguir em frente sem olhar').reject).toBe('too_long');
  });
  it('caixa alta e quebra pedida', () => {
    const r = ajustarHeadlineCopia({ ...CAIXA, caseStyle: 'upper' }, 'nunca foi\npra você');
    expect(r.lines).toEqual(['NUNCA FOI', 'PRA VOCÊ']);
  });
});
