import type { EditMap } from '@maquina/contratos';
import { faixasProtegidasDe } from '@maquina/video';
import { faixasDoCampeao } from './faixas-protegidas';

it('planner and render use the same caption bands even when cached bands are stale or empty', () => {
  const map = { width: 1080, height: 1920, fps: 30, protectedBands: [], layers: [{ kind: 'caption', box: { x: 100, y: 700, w: 880, h: 100 }, startFrame: 0, endFrame: 300, style: { fontSizePx: 40 } }] } as unknown as EditMap;
  const dims = { width: 1080, height: 1920 };
  expect(faixasDoCampeao(map, dims)).toHaveLength(1);
  expect(faixasDoCampeao(map, dims)).toEqual(faixasProtegidasDe(map as never, dims));
});
