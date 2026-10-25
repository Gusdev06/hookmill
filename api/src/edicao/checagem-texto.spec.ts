// §A6: checagem de texto do STATIC assembled (comparação, críticos, aspecto, escolha da melhor imagem).
import type { StaticImageSpecV2 } from '../integracoes/contrato';
import { compararTexto, expectedTexts, pickBest, shouldRedoForText, skippedCheck, verdictOf } from './checagem-texto';

const SPEC: StaticImageSpecV2 = {
  layout: 'assembled', screenLanguage: 'pt-BR', brandName: 'Sono Já', palette: { background: '#1A0D05', accent: '#FF8A3D' }, screenRefUrl: null,
  copy: {
    brandLine: 'rotina noturna de 10 min', brandLineSource: 'what',
    tagline: 'Menos dor. Mais vida.',
    headline: { lead: 'Você dorme de novo', highlight: 'sua manhã de volta' }, headlineSource: 'promise',
    subheadline: 'Sem remédio.', subheadlineSource: 'promise',
    handwritten: 'Sua manhã de volta.',
    benefits: [
      { icon: 'moon', title: 'Dorme rápido', line: 'Em 10 minutos', source: 'promise' },
      { icon: 'clock', title: 'Sem tempo', line: 'Pra quem corre', source: 'pains' },
      { icon: 'heart', title: 'Calma', line: 'Respira melhor', source: 'promise' },
      { icon: 'star', title: 'Leve', line: 'Acorda bem', source: 'promise' },
    ],
    trust: [
      { icon: 'shield', text: 'Garantia de 7 dias', source: 'offerAndPrice' },
      { icon: 'lock', text: 'Pagamento seguro', source: 'offerAndPrice' },
      { icon: 'check', text: 'Acesso imediato', source: 'offerAndPrice' },
    ],
    cta: { main: 'Comece hoje', sub: '7 dias grátis', subSource: 'offerAndPrice' },
    closing: 'Você merece descansar.',
  },
  visual: {
    hero: { person: 'A woman in her 40s', setting: 'bedroom', emotion: 'relief', light: 'warm lamp' },
    product: { kind: 'phone_screen', look: 'dark interface', screenTitle: 'Sono Já', screenTitleSource: 'name' },
    mood: 'calm',
  },
};

describe('compararTexto (§A6)', () => {
  it('acento conta; caixa, espaço e quebra de linha não', () => {
    expect(compararTexto('Sua manhã de volta.', 'sua manhã de\nvolta.')).toBe(true);
    expect(compararTexto('Sua manhã de volta.', 'SUA MANHÃ  DE VOLTA.')).toBe(true);
    expect(compararTexto('volta', 'vólta')).toBe(false);
    expect(compararTexto('manhã', 'manha')).toBe(false);
    expect(compararTexto('Garantia', null)).toBe(false);
    expect(compararTexto('é', 'é')).toBe(true); // NFD vs NFC
  });
});

describe('expectedTexts: o corte do staticTextsFor da ia + afirmação como crítico', () => {
  it('9:16: tudo; críticos = marca, headline, CTA e textos com número/afirmação', () => {
    const e = expectedTexts(SPEC, '9:16');
    const keys = e.map((x) => x.key);
    expect(keys).toEqual(expect.arrayContaining(['brand', 'brandLine', 'tagline', 'headline', 'subheadline', 'handwritten', 'cta.main', 'cta.sub', 'closing', 'screenTitle', 'trust.0']));
    expect(keys.filter((k) => k.startsWith('benefits.') && k.endsWith('.title'))).toHaveLength(4);
    const crit = new Map(e.map((x) => [x.key, x.critical]));
    expect([crit.get('brand'), crit.get('headline'), crit.get('cta.main'), crit.get('cta.sub'), crit.get('trust.0'), crit.get('brandLine')]).toEqual([true, true, true, true, true, true]);
    expect([crit.get('handwritten'), crit.get('closing'), crit.get('trust.1')]).toEqual([false, false, false]);
  });
  it('1:1: sem tagline, manuscrito, confiança e fechamento; cards só com título (até 3)', () => {
    const keys = expectedTexts(SPEC, '1:1').map((x) => x.key);
    expect(keys).not.toEqual(expect.arrayContaining(['tagline']));
    expect(keys.some((k) => k === 'handwritten' || k === 'closing' || k.startsWith('trust.') || k.endsWith('.line'))).toBe(false);
    expect(keys.filter((k) => k.startsWith('benefits.'))).toEqual(['benefits.0.title', 'benefits.1.title', 'benefits.2.title']);
  });
  it('com referência da tela, o título da tela sai da checagem', () => {
    expect(expectedTexts({ ...SPEC, screenRefUrl: 'https://x/ref.png' }, '9:16').some((x) => x.key === 'screenTitle')).toBe(false);
  });
});

