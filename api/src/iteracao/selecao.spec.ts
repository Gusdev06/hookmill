import type { AutoVariationType, IterateAnswers } from '@maquina/contratos';
import { DEFAULT_ANSWERS, selectPieces, validateAnswers } from './selecao';

const candidates = (types: AutoVariationType[]) => types.map((autoType, index) => ({ autoType, index, priority: index, axis: (['CUT', 'HEADLINE'].includes(autoType) ? 'ITERATION' : 'DIVERSITY') as 'ITERATION' | 'DIVERSITY' }));
const pool = candidates(['HEADLINE', 'HEADLINE', 'HEADLINE', 'CUT', 'CUT', ...Array<AutoVariationType>(8).fill('FRAME'), 'STATIC', 'REVIEW', 'NATIVE_SEARCH']);
const answers = (over: Partial<IterateAnswers> = {}): IterateAnswers => ({ ...DEFAULT_ANSWERS, ...over });
const chosen = (goal: IterateAnswers['goal']) => selectPieces(pool, answers({ goal })).selected.filter((p) => p.included);

describe('selection from the same candidate pool', () => {
  it.each([['stretch', 5, 3], ['new_audience', 2, 10], ['both', 4, 8], ['auto', 4, 8]] as const)('%s preserves the goal mix', (goal, stretch, diversity) => {
    const result = chosen(goal);
    expect(result.filter((p) => p.item.axis === 'ITERATION')).toHaveLength(stretch);
    expect(result.filter((p) => p.item.axis === 'DIVERSITY')).toHaveLength(diversity);
  });
  it('only headlines: excludes categorized pieces and retains compatible uncategorized edits', () => {
    const result = selectPieces(pool, answers({ wants: ['headline'] }));
    expect(result.selected.filter((p) => p.included).map((p) => p.item.autoType)).toEqual(['HEADLINE', 'HEADLINE', 'HEADLINE', 'REVIEW', 'NATIVE_SEARCH']);
    expect(result.selected.filter((p) => p.selection === 'not_asked').every((p) => ['FRAME', 'STATIC'].includes(p.item.autoType!))).toBe(true);
    expect(selectPieces(pool, answers({ wants: [] })).selected.filter((p) => p.included)).toHaveLength(12);
  });
  it('fills a short batch from goal cuts, never from a category the user did not ask for', () => {
    const cut = candidates(['CUT', 'CUT', 'FRAME', 'FRAME', 'FRAME', 'FRAME']);
    const result = selectPieces(cut, answers({ goal: 'stretch' }));
    expect(result.selected.filter((p) => p.included)).toHaveLength(5);
    const small = selectPieces(candidates(['HEADLINE', 'FRAME']), answers({ wants: ['headline'] }));
    expect(small.smallBatch).toBe(true);
    expect(small.selected.filter((p) => p.included)).toHaveLength(1);
  });
  it('uses planner priority without mutating the pool', () => {
    const reversed = [...pool].reverse();
    expect(selectPieces(reversed, answers()).selected).toEqual(selectPieces(pool, answers()).selected);
    expect(reversed[0]).toBe(pool.at(-1));
  });
});

describe('answers validation', () => {
  it.each([
    [{ ai: 'auto', aiCapUsd: 10 }, 'cap_needs_yes'],
    [{ ai: 'yes', aiCapUsd: 0 }, 'cap_range'],
    [{ ai: 'yes', aiCapUsd: Infinity }, 'cap_range'],
    [{ wants: ['face'] }, 'wants_need_ai'],
    [{ ai: 'auto', wants: ['format'] }, 'ai_not_enabled'],
  ])('rejects invalid spend/category combinations', (over, rule) => {
    try { validateAnswers(answers(over as Partial<IterateAnswers>)); throw new Error('expected rejection'); }
    catch (e) { expect((e as { details: unknown }).details).toMatchObject({ fields: [{ rule }] }); }
  });
  it('deduplicates categories and rejects incomplete/unknown answers', () => {
    expect(validateAnswers(answers({ wants: ['headline', 'headline'] })).wants).toEqual(['headline']);
    expect(() => validateAnswers({})).toThrow();
    expect(() => validateAnswers(answers({ wants: ['unknown' as never] }))).toThrow();
  });
});
