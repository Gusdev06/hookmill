import { initials } from './format';

describe('initials', () => {
  it.each([
    ['Hunt sleep 🧪', 'H🧪'],
    ['🧪 Brand', '🧪B'],
    ['🧪', '🧪'],
    ['🧪🚀', '🧪🚀'],
    ['Álvaro Silva', 'ÁS'],
    ['Acme', 'AC'],
    ['  ', '?'],
  ])('preserves complete Unicode characters in %j', (name, expected) => {
    expect(initials(name)).toBe(expected);
    expect(JSON.parse(JSON.stringify(initials(name)))).toBe(expected);
    expect(Buffer.from(initials(name), 'utf8').toString('utf8')).toBe(expected);
  });
});
