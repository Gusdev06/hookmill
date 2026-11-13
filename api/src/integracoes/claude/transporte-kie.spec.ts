import { KieTransport, KIE_RESPONSES_URL, KIE_CLAUDE_PAUSA_MS, buildLlmTransport, llmKeyName, reabrirClaudeKie, stripJsonFence } from './transporte-kie';
import { SdkClaudeTransport } from './transporte';
import { IntegracaoError } from '../erros';

const schema = { type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] };

function fakeClient(text: string, seen: Record<string, unknown>[] = []) {
  return {
    beta: {
      messages: {
        stream: (params: Record<string, unknown>) => {
          seen.push(params);
          return {
            async *[Symbol.asyncIterator]() {},
            finalMessage: async () => ({ model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }),
          };
        },
      },
    },
  } as never;
}

const okFetch = (calls: { url: string; body: any; headers: any }[], text = '{"a":1}') =>
  (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers });
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', content: [] }, { type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 100, output_tokens: 7, input_tokens_details: { cached_tokens: 3 } } }), { status: 200 });
  }) as unknown as typeof fetch;

describe('transporte-kie', () => {
  beforeEach(() => reabrirClaudeKie());
  it('stripJsonFence tira a cerca e deixa JSON puro igual', () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripJsonFence(' {"a":1} ')).toBe('{"a":1}');
  });

  it('texto vai pelo Claude do Kie, sem beta de fallback, e volta sem cerca', async () => {
    const seen: Record<string, unknown>[] = [];
    const t = new KieTransport({ apiKey: 'k', model: 'claude-opus-5-5', effort: 'medium', fallbacks: true, client: fakeClient('```json\n{"a":2}\n```', seen), fetchImpl: (() => { throw new Error('não devia chamar fetch'); }) as never });
    const r = await t.run({ system: 's', user: 'u', schema, maxTokens: 100 });
    expect(JSON.parse(r.text)).toEqual({ a: 2 });
    expect(seen[0].betas).toBeUndefined();
    const content = (seen[0].messages as { content: { text?: string }[] }[])[0].content;
    expect(content[content.length - 1].text).toContain('"required":["a"]');
    expect(r.usage[0].model).toBe('claude-opus-5-5');
  });

  it('com imagem vai pro GPT do Kie (Responses) com json_schema e imagem em data URL', async () => {
    const calls: { url: string; body: any; headers: any }[] = [];
    const t = new KieTransport({ apiKey: 'k', model: 'claude-opus-5-5', effort: 'max', fallbacks: false, client: fakeClient('x'), fetchImpl: okFetch(calls) });
    const r = await t.run({ system: 'sys', context: 'ctx', user: 'u', schema, maxTokens: 500, images: [{ mediaType: 'image/jpeg', data: 'AAAA', caption: 'quadro 1' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(KIE_RESPONSES_URL);
    expect(calls[0].headers.authorization).toBe('Bearer k');
    const b = calls[0].body;
    expect(b.model).toBe('gpt-6-1-sol');
    expect(b.instructions).toBe('sys');
    expect(b.reasoning).toEqual({ effort: 'high' });
    expect(b.text.format).toMatchObject({ type: 'json_schema', schema });
    expect(b.input[0].content.map((c: any) => c.type)).toEqual(['input_text', 'input_text', 'input_image', 'input_text']);
    expect(b.input[0].content[2].image_url).toBe('data:image/jpeg;base64,AAAA');
    expect(JSON.parse(r.text)).toEqual({ a: 1 });
    expect(r.usage[0]).toMatchObject({ model: 'gpt-6-1-sol', inputTokens: 100, outputTokens: 7, cacheReadTokens: 3 });
  });

  it('200 com {code:500} no corpo vira PROVIDER_UNAVAILABLE e repete; 400 não repete', async () => {
    let n = 0;
    const f500 = (async () => { n++; return new Response(JSON.stringify({ code: 500, msg: 'Internal Server Error' }), { status: 200 }); }) as unknown as typeof fetch;
    const t = new KieTransport({ apiKey: 'k', model: 'm', effort: 'low', fallbacks: false, maxRetries: 1, client: fakeClient('x'), fetchImpl: f500 });
    const img = [{ mediaType: 'image/png' as const, data: 'A', caption: 'c' }];
    await expect(t.run({ system: 's', user: 'u', schema, maxTokens: 10, images: img })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(n).toBe(2);

    let m = 0;
    const f400 = (async () => { m++; return new Response('{"error":{"message":"bad"}}', { status: 400 }); }) as unknown as typeof fetch;
    const t2 = new KieTransport({ apiKey: 'k', model: 'm', effort: 'low', fallbacks: false, maxRetries: 2, client: fakeClient('x'), fetchImpl: f400 });
    const e = await t2.run({ system: 's', user: 'u', schema, maxTokens: 10, images: img }).catch((x) => x);
    expect(e).toBeInstanceOf(IntegracaoError);
    expect(e.code).toBe('PROVIDER_ERROR');
    expect(m).toBe(1);
  });

  it('texto: 500 do Claude do Kie cai pro GPT do Kie; 400 não cai', async () => {
    const boom = (code: string) => ({ beta: { messages: { stream: () => { throw new IntegracaoError(code as never, 'x'); } } } }) as never;
    const calls: { url: string; body: any; headers: any }[] = [];
    const t = new KieTransport({ apiKey: 'k', model: 'claude-opus-5-5', effort: 'medium', fallbacks: false, client: boom('PROVIDER_UNAVAILABLE'), fetchImpl: okFetch(calls) });
    const r = await t.run({ system: 's', user: 'u', schema, maxTokens: 100 });
    expect(calls).toHaveLength(1);
    expect(r.usage[0].model).toBe('gpt-6-1-sol');
    expect(calls[0].body.input[0].content.map((c: any) => c.type)).toEqual(['input_text']);

    reabrirClaudeKie();
    const calls2: typeof calls = [];
    const t2 = new KieTransport({ apiKey: 'k', model: 'claude-opus-5-5', effort: 'medium', fallbacks: false, client: boom('PROVIDER_ERROR'), fetchImpl: okFetch(calls2) });
    await expect(t2.run({ system: 's', user: 'u', schema, maxTokens: 100 })).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    expect(calls2).toHaveLength(0);
  });

  it('13/11 disjuntor: depois de uma falha do Claude do Kie, o texto vai direto pro GPT por 30 min e depois volta a tentar', async () => {
    let tentativas = 0;
    const boom = { beta: { messages: { stream: () => { tentativas++; throw new IntegracaoError('PROVIDER_UNAVAILABLE' as never, 'x'); } } } } as never;
    const calls: { url: string; body: any; headers: any }[] = [];
    const t = new KieTransport({ apiKey: 'k', model: 'claude-opus-5-5', effort: 'medium', fallbacks: false, client: boom, fetchImpl: okFetch(calls) });
    const agora = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(agora);
    try {
      await t.run({ system: 's', user: 'u', schema, maxTokens: 100 });
      await t.run({ system: 's', user: 'u', schema, maxTokens: 100 });
      expect(tentativas).toBe(1); // a 2ª nem tentou o Claude
      expect(calls).toHaveLength(2);
      spy.mockReturnValue(agora + KIE_CLAUDE_PAUSA_MS + 1);
      await t.run({ system: 's', user: 'u', schema, maxTokens: 100 });
      expect(tentativas).toBe(2); // passou a pausa: tenta o Claude de novo
    } finally { spy.mockRestore(); }
  });

  it('buildLlmTransport escolhe pelo CLAUDE_PROVIDER', () => {
    const env = (o: Record<string, string>) => (k: string) => o[k];
    const opts = { model: 'claude-opus-5-5', effort: 'medium' as const, fallbacks: false };
    expect(buildLlmTransport(env({ CLAUDE_PROVIDER: 'kie', KIE_API_KEY: 'k' }), opts)).toBeInstanceOf(KieTransport);
    expect(buildLlmTransport(env({ CLAUDE_PROVIDER: 'kie' }), opts)).toBeNull();
    expect(buildLlmTransport(env({ ANTHROPIC_API_KEY: 'a' }), opts)).toBeInstanceOf(SdkClaudeTransport);
    expect(llmKeyName(env({ CLAUDE_PROVIDER: 'KIE' }))).toBe('KIE_API_KEY');
    expect(llmKeyName(env({}))).toBe('ANTHROPIC_API_KEY');
  });
});
