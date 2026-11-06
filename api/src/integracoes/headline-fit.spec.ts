// troca-texto-queimado-v1 §16.3 / §16.5 / §16.6 linha I1 (F1b): rewriteHeadlineFit (live com transporte falso e fake),
// o laço de até 3 reescritas, `<headline>` com alvo por linha, sem emoji no texto e describeEdit com `\n`. Sem rede,
// nenhuma chamada real à Anthropic.
import type { HeadlineFitReject } from '@maquina/contratos';
import type { AutoPlanInput, RewriteHeadlineFitInput } from './contrato';
import { HEADLINE_FIT_MODEL, headlineFitUsd } from './catalogo/precos';
import { headlineParamsOf, headlineRequest } from './claude/auto-plano';
import { ClaudeLiveService } from './claude/claude.service';
import { parseEditMap, textLinesOf, EDIT_SCHEMA } from './claude/edicao';
import { REWRITE_FIT_SYSTEM, alvosPorLinha, hasEmoji, parseRewriteFit, rewriteFitUserMessage, stripEmoji } from './claude/headline-fit';
import { encaixarHeadline, type HeadlineFitVerdict } from './claude/laco-headline';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './claude/transporte';
import { IntegracaoError } from './erros';
import { FakeClaudeService } from './mock/fake-claude.service';
import { fakeRewriteHeadlineFit } from './mock/fake-headline-fit';
import { MemoryCostStore } from './store/memoria.store';

class FakeTransport implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly reply: (n: number) => ClaudeResult | Error) {}
  async run(call: ClaudeCall): Promise<ClaudeResult> {
    const r = this.reply(this.calls.push(call) - 1);
    if (r instanceof Error) throw r;
    return r;
  }
}
const haiku = (i = 1200, o = 150) => [{ model: 'claude-haiku-4-5', inputTokens: i, outputTokens: o, cacheWriteTokens: 0, cacheReadTokens: 0 }];

// a original da S4 (3 linhas, emoji no fim da 1ª)
const ORIGINAL = 'POV: você descobriu 😱\nquem deixou de te seguir\nsem baixar nenhum app';
const CHARS = [19, 24, 21];
const REQ: RewriteHeadlineFitInput = {
  workspaceId: 'w1', batchId: 'b1', jobId: 'j1', language: 'pt-BR', original: ORIGINAL, current: 'Veja quem saiu',
  reject: 'too_short', measure: 'E 0.33 > 0.15', targetCharsPerLine: alvosPorLinha(CHARS), rules: [], hasHighlight: false,
  others: ['Descubra quem parou de te seguir hoje'],
};

describe('alvo por linha e emoji', () => {
  it('85-115 % de cada linha da original', () => {
    expect(alvosPorLinha([20, 24, 0, 18])).toEqual([{ min: 17, max: 23 }, { min: 20, max: 28 }, { min: 15, max: 21 }]);
    expect(HEADLINE_FIT_MODEL.targetPct).toEqual({ min: 0.85, max: 1.15 });
  });

  it('stripEmoji tira pictograma, bandeira, tom de pele, ZWJ e seletor; mantém \\n, acento e número', () => {
    expect(stripEmoji('POV: você 😱 descobriu\nquem 👍🏽 saiu 🇧🇷 ❤️ 👨‍👩‍👧 em 3 dias')).toBe('POV: você descobriu\nquem saiu em 3 dias');
    expect(hasEmoji('sem emoji, 100 %')).toBe(false);
    expect(hasEmoji('com 🔥')).toBe(true);
  });

  it('a HEADLINE do plano sai sem emoji (texto e destaque)', () => {
    const h = { mode: 'replace' as const, original: ORIGINAL, lines: 3, maxChars: 80, hasHighlight: true, language: 'pt-BR' };
    const p = headlineParamsOf({ text: '🔥 Descubra quem 😱 parou de te seguir', highlight: 'parou de te seguir 😱', textSource: 'promise' }, h)!;
    expect(p.text).toBe('Descubra quem parou de te seguir');
    expect(p.highlight).toBe('parou de te seguir');
    expect(headlineParamsOf({ text: '😱🔥', highlight: '' }, h)).toBeNull();
  });
});

