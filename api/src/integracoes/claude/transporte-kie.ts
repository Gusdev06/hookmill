// 11/11 (Gusta): todo LLM pelo Kie.ai (CLAUDE_PROVIDER=kie). Mesmo contrato do SdkClaudeTransport.
//  - Texto: Claude pelo endpoint compatível com a Anthropic (https://api.kie.ai/anthropic), mesmo SDK.
//    O Kie ignora output_config.format (o JSON volta às vezes dentro de ```json): tiramos a cerca antes de devolver.
//  - Com imagem: o Claude do Kie dá 500 em qualquer imagem (testado 11/11 em todos os Claude). Essas chamadas vão pro
//    GPT do Kie (Responses, /codex/v1/responses) com text.format json_schema. Modelo em KIE_VISION_MODEL (padrão gpt-6-1-sol).
import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { IntegracaoError } from '../erros';
import { SdkClaudeTransport, type ClaudeCall, type ClaudeResult, type ClaudeTransport, type OnText, type SdkTransportOptions } from './transporte';

export const KIE_ANTHROPIC_BASE_URL = 'https://api.kie.ai/anthropic';
export const KIE_RESPONSES_URL = 'https://api.kie.ai/codex/v1/responses';
export const KIE_VISION_DEFAULT = 'gpt-6-1-sol';

const log = new Logger('KieTransport');

/** Tira ```json … ``` (ou ``` … ```) em volta do JSON; texto sem cerca volta igual. */
export function stripJsonFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : t;
}

/** O contrato de saída escrito no pedido (o Kie não aplica o json_schema do output_config). */
export function schemaInstruction(schema: Record<string, unknown>): string {
  return [
    'OUTPUT FORMAT (mandatory): reply with ONE JSON object only — no prose, no markdown, no code fence.',
    'It must validate against this JSON Schema: use exactly these property names, include every "required" property, add no other properties, respect enums, types and limits.',
    JSON.stringify(schema),
  ].join('\n');
}

export interface KieTransportOptions extends SdkTransportOptions {
  apiKey: string;
  visionModel?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** injeção pros testes */
  fetchImpl?: typeof fetch;
  client?: Pick<Anthropic, 'beta'>;
}

