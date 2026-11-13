// (c) 08/10: legenda sem fundo ganha a caixa medida por pixel (medicao.captionBox, proposta ao video) nos instantes das palavras.
import type { EditLayer } from '@maquina/contratos';
import type { MediaAnalysisService } from '../medicao/contrato';
import { refinar } from '../medicao/leitura/etapas';

const cap: EditLayer = {
  id: 'cap', kind: 'caption', startFrame: 0, endFrame: 250, box: { x: 0, y: 589, w: 720, h: 80 },
  background: { kind: 'none', color: null, box: null }, style: {} as any, text: null, wordsPerPage: 3, source: 'vision',
};
const words = Array.from({ length: 30 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
// 31/10 (leitura-lambda-v1): o refino saiu do AnaliseService.refineCaptionBox para medicao/leitura/etapas.ts › refinar (QA 01/11).
const refine = async (media: object, l = cap): Promise<EditLayer> =>
  (await refinar(media as MediaAnalysisService, '/v.mp4', { layers: [l], fps: 25, frameCount: 250, words }))[0];

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
  // 13/11: campeão cmwemcigz (lote cmwemcii7): legenda "pill" com y da visão na altura do rosto (518) ficava sem refino
  it('legenda com fundo (pill) também é medida por pixel, e o fundo acompanha a caixa', async () => {
    const pill: EditLayer = { ...cap, box: { x: 194, y: 518, w: 691, h: 67 }, background: { kind: 'pill', color: '#111111', box: { x: 194, y: 518, w: 691, h: 67 } } };
    const solidBackground = jest.fn(async () => null);
    const l = await refine({ captionBox: async () => ({ x: 197, y: 1309, w: 674, h: 81 }), solidBackground }, pill);
    expect(l).toMatchObject({ box: { y: 1309, h: 81 }, background: { kind: 'pill', color: '#111111', box: { y: 1309, h: 81 } }, source: 'vision+pixel' });
    expect(solidBackground).not.toHaveBeenCalled();
  });
});
