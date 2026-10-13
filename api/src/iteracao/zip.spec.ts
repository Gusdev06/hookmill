import { folderFor, readmeFor, slugOf, zipFileName, zipFolders, zipKeyOf } from './zip';

describe('zip do lote AUTO (variacao-auto-v1 §8)', () => {
  it('nome: <CLIENTE>_<MMDD>_<SLUG>_variations.zip (PT _variacoes), slug ASCII maiúsculo ≤ 24', () => {
    const d = new Date('2026-10-13T12:00:00Z');
    expect(zipFileName({ shortCode: 'MC', launchedAt: d, championName: 'Colchão — promo 60 noites!!', locale: 'EN' })).toBe('MC_1013_COLCHAO-PROMO-60-NOITES_variations.zip');
    expect(zipFileName({ shortCode: 'MC', launchedAt: d, championName: 'x', locale: 'PT_BR' })).toBe('MC_1013_X_variacoes.zip');
    expect(slugOf('a'.repeat(40)).length).toBe(24);
    expect(slugOf('###')).toBe('VIDEO');
  });
  it('pastas no idioma da interface, pelo eixo', () => {
    expect(zipFolders('EN')).toEqual({ stretch: '1-stretch-its-life', newAudience: '2-new-audience' });
    expect(folderFor('DIVERSITY', 'PT_BR')).toBe('2-publico-novo');
    expect(folderFor('ITERATION', 'PT_BR')).toBe('1-esticar-a-vida');
  });
  it('README: instrução do conjunto + arquivo → o que mudou', () => {
    const r = readmeFor('ITERATION', [{ file: 'MC_1013_CUT-15S_9x16.mp4', change: '15 s cut' }], 'EN');
    expect(r).toContain('separate from the winner');
    expect(r).toContain('MC_1013_CUT-15S_9x16.mp4 → 15 s cut');
    expect(readmeFor('DIVERSITY', [], 'PT_BR')).toContain('Conjunto novo');
  });
  it('zipKey estável na ordem; muda com a seleção', () => {
    const a = zipKeyOf([{ pieceId: 'a', fileIds: ['1', '2'] }, { pieceId: 'b', fileIds: ['3'] }]);
    expect(zipKeyOf([{ pieceId: 'b', fileIds: ['3'] }, { pieceId: 'a', fileIds: ['2', '1'] }])).toBe(a);
    expect(zipKeyOf([{ pieceId: 'a', fileIds: ['1', '2'] }])).not.toBe(a);
  });
});
