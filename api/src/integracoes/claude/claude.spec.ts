import Anthropic from '@anthropic-ai/sdk';
import type { OfferBriefDraft, ScriptDraft, WinnerExample } from '../contrato';
import { IntegracaoError } from '../erros';
import { MemoryCostStore } from '../store/memoria.store';
import { ClaudeLiveService } from './claude.service';
import { costOf } from './custo';
import { JsonStringStream } from './json-stream';
import { fetchPage, htmlToText, isPrivateIp, looksLikeSpa } from './pagina';
import type { RenderedPage } from './render-pagina';
import { winnersBlock } from './prompts';
import { SdkClaudeTransport, type ClaudeCall, type ClaudeResult, type ClaudeTransport, type OnText } from './transporte';
import { normalizeLanguage, parseScript } from './validacao';

const offer: OfferBriefDraft = {
  name: 'Orbit Budget', language: 'en', kind: 'App', what: 'Budget app that finds forgotten subscriptions.', audience: 'Young couples',
  promise: 'Save $300 a month', pains: 'Money disappears', proof: null, offerAndPrice: '7-day trial', cta: 'Start your free trial', notes: null,
};

const usage = (model = 'claude-opus-5-5', i = 1000, o = 500) => [{ model, inputTokens: i, outputTokens: o, cacheWriteTokens: 0, cacheReadTokens: 0 }];

const scriptJson = (angle = 'Hidden cost') =>
  JSON.stringify({
    angle,
    rationale: 'Names the pain first.',
    blocks: [
      { label: 'hook', durationSec: 3, speech: 'You are paying for things you forgot.', visualPrompt: 'medium close-up, raised eyebrows' },
      { label: 'problem', durationSec: 8, speech: 'Every month money disappears and you never know where it went.', visualPrompt: 'SOLO SHOT, slight head tilt' },
      { label: 'product', durationSec: 9, speech: 'Orbit finds every subscription in one minute.', visualPrompt: 'SOLO SHOT, confident smile' },
      { label: 'cta', durationSec: 4, speech: 'Start your free trial.', visualPrompt: 'SOLO SHOT, warm smile' },
    ],
  });

/** Transporte falso: devolve respostas por chamada e "streama" o texto em pedaços de 7 caracteres. */
class FakeTransport implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly reply: (call: ClaudeCall, n: number) => ClaudeResult | Error) {}
  async run(call: ClaudeCall, onText?: OnText): Promise<ClaudeResult> {
    const n = this.calls.push(call) - 1;
    const r = this.reply(call, n);
    if (r instanceof Error) throw r;
    for (let i = 0; i < r.text.length; i += 7) onText?.(r.text.slice(i, i + 7));
    return r;
  }
}

describe('JsonStringStream', () => {
  it('entrega o texto de cada string com o caminho, mesmo partido no meio de escape', () => {
    const got: Record<string, string> = {};
    const s = new JsonStringStream((p, c) => (got[p.join('.')] = (got[p.join('.')] ?? '') + c));
    const json = JSON.stringify({ angle: 'A "big" one', blocks: [{ label: 'hook', speech: 'Olá\nmundo ✓' }, { speech: 'dois, três' }], n: 3 });
    for (let i = 0; i < json.length; i += 3) s.push(json.slice(i, i + 3));
    expect(got['angle']).toBe('A "big" one');
    expect(got['blocks.0.speech']).toBe('Olá\nmundo ✓');
    expect(got['blocks.1.speech']).toBe('dois, três');
    expect(got['blocks.0.label']).toBe('hook');
  });

  it('\\u escapado e reset', () => {
    const out: string[] = [];
    const s = new JsonStringStream((_p, c) => out.push(c));
    s.push('{"a":"x\\u00e9');
    s.reset();
    s.push('{"a":"y"}');
    expect(out.join('')).toBe('xéy');
  });
});

