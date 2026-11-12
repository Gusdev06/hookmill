import { LEGENDA_FONTES, legendaDoCaptionTrack, legendaSwapSchema, limpaPalavra, paginasDaLegenda, paginasPorTempo, palavraDaVez, posicoesDasPalavras } from '../src/lib/legendaSwap';
import { captionsAutoSchema, paginasLegendaAuto } from '../src/lib';

const canvas = { width: 720, height: 960, fps: 30, frameCount: 300 };
const w = (word: string, s: number, e: number) => ({ word, startSec: s, endSec: e });

describe('legendaSwap (troca de legenda, F2)', () => {
  it('limpa como o Python: sem pontuação, maiúsculas, mantém acento, $ e %', () => {
    expect(limpaPalavra(' Día,')).toBe('DÍA');
    expect(limpaPalavra('$50!')).toBe('$50');
    expect(limpaPalavra('…')).toBe('');
  });

  it('páginas: cada trecho consome as palavras do próprio texto; pula palavra sem trecho; fim = início da próxima (A7); última até o fim', () => {
    const words = [w('Cada', 0, .3), w('día', .3, .6), w('(ruído)', .6, .8), w('miles', 1, 1.3), w('de', 1.3, 1.5), w('personas', 1.5, 2)];
    const p = paginasDaLegenda({ canvas, atrasoSec: 0.1, words, trechos: [
      { iniFrame: 3, fimFrame: 20, texto: 'CADA DÍA' }, { iniFrame: 33, fimFrame: 60, texto: 'MILES DE PERSONAS' },
    ] });
    expect(p.map((x) => x.palavras.map((y) => y.texto))).toEqual([['CADA', 'DÍA'], ['MILES', 'DE', 'PERSONAS']]);
    expect(p[0].palavras[0].iniSec).toBeCloseTo(0.1, 6);
    expect(p[1].palavras[0].iniSec).toBeCloseTo(1.1, 6);
    expect(p[0].fimFrame).toBe(33);   // fica na tela até a próxima, não some na pausa
    expect(p[1].fimFrame).toBe(300);
  });

  it('páginas: texto que não casa cai no tempo; sem palavra no tempo, mostra sem karaokê', () => {
    const words = [w('uno', 0, .3), w('dos', .3, .6)];
    const a = paginasDaLegenda({ canvas, atrasoSec: 0, words, trechos: [{ iniFrame: 0, fimFrame: 30, texto: 'OTRA COSA' }] });
    expect(a[0].palavras.map((x) => x.texto)).toEqual(['UNO', 'DOS']);
    const b = paginasDaLegenda({ canvas, atrasoSec: 0, words, trechos: [{ iniFrame: 90, fimFrame: 120, texto: 'OTRA COSA' }] });
    expect(b[0].palavras).toEqual([{ texto: 'OTRA', iniSec: null }, { texto: 'COSA', iniSec: null }]);
    expect(palavraDaVez(b[0], 3.5)).toBe(-1);
  });

  it('karaokê: palavra da vez muda no tempo da palavra (+atraso)', () => {
    const p = paginasDaLegenda({ canvas, atrasoSec: 0.1, words: [w('a', 0, .3), w('b', .5, .8), w('c', 1, 1.3)], trechos: [{ iniFrame: 0, fimFrame: 60, texto: 'A B C' }] })[0];
    expect([0.05, 0.2, 0.7, 1.2].map((t) => palavraDaVez(p, t))).toEqual([-1, 0, 1, 2]);
  });

  it('posições centradas: a soma das larguras e dos espaços fica no centro', () => {
    const { x, total } = posicoesDasPalavras([100, 50, 150], 10, 360);
    expect(total).toBe(320);
    expect(x).toEqual([200, 310, 370]);
  });

  it('catálogo da legenda cobre os ids que o Python emite; schema aceita o estilo do captionTrack', () => {
    for (const id of ['gabarito-900', 'poppins-800', 'poppins-900', 'montserrat-900', 'archivo-w125-900', 'manrope-800', 'inter-700', 'tiktok-sans-700']) expect(LEGENDA_FONTES[id]).toBeTruthy();
    const ok = legendaSwapSchema.safeParse({ canvas, baseVideoUrl: 'p.mp4', trechos: [], words: [], atrasoSec: 0.1,
      estilo: { fontId: 'gabarito-900', tamPx: 55, tracking: 0, espaco: 0.5, strokePx: 3, sombra: [0, 2], corTexto: '#fff', corDestaque: null, corTraco: '#000', baseY: 500, centroX: 360 } });
    expect(ok.success).toBe(true);
  });

  const track = {
    trechos: [{ iniFrame: 30, fimFrame: 72, texto: 'OKAY', box: { x: 181, y: 979, w: 239, h: 37 } }, { iniFrame: 72, fimFrame: 120, texto: '', herdado: true, box: { x: 150, y: 979, w: 421, h: 37 } }],
    atrasoSec: -0.5, fps: 30, quadros: 300,
    estilo: { tamPx: 51, strokePx: 7, corTexto: '#fcfcfc', corDestaque: null as string | null, corTraco: '#000000', sombra: [2, 2] as [number, number], caixaDestaque: { cor: '#6f26d9', raioPx: 10 }, palavrasPorPagina: 2 },
  };
  const falas = [w('In', 1.0, 1.2), w('the,', 1.2, 1.5), w('morning.', 1.5, 2.1), w('Okay', 2.4, 2.8)];

  it('paginasPorTempo: reestima o atraso pelo início das páginas e põe cada palavra na página em cujo intervalo ela cai', () => {
    const r = paginasPorTempo(track.trechos, falas, 30, 300, -0.5);
    expect(Math.abs(r.atrasoSec)).toBeLessThanOrEqual(0.12);   // as páginas de 1,0 s e 2,4 s casam com "In" e "Okay": o atraso certo é ~0 (±0,12), não o −0,5 da dica
    expect(r.paginas[0].palavras.map((x) => x.texto)).toEqual(['IN', 'THE', 'MORNING']);
  });

  it('legendaDoCaptionTrack: modo livre (estilo padrão) ignora o estilo medido: branco, contorno escuro, destaque, 3 palavras, sem caixa', () => {
    const l = legendaDoCaptionTrack({ ...track, veredito: { estilo: 'padrao' } }, falas, 'en', 1280);
    expect(l.style).toMatchObject({ color: '#ffffff', strokeColor: '#000000', uppercase: true, wordsPerPage: 3, highlightBox: null, shadow: false });
    expect(l.style.sizeRel).toBeCloseTo(0.042, 3);
    expect(legendaDoCaptionTrack({ ...track, veredito: { estilo: 'copiado' } }, falas, 'en', 1280).style.sizeRel).toBeCloseTo(track.estilo.tamPx / 1280, 3);
  });

  it('legendaDoCaptionTrack: sem pontuação, caixa do destaque medida, sem traço quando há caixa, 1 palavra por página só se o original tem 1', () => {
    const l = legendaDoCaptionTrack(track, falas, 'en', 1280);
    expect(l.words.map((x) => x.word)).toEqual(['IN', 'THE', 'MORNING', 'OKAY']);          // "the," e "morning." viram "THE" e "MORNING"
    expect(l.style.highlightBox).toEqual({ color: '#6f26d9', radiusRel: 0.196 });
    expect(l.style.strokeColor).toBeNull(); expect(l.style.strokeWidthRel).toBe(0); expect(l.style.shadow).toBe(false);
    expect(l.style.sizeRel).toBeCloseTo(51 / 1280, 5);
    expect(l.style.wordsPerPage).toBe(3);
    expect(l.words.every((x) => x.startSec >= 0)).toBe(true);                               // atraso negativo nunca empurra para antes de 0
    expect(captionsAutoSchema.safeParse(l).success).toBe(true);
    const sem = legendaDoCaptionTrack({ ...track, estilo: { ...track.estilo, caixaDestaque: null, palavrasPorPagina: 1, strokePx: 3 } }, falas, 'en', 1280);
    expect(sem.style.highlightBox).toBeNull(); expect(sem.style.strokeColor).toBe('#000000'); expect(sem.style.wordsPerPage).toBe(1);
  });

  it('páginas da original (`pg` em todas as palavras): agrupa por página, fim = início da próxima, a última até o fim', () => {
    const ps = paginasLegendaAuto([{ word: 'A', startSec: 0, endSec: 0.3, pg: 0 }, { word: 'B', startSec: 0.3, endSec: 0.6, pg: 0 }, { word: 'C', startSec: 1.5, endSec: 1.9, pg: 1 }], 'en', 5, 4);
    expect(ps.map((p) => p.palavras.map((x) => x.word))).toEqual([['A', 'B'], ['C']]);
    expect(ps[0].endSec).toBe(1.5); expect(ps[1].endSec).toBe(5);
  });
});
