// Uma chamada ao Claude com saída estruturada (JSON Schema) e streaming. É a ÚNICA peça que conhece o SDK;
// o ClaudeLiveService fala com esta interface, então os testes trocam o transporte por um falso.
import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
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
  /** Outro modelo só nesta chamada (ex.: Haiku na checagem de texto do STATIC). Com ele não há fallback de servidor
   *  (o `fallbacks: "default"` é dos modelos Opus/Sonnet/Fable) e o esforço é o `effort` abaixo. */
  model?: string;
  /** Esforço desta chamada (vence o do transporte); null = sem `effort` (Haiku 4.5 recusa o parâmetro). */
  effort?: SdkTransportOptions['effort'] | null;
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
    const model = call.model ?? this.opts.model;
    // `effort` da chamada vence (null = sem effort); sem ele, o padrão do transporte (ou nenhum, quando o modelo é outro)
    const effort = call.effort !== undefined ? call.effort : call.model ? null : this.opts.effort;
    try {
      const stream = this.client.beta.messages.stream({
        model,
        max_tokens: call.maxTokens,
        system,
        messages: [{ role: 'user', content }],
        output_config: { ...(effort ? { effort } : {}), format: { type: 'json_schema', schema: call.schema } },
        ...(this.opts.fallbacks && !call.model ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });
      for await (const ev of stream) {
        if (!onText) continue;
        if (ev.type === 'content_block_start' && ev.content_block.type === 'fallback') onText(null);
        else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') onText(ev.delta.text);
      }
      final = await stream.finalMessage();
    } catch (e) {
      const mapped = mapSdkError(e);
      // nunca mais cego (bug live 22/10): status + tipo + mensagem do provedor no log (sem chave, sem base64 — o corpo do erro não ecoa o pedido)
      log.warn(`anthropic falhou (${model}): ${mapped.code} ${String(mapped.details?.providerDetail ?? mapped.message)}`);
      throw mapped;
    }

    // texto depois do último bloco de fallback = resposta do modelo que terminou
    let text = '';
    for (const b of final.content) {
      if (b.type === 'fallback') text = '';
      else if (b.type === 'text') text += b.text;
    }
    return { text, stopReason: final.stop_reason ?? null, usage: usageOf(final, model) };
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

const log = new Logger('ClaudeTransport');

/** "400 invalid_request_error: <mensagem> (req_…)" — o que vai pro log e pro `details.providerDetail` (backend → failDetail). */
export function providerDetailOf(e: InstanceType<typeof Anthropic.APIError>): string {
  const body = (e.error ?? {}) as { error?: { type?: string; message?: string } };
  const type = body.error?.type ?? 'unknown';
  const msg = body.error?.message ?? e.message;
  const req = (e as { requestID?: string | null }).requestID;
  return `${e.status ?? '-'} ${type}: ${msg}${req ? ` (${req})` : ''}`.slice(0, 1000);
}

/** Erros do SDK → códigos do contrato. Classes tipadas, nunca casar texto. `details.providerDetail` = status + tipo + mensagem do provedor. */
export function mapSdkError(e: unknown): IntegracaoError {
  if (e instanceof IntegracaoError) return e;
  const err = (code: ConstructorParameters<typeof IntegracaoError>[0], message: string) =>
    new IntegracaoError(code, message, e instanceof Anthropic.APIError ? { providerDetail: providerDetailOf(e) } : { providerDetail: e instanceof Error ? e.message : String(e) });
  if (e instanceof Anthropic.RateLimitError) return err('RATE_LIMITED', 'anthropic 429');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return err('PROVIDER_UNAVAILABLE', `anthropic auth ${e.status}`);
  if (e instanceof Anthropic.BadRequestError) return err('PROVIDER_ERROR', `anthropic 400: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionTimeoutError) return err('PROVIDER_TIMEOUT', 'anthropic timeout');
  if (e instanceof Anthropic.APIConnectionError) return err('PROVIDER_UNAVAILABLE', 'anthropic connection');
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || (e.status ?? 0) >= 500) return err('PROVIDER_UNAVAILABLE', `anthropic ${e.status}`);
    return err('PROVIDER_ERROR', `anthropic ${e.status}: ${e.message}`);
  }
  return err('PROVIDER_ERROR', e instanceof Error ? e.message : String(e));
}
