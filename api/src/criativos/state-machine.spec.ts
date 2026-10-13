import type { CreativeState } from '@maquina/contratos';
import { AppException } from '../common/errors/app-exception';
import { ALL_STATES } from './derivacao';
import { CREATIVE_CHANGED, CREATIVE_EVENTS, CreativeEvent, CreativeStateMachine, TRANSITIONS, allowedFrom, assertNotAutoPiece, assertVariationGenerate, canTransition, initialState, pickEvent } from './state-machine';

/** Banco em memória com o mesmo compare-and-set do Prisma (updateMany where state in [...]). */
function fakeDb(state: CreativeState, extra: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = { id: 'c1', state, archivedAt: null, editDirty: false, ...extra };
  const creative = {
    updateMany: jest.fn(async ({ where, data }: any) => {
      const okState = where.state.in.includes(row.state);
      const okExtra = Object.entries(where).every(([k, v]) => ['id', 'state', 'archivedAt'].includes(k) || row[k] === v);
      if (where.id !== row.id || row.archivedAt !== null || !okState || !okExtra) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    }),
    findUnique: jest.fn(async () => ({ state: row.state, archivedAt: row.archivedAt })),
  };
  return { row, prisma: { creative } as any };
}

const bus = () => ({ emit: jest.fn() }) as any;

// Todas as transições válidas da tabela (modelo-de-dados.md), uma linha por (evento, de, para).
const VALID: [CreativeEvent, CreativeState, CreativeState][] = CREATIVE_EVENTS.flatMap((ev) =>
  TRANSITIONS[ev].from.flatMap((from) => TRANSITIONS[ev].to.map((to) => [ev, from, to] as [CreativeEvent, CreativeState, CreativeState])),
);

describe('CreativeStateMachine: uma transição válida por teste', () => {
  it.each(VALID)('%s: %s → %s grava o estado novo com compare-and-set e avisa o SSE', async (event, from, to) => {
    const { row, prisma } = fakeDb(from);
    const b = bus();
    const sm = new CreativeStateMachine(prisma, b);
    await expect(sm.transition({ creativeId: 'c1', event, to, from })).resolves.toEqual({ to });
    expect(row.state).toBe(to);
    expect(row.stateChangedAt).toBeInstanceOf(Date);
    expect(prisma.creative.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'c1', archivedAt: null, state: { in: [from] } }) }),
    );
    expect(b.emit).toHaveBeenCalledWith(CREATIVE_CHANGED, { creativeId: 'c1' });
  });
});

describe('CreativeStateMachine: origens proibidas', () => {
  const INVALID: [CreativeEvent, CreativeState][] = CREATIVE_EVENTS.flatMap((ev) =>
    ALL_STATES.filter((s) => !allowedFrom(ev).includes(s)).map((s) => [ev, s] as [CreativeEvent, CreativeState]),
  );

  it.each(INVALID)('%s em %s → 409 INVALID_STATE { state, allowed } e o estado não muda', async (event, from) => {
    const { row, prisma } = fakeDb(from);
    const b = bus();
    const sm = new CreativeStateMachine(prisma, b);
    const to = TRANSITIONS[event].to[0];
    const err = await sm.transition({ creativeId: 'c1', event, to }).catch((e) => e);
    expect(err).toBeInstanceOf(AppException);
    expect(err.code).toBe('INVALID_STATE');
    expect(err.details).toEqual({ state: from, allowed: allowedFrom(event) });
    expect(row.state).toBe(from);
    expect(b.emit).not.toHaveBeenCalled();
  });

  it('APPROVED é final: nenhum evento sai dele', () => {
    for (const ev of CREATIVE_EVENTS) expect(allowedFrom(ev)).not.toContain('APPROVED');
  });

  it('nenhum evento leva de volta a SCRIPTS_WRITING fora de gerar roteiros, nem a APPROVED fora de aprovar', () => {
    for (const ev of CREATIVE_EVENTS) {
      if (ev !== 'GENERATE_SCRIPTS') expect(TRANSITIONS[ev].to).not.toContain('SCRIPTS_WRITING');
      if (ev !== 'APPROVE' && ev !== 'AUTO_APPROVE') expect(TRANSITIONS[ev].to).not.toContain('APPROVED');
    }
  });
});

