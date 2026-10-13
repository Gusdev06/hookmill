// Uma chamada ao Claude com saída estruturada (JSON Schema) e streaming. É a ÚNICA peça que conhece o SDK;
// o ClaudeLiveService fala com esta interface, então os testes trocam o transporte por um falso.
import Anthropic from '@anthropic-ai/sdk';
import { IntegracaoError } from '../erros';

export interface ClaudeCall {
  /** Prompt de sistema estável (vai com cache_control: prefixo igual entre os N roteiros). */
  system: string;
  /** Contexto estável da rodada (briefing + vencedores): segundo bloco cacheável. */
  context?: string;
  /** Imagens (base64), cada uma precedida da legenda; vão depois do contexto e antes do pedido. */
  images?: ClaudeImage[];
  /** Pedido específico desta chamada (slot, ângulo). */
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface ClaudeImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  /** base64 sem quebra de linha */
  data: string;
  caption: string;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface ClaudeResult {
  /** Texto final (JSON) só do modelo que terminou (descarta o parcial de um modelo que recusou). */
  text: string;
  stopReason: string | null;
  /** Uso por modelo que rodou (o fallback pode somar uma 2ª entrada). */
  usage: ModelUsage[];
}

/** onText(null) = descarte o que chegou até aqui (o modelo recusou no meio e o fallback recomeça). */
export type OnText = (delta: string | null) => void;

export interface ClaudeTransport {
  run(call: ClaudeCall, onText?: OnText): Promise<ClaudeResult>;
}

export interface SdkTransportOptions {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** fallbacks "default" (beta server-side-fallback-2026-07-01): recusa do classificador re-roda em outro modelo. */
  fallbacks: boolean;
}

/** Subconjunto do client que usamos (o teste injeta um falso com a mesma forma). */
export type AnthropicLike = Pick<Anthropic, 'beta'>;

export class SdkClaudeTransport implements ClaudeTransport {
  constructor(
    private readonly client: AnthropicLike,
    private readonly opts: SdkTransportOptions,
  ) {}

  async run(call: ClaudeCall, onText?: OnText): Promise<ClaudeResult> {
    const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }];
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (call.context) content.push({ type: 'text', text: call.context, cache_control: { type: 'ephemeral' } });
    for (const img of call.images ?? []) {
      content.push({ type: 'text', text: img.caption });
      content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
    }
    content.push({ type: 'text', text: call.user });

    let final: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream({
        model: this.opts.model,
        max_tokens: call.maxTokens,
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort: this.opts.effort, format: { type: 'json_schema', schema: call.schema } },
        ...(this.opts.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      for await (const ev of stream) {
        if (!onText) continue;
        if (ev.type === 'content_block_start' && ev.content_block.type === 'fallback') onText(null);
        else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onText(ev.delta.text);
      }
      final = await stream.finalMessage();
    } catch (e) {
      throw mapSdkError(e);
    }

    // texto depois do último bloco de fallback = resposta do modelo que terminou
    let text = '';
    for (const b of final.content) {
      if (b.type === 'fallback') text = '';
      else if (b.type === 'text') text += b.text;
    }
    return { text, stopReason: final.stop_reason ?? null, usage: usageOf(final, this.opts.model) };
  }
}

function usageOf(m: Anthropic.Beta.BetaMessage, requested: string): ModelUsage[] {
  const its = m.usage.iterations ?? [];
  const perModel = its
    .filter((i) => i.type === 'message' || i.type === 'fallback_message')
    .map((i) => {
      const x = i as Anthropic.Beta.BetaMessageIterationUsage;
      return {
        model: String(x.model ?? m.model ?? requested),
        inputTokens: x.input_tokens ?? 0,
        outputTokens: x.output_tokens ?? 0,
        cacheWriteTokens: x.cache_creation_input_tokens ?? 0,
        cacheReadTokens: x.cache_read_input_tokens ?? 0,
      };
    });
  if (perModel.length) return perModel;
  return [
    {
      model: m.model ?? requested,
      inputTokens: m.usage.input_tokens ?? 0,
      outputTokens: m.usage.output_tokens ?? 0,
      cacheWriteTokens: m.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: m.usage.cache_read_input_tokens ?? 0,
    },
  ];
}

/** Erros do SDK → códigos do contrato. Classes tipadas, nunca casar texto. */
export function mapSdkError(e: unknown): IntegracaoError {
  if (e instanceof IntegracaoError) return e;
  if (e instanceof Anthropic.RateLimitError) return new IntegracaoError('RATE_LIMITED', 'anthropic 429');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new IntegracaoError('PROVIDER_UNAVAILABLE', `anthropic auth ${e.status}`);
  if (e instanceof Anthropic.BadRequestError) return new IntegracaoError('PROVIDER_ERROR', `anthropic 400: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new IntegracaoError('PROVIDER_TIMEOUT', 'anthropic timeout');
  if (e instanceof Anthropic.APIConnectionError) return new IntegracaoError('PROVIDER_UNAVAILABLE', 'anthropic connection');
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return new IntegracaoError('PROVIDER_UNAVAILABLE', `anthropic ${e.status}`);
    return new IntegracaoError('PROVIDER_ERROR', `anthropic ${e.status}`);
  }
  return new IntegracaoError('PROVIDER_ERROR', e instanceof Error ? e.message : String(e));
}
