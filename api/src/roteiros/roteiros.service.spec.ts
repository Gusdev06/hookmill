import { applyBlockEdits, letterAt } from './roteiros.service';

describe('roteiros: letras e tempos', () => {
  it('letras A..Z, depois AA, AB… (nunca repete)', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(letterAt)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('editar a fala recalcula o tempo pelo nº de palavras e empurra os blocos seguintes', () => {
    const blocks = [
      { label: 'hook', startSec: 0, endSec: 2, speech: 'one two three four', visualPrompt: 'a' },
      { label: 'cta', startSec: 2, endSec: 4, speech: 'five six', visualPrompt: 'b' },
    ];
    const out = applyBlockEdits(blocks, [{ index: 0, speech: 'one two three four five six seven eight' }]);
    expect(out[0]).toMatchObject({ startSec: 0, endSec: 4 });
    expect(out[1]).toMatchObject({ startSec: 4, endSec: 6, speech: 'five six' });
    expect(() => applyBlockEdits(blocks, [{ index: 9, speech: 'x' }])).toThrow();
  });
});