describe('página da oferta', () => {
  const html = (body: string) => `<html><head><title>Orbit &amp; Co</title><meta name="description" content="Save money"></head><body>${body}</body></html>`;
  const res = (status: number, body = '', headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }) => new Response(body, { status, headers });
  const long = '<p>' + 'Find every forgotten subscription in one minute. '.repeat(10) + '</p>';
  const opts = (r: Response | (() => Response)) => ({ fetchImpl: (async () => (typeof r === 'function' ? r() : r)) as typeof fetch, resolve: async () => ['93.184.216.34'] });

  it('html vira texto sem script/style, com título e descrição', () => {
    const t = htmlToText(html('<script>alert(1)</script><style>p{}</style><h1>Stop&nbsp;wasting</h1><ul><li>One</li><li>Two</li></ul>'));
    expect(t.title).toBe('Orbit & Co');
    expect(t.description).toBe('Save money');
    expect(t.text).toContain('Stop wasting');
    expect(t.text).toContain('• One');
    expect(t.text).not.toContain('alert');
  });

  it('403 → PAGE_FORBIDDEN, 429 → RATE_LIMITED, 500 → PAGE_UNREADABLE, SPA vazia → PAGE_UNREADABLE', async () => {
    await expect(fetchPage('https://x.com', opts(res(403)))).rejects.toMatchObject({ code: 'PAGE_FORBIDDEN' });
    await expect(fetchPage('https://x.com', opts(res(429)))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(fetchPage('https://x.com', opts(res(500)))).rejects.toMatchObject({ code: 'PAGE_UNREADABLE' });
    await expect(fetchPage('https://x.com', opts(res(200, html('<div id="root"></div>'))))).rejects.toMatchObject({ code: 'PAGE_UNREADABLE' });
    await expect(fetchPage('https://x.com', opts(res(503, '', { 'cf-mitigated': 'challenge' })))).rejects.toMatchObject({ code: 'PAGE_FORBIDDEN' });
    const ok = await fetchPage('https://x.com', opts(res(200, html(long))));
    expect(ok.text).toContain('forgotten subscription');
    expect(ok.truncated).toBe(false);
  });

  it('bloqueia rede interna (SSRF), inclusive via redirect', async () => {
    await expect(fetchPage('http://127.0.0.1/admin', opts(res(200, html(long))))).rejects.toMatchObject({ code: 'PAGE_UNREADABLE' });
    await expect(fetchPage('http://intra.local', { ...opts(res(200, html(long))), resolve: async () => ['10.0.0.5'] })).rejects.toThrow(/private/);
    let n = 0;
    const redirect = () => (n++ === 0 ? res(302, '', { location: 'http://169.254.169.254/latest' }) : res(200, html(long)));
    await expect(fetchPage('https://x.com', opts(redirect))).rejects.toThrow(/private/);
    expect(['10.1.1.1', '192.168.0.1', '172.20.0.1', '::1', 'fd00::1', '::ffff:127.0.0.1'].every(isPrivateIp)).toBe(true);
    expect(['8.8.8.8', '172.32.0.1', '2606:4700::1'].some(isPrivateIp)).toBe(false);
  });

  describe('página montada por JavaScript (bug live 22/10: quiz 100% JS)', () => {
    const spa = html('<div id="root"></div><noscript>You need to enable JavaScript to run this app.</noscript>');
    const renderedText = 'Discover the kingdom of love. '.repeat(20);
    const rendered: RenderedPage = {
      url: 'https://x.com/', title: 'Kingdom quiz', description: 'A quiz', text: renderedText,
      links: [{ href: 'https://x.com/quiz', text: 'Start' }, { href: 'https://checkout.x.com/pay', text: 'Buy' }],
      images: [], bigImgs: 0, video: { firstScreen: false, poster: null, ogImage: null }, passwordVisible: false,
    };

    it('texto curto + render devolve texto longo → sucesso com o texto, links e flag do render', async () => {
      const seen: string[] = [];
      const render = async (u: string) => { seen.push(u); return rendered; };
      const ok = await fetchPage('https://x.com', { ...opts(res(200, spa)), render });
      expect(seen).toEqual(['https://x.com/']);
      expect(ok.text).toContain('kingdom of love');
      expect(ok.title).toBe('Kingdom quiz');
      expect(ok.rendered).toBe(true);
      expect(ok.links).toEqual(expect.arrayContaining(['https://x.com/quiz', 'https://checkout.x.com/pay']));
      expect(ok.internalLinks).toEqual(rendered.links);
    });

    it('texto curto + sem binário (render → null) → PAGE_UNREADABLE com o failDetail de hoje', async () => {
      await expect(fetchPage('https://x.com', { ...opts(res(200, spa)), render: async () => null })).rejects.toMatchObject({
        code: 'PAGE_UNREADABLE', message: 'no readable text (page rendered by JavaScript?)',
      });
    });

    it('render que também não acha texto → PAGE_UNREADABLE; render que lança (timeout) propaga o código', async () => {
      await expect(fetchPage('https://x.com', { ...opts(res(200, spa)), render: async () => ({ ...rendered, text: 'nada' }) })).rejects.toMatchObject({ code: 'PAGE_UNREADABLE', details: { reason: 'empty_after_render' } });
      await expect(fetchPage('https://x.com', { ...opts(res(200, spa)), render: async () => { throw new IntegracaoError('PAGE_FORBIDDEN', 'bot challenge page'); } })).rejects.toMatchObject({ code: 'PAGE_FORBIDDEN' });
    });

    it('esqueleto de SPA com pouco texto renderiza mesmo passando dos 200 caracteres; página normal não renderiza', async () => {
      let calls = 0;
      const render = async () => { calls++; return rendered; };
      const skeleton = html('<div id="__next"><p>' + 'Loading your experience. '.repeat(12) + '</p></div>');
      const r1 = await fetchPage('https://x.com', { ...opts(res(200, skeleton)), render });
      expect(calls).toBe(1);
      expect(r1.rendered).toBe(true);
      const r2 = await fetchPage('https://x.com', { ...opts(res(200, html(long))), render });
      expect(calls).toBe(1);
      expect(r2.rendered).toBeUndefined();
      expect(looksLikeSpa(spa)).toBe(true);
      expect(looksLikeSpa(html(long))).toBe(false);
    });
  });
});