describe('<headline> com alvo por linha (§16.3 item 1)', () => {
  const base: Pick<AutoPlanInput, 'allowed' | 'headline'> = {
    allowed: [{ type: 'HEADLINE', max: 3 }],
    headline: { mode: 'replace', original: ORIGINAL.replace(/\n/g, ' '), lines: 3, maxChars: 77, hasHighlight: true, language: 'pt-BR',
      charsPerLine: CHARS, caseStyle: 'sentence', emphasisKind: 'underline', copy: 'loose' },
  };

  it('leva linhas, alvo numérico por linha, total, estilo do destaque, caixa e o aviso do emoji, sem emoji', () => {
    const r = headlineRequest(base)!;
    expect(r).toContain('lines="3"');
    expect(r).toContain('highlight_style="underline"');
    expect(r).toContain('case="sentence"');
    expect(r).toContain('line 1: 16-22 characters; line 2: 20-28 characters; line 3: 17-25 characters');
    expect(r).toContain('about 53-75 characters in total');
    expect(r).toContain('its emoji stays in the video');
    expect(hasEmoji(r)).toBe(false);
  });

  it('original com \\n vai linha a linha (" / ")', () => {
    const r = headlineRequest({ ...base, headline: { ...base.headline!, original: ORIGINAL } })!;
    expect(r).toContain('"POV: você descobriu / quem deixou de te seguir / sem baixar nenhum app"');
  });

  it('sem `charsPerLine` (F1a, `add`) o bloco é o de antes', () => {
    const r = headlineRequest({ ...base, headline: { mode: 'replace', original: 'STOP WAKING UP SORE', lines: 2, maxChars: 30, hasHighlight: false, language: 'en' } })!;
    expect(r).toBe([
      '<headline mode="replace" pieces="3" lines="2" max_chars="30" highlight="no" language="en">',
      'Original headline: "STOP WAKING UP SORE"',
      'Write exactly 3 HEADLINE pieces, each at most 30 characters in 2 line(s), in English (en).',
      '</headline>',
    ].join('\n'));
  });
});

describe('describeEdit com \\n (§14.1)', () => {
  it('o esquema pede a quebra e a leitura guarda cada linha aparada', () => {
    const d = (EDIT_SCHEMA as unknown as { properties: { layers: { items: { properties: { text: { description: string } } } } } }).properties.layers.items.properties.text.description;
    expect(d).toContain('\\n');
    expect(textLinesOf('  POV: você  descobriu 😱 \r\nquem deixou\n\n de te seguir\\nsem app ')).toBe('POV: você descobriu 😱\nquem deixou\nde te seguir\nsem app');
    const g = { width: 464, height: 832, fps: 30, frameCount: 300, durationSec: 10 };
    const raw = JSON.stringify({
      layers: [{ kind: 'headline', text: 'POV: você descobriu 😱\nquem deixou de te seguir\nsem baixar nenhum app', startSec: 0, endSec: 5,
        box: { x: 0.1, y: 0.6, w: 0.8, h: 0.15 }, background: 'none', backgroundColor: '', fontId: 'montserrat-800', uppercase: false, fontSizeRel: 0.03,
        color: '#FFFFFF', highlightColor: '', highlightBoxColor: '', strokeColor: '', strokeRel: 0, shadow: true, align: 'center', wordsPerPage: 0 }],
      mainSpeaker: { present: false, box: { x: 0, y: 0, w: 0, h: 0 }, description: '' }, otherFaces: [], overlaysOverFace: [],
      profile: { gender: 'unknown', ageBand: '', ethnicity: '', hair: '', clothing: '', setting: '', lighting: '', framing: '', pose: '' },
    });
    const L = parseEditMap(raw, g, []).layers[0];
    expect(L.text!.split('\n')).toEqual(['POV: você descobriu 😱', 'quem deixou de te seguir', 'sem baixar nenhum app']);
  });
});

