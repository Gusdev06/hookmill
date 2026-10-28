// iterate-v2 F1.2: esquema e parse do roteiro dos templates (2ª etapa do planAutoBatch). Sem chamada paga.
import { CHAT_DM_SCHEMA, PERSON_MOTION_SCHEMA, chatDmOf, personMotionOf, templateDetailMessage, wordAt } from './auto-plano-template';
import { detailTargets, mergeDetails } from './auto-plano-detalhe';
import { parseAutoPlan } from './auto-plano';

/** Propriedades de objeto no esquema (o limite da gramática medido em 25/10: ~55 compila, 105 falha). */
const props = (s: unknown): number => {
  if (!s || typeof s !== 'object') return 0;
  const o = s as { properties?: Record<string, unknown>; items?: unknown };
  return (o.properties ? Object.keys(o.properties).length + Object.values(o.properties).reduce<number>((a, v) => a + props(v), 0) : 0) + props(o.items);
};
const words = Array.from({ length: 40 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));

describe('roteiro dos templates no planAutoBatch (F1.2)', () => {
  it('cada esquema cabe no limite da gramática e não tem union', () => {
    expect(props(CHAT_DM_SCHEMA)).toBeLessThanOrEqual(55);
    expect(props(PERSON_MOTION_SCHEMA)).toBeLessThanOrEqual(55);
    expect(JSON.stringify([CHAT_DM_SCHEMA, PERSON_MOTION_SCHEMA])).not.toMatch(/anyOf|oneOf/);
  });
  it('chat: fala com srcSpan, linhas da correção com a fonte da mensagem, -1 = sem trecho', () => {
    const d = chatDmOf({
      hook: { text: 'Still tired?', highlight: 'tired', source: 'transcript', srcStartSec: 0, srcEndSec: 2 },
      chrome: { typing: 'typing…', inputPlaceholder: 'Message…', profileStatus: 'Active now' },
      messages: [{ from: 'brand', kind: 'correction', text: 'What changes', source: 'transcript', srcStartSec: 3, srcEndSec: 5, wrong: ['A'], right: ['B'], preserves: ['proof', 'xx'] }],
      close: [{ text: 'Sleep better', source: 'promise', srcStartSec: -1, srcEndSec: -1 }],
      ctaButton: { text: 'Download', source: 'cta', srcStartSec: -1, srcEndSec: -1 }, ctaNote: { text: '', source: 'generic', srcStartSec: -1, srcEndSec: -1 },
      proof: [{ value: 4.9, decimals: 1, prefix: '', suffix: '', label: 'rating' }],
    })!;
    expect(d.hook).toMatchObject({ text: 'Still tired?', highlight: 'tired', srcSpan: { startSec: 0, endSec: 2 } });
    expect(d.messages[0]).toMatchObject({ kind: 'correction', wrong: [{ text: 'A', source: 'transcript' }], preserves: ['proof'] });
    expect(d.close.lines[0].srcSpan).toBeNull();
    expect(d.cta.note).toBeNull();
    expect(d.proof[0]).toMatchObject({ value: 4.9, source: 'proof' });
  });
  it('pessoa + motion: segundos → índice de palavra; linhas por tipo de cena; endCard só com show', () => {
    expect(wordAt(words, 3)).toBe(6);
    const d = personMotionOf({
      spans: [{ startSec: 0, endSec: 8, preserves: ['hook'] }],
      beats: [
        { spanIndex: 0, atSec: 1, untilSec: -1, kind: 'wrong_right', lines: ['wrong', 'right 1', 'right 2'], icons: [], source: 'transcript', srcStartSec: 1, srcEndSec: 3 },
        { spanIndex: 0, atSec: 4, untilSec: 6, kind: 'icon_list', lines: ['a', 'b'], icons: ['brain', 'nope'], source: 'what', srcStartSec: -1, srcEndSec: -1 },
      ],
      endCard: { show: false, proof: [], ctaButton: { text: 'Go', source: 'cta', srcStartSec: -1, srcEndSec: -1 }, ctaNote: { text: '', source: 'generic', srcStartSec: -1, srcEndSec: -1 } },
    }, words)!;
    expect(d.beats[0]).toMatchObject({ kind: 'wrong_right', atWord: 2, untilWord: null, wrong: { text: 'wrong' }, right: [{ text: 'right 1' }, { text: 'right 2' }] });
    expect(d.beats[1]).toMatchObject({ kind: 'icon_list', atWord: 8, untilWord: 12, items: [{ icon: 'brain' }, { icon: 'check' }] });
    expect(d.endCard).toBeNull();
  });
  it('2ª etapa: alvo do template, encaixe em params.template e parse; sem detalhe a peça sai', () => {
    const root = { blocks: [], why: { hook: { text: 'h', source: 'video', brainField: 'none', ref: '' }, proof: { text: 'p', source: 'video', brainField: 'none', ref: '' }, cta: { text: 'c', source: 'video', brainField: 'none', ref: '' } }, kept: [],
      items: [{ type: 'CHAT_DM', change: 'Chat', rationale: 'r', whyKey: 'proof', params: {} }, { type: 'PERSON_MOTION', change: 'Motion', rationale: 'r', whyKey: 'hook', params: {} }] };
    const tg = detailTargets(root, []);
    expect(tg.map((t) => t.kind)).toEqual(['CHAT_DM', 'PERSON_MOTION']);
    expect(templateDetailMessage('CHAT_DM', tg[0], { screenLanguage: 'English (en)', whys: {}, violations: ['item 0 (CHAT_DM): prospect_testimonial: x', 'item 3 (FRAME): y'] })).toMatch(/prospect_testimonial[\s\S]*Return template/);
    const chat = { hook: { text: 'Hi', highlight: '', source: 'generic', srcStartSec: -1, srcEndSec: -1 }, chrome: { typing: 't', inputPlaceholder: 'm', profileStatus: 's' },
      messages: [{ from: 'prospect', kind: 'question', text: 'Q?', source: 'generic', srcStartSec: -1, srcEndSec: -1, wrong: [], right: [], preserves: [] }], close: [], ctaButton: { text: 'Go', source: 'cta', srcStartSec: -1, srcEndSec: -1 }, ctaNote: { text: '', source: 'generic', srcStartSec: -1, srcEndSec: -1 }, proof: [] };
    const json = mergeDetails(root, tg, new Map([[0, { template: chat }]]));
    const d = parseAutoPlan(json, { uiLocale: 'EN', durationSec: 20, blockCount: 0, offer: { name: 'x' } as never, pageCaptured: false, words });
    expect(d.items.map((i) => i.type)).toEqual(['CHAT_DM']);
  });
});