describe('peça AUTO (variacao-auto-v1 §3.3)', () => {
  it('AUTO_PIECE_START é criação: nasce RENDERING e não sai de estado nenhum', () => {
    expect(initialState('AUTO_PIECE_START')).toBe('RENDERING');
    expect(allowedFrom('AUTO_PIECE_START')).toEqual([]);
  });
  it('AUTO_APPROVE: só RENDER_READY → APPROVED', () => {
    expect(canTransition('AUTO_APPROVE', 'RENDER_READY', 'APPROVED')).toBe(true);
    expect(allowedFrom('AUTO_APPROVE')).toEqual(['RENDER_READY']);
  });
  it('travas: AUTO_EDIT = 409 variation_locked; outros passam', () => {
    const err = (() => { try { assertNotAutoPiece({ state: 'APPROVED', variationKind: 'AUTO_EDIT' }); } catch (e) { return e as AppException; } })();
    expect(err).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'variation_locked' } });
    expect(() => assertNotAutoPiece({ state: 'APPROVED', variationKind: 'NEW_HOOKS' })).not.toThrow();
    expect(() => assertVariationGenerate(
      { state: 'RENDER_FAILED', origin: 'VARIATION', engine: null, engineModel: null, voiceId: null, format: 'VERTICAL_9_16', variationKind: 'AUTO_EDIT' },
      { engine: 'x', engineModel: 'y', format: 'VERTICAL_9_16' } as never,
    )).toThrow();
  });
});

describe('CreativeStateMachine: compare-and-set e erros', () => {
  it('clique duplo: a segunda chamada com o mesmo estado esperado recebe 409', async () => {
    const { prisma } = fakeDb('ENGINE_PENDING');
    const sm = new CreativeStateMachine(prisma, bus());
    await sm.transition({ creativeId: 'c1', event: 'GENERATE', to: 'SCENES_GENERATING' });
    const err = await sm.transition({ creativeId: 'c1', event: 'GENERATE', to: 'SCENES_GENERATING' }).catch((e) => e);
    expect(err.code).toBe('INVALID_STATE');
    expect(err.details.state).toBe('SCENES_GENERATING');
  });

  it('filtro extra do CAS: aprovar com editDirty = true não passa', async () => {
    const { row, prisma } = fakeDb('RENDER_READY', { editDirty: true });
    const sm = new CreativeStateMachine(prisma, bus());
    const err = await sm.transition({ creativeId: 'c1', event: 'APPROVE', to: 'APPROVED', where: { editDirty: false } }).catch((e) => e);
    expect(err.code).toBe('INVALID_STATE');
    expect(row.state).toBe('RENDER_READY');
  });

  it('criativo arquivado ou inexistente → 404', async () => {
    const { row, prisma } = fakeDb('ENGINE_PENDING');
    row.archivedAt = new Date();
    prisma.creative.findUnique.mockResolvedValueOnce({ state: 'ENGINE_PENDING', archivedAt: row.archivedAt });
    const sm = new CreativeStateMachine(prisma, bus());
    const err = await sm.transition({ creativeId: 'c1', event: 'GENERATE', to: 'SCENES_GENERATING' }).catch((e) => e);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('destino fora da tabela é erro de programação (não vira 409)', async () => {
    const { prisma } = fakeDb('ENGINE_PENDING');
    const sm = new CreativeStateMachine(prisma, bus());
    await expect(sm.transition({ creativeId: 'c1', event: 'GENERATE', to: 'APPROVED' })).rejects.toThrow('transição inválida');
    await expect(sm.transition({ creativeId: 'c1', event: 'GENERATE', to: 'SCENES_GENERATING', from: 'RENDER_READY' })).rejects.toThrow(
      'transição inválida',
    );
    expect(prisma.creative.updateMany).not.toHaveBeenCalled();
  });

  it('dentro de transação: não anuncia antes do commit', async () => {
    const { prisma } = fakeDb('RENDER_READY');
    const b = bus();
    const sm = new CreativeStateMachine({} as any, b);
    await sm.transition({ creativeId: 'c1', event: 'CHANGE_FACE', to: 'FACES_READY', tx: prisma });
    expect(b.emit).not.toHaveBeenCalled();
  });

  it('pickEvent escolhe o evento pelo estado ou devolve 409 com a união dos permitidos', () => {
    expect(pickEvent('SCRIPTS_READY', ['SELECT_SCRIPT', 'RESELECT_SCRIPT'])).toBe('SELECT_SCRIPT');
    expect(pickEvent('RENDER_READY', ['SELECT_SCRIPT', 'RESELECT_SCRIPT'])).toBe('RESELECT_SCRIPT');
    try {
      pickEvent('SCRIPTS_WRITING', ['SELECT_SCRIPT', 'RESELECT_SCRIPT']);
      fail('devia lançar');
    } catch (e) {
      expect((e as AppException).details).toMatchObject({ state: 'SCRIPTS_WRITING' });
      expect((e as AppException).details!.allowed).toEqual(expect.arrayContaining(['SCRIPTS_READY', 'RENDER_READY']));
    }
  });

  it('canTransition bate com a tabela', () => {
    expect(canTransition('RENDER_FINISHED', 'RENDERING', 'EDIT_PENDING')).toBe(true);
    expect(canTransition('RENDER_FINISHED', 'RENDER_READY', 'EDIT_PENDING')).toBe(false);
    expect(canTransition('SCENES_SETTLED', 'SCENES_GENERATING', 'SCENES_FAILED')).toBe(true);
  });
});
