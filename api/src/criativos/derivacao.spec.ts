import { ALL_STATES, filterStates, isDraft, statusKeyOf, statusOf, stepOf, stepsOf } from './derivacao';

describe('derivação de step/status (tabela do modelo-de-dados)', () => {
  const TABLE: Record<string, [string, string]> = {
    SCRIPTS_WRITING: ['scripts', 'progress'], SCRIPTS_READY: ['scripts', 'waiting'], SCRIPTS_FAILED: ['scripts', 'failed'],
    AVATAR_PENDING: ['avatar', 'waiting'], FACES_GENERATING: ['avatar', 'progress'], FACES_READY: ['avatar', 'waiting'],
    FACES_FAILED: ['avatar', 'failed'], ENGINE_PENDING: ['engine', 'waiting'], SCENES_GENERATING: ['generation', 'progress'],
    SCENES_FAILED: ['generation', 'failed'], EDIT_PENDING: ['edit', 'waiting'], RENDERING: ['edit', 'progress'],
    RENDER_FAILED: ['edit', 'failed'], RENDER_READY: ['review', 'waiting'], APPROVED: ['library', 'approved'],
  };

  it('os 15 estados têm step e chip da tabela', () => {
    expect(ALL_STATES).toHaveLength(15);
    for (const s of ALL_STATES) expect([stepOf(s), statusOf(s, new Date())]).toEqual(TABLE[s]);
  });

  it('draft: AVATAR_PENDING/ENGINE_PENDING parados há mais de 7 dias', () => {
    const old = new Date(Date.now() - 8 * 86_400_000);
    expect(isDraft('ENGINE_PENDING', old)).toBe(true);
    expect(statusOf('AVATAR_PENDING', old)).toBe('draft');
    expect(statusKeyOf('AVATAR_PENDING', 'draft')).toBe('status.draft');
    expect(statusOf('FACES_READY', old)).toBe('waiting');
    expect(statusKeyOf('SCENES_GENERATING', 'progress')).toBe('status.scenes_generating');
  });

  it('trilho: 7 etapas, anteriores done, atual conforme o chip, seguintes todo; aprovado = tudo done', () => {
    expect(stepsOf('SCENES_FAILED').map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'failed', 'todo', 'todo']);
    expect(stepsOf('RENDERING').map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'progress', 'todo']);
    expect(stepsOf('ENGINE_PENDING').map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'todo', 'todo', 'todo']);
    expect(stepsOf('APPROVED').every((s) => s.state === 'done')).toBe(true);
    expect(stepsOf('APPROVED').map((s) => s.step)).toEqual(['offer', 'scripts', 'avatar', 'engine', 'generation', 'edit', 'review']);
  });

  it('filtros da Home', () => {
    expect(filterStates('all')).toBeNull();
    expect(filterStates('progress')!.sort()).toEqual(['FACES_GENERATING', 'RENDERING', 'SCENES_GENERATING', 'SCRIPTS_WRITING']);
    expect(filterStates('approved')).toEqual(['APPROVED']);
    expect(filterStates('needs_you')).toHaveLength(10);
  });
});
