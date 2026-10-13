import { adFileName, withCollisionSuffix, type AdNameInput } from './ad-name';

// fase2-agencia.md §6: as 6 partes da tabela + colisão.
const base: AdNameInput = {
  shortCode: 'MC', origin: 'SCRATCH', approvedAt: new Date('2026-10-12T15:00:00Z'), scriptLetter: 'A',
  variation: null, face: { batch: 1, position: 1 }, format: 'VERTICAL_9_16',
};

describe('adFileName', () => {
  it('exemplo do contrato: MC_NEW_1012_A_F2_9x16', () => {
    expect(adFileName(base)).toBe('MC_NEW_1012_A_F2_9x16');
  });
  it('CLIENTE = shortCode', () => {
    expect(adFileName({ ...base, shortCode: 'ACME' })).toMatch(/^ACME_/);
  });
  it('CAMINHO: SCRATCH → NEW, VARIATION → ITER', () => {
    expect(adFileName({ ...base, origin: 'VARIATION', variation: { kind: 'NEW_HOOKS', index: 2, isControl: false } })).toBe('MC_ITER_1012_H03_F2_9x16');
  });
  it('MMDD em UTC; sem OK final usa hoje (UTC)', () => {
    expect(adFileName({ ...base, approvedAt: new Date('2026-01-05T23:30:00-03:00') })).toContain('_0106_');
    expect(adFileName({ ...base, approvedAt: null, now: new Date('2026-12-31T12:00:00Z') })).toContain('_1231_');
  });
  it('ROTEIRO: letra no zero; tipo + índice com 2 dígitos na variação; controle → CTRL', () => {
    const v = (kind: AdNameInput['variation'] & object) => adFileName({ ...base, origin: 'VARIATION', variation: kind }).split('_')[3];
    expect(v({ kind: 'NEW_HOOKS', index: 0, isControl: false })).toBe('H01');
    expect(v({ kind: 'SWAP_AVATAR', index: 0, isControl: false })).toBe('AV01');
    expect(v({ kind: 'COPY_NEW', index: 9, isControl: false })).toBe('C10');
    expect(v({ kind: 'REMIX_EDIT', index: 0, isControl: false })).toBe('L01');
    expect(v({ kind: 'NEW_HOOKS', index: -1, isControl: true })).toBe('CTRL');
  });
  it('ROSTO: F + (batch − 1) × 4 + position + 1; sem rosto gerado → ORIG', () => {
    expect(adFileName({ ...base, face: { batch: 1, position: 0 } })).toContain('_F1_');
    expect(adFileName({ ...base, face: { batch: 3, position: 2 } })).toContain('_F11_');
    expect(adFileName({ ...base, face: null })).toContain('_ORIG_');
  });
  it('FORMATO: 9x16, 4x5, 1x1', () => {
    expect(adFileName({ ...base, format: 'PORTRAIT_4_5' })).toMatch(/_4x5$/);
    expect(adFileName({ ...base, format: 'SQUARE_1_1' })).toMatch(/_1x1$/);
  });
});

describe('withCollisionSuffix', () => {
  it('livre = o próprio nome; colisão → _2, _3 no fim', () => {
    expect(withCollisionSuffix('MC_NEW_1012_A_F2_9x16', [])).toBe('MC_NEW_1012_A_F2_9x16');
    expect(withCollisionSuffix('MC_NEW_1012_A_F2_9x16', ['MC_NEW_1012_A_F2_9x16'])).toBe('MC_NEW_1012_A_F2_9x16_2');
    expect(withCollisionSuffix('MC_NEW_1012_A_F2_9x16', ['MC_NEW_1012_A_F2_9x16', 'MC_NEW_1012_A_F2_9x16_2'])).toBe('MC_NEW_1012_A_F2_9x16_3');
  });
});
