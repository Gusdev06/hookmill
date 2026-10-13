// Preço do Claude por milhão de tokens (tabela da skill claude-api, cache de 25/09/2026).
// Cache: escrita de 5 min = 1,25 × entrada; leitura = preço de cache read do modelo.
import type { CostStore } from '../portas';
import type { ModelUsage } from './transporte';

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

export const CLAUDE_PRICES: Record<string, Price> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
};
/** Modelo fora da tabela: cobra como o mais caro conhecido (estimar pra cima, nunca pra baixo). */
const UNKNOWN: Price = { input: 10, output: 50, cacheRead: 1 };

export function priceOf(model: string): Price {
  const id = model.replace(/-\d{8}$/, ''); // ids com data de snapshot
  return CLAUDE_PRICES[id] ?? UNKNOWN;
}

export interface LlmCost {
  inputKtok: number;
  outputKtok: number;
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function costOf(usage: ModelUsage[]): LlmCost {
  let inTok = 0;
  let outTok = 0;
  let inUsd = 0;
  let outUsd = 0;
  for (const u of usage) {
    const p = priceOf(u.model);
    inTok += u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
    outTok += u.outputTokens;
    inUsd += (u.inputTokens * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cacheReadTokens * p.cacheRead) / 1e6;
    outUsd += (u.outputTokens * p.output) / 1e6;
  }
  return { inputKtok: r4(inTok / 1000), outputKtok: r4(outTok / 1000), inputUsd: r6(inUsd), outputUsd: r6(outUsd), totalUsd: r6(inUsd + outUsd) };
}

/** Grava o custo real de UMA chamada: duas linhas (entrada e saída), pra soma mensal e auditoria por unidade. */
export async function recordLlmCost(
  costs: CostStore,
  ctx: { workspaceId: string; creativeId?: string | null; championId?: string | null; variationBatchId?: string | null; jobId?: string; model: string },
  usage: ModelUsage[],
): Promise<number> {
  const c = costOf(usage);
  const model = usage.length > 1 ? usage.map((u) => u.model).join('>') : (usage[0]?.model ?? ctx.model);
  const base = {
    workspaceId: ctx.workspaceId, creativeId: ctx.creativeId ?? null, championId: ctx.championId ?? null, variationBatchId: ctx.variationBatchId ?? null,
    jobId: ctx.jobId, provider: 'ANTHROPIC' as const, kind: 'LLM' as const, model,
  };
  await costs.record({ ...base, units: c.inputKtok, unit: 'ktoken_in', amountUsd: r4(c.inputUsd) });
  await costs.record({ ...base, units: c.outputKtok, unit: 'ktoken_out', amountUsd: r4(c.outputUsd) });
  return c.totalUsd;
}
