// (c) 08/10: legenda sem fundo ganha a caixa medida por pixel (medicao.captionBox, proposta ao video) nos instantes das palavras.
import type { EditLayer } from '@maquina/contratos';
import { AnaliseService } from './analise.service';

const cap: EditLayer = {
  id: 'cap', kind: 'caption', startFrame: 0, endFrame: 250, box: { x: 0, y: 589, w: 720, h: 80 },
  background: { kind: 'none', color: null, box: null }, style: {} as any, text: null, wordsPerPage: 3, source: 'vision',
};
const words = Array.from({ length: 30 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
const refine = (media: object, l = cap) =>
  (AnaliseService.prototype as any).refineCaptionBox.call({ media, log: { warn: () => undefined } }, '/v.mp4', l, 25, words) as Promise<EditLayer>;

describe('refino da legenda sem fundo (captionBox)', () => {
  it('usa a caixa medida, só nos instantes das palavras dentro do intervalo da camada', async () => {
    const captionBox = jest.fn(async () => ({ x: 40, y: 955, w: 640, h: 86 }));
    const l = await refine({ captionBox });
    expect(l).toMatchObject({ box: { y: 955, h: 86 }, source: 'vision+pixel' });
    const at = (captionBox.mock.calls[0] as unknown as [string, number[]])[1];
    expect(at.every((t) => t * 25 < 250)).toBe(true);
    expect(at[0]).toBe(0.2);
  });
  it('sem o método na medicao, sem achado ou com erro = a caixa da visão', async () => {
    expect(await refine({})).toBe(cap);
    expect((await refine({ captionBox: async () => null })).box.y).toBe(589);
    expect((await refine({ captionBox: async () => { throw new Error('x'); } })).box.y).toBe(589);
  });
});
