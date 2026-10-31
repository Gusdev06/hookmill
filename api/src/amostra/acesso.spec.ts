import { admitIterate, capSampleSelection, effectiveAccess, isLocked } from './acesso';

describe('amostra: acesso efetivo e admissão (puro)', () => {
  it('PAID > INTERNAL > SAMPLE entre os OWNERs; sem OWNER = SAMPLE', () => {
    expect(effectiveAccess(['SAMPLE', 'PAID', 'INTERNAL'])).toBe('PAID');
    expect(effectiveAccess(['SAMPLE', 'INTERNAL'])).toBe('INTERNAL');
    expect(effectiveAccess(['SAMPLE', 'SAMPLE'])).toBe('SAMPLE');
    expect(effectiveAccess([])).toBe('SAMPLE');
  });

  it('travado só o lote da amostra sem plano', () => {
    expect(isLocked({ sample: true }, 'SAMPLE')).toBe(true);
    expect(isLocked({ sample: true }, 'PAID')).toBe(false);
    expect(isLocked({ sample: true }, 'INTERNAL')).toBe(false);
    expect(isLocked({ quizEnabled: true }, 'SAMPLE')).toBe(false);
    expect(isLocked(null, 'SAMPLE')).toBe(false);
  });

  it('POST /iterate: normal, amostra, gasta e P4 (só OWN)', () => {
    expect(admitIterate({ access: 'INTERNAL', sampleUsed: true, accountMode: null })).toEqual({ kind: 'normal' });
    expect(admitIterate({ access: 'PAID', sampleUsed: true, accountMode: 'AGENCY' })).toEqual({ kind: 'normal' });
    expect(admitIterate({ access: 'SAMPLE', sampleUsed: false, accountMode: 'OWN' })).toEqual({ kind: 'sample' });
    const used = { kind: 'blocked', details: { reason: 'sample_used', unlock: { pieces: 0 } } };
    expect(admitIterate({ access: 'SAMPLE', sampleUsed: true, accountMode: 'OWN' })).toEqual(used);
    expect(admitIterate({ access: 'SAMPLE', sampleUsed: false, accountMode: 'AGENCY' })).toEqual(used);
    expect(admitIterate({ access: 'SAMPLE', sampleUsed: false, accountMode: null })).toEqual(used);
  });

  it('corta a seleção em 4 incluídas, na ordem, sem mexer nas de fora', () => {
    const sel = [true, false, true, true, true, true, true].map((included, i) => ({ i, included, selection: included ? 'auto' : 'not_asked' }));
    const out = capSampleSelection(sel);
    expect(out.filter((s) => s.included).map((s) => s.i)).toEqual([0, 2, 3, 4]);
    expect(out[5]).toMatchObject({ included: false, selection: 'goal_cut' });
    expect(out[1]).toBe(sel[1]);
    expect(sel[5].included).toBe(true);
  });
});
