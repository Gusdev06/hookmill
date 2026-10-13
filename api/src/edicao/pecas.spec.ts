import { autoAdName, autoFileName, expectedOutputSec, folderOf, latestByFormat, mockRenderFail, pieceOutcome, pieceStatus, renderOrder } from './pecas';
import { withCollisionSuffix } from '../biblioteca/ad-name';

const t = (ms: number) => new Date(1_700_000_000_000 + ms);

describe('peças AUTO: regras puras (variacao-auto-v1)', () => {
  it('ordem da fila (§5.1/D5): 9:16 de todas na ordem do plano, depois 4:5, depois 1:1', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ index: 10 - i, id: `p${10 - i}` }));
    const o = renderOrder(items);
    expect(o).toHaveLength(33);
    expect(o.slice(0, 11).every((x) => x.format === 'VERTICAL_9_16')).toBe(true);
    expect(o.slice(11, 22).every((x) => x.format === 'PORTRAIT_4_5')).toBe(true);
    expect(o.slice(22).every((x) => x.format === 'SQUARE_1_1')).toBe(true);
    expect(o.slice(0, 11).map((x) => x.item.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(o.map((x) => x.seq)).toEqual([...Array(33).keys()]);
  });

  it('status derivado na ordem do §3.2', () => {
    const r = (status: 'QUEUED' | 'RENDERING' | 'READY' | 'FAILED') => ({ format: 'VERTICAL_9_16' as const, status, createdAt: t(0) });
    expect(pieceStatus({ launched: false, leftOutAt: null, creativeState: null, renders: [] })).toBe('planned');
    expect(pieceStatus({ launched: true, leftOutAt: t(1), creativeState: 'RENDER_FAILED', renders: [] })).toBe('left_out');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'APPROVED', renders: [] })).toBe('ready');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'RENDER_FAILED', renders: [] })).toBe('failed');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'RENDERING', renders: [r('RENDERING')] })).toBe('rendering');
    expect(pieceStatus({ launched: true, leftOutAt: null, creativeState: 'RENDERING', renders: [r('QUEUED')] })).toBe('queued');
  });

  it('desfecho: falta formato = null; 3 READY = ready; algum FAILED (e nada pendente) = failed; o mais novo de cada formato vale', () => {
    const R = (format: any, status: any, ms = 0) => ({ format, status, createdAt: t(ms) });
    expect(pieceOutcome([R('VERTICAL_9_16', 'READY'), R('PORTRAIT_4_5', 'READY')])).toBeNull();
    expect(pieceOutcome([R('VERTICAL_9_16', 'READY'), R('PORTRAIT_4_5', 'FAILED'), R('SQUARE_1_1', 'QUEUED')])).toBeNull();
    expect(pieceOutcome([R('VERTICAL_9_16', 'READY'), R('PORTRAIT_4_5', 'FAILED'), R('SQUARE_1_1', 'READY')])).toBe('failed');
    expect(pieceOutcome([R('VERTICAL_9_16', 'READY'), R('PORTRAIT_4_5', 'FAILED'), R('PORTRAIT_4_5', 'READY', 5), R('SQUARE_1_1', 'READY')])).toBe('ready');
    expect(latestByFormat([R('PORTRAIT_4_5', 'READY', 9), R('PORTRAIT_4_5', 'FAILED', 1)]).get('PORTRAIT_4_5')!.status).toBe('READY');
  });

  it('adName AUTO = CLIENTE_MMDD_CODIGO (UTC do launchedAt), colisão _2; arquivo <adName>_<FMT>.<ext>', () => {
    const base = autoAdName({ shortCode: 'MC', launchedAt: new Date('2026-10-13T23:30:00-03:00'), code: 'CUT-15S' });
    expect(base).toBe('MC_1014_CUT-15S');
    expect(autoAdName({ shortCode: 'MC', launchedAt: new Date('2026-10-13T15:00:00Z'), code: 'CUT-15S' })).toBe('MC_1013_CUT-15S');
    expect(withCollisionSuffix('MC_1013_CUT-15S', ['MC_1013_CUT-15S'])).toBe('MC_1013_CUT-15S_2');
    expect(autoFileName('MC_1013_CUT-15S', 'VERTICAL_9_16', 'video/mp4')).toBe('MC_1013_CUT-15S_9x16.mp4');
    expect(autoFileName('MC_1013_LAYOUT-SPLIT-LP', 'PORTRAIT_4_5', 'video/mp4')).toBe('MC_1013_LAYOUT-SPLIT-LP_4x5.mp4');
    expect(autoFileName('MC_1013_STATIC-F1', 'SQUARE_1_1', 'image/png')).toBe('MC_1013_STATIC-F1_1x1.png');
  });

  it('pasta pelo eixo; gatilho de mock só na 1ª tentativa do 4:5 do tipo; duração esperada', () => {
    expect(folderOf('ITERATION')).toBe('1-stretch');
    expect(folderOf('DIVERSITY')).toBe('2-new-audience');
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'STORY', 'PORTRAIT_4_5', 1)).toBe(true);
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'STORY', 'PORTRAIT_4_5', 2)).toBe(false);
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'STORY', 'VERTICAL_9_16', 1)).toBe(false);
    expect(mockRenderFail('x [mock:render-fail:STORY]', 'CUT', 'PORTRAIT_4_5', 1)).toBe(false);
    expect(expectedOutputSec('CUT', { targetSec: 15 }, 30)).toBe(15);
    expect(expectedOutputSec('ENDCARD', {}, 30)).toBe(32);
    expect(expectedOutputSec('STORY', {}, 30)).toBe(30);
  });
});