describe('rewriteHeadlineFit (live, transporte falso: nada pago)', () => {
  const live = (t: ClaudeTransport, costs = new MemoryCostStore(), headlineFitModel?: string) =>
    new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5', headlineFitModel });

  it('1 chamada Haiku 4.5, sem effort, esquema estruturado; texto sem emoji; custo LLM no lote', async () => {
    const t = new FakeTransport(() => ({ text: JSON.stringify({ lines: ['Veja quem 😱 deixou', 'de te seguir sem', 'baixar app nenhum'], highlight: '' }), stopReason: 'end_turn', usage: haiku() }));
    const costs = new MemoryCostStore();
    const out = await live(t, costs).rewriteHeadlineFit(REQ);
    expect(out).toEqual({ text: 'Veja quem deixou de te seguir sem baixar app nenhum', highlight: null, costUsd: 0.00195 });
    expect(t.calls).toHaveLength(1);
    const c = t.calls[0];
    expect(c.model).toBe('claude-haiku-4-5');
    expect(c.effort).toBeNull();
    expect(c.images).toBeUndefined();
    expect(c.system).toBe(REWRITE_FIT_SYSTEM);
    expect(c.schema).toMatchObject({ required: ['lines', 'highlight'], additionalProperties: false });
    expect(c.user).toContain('TOO SHORT');
    expect(c.user).toContain('Measure: E 0.33 > 0.15.');
    expect(c.user).toContain('line 1: 16-22 characters');
    expect(c.user).toContain('Descubra quem parou de te seguir hoje');
    expect(hasEmoji(c.user)).toBe(false);
    expect(costs.entries.map((e) => [e.variationBatchId, e.provider, e.kind, e.model, e.unit, e.amountUsd])).toEqual([
      ['b1', 'ANTHROPIC', 'LLM', 'claude-haiku-4-5', 'ktoken_in', 0.0012],
      ['b1', 'ANTHROPIC', 'LLM', 'claude-haiku-4-5', 'ktoken_out', 0.0008],
    ]);
  });

  it('ANTHROPIC_HEADLINE_FIT_MODEL troca o modelo; motivos e regras no pedido', async () => {
    const t = new FakeTransport(() => ({ text: JSON.stringify({ lines: ['x y z'], highlight: '' }), stopReason: 'end_turn', usage: haiku() }));
    await live(t, new MemoryCostStore(), 'claude-haiku-5-5').rewriteHeadlineFit({ ...REQ, reject: 'rule', rules: ['"x" has 3, not in the Brain nor the transcript'] });
    expect(t.calls[0].model).toBe('claude-haiku-5-5');
    expect(t.calls[0].effort).toBe('low');
    expect(t.calls[0].user).toContain('BREAKS A RULE');
    expect(t.calls[0].user).toContain('- "x" has 3, not in the Brain');
    for (const r of ['too_long', 'over_chin'] as HeadlineFitReject[]) expect(rewriteFitUserMessage({ ...REQ, reject: r })).toContain('TOO LONG');
  });

  it('destaque só se a original tem e é trecho literal', () => {
    const j = JSON.stringify({ lines: ['Descubra quem saiu', 'do seu perfil hoje'], highlight: 'quem saiu' });
    expect(parseRewriteFit(j, { hasHighlight: true })).toEqual({ text: 'Descubra quem saiu do seu perfil hoje', highlight: 'quem saiu' });
    expect(parseRewriteFit(j, { hasHighlight: false }).highlight).toBeNull();
    expect(parseRewriteFit(JSON.stringify({ lines: ['a b'], highlight: 'zz' }), { hasHighlight: true }).highlight).toBeNull();
  });

  it('sem nova tentativa interna: recusa = SAFETY_BLOCK, vazio = INVALID_SCRIPT; o custo fica gravado nos dois', async () => {
    const costs = new MemoryCostStore();
    const refusal = new FakeTransport(() => ({ text: '', stopReason: 'refusal', usage: haiku(1200, 0) }));
    await expect(live(refusal, costs).rewriteHeadlineFit(REQ)).rejects.toMatchObject({ code: 'SAFETY_BLOCK' });
    const empty = new FakeTransport(() => ({ text: JSON.stringify({ lines: ['😱', ' '], highlight: '' }), stopReason: 'end_turn', usage: haiku() }));
    await expect(live(empty, costs).rewriteHeadlineFit(REQ)).rejects.toMatchObject({ code: 'INVALID_SCRIPT' });
    expect(refusal.calls).toHaveLength(1);
    expect(empty.calls).toHaveLength(1);
    expect(costs.entries).toHaveLength(4);
  });

  it('custo estimado: ~US$ 0,002 por chamada, pior caso do lote (3 peças × 3) ~US$ 0,018', () => {
    expect(headlineFitUsd(1)).toBe(0.002);
    expect(headlineFitUsd(3 * HEADLINE_FIT_MODEL.maxRewrites)).toBe(0.0176);
  });
});

describe('rewriteHeadlineFit (fake)', () => {
  it('mira o meio do alvo só com palavras do atual e da original: sem emoji, sem número novo, diferente da original e das outras', async () => {
    const costs = new MemoryCostStore();
    const f = new FakeClaudeService(costs, { model: 'claude-opus-5-5', stepMs: 0 });
    const out = await f.rewriteHeadlineFit(REQ);
    const total = REQ.targetCharsPerLine.reduce((a, x) => ({ min: a.min + x.min, max: a.max + x.max }), { min: 0, max: 0 });
    expect(out.text.length).toBeGreaterThanOrEqual(total.min);
    expect(out.text.length).toBeLessThanOrEqual(total.max);
    expect(hasEmoji(out.text)).toBe(false);
    expect(/\d/.test(out.text)).toBe(false);
    expect(out.text.toLowerCase()).not.toBe(ORIGINAL.toLowerCase());
    expect(out.costUsd).toBe(0);
    expect(f.headlineFitCalls).toBe(1);
    expect(costs.entries[0]).toMatchObject({ variationBatchId: 'b1', provider: 'ANTHROPIC', kind: 'LLM', amountUsd: 0 });
  });

  it('longo demais encurta pro teto; `same` devolve o atual; `error` falha', async () => {
    const long = fakeRewriteHeadlineFit({ ...REQ, reject: 'too_long', current: 'Descubra agora mesmo quem deixou de te seguir no Instagram sem baixar nenhum aplicativo estranho no celular' });
    expect(long.text.length).toBeLessThanOrEqual(75);
    expect(fakeRewriteHeadlineFit(REQ, 'same').text).toBe('Veja quem saiu');
    const f = new FakeClaudeService(new MemoryCostStore(), { model: 'm', stepMs: 0, headlineFit: 'error' });
    await expect(f.rewriteHeadlineFit(REQ)).rejects.toBeInstanceOf(IntegracaoError);
  });
});