describe('validação e custo', () => {
  it('roteiro: tempos contínuos a partir de 0, gancho primeiro, SOLO SHOT garantido', () => {
    const s = parseScript(scriptJson());
    expect(s.blocks.map((b) => [b.label, b.startSec, b.endSec])).toEqual([['hook', 0, 3], ['problem', 3, 11], ['product', 11, 20], ['cta', 20, 24]]);
    expect(s.durationSec).toBe(24);
    expect(s.blocks[0].visualPrompt).toMatch(/^SOLO SHOT, medium/);
    expect(() => parseScript('{"angle":"x"')).toThrow(IntegracaoError);
    expect(() => parseScript(JSON.stringify({ angle: 'a', rationale: 'b', blocks: [{ durationSec: 0, speech: 'x' }, { durationSec: 2, speech: 'y' }] }))).toThrow(/duration/);
  });

  it('idioma normalizado', () => {
    expect(normalizeLanguage('pt')).toBe('pt-BR');
    expect(normalizeLanguage('pt_br')).toBe('pt-BR');
    expect(normalizeLanguage('es')).toBe('es');
    expect(normalizeLanguage('???')).toBe('en');
  });

  it('preço por token do Opus 5.5 (US$ 4 / 20) e do fallback pelo modelo que rodou', () => {
    expect(costOf(usage('claude-opus-5-5', 1_000_000, 0)).totalUsd).toBe(4);
    expect(costOf(usage('claude-opus-5-5', 0, 1_000_000)).totalUsd).toBe(20);
    const both = costOf([...usage('claude-opus-5-5', 1000, 0), ...usage('claude-opus-4-8', 1000, 1000)]);
    expect(both.totalUsd).toBeCloseTo(0.004 + 0.005 + 0.025, 6);
    expect(costOf([{ model: 'claude-opus-5-5', inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000, cacheReadTokens: 1_000_000 }]).totalUsd).toBeCloseTo(5 + 0.2, 6);
  });

  it('vencedor de OUTRA oferta chega só como estrutura (sem fala, sem ângulo)', () => {
    const w: WinnerExample[] = [
      { creativeId: 'a', sameOffer: true, angle: 'Mine', blocks: [{ label: 'hook', startSec: 0, endSec: 3, speech: 'Same offer line', visualPrompt: 'v' }] },
      { creativeId: 'b', sameOffer: false, angle: 'Lose 10kg fast', blocks: [{ label: 'hook', startSec: 0, endSec: 3, speech: 'Their secret promise here', visualPrompt: 'their product' }] },
    ];
    const t = winnersBlock(w)!;
    expect(t).toContain('Same offer line');
    expect(t).not.toContain('secret promise');
    expect(t).not.toContain('Lose 10kg');
    expect(t).not.toContain('their product');
    expect(t).toContain('hook: 3s, 4 words');
  });
});

