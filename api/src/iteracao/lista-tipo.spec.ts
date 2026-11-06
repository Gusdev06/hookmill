// templates-lista-v1 T-B1 (04/11): `LIST_OVERLAY` no AutoVariationType, tabelas exaustivas, só no lote de template e as chaves
// `LIST_OVERLAY:<templateId>`. O allowedFor/fit/plano da lista é a T-B2 (aqui só o portão do tipo).
import { lineKeyOf, lineSubIdOf } from '../creditos/regras';
import { availabilityOf } from '../templates/catalogo';
import {
  AXIS_OF, LIST_CODE, LIST_TEMPLATE_IDS, TEMPLATE_ONLY_TYPES, TYPE_MAX, type PlanCtx, allowedFor, codeFor, isListTemplateId,
  isTemplateOnlyType, listKeyOf, listTemplatesOf, pickedMissing, templateOnlyTypesOf,
} from './regras';
import { keysOf, pieceKeyOf } from './templates-lote';

const words = Array.from({ length: 60 }, (_, i) => ({ word: `w${i}`, startSec: i * 0.5, endSec: i * 0.5 + 0.4 }));
const ctx = (over: Partial<PlanCtx> = {}): PlanCtx => ({
  lang: 'EN', durationSec: 30,
  blocks: [
    { index: 0, label: 'Hook', fn: 'hook', startSec: 0, endSec: 3 }, { index: 1, label: 'Problem', fn: 'problem', startSec: 3, endSec: 10 },
    { index: 2, label: 'Proof', fn: 'proof', startSec: 10, endSec: 25 }, { index: 3, label: 'CTA', fn: 'cta', startSec: 25, endSec: 30 },
  ],
  hasSpeech: true, words, silences: [], hasWrittenHook: false, hasEndCard: false,
  brain: { what: 'A sleep app', audience: 'Busy parents', pains: 'No time', promise: 'Sleep better', proof: null, offerAndPrice: null, cta: 'Download now', notes: null },
  spokenCta: 'Download the app', pageCaptured: true, productPhoto: false, brandTerms: [],
  ...over,
});

describe('LIST_OVERLAY: tipo e tabelas (templates-lista-v1 §1)', () => {
  it('DIVERSITY, máx. 2 (1 por template)', () => {
    expect(AXIS_OF.LIST_OVERLAY).toBe('DIVERSITY');
    expect(TYPE_MAX.LIST_OVERLAY).toBe(2);
    expect(LIST_TEMPLATE_IDS).toEqual(['versus', 'value-stack']);
  });

  it('códigos EN/PT pelo templateId (MC_1104_VERSUS_9x16)', () => {
    expect(codeFor('LIST_OVERLAY', 'versus', 1, 'EN')).toBe('VERSUS');
    expect(codeFor('LIST_OVERLAY', 'versus', 1, 'PT')).toBe('VERSUS');
    expect(codeFor('LIST_OVERLAY', 'value-stack', 1, 'EN')).toBe('VALUE-STACK');
    expect(codeFor('LIST_OVERLAY', 'value-stack', 1, 'PT')).toBe('PILHA-VALOR');
    expect(LIST_CODE.PT['value-stack']).toBe('PILHA-VALOR');
  });
});

describe('LIST_OVERLAY: só no lote de template (como COLD_OPEN/ENDCARD)', () => {
  it('está no TEMPLATE_ONLY_TYPES', () => {
    expect(TEMPLATE_ONLY_TYPES).toContain('LIST_OVERLAY');
    expect(isTemplateOnlyType('LIST_OVERLAY')).toBe(true);
    expect(isTemplateOnlyType('FRAME')).toBe(false);
  });

  it('chaves LIST_OVERLAY:<id> liberam o tipo e os templates; chave desconhecida não libera', () => {
    expect(templateOnlyTypesOf(['LIST_OVERLAY:versus'])).toEqual(['LIST_OVERLAY']);
    expect(templateOnlyTypesOf(['COLD_OPEN', 'LIST_OVERLAY:value-stack', 'FRAME:news'])).toEqual(['COLD_OPEN', 'LIST_OVERLAY']);
    expect(templateOnlyTypesOf(['LIST_OVERLAY:outro'])).toEqual([]);
    expect(templateOnlyTypesOf(['LIST_OVERLAY'])).toEqual([]); // sem templateId não é chave do catálogo
    expect(listTemplatesOf(['LIST_OVERLAY:value-stack', 'FRAME:news', 'LIST_OVERLAY:versus'])).toEqual(['versus', 'value-stack']);
    expect(isListTemplateId('versus')).toBe(true);
    expect(isListTemplateId('ranking')).toBe(false);
  });

  it('Iterate normal (sem chave): o tipo nunca aparece no allowed', () => {
    expect(allowedFor(ctx()).some((a) => a.type === 'LIST_OVERLAY')).toBe(false);
  });

  it('catálogo: disponível (o portão até ter exemplo é o DRAFT)', () => {
    expect(availabilityOf({ autoType: 'LIST_OVERLAY', pack: false, credits: 1 })).toEqual({ available: true, reason: null });
  });
});

describe('LIST_OVERLAY: chave `LIST_OVERLAY:<templateId>` (catálogo, RunLine, duplicata)', () => {
  it('peça planejada e linha de crédito usam a mesma chave', () => {
    expect(listKeyOf('versus')).toBe('LIST_OVERLAY:versus');
    expect(pieceKeyOf('LIST_OVERLAY', { templateId: 'value-stack' })).toBe('LIST_OVERLAY:value-stack');
    expect(lineKeyOf('LIST_OVERLAY', lineSubIdOf({ params: { type: 'LIST_OVERLAY', templateId: 'versus' } }))).toBe('LIST_OVERLAY:versus');
    expect(lineKeyOf('FRAME', lineSubIdOf({ params: { template: 'news' } }))).toBe('FRAME:news');
    // o `template` objeto dos templates grátis não vira sub-chave
    expect(lineKeyOf('CHAT_DM', lineSubIdOf({ params: { template: { messages: [] } } }))).toBe('CHAT_DM');
    expect(keysOf(['LIST_OVERLAY:versus']).types.has('LIST_OVERLAY')).toBe(true);
  });

  it('picked_missing reconhece a peça pelo templateId', () => {
    const items = [{ type: 'LIST_OVERLAY', change: 'x', rationale: 'y', whyKey: 'hook', params: { type: 'LIST_OVERLAY', templateId: 'versus' } }];
    const v = pickedMissing({ items } as never, ['LIST_OVERLAY:versus', 'LIST_OVERLAY:value-stack']);
    expect(v.map((x) => x.detail)).toEqual(['no LIST_OVERLAY:value-stack piece: the user picked it, write at least 1 piece of it']);
  });
});
