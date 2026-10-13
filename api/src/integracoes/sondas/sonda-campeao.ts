// Sonda da feature 2 (I4a/I4b): analyzeChampion + planVariations REAIS num criativo NOSSO, sem banco e sem Whisper
// (a transcrição com tempo já existe no lote, gerada quando montamos a peça). Medição pelo MediaAnalysisService real.
// Uso (de api/):  npx ts-node --transpile-only src/integracoes/sondas/sonda-campeao.ts <video.mp4> <palavras.json> [saida.json]
//                 → só mede, conta tokens (grátis) e mostra o custo estimado
//                 ... --yes  → roda (teto US$ 0,35 somando as duas chamadas)
//                 ... --yes --plan-only → só o plano (1 gancho + elenco compartilhado), com o teardown determinístico do mock
//                     montado da transcrição e das medições reais (não repete a análise paga)
import 'dotenv/config';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { FfmpegMediaAnalysisService } from '../../medicao/media-analysis.service';
import type { Measurements, OfferBriefDraft, TranscriptWord, VariationItemDraft } from '../contrato';
import { ClaudeLiveService, planParams } from '../claude/claude.service';
import { CLAUDE_PRICES } from '../claude/custo';
import { HOOK_SCHEMA, planContext, planSystem } from '../claude/prompts-campeao';
import { SdkClaudeTransport, type ClaudeCall, type ClaudeResult, type ClaudeTransport } from '../claude/transporte';
import { MemoryCostStore } from '../store/memoria.store';
import { mockTeardown } from '../mock/fake-claude.service';
import type { TeardownDraft, Usage } from '../contrato';

const CAP_USD = 0.31; // 0,35 autorizado − 0,04 já gastos nas sondas de esquema (06/10)
const [video, wordsPath, outPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const yes = process.argv.includes('--yes');
const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const effort = (process.env.ANTHROPIC_EFFORT || 'medium') as 'medium';
const price = CLAUDE_PRICES[model] ?? CLAUDE_PRICES['claude-opus-5-5'];
const usd = (inTok: number, outTok: number) => (inTok * price.input + outTok * price.output) / 1e6;

/** Oferta genérica do time (o campeão é de outra oferta: o diagnóstico tem que separar as duas). */
const offer: OfferBriefDraft = {
  name: 'Spy Zap', language: 'en', kind: 'Mobile app', what: 'Shows who someone talks to on WhatsApp and when they are online.',
  audience: 'Women who suspect their partner is cheating', promise: 'Know the truth without asking', pains: 'Anxiety, lies, being called crazy',
  proof: null, offerAndPrice: null, cta: 'Tap the link and check', notes: null,
};

/** Transporte que só guarda o pedido (pra contar tokens antes de gastar). */
class Capture implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  async run(c: ClaudeCall): Promise<ClaudeResult> {
    this.calls.push(c);
    throw new Error('dry');
  }
}

async function countIn(client: Anthropic, c: ClaudeCall): Promise<number> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (c.context) content.push({ type: 'text', text: c.context });
  for (const img of c.images ?? []) {
    content.push({ type: 'text', text: img.caption });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } });
  }
  content.push({ type: 'text', text: c.user });
  const r = await client.messages.countTokens({ model, system: c.system, messages: [{ role: 'user', content }] });
  // + o esquema da saída estruturada (vira gramática; conta como entrada) ≈ tamanho do JSON / 3,5
  return r.input_tokens + Math.ceil(JSON.stringify(c.schema).length / 3.5);
}

