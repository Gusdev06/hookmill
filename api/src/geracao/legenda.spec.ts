import { alignCaptionToScript, type Word } from './legenda';

const w = (word: string, s: number, e: number): Word => ({ word, startSec: s, endSec: e });

describe('alignCaptionToScript', () => {
  it('troca a palavra errada pela do roteiro e mantém o tempo', () => {
    const out = alignCaptionToScript('Na Geraew você cria', [w('Na', 0, 0.2), w('Guerra', 0.2, 0.6), w('você', 0.6, 0.8), w('cria', 0.8, 1)]);
    expect(out).toEqual([w('Na', 0, 0.2), w('Geraew', 0.2, 0.6), w('você', 0.6, 0.8), w('cria', 0.8, 1)]);
  });
  it('palavra quebrada em duas na transcrição vira uma, cobrindo os dois tempos', () => {
    const out = alignCaptionToScript('doze e noventa. Cancela quando', [w('doce', 0, 0.3), w('e', 0.3, 0.4), w('noventa', 0.4, 0.8), w('Cansá', 0.8, 1.0), w('la', 1.0, 1.2), w('quando', 1.2, 1.5)]);
    expect(out.map((x) => x.word)).toEqual(['doze', 'e', 'noventa.', 'Cancela', 'quando']);
    expect(out[3]).toEqual(w('Cancela', 0.8, 1.2));
  });
  it('palavra do roteiro que a transcrição pulou ganha tempo interpolado', () => {
    const out = alignCaptionToScript('Mais de dois mil criadores', [w('Mais', 0, 0.2), w('de', 0.2, 0.3), w('mil', 0.5, 0.7), w('criadores', 0.7, 1.2)]);
    expect(out.map((x) => x.word)).toEqual(['Mais', 'de', 'dois', 'mil', 'criadores']);
    expect(out[2].startSec).toBeGreaterThanOrEqual(0.3);
    expect(out[2].endSec).toBeLessThanOrEqual(0.5);
  });
  it('tempos sempre crescentes e sem sobreposição; mantém a pontuação do roteiro', () => {
    const out = alignCaptionToScript('Eu não sou real.', [w('eu', 0, 0.3), w('nao', 0.25, 0.5), w('sou', 0.5, 0.7), w('real', 0.7, 1)]);
    for (let k = 1; k < out.length; k++) expect(out[k].startSec).toBeGreaterThanOrEqual(out[k - 1].endSec);
    expect(out[3].word).toBe('real.');
  });
  it('sem transcrição devolve vazio; sem roteiro devolve a transcrição', () => {
    expect(alignCaptionToScript('oi', [])).toEqual([]);
    expect(alignCaptionToScript('', [w('oi', 0, 1)])).toEqual([w('oi', 0, 1)]);
  });
});