describe('laço de até 3 reescritas (§16.3 itens 2-4)', () => {
  // medida de brinquedo no lugar de `ajustarHeadlineCopia`: total de caracteres contra o alvo
  const total = REQ.targetCharsPerLine.reduce((a, x) => ({ min: a.min + x.min, max: a.max + x.max }), { min: 0, max: 0 });
  const medir = (text: string): HeadlineFitVerdict => {
    const n = text.length;
    if (n < total.min) return { ok: false, reject: 'too_short', measure: `${n} < ${total.min}`, rules: [] };
    if (n > total.max) return { ok: false, reject: 'too_long', measure: `${n} > ${total.max}`, rules: [] };
    return { ok: true, reject: null, measure: '', rules: [] };
  };

  it('passou de primeira: 0 reescritas, 1 medida', async () => {
    const r = await encaixarHeadline({ text: 'Veja quem deixou de te seguir sem baixar nenhum app no celular', highlight: null, medir, reescrever: async () => { throw new Error('não deveria chamar'); } });
    expect(r).toMatchObject({ ok: true, rewrites: 0, measures: 1 });
  });

  it('com o fake: curta passa na 1ª reescrita, com o motivo e a medida da função', async () => {
    const f = new FakeClaudeService(new MemoryCostStore(), { model: 'm', stepMs: 0 });
    const seen: string[] = [];
    const r = await encaixarHeadline({
      text: REQ.current, highlight: null, medir,
      reescrever: async (a) => { seen.push(`${a.reject}|${a.measure}`); return f.rewriteHeadlineFit({ ...REQ, current: a.current, reject: a.reject, measure: a.measure, rules: a.rules }); },
    });
    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ rewrites: 1, measures: 2 });
    expect(seen).toEqual([`too_short|14 < ${total.min}`]);
  });

  it('nunca passa: 3 reescritas, 4 medidas, peça sai com headline_no_fit', async () => {
    const f = new FakeClaudeService(new MemoryCostStore(), { model: 'm', stepMs: 0, headlineFit: 'same' });
    const r = await encaixarHeadline({ text: REQ.current, highlight: null, medir, reescrever: (a) => f.rewriteHeadlineFit({ ...REQ, current: a.current, reject: a.reject }) });
    expect(r).toMatchObject({ ok: false, reason: 'headline_no_fit', rewrites: 3, measures: 4 });
    expect(f.headlineFitCalls).toBe(3);
  });

  it('erro da chamada conta como tentativa (3 erros = 3 tentativas, 1 medida); recupera se a seguinte passa', async () => {
    const f = new FakeClaudeService(new MemoryCostStore(), { model: 'm', stepMs: 0, headlineFit: 'error' });
    const r = await encaixarHeadline({ text: REQ.current, highlight: null, medir, reescrever: (a) => f.rewriteHeadlineFit({ ...REQ, current: a.current, reject: a.reject }) });
    expect(r).toMatchObject({ ok: false, rewrites: 3, measures: 1 });
    expect(r.attempts.slice(1).map((x) => x.error)).toEqual(['PROVIDER_ERROR', 'PROVIDER_ERROR', 'PROVIDER_ERROR']);

    let n = 0;
    const ok = await encaixarHeadline({
      text: REQ.current, highlight: null, medir,
      reescrever: async () => { if (n++ < 2) throw new IntegracaoError('RATE_LIMITED', 'x'); return { text: 'Veja quem deixou de te seguir sem baixar nenhum app no celular', highlight: null }; },
    });
    expect(ok).toMatchObject({ ok: true, rewrites: 3, measures: 2 });
  });

  it('a regra do backend também entra no laço (`rule`), com o detalhe', async () => {
    const regras = (text: string): HeadlineFitVerdict => (/\d/.test(text) ? { ok: false, reject: 'rule', measure: '', rules: [`"${text}" has a number not in the Brain`] } : medir(text));
    const got: string[][] = [];
    const r = await encaixarHeadline({
      text: 'Veja em 3 dias quem deixou de te seguir sem app', highlight: null, medir: regras,
      reescrever: async (a) => { got.push(a.rules); return { text: 'Veja quem deixou de te seguir sem baixar nenhum app no celular', highlight: null }; },
    });
    expect(r.ok).toBe(true);
    expect(got[0][0]).toContain('has a number');
  });
});