describe('ClaudeLiveService', () => {
  const READ_STAGES = ['fetching_page', 'rendering_page', 'reading_subpages', 'reading_images'] as const;
  /** leitura falsa (leitura.ts): emite os 4 stages de leitura e devolve só a principal por HTTP */
  const reading = async (_u: string, onStage: (s: (typeof READ_STAGES)[number]) => void) => {
    for (const st of READ_STAGES) onStage(st);
    const text = 'Orbit finds subscriptions...';
    return {
      page: { url: 'https://orbit.app', title: 'Orbit', description: null, text, truncated: false, pages: [{ url: 'https://orbit.app', role: 'main' as const, title: 'Orbit', text, truncated: false, via: 'http' as const, images: [] }], readMode: 'http' as const },
      images: [], imageReason: null, readMs: 1,
    };
  };

  it('extractOffer: etapas na ordem, briefing validado e custo gravado', async () => {
    const costs = new MemoryCostStore();
    const t = new FakeTransport(() => ({ text: JSON.stringify({ ...offer, language: 'pt', notes: '  ' }), stopReason: 'end_turn', usage: usage() }));
    const svc = new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5', readOffer: reading });
    const stages: string[] = [];
    const r = await svc.extractOffer({ url: 'https://orbit.app', workspaceId: 'w', jobId: 'j' }, (s) => stages.push(s));
    expect(stages).toEqual([...READ_STAGES, 'extracting', 'detecting_language']);
    expect(r).toMatchObject({ name: 'Orbit Budget', language: 'pt-BR', notes: null, readMode: 'http', relatedUrls: [], imagesRead: [] });
    expect(r.pages).toEqual([{ url: 'https://orbit.app', role: 'main', via: 'http', chars: 'Orbit finds subscriptions...'.length }]);
    expect(r.costUsd).toBeCloseTo(0.004 + 0.01, 6);
    expect(costs.entries.map((e) => [e.provider, e.kind, e.unit, e.units, e.jobId])).toEqual([
      ['ANTHROPIC', 'LLM', 'ktoken_in', 1, 'j'],
      ['ANTHROPIC', 'LLM', 'ktoken_out', 0.5, 'j'],
    ]);
    expect(t.calls[0].user).toContain('Orbit finds subscriptions');
  });

  it('extractOffer: texto colado não busca a página; erro da página propaga o código', async () => {
    const t = new FakeTransport(() => ({ text: JSON.stringify(offer), stopReason: 'end_turn', usage: usage() }));
    const fetchSpy = jest.fn(reading);
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'm', readOffer: fetchSpy });
    const stages: string[] = [];
    const r = await svc.extractOffer({ pageText: 'Pasted sales copy', url: 'https://x', workspaceId: 'w', jobId: 'j' }, (s) => stages.push(s));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(stages).toEqual(['extracting', 'detecting_language']);
    expect(r.readMode).toBe('pasted');
    expect(t.calls[0].user).toContain('<page role="main" url="https://x" via="pasted">');
    const forbidden = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'm', readOffer: async () => { throw new IntegracaoError('PAGE_FORBIDDEN'); } });
    await expect(forbidden.extractOffer({ url: 'https://x', workspaceId: 'w', jobId: 'j' }, () => undefined)).rejects.toMatchObject({ code: 'PAGE_FORBIDDEN' });
  });

  it('generateScripts: N em paralelo com streaming, falha parcial, 1 nova tentativa pra JSON ruim, custo somado', async () => {
    const costs = new MemoryCostStore();
    let slot2Tries = 0;
    const t = new FakeTransport((call) => {
      if (call.user.includes('option 2 of 4')) return new IntegracaoError('RATE_LIMITED');
      if (call.user.includes('option 3 of 4')) {
        slot2Tries++;
        return { text: slot2Tries === 1 ? '{"angle":"broken"' : scriptJson('Retry ok'), stopReason: 'end_turn', usage: usage() };
      }
      if (call.user.includes('option 4 of 4')) return { text: '', stopReason: 'refusal', usage: usage('claude-opus-5-5', 100, 0) };
      return { text: scriptJson(), stopReason: 'end_turn', usage: usage() };
    });
    const svc = new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5' });
    const stages: string[] = [];
    const deltas: Record<string, string> = {};
    const done: Record<number, ScriptDraft> = {};
    const failed: Record<number, string> = {};
    const r = await svc.generateScripts(
      { workspaceId: 'w', creativeId: 'c', jobId: 'j', offer, count: 4, avoidAngles: ['Old one'], winners: [{ creativeId: 'x', sameOffer: true, angle: 'A', blocks: [] }] },
      {
        onStage: (s) => stages.push(s),
        onDelta: (slot, b, f, text) => (deltas[`${slot}.${b}.${f}`] = (deltas[`${slot}.${b}.${f}`] ?? '') + text),
        onScriptDone: (slot, d) => (done[slot] = d),
        onScriptFailed: (slot, code) => (failed[slot] = code),
      },
    );
    expect(stages).toEqual(['reading_brief', 'studying_winners', 'writing']);
    expect(Object.keys(done).map(Number).sort()).toEqual([0, 2]);
    expect(done[2].angle).toBe('Retry ok');
    expect(failed).toEqual({ 1: 'RATE_LIMITED', 3: 'SAFETY_BLOCK' });
    expect(deltas['0.0.angle']).toBe('Hidden cost');
    expect(deltas['0.2.speech']).toBe('Orbit finds every subscription in one minute.');
    expect(t.calls).toHaveLength(5); // 4 + a nova tentativa do slot 2
    expect(t.calls[0].context).toContain('<brief>');
    expect(t.calls[0].user).toContain('Old one');
    expect(t.calls[0].user).not.toBe(t.calls[1].user); // cada slot recebe uma família de ângulo
    // 3 respostas (slot 0, slot 2 duas vezes) a 1000/500 + recusa 100/0; a de 429 não cobra
    expect(r.costUsd).toBeCloseTo(3 * (0.004 + 0.01) + 0.0004, 6);
    expect(costs.entries).toHaveLength(8);
    expect(costs.entries.every((e) => e.creativeId === 'c' && e.jobId === 'j')).toBe(true);
  });

  it('suggestFaceDescription devolve a descrição (≤ 600) e grava custo', async () => {
    const costs = new MemoryCostStore();
    const t = new FakeTransport(() => ({ text: JSON.stringify({ description: 'Uma mulher de 30 anos, camiseta lisa, sala clara, olhando para a câmera.' }), stopReason: 'end_turn', usage: usage() }));
    const svc = new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5' });
    const d = await svc.suggestFaceDescription({ offer, script: parseScript(scriptJson()), workspaceId: 'w', creativeId: 'c' });
    expect(d).toMatch(/^Uma mulher/);
    expect(costs.entries).toHaveLength(2);
    expect(t.calls[0].user).toContain('You are paying for things you forgot.');
  });
});