describe('veredito, refação e melhor imagem', () => {
  const exp = expectedTexts(SPEC, '9:16');
  const all = (over: Record<string, string | null> = {}) => ({
    items: exp.map((x) => ({ key: x.key, found: over[x.key] !== null, seen: x.key in over ? over[x.key] : x.text })), extraText: [],
  });
  it('tudo bate = ok sem itens; erro menor = mismatch sem refação; erro crítico = refaz com 1 task', () => {
    const okv = verdictOf(exp, all()).check;
    expect(okv).toMatchObject({ status: 'ok', extraText: [] });
    expect(okv.items).toHaveLength(exp.length); // §A10.4: todos os conferidos, cada um com match
    expect(okv.items.every((i) => i.match === true && i.key)).toBe(true);
    const minor = verdictOf(exp, all({ handwritten: 'Sua manhã de vólta.' }));
    expect(minor.check.status).toBe('mismatch');
    expect(minor.check.items.filter((i) => !i.match)).toEqual([{ key: 'handwritten', expected: 'Sua manhã de volta.', seen: 'Sua manhã de vólta.', critical: false, match: false }]);
    expect(shouldRedoForText(minor, 1, 2)).toBe(false);
    const crit = verdictOf(exp, all({ 'cta.main': null }));
    expect(crit.criticalErrors).toBe(1);
    expect(crit.check.items.filter((i) => !i.match)).toEqual([{ key: 'cta.main', expected: 'COMECE HOJE', seen: null, critical: true, match: false }]); // caixa alta do prompt (staticTextsFor)
    expect(shouldRedoForText(crit, 1, 2)).toBe(true);
    expect(shouldRedoForText(crit, 2, 2)).toBe(false); // a recusa já gastou a 2ª task
    // G3: texto inventado pela imagem = erro crítico (refaz)
    const extra = verdictOf(exp, { ...all(), extraText: ['Plano de 21 dias'] });
    expect(extra).toMatchObject({ criticalErrors: 1, check: { status: 'mismatch', extraText: ['Plano de 21 dias'] } });
    expect(extra.check.items.every((i) => i.match)).toBe(true);
    const sk = skippedCheck(exp);
    expect(sk.status).toBe('skipped');
    expect(sk.items.every((i) => i.match === false && i.seen === null)).toBe(true);
    expect(sk.items).toHaveLength(exp.length);
    expect(shouldRedoForText(extra, 1, 2)).toBe(true);
  });
  it('a de menos erros críticos; empate = a mais nova', () => {
    const a = { providerTaskId: 'a', fileId: 'fa', check: { status: 'mismatch' as const, items: [] }, criticalErrors: 1 };
    const b = { providerTaskId: 'b', fileId: 'fb', check: { status: 'mismatch' as const, items: [] }, criticalErrors: 2 };
    const c = { providerTaskId: 'c', fileId: 'fc', check: { status: 'mismatch' as const, items: [] }, criticalErrors: 1 };
    expect(pickBest([a, b])!.fileId).toBe('fa');
    expect(pickBest([a, c])!.fileId).toBe('fc');
    expect(pickBest([])).toBeNull();
  });
});