export class KieTransport implements ClaudeTransport {
  private readonly text: SdkClaudeTransport;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: KieTransportOptions) {
    // O Kie aceita x-api-key no formato "Bearer <chave>". Sem o beta de fallback (é do servidor da Anthropic).
    const client = opts.client ?? new Anthropic({ baseURL: KIE_ANTHROPIC_BASE_URL, apiKey: `Bearer ${opts.apiKey}`, maxRetries: Math.max(opts.maxRetries ?? 2, 3), ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}) });
    this.text = new SdkClaudeTransport(client, { model: opts.model, effort: opts.effort, fallbacks: false });
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(call: ClaudeCall, onText?: OnText): Promise<ClaudeResult> {
    if (call.images?.length) return this.runVision(call, onText);
    // o Kie ignora output_config.format (11/11: devolveu campo inventado e sem o obrigatório) → o schema vai no pedido
    try {
      const res = await this.text.run({ ...call, user: `${call.user}\n\n${schemaInstruction(call.schema)}` }, onText);
      return { ...res, text: stripJsonFence(res.text) };
    } catch (e) {
      // 11/11: o Claude do Kie solta 500 intermitente (mesmo pedido passa e falha). Depois dos retries do SDK, a chamada
      // vai pro GPT do Kie (mesmo endpoint das imagens), que ficou estável nos testes. Erro de pedido (400) não cai.
      const code = (e as IntegracaoError)?.code;
      if (code !== 'PROVIDER_UNAVAILABLE' && code !== 'PROVIDER_TIMEOUT') throw e;
      log.warn(`claude do kie indisponível (${code}); caindo pro ${this.opts.visionModel || KIE_VISION_DEFAULT}`);
      if (onText) onText(null);
      return this.runVision(call, onText);
    }
  }

  private async runVision(call: ClaudeCall, onText?: OnText): Promise<ClaudeResult> {
    const model = this.opts.visionModel || KIE_VISION_DEFAULT;
    const content: Record<string, unknown>[] = [];
    if (call.context) content.push({ type: 'input_text', text: call.context });
    for (const img of call.images ?? []) {
      content.push({ type: 'input_text', text: img.caption });
      content.push({ type: 'input_image', image_url: `data:${img.mediaType};base64,${img.data}` });
    }
    content.push({ type: 'input_text', text: call.user });
    const effort = call.effort === null ? null : (call.effort ?? this.opts.effort);
    const body = {
      model,
      stream: false,
      instructions: call.system,
      input: [{ role: 'user', content }],
      max_output_tokens: call.maxTokens,
      ...(effort ? { reasoning: { effort: effort === 'xhigh' || effort === 'max' ? 'high' : effort } } : {}),
      // strict:false: os schemas foram escritos pro Claude (campos opcionais), o strict da OpenAI exige todos obrigatórios
      text: { format: { type: 'json_schema', name: 'saida', strict: false, schema: call.schema } },
    };

    const attempts = (this.opts.maxRetries ?? 2) + 1;
    let lastErr: IntegracaoError | null = null;
    for (let a = 1; a <= attempts; a++) {
      try {
        const out = await this.postResponses(body);
        const text = stripJsonFence(out.text);
        if (onText) onText(text);
        return { text, stopReason: out.stopReason, usage: [{ model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, cacheWriteTokens: 0, cacheReadTokens: out.cachedTokens }] };
      } catch (e) {
        lastErr = e instanceof IntegracaoError ? e : new IntegracaoError('PROVIDER_ERROR', String(e));
        const retriable = lastErr.code === 'PROVIDER_UNAVAILABLE' || lastErr.code === 'PROVIDER_TIMEOUT' || lastErr.code === 'RATE_LIMITED';
        log.warn(`kie vision falhou (${model}, tentativa ${a}/${attempts}): ${lastErr.code} ${String(lastErr.details?.providerDetail ?? lastErr.message)}`);
        if (!retriable || a === attempts) break;
        await new Promise((r) => setTimeout(r, 1500 * a));
      }
    }
    throw lastErr!;
  }

  private async postResponses(body: Record<string, unknown>): Promise<{ text: string; stopReason: string | null; inputTokens: number; outputTokens: number; cachedTokens: number }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 180_000);
    let res: Response;
    try {
      res = await this.fetchImpl(KIE_RESPONSES_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      const aborted = (e as { name?: string })?.name === 'AbortError';
      throw new IntegracaoError(aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE', aborted ? 'kie timeout' : 'kie connection', { providerDetail: e instanceof Error ? e.message : String(e) });
    } finally {
      clearTimeout(timer);
    }
    const raw = await res.text();
    let json: Record<string, any> = {};
    try { json = JSON.parse(raw); } catch { /* corpo não-JSON */ }
    // o Kie às vezes responde 200 com { code: 500, msg } no corpo
    const bodyCode = typeof json.code === 'number' ? json.code : null;
    const status = !res.ok ? res.status : bodyCode && bodyCode >= 400 ? bodyCode : 200;
    if (status !== 200) {
      const detail = `${status}: ${String(json.msg ?? json.error?.message ?? raw).slice(0, 500)}`;
      if (status === 429) throw new IntegracaoError('RATE_LIMITED', 'kie 429', { providerDetail: detail });
      if (status === 401 || status === 403) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `kie auth ${status}`, { providerDetail: detail });
      if (status >= 500) throw new IntegracaoError('PROVIDER_UNAVAILABLE', `kie ${status}`, { providerDetail: detail });
      throw new IntegracaoError('PROVIDER_ERROR', `kie ${status}`, { providerDetail: detail });
    }
    let text = '';
    for (const o of (json.output ?? []) as { type?: string; content?: { type?: string; text?: string }[] }[]) {
      if (o.type && o.type !== 'message') continue;
      for (const c of o.content ?? []) if (typeof c.text === 'string') text += c.text;
    }
    if (!text && typeof json.output_text === 'string') text = json.output_text;
    if (!text) throw new IntegracaoError('PROVIDER_ERROR', 'kie vision: resposta sem texto', { providerDetail: raw.slice(0, 500) });
    const u = json.usage ?? {};
    return {
      text,
      stopReason: json.status === 'incomplete' ? 'max_tokens' : 'end_turn',
      inputTokens: Number(u.input_tokens ?? 0),
      outputTokens: Number(u.output_tokens ?? 0),
      cachedTokens: Number(u.input_tokens_details?.cached_tokens ?? 0),
    };
  }
}

/** Escolhe o transporte pelo CLAUDE_PROVIDER (kie | anthropic). null = sem chave do provedor escolhido. */
export function buildLlmTransport(
  get: (k: string) => string | undefined,
  opts: SdkTransportOptions & { maxRetries?: number; timeoutMs?: number },
): ClaudeTransport | null {
  if ((get('CLAUDE_PROVIDER') ?? '').trim().toLowerCase() === 'kie') {
    const apiKey = get('KIE_API_KEY');
    if (!apiKey) return null;
    return new KieTransport({ ...opts, apiKey, visionModel: get('KIE_VISION_MODEL') || undefined });
  }
  const apiKey = get('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  return new SdkClaudeTransport(new Anthropic({ apiKey, maxRetries: opts.maxRetries ?? 2, ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}) }), opts);
}

/** Nome da chave que falta, pro NOT_CONFIGURED. */
export function llmKeyName(get: (k: string) => string | undefined): string {
  return (get('CLAUDE_PROVIDER') ?? '').trim().toLowerCase() === 'kie' ? 'KIE_API_KEY' : 'ANTHROPIC_API_KEY';
}