async function main() {
  if (!video || !wordsPath) throw new Error('uso: sonda-campeao.ts <video.mp4> <palavras.json> [saida.json] [--yes]');
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY vazio em api/.env');
  const client = new Anthropic({ apiKey: key, maxRetries: 2 });

  // 1. medição real (local, grátis)
  const med = new FfmpegMediaAnalysisService();
  const dir = mkdtempSync(join(tmpdir(), 'sonda-campeao-'));
  const probe = await med.probe(video);
  await med.validateFull(video);
  const audio = join(dir, 'a.m4a');
  await med.extractAudio(video, audio);
  const [layout, silences] = await Promise.all([med.measureLayout(video), med.silences(audio)]);
  const raw = JSON.parse(readFileSync(wordsPath, 'utf8')) as { w?: string; s?: number; e?: number; word?: string; startSec?: number; endSec?: number }[];
  const words: TranscriptWord[] = raw.map((x) => ({ word: String(x.w ?? x.word), startSec: Number(x.s ?? x.startSec), endSec: Number(x.e ?? x.endSec) }));
  const times = [0, ...layout.cuts.map((c) => c.atSec), ...[0.25, 0.5, 0.75].map((f) => probe.durationSec * f), Math.max(0, probe.durationSec - 0.3)]
    .map((t) => Math.round(t * 100) / 100)
    .filter((t, i, a) => a.indexOf(t) === i)
    .sort((a, b) => a - b)
    .slice(0, 16);
  const frames = await med.keyframes(video, times, dir, 768);
  const palette = await med.palette(frames.map((f) => f.path), 5);
  const measurements: Omit<Measurements, 'keyframes'> = { ...probe, ...layout, palette, silences };
  const keyframes = frames.map((f, i) => ({ atSec: f.atSec, reason: i === 0 ? 't0' : i === frames.length - 1 ? 'end' : layout.cuts.some((c) => Math.abs(c.atSec - f.atSec) < 0.05) ? 'cut' : 'block', url: `file://${f.path}` }));
  const localFetch = (async (url: string) => new Response(readFileSync(String(url).replace('file://', '')), { headers: { 'content-type': 'image/jpeg' } })) as unknown as typeof fetch;
  console.log(`medido: ${probe.durationSec}s ${probe.width}x${probe.height}, ${layout.cuts.length} corte(s), ${layout.segments.length} segmento(s), ${silences.length} silêncio(s), ${frames.length} frames, paleta ${palette.join(' ')}, ${words.length} palavras`);

  const input = { workspaceId: 'sonda', championId: 'sonda', jobId: 'sonda', uiLocale: 'PT_BR' as const, offer, transcript: { language: 'en', words }, measurements, keyframes, adMeta: null };

  const planOnly = process.argv.includes('--plan-only');
  const transport = new SdkClaudeTransport(client, { model, effort, fallbacks: true });
  const costs = new MemoryCostStore();
  let td: TeardownDraft & Usage;
  if (planOnly) {
    td = { language: 'en', sections: mockTeardown('PT_BR', words, measurements, null, frames.length), costUsd: 0 };
    console.log('plan-only: teardown determinístico (mock) com a transcrição e as medições reais');
    if (!yes) return;
  } else {
  // 2. estimativa (count_tokens é grátis)
  const cap = new Capture();
  await new ClaudeLiveService(cap, new MemoryCostStore(), { model, fetchImpl: localFetch }).analyzeChampion(input, () => undefined).catch(() => undefined);
  // 2 chamadas: fatos (com frames) e diagnóstico (sem frames, + ~3k de fatos); a 2ª lê o prefixo do cache
  const inA = await countIn(client, cap.calls[0]);
  const estA = usd(inA, 6000) + usd(inA - (cap.calls[0].images?.length ?? 0) * 450 + 3000, 4000);
  console.log(`analyzeChampion: ${inA} tokens de entrada na 1ª (contados) + 2ª sem frames; ~10000 de saída (estimado) ≈ US$ ${estA.toFixed(3)} (sem desconto de cache)`);
  if (!yes) return console.log(`(dry-run) rode com --yes pra gastar ≈ US$ ${estA.toFixed(3)} + o plano (teto US$ ${CAP_USD})`);

  // 3. analyzeChampion real (salva na hora: não pagar duas vezes se o plano falhar)
  const t0 = Date.now();
  td = await new ClaudeLiveService(transport, costs, { model, fetchImpl: localFetch }).analyzeChampion(input, () => undefined);
  const sum = (u: string) => Math.round(costs.entries.filter((e) => e.unit === u).reduce((a, e) => a + e.units, 0) * 1000) / 1000;
  console.log(`analyzeChampion OK em ${((Date.now() - t0) / 1000).toFixed(0)}s: US$ ${td.costUsd.toFixed(4)} (entrada ${sum('ktoken_in')} ktok, saída ${sum('ktoken_out')} ktok)`);
  for (const [k, s] of Object.entries(td.sections)) console.log(`  ${k}: ${s.status}${s.naReason ? ` (${s.naReason})` : ''}`);
  if (outPath) writeFileSync(outPath.replace(/\.json$/, '.teardown.json'), JSON.stringify({ teardown: td, costs: costs.entries }, null, 2));
  }

  // 4. planVariations: 1 gancho + 1 elenco (+ elenco compartilhado) = 3 chamadas
  const p = planParams(td.sections, words);
  const ctx = planContext({ offer, teardown: td.sections, transcript: words, hookEndSec: p.hookEndSec, notes: null });
  const inP = await countIn(client, { system: planSystem('en'), context: ctx, user: 'x'.repeat(900), schema: HOOK_SCHEMA, maxTokens: 1 });
  // 3 chamadas (gancho + elenco + elenco compartilhado); se não couber no teto, só o gancho + compartilhado (2)
  const per = usd(inP, 1500);
  const spentBefore = planOnly ? 0.2293 : 0; // análise real da rodada anterior (06/10), já paga
  const calls = planOnly ? 2 : td.costUsd + 3 * per <= CAP_USD ? 3 : td.costUsd + 2 * per <= CAP_USD ? 2 : 0;
  if (planOnly) console.log(`já gasto: análise US$ ${spentBefore} + esquemas ~0,039; plano estimado ~US$ ${(2 * per).toFixed(3)} (pior caso)`);
  console.log(`planVariations: ~${inP} tokens de entrada + ~1500 de saída por chamada ≈ US$ ${per.toFixed(3)} cada; cabem ${calls} no teto`);
  if (!calls) return console.log(`PARADO: análise real US$ ${td.costUsd.toFixed(3)} + plano estimado passa do teto US$ ${CAP_USD}`);
  const planCosts = new MemoryCostStore();
  const items: { kind: string; index: number; draft?: VariationItemDraft; error?: string }[] = [];
  let sharedCasting = '';
  const t1 = Date.now();
  const u = await new ClaudeLiveService(transport, planCosts, { model }).planVariations(
    { workspaceId: 'sonda', batchId: 'sonda', jobId: 'sonda', language: td.language, offer, teardown: td.sections, transcript: words, slots: calls === 3 ? [{ kind: 'NEW_HOOKS', index: 0 }, { kind: 'SWAP_AVATAR', index: 0 }] : [{ kind: 'NEW_HOOKS', index: 0 }], avoidLevers: [], notes: null },
    {
      onSharedCasting: (d) => (sharedCasting = d),
      onItemDone: (kind, index, draft) => items.push({ kind, index, draft }),
      onItemFailed: (kind, index, error) => items.push({ kind, index, error }),
    },
  );
  console.log(`planVariations OK em ${((Date.now() - t1) / 1000).toFixed(0)}s: US$ ${u.costUsd.toFixed(4)}`);
  console.log(JSON.stringify({ sharedCasting, items }, null, 2));
  console.log(`TOTAL REAL: US$ ${(td.costUsd + u.costUsd).toFixed(4)}`);
  if (outPath) writeFileSync(outPath, JSON.stringify({ measurements, keyframes: keyframes.map((k) => ({ atSec: k.atSec, reason: k.reason })), teardown: td, plan: { sharedCasting, items }, costs: [...costs.entries, ...planCosts.entries] }, null, 2));
}

main().catch((e) => {
  console.error('FALHOU:', e);
  process.exit(1);
});