describe('SdkClaudeTransport (SDK falso)', () => {
  function fakeClient(events: unknown[], final: unknown, capture: { params?: Record<string, unknown> }) {
    return {
      beta: {
        messages: {
          stream: (params: Record<string, unknown>) => {
            capture.params = params;
            return {
              async *[Symbol.asyncIterator]() {
                for (const e of events) yield e;
              },
              finalMessage: async () => final,
            };
          },
        },
      },
    } as unknown as ConstructorParameters<typeof SdkClaudeTransport>[0];
  }

  it('erro 400 do provedor vira PROVIDER_ERROR com status + tipo + mensagem em details.providerDetail (bug live 22/10)', async () => {
    const body = { type: 'error', error: { type: 'invalid_request_error', message: 'Schemas contains too many parameters with union types (19 parameters with type arrays or anyOf).' } };
    const client = { beta: { messages: { stream: () => { throw new Anthropic.BadRequestError(400, body, '400 bad', new Headers({ 'request-id': 'req_1' })); } } } } as unknown as ConstructorParameters<typeof SdkClaudeTransport>[0];
    const t = new SdkClaudeTransport(client, { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true });
    await expect(t.run({ system: 'S', user: 'U', schema: { type: 'object' }, maxTokens: 100 })).rejects.toMatchObject({
      code: 'PROVIDER_ERROR',
      details: { providerDetail: expect.stringMatching(/^400 invalid_request_error: Schemas contains too many parameters with union types .*\(req_1\)$/) },
    });
  });

  it('manda modelo, effort, schema, cache e fallbacks "default"; streama texto; uso por modelo', async () => {
    const cap: { params?: Record<string, unknown> } = {};
    const events = [
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"a":' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '1}' } },
    ];
    const final = { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, iterations: null } };
    const t = new SdkClaudeTransport(fakeClient(events, final, cap), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true });
    const got: (string | null)[] = [];
    const r = await t.run({ system: 'S', context: 'C', user: 'U', schema: { type: 'object' }, maxTokens: 100 }, (d) => got.push(d));
    expect(got.join('')).toBe('{"a":1}');
    expect(r).toEqual({ text: '{"a":1}', stopReason: 'end_turn', usage: [{ model: 'claude-opus-5-5', inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 }] });
    const p = cap.params!;
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.output_config).toEqual({ effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } });
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(p.thinking).toBeUndefined(); // Opus 5.5: thinking sempre ligado; mandar disabled/budget = 400
    expect((p.system as { cache_control?: unknown }[])[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('fallback no meio: avisa reset, devolve só o texto do modelo que terminou e cobra os dois', async () => {
    const events = [
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"partial' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'fallback' } },
      { type: 'content_block_delta', index: 2, delta: { type: 'text_delta', text: '{"b":2}' } },
    ];
    const final = {
      model: 'claude-opus-4-8', stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"partial' }, { type: 'fallback' }, { type: 'text', text: '{"b":2}' }],
      usage: { input_tokens: 0, output_tokens: 0, iterations: [
        { type: 'message', model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 100, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      ] },
    };
    const t = new SdkClaudeTransport(fakeClient(events, final, {}), { model: 'claude-opus-5-5', effort: 'medium', fallbacks: true });
    const got: (string | null)[] = [];
    const r = await t.run({ system: 'S', user: 'U', schema: {}, maxTokens: 10 }, (d) => got.push(d));
    expect(got).toEqual(['{"partial', null, '{"b":2}']);
    expect(r.text).toBe('{"b":2}');
    expect(r.usage.map((u) => u.model)).toEqual(['claude-opus-5-5', 'claude-opus-4-8']);
  });

  it('erros tipados do SDK viram códigos do contrato', async () => {
    const boom = (err: unknown) =>
      ({ beta: { messages: { stream: () => { throw err; } } } }) as unknown as ConstructorParameters<typeof SdkClaudeTransport>[0];
    const run = (err: unknown) => new SdkClaudeTransport(boom(err), { model: 'm', effort: 'medium', fallbacks: false }).run({ system: '', user: '', schema: {}, maxTokens: 1 });
    await expect(run(new Anthropic.RateLimitError(429, undefined, 'rl', new Headers()))).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(run(new Anthropic.AuthenticationError(401, undefined, 'no', new Headers()))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(run(new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers()))).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    await expect(run(new Error('weird'))).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });
});
