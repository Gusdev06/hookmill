// Sonda live do plano de COLD_OPEN e ENDCARD no lote de template (templates-creditos-v1 A6, 01/11). SÓ o PLANO (Claude):
// sem render, sem WaveSpeed, sem Lambda, sem banco. O campeão é FICTÍCIO e agnóstico, montado em memória (transcrição com
// tempos, estrutura do mock, Brain), e o AutoPlanInput sai como o PlanoAutoService monta pro lote de template (allowed
// restrito à chave, rules 1..1, variantes do end card pelo Brain). Custo em memória, nada gravado.
// Uso (de api/):  npx ts-node --transpile-only src/integracoes/sondas/sonda-plano-a6.ts [--yes]
// Sem --yes: só conta os tokens de entrada (count_tokens, grátis) e estima. Teto do conjunto: US$ 0,10 (ok do Gusta 01/11).
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { regrasDeMidiaFallback } from '../../iteracao/portas';
import {
  type PlanCtx, allowedFor, endcardVariants, finalizePlan, templateOnlyTypesOf, validatePlan,
} from '../../iteracao/regras';
import { restrictToTemplate } from '../../iteracao/templates-lote';
import { AUTO_PLAN_SYSTEM, autoPlanContext, autoPlanSchemaFor, autoPlanUserMessage } from '../claude/auto-plano';
import { ClaudeLiveService } from '../claude/claude.service';
import { SdkClaudeTransport } from '../claude/transporte';
import type { AutoPlanInput, Measurements, OfferBriefDraft, TranscriptWord } from '../contrato';
import { mockTeardown } from '../mock/fake-claude.service';
import { MemoryCostStore } from '../store/memoria.store';

const TETO_USD = 0.1;

function speak(sentences: string[], start = 0.2): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  let t = start;
  for (const s of sentences) {
    for (const w of s.split(' ')) {
      out.push({ word: w, startSec: Math.round(t * 1000) / 1000, endSec: Math.round((t + 0.3) * 1000) / 1000 });
      t += 0.38;
    }
    t += 0.6;
  }
  return out;
}
// anúncio fictício (agnóstico): rotina noturna pra dor nas costas, criadora falando pra câmera
const WORDS = speak([
  'If your back hurts every single morning, watch this.',
  'I tried new pillows, stretches and pills and nothing worked.',
  'Then a physiotherapist showed me a five minute routine before bed.',
  'The first night I woke up and for once nothing hurt.',
  'My neighbor tried it too and she sleeps through the night now.',
  'Tap the link below and start it tonight.',
]);
const DUR = Math.ceil(WORDS[WORDS.length - 1].endSec + 0.6);
const M: Omit<Measurements, 'keyframes'> = { durationSec: DUR, width: 1080, height: 1920, fps: 30, hasAudio: true, cuts: [{ atSec: 4, kind: 'content' }], segments: [], palette: ['#ffffff'], silences: [] };
const OFFER: OfferBriefDraft = {
  name: 'Calma', language: 'en', kind: 'App', what: 'A five minute night routine for back pain.', audience: 'Adults who wake up with back pain',
  promise: 'Wake up without back pain', pains: 'Stiff back every morning', proof: '"I slept the whole night for the first time." Ana, verified buyer',
  offerAndPrice: '7-day free trial, then $9/month. 30-day money-back guarantee.', cta: 'Start your free trial tonight', notes: null,
};

async function main() {
  const yes = process.argv.includes('--yes');
  const model = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 });
  const teardown = mockTeardown('EN', WORDS, M, null, 8);
  const blocks = teardown.structure.data!.blocks.map((b, index) => ({ index, label: b.label, fn: b.function, startSec: b.startSec, endSec: b.endSec }));
  const gaps = WORDS.slice(1).map((w, k) => ({ startSec: WORDS[k].endSec, endSec: w.startSec })).filter((g) => g.endSec - g.startSec >= 0.3);
  const base: PlanCtx = {
    lang: 'EN', durationSec: DUR, blocks, hasSpeech: true, words: WORDS, silences: gaps, hasWrittenHook: false, hasEndCard: false,
    brain: { what: OFFER.what, audience: OFFER.audience, pains: OFFER.pains, promise: OFFER.promise, proof: OFFER.proof, offerAndPrice: OFFER.offerAndPrice, cta: OFFER.cta, notes: null },
    spokenCta: 'Tap the link below and start it tonight.', pageCaptured: false, productPhoto: false, brandTerms: ['Calma'], screenLanguage: 'en-US',
    offerName: OFFER.name, offerKind: OFFER.kind, candidatePlan: true,
  };
  let gasto = 0;
  let lastOut: number | null = null;
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  for (const key of (['COLD_OPEN', 'ENDCARD'] as const).filter((k) => !only || k === only)) {
    const ctx: PlanCtx = { ...base, templateOnlyTypes: templateOnlyTypesOf([key]), planRules: { min: 1, max: 1 } };
    const allowed = restrictToTemplate(ctx, allowedFor(ctx), { keys: [key] }).allowed;
    const input = {
      workspaceId: 'sonda', batchId: 'sonda-a6', jobId: `sonda-a6-${key}`, uiLocale: 'PT_BR', screenLanguage: 'en-US', offer: OFFER,
      workspace: { name: 'Calma', industry: 'health', market: 'US' }, page: { captured: false, text: null }, teardown, transcript: WORDS,
      media: { durationSec: DUR, cuts: 1, silences: gaps, hasWrittenHook: false, hasEndCard: false },
      keyframes: [], allowed: allowed.map((a) => ({ type: a.type, max: a.max })), allowedFrames: [],
      rules: { min: 1, max: 1, minDiversityPct: 0 },
      ...(key === 'ENDCARD' && { endcardVariants: endcardVariants(ctx) }),
    } as unknown as AutoPlanInput;
    console.log(`\n== ${key}: allowed=${JSON.stringify(input.allowed)} variants=${JSON.stringify(input.endcardVariants ?? null)} dur=${DUR}s blocos=${blocks.length}`);
    if (!allowed.some((a) => a.max > 0)) {
      console.log('  não cabe: nada a planejar');
      continue;
    }
    const ct = await client.messages.countTokens({
      model, system: AUTO_PLAN_SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: autoPlanContext(input) }, { type: 'text', text: autoPlanUserMessage(input) }] }],
      output_config: { format: { type: 'json_schema', schema: autoPlanSchemaFor(input) as Record<string, unknown> } },
    } as Parameters<typeof client.messages.countTokens>[0]);
    // 1ª chamada: tudo como escrita de cache (1,25 × US$ 4/M) + ~2 mil de saída (US$ 20/M). Depois da 1ª: sistema e
    // contexto (iguais) saem do cache (US$ 0,20/M), ~1 mil tokens novos e a saída medida + 30 %
    const est = lastOut == null
      ? (ct.input_tokens * 5 + 2000 * 20) / 1e6
      : ((ct.input_tokens - 1000) * 0.2 + 1000 * 5 + lastOut * 1.3 * 20) / 1e6;
    console.log(`  entrada ${ct.input_tokens} tokens; estimativa ≤ US$ ${est.toFixed(4)}; gasto até aqui US$ ${gasto.toFixed(4)}`);
    if (!yes) continue;
    if (gasto + est > TETO_USD) {
      console.log(`  PULADO: passaria do teto de US$ ${TETO_USD}`);
      continue;
    }
    const costs = new MemoryCostStore();
    const sdk = new SdkClaudeTransport(client, { model, effort: 'medium', fallbacks: true });
    // registra a resposta crua e o custo de CADA chamada, mesmo quando o plano falha (1ª rodada de 01/11 caiu sem isso)
    const transport = {
      run: async (call: Parameters<SdkClaudeTransport['run']>[0]) => {
        const r = await sdk.run(call);
        console.log(`  resposta crua (stop=${r.stopReason}, uso=${JSON.stringify(r.usage)}): ${r.text.slice(0, 1500)}`);
        return r;
      },
    } as unknown as SdkClaudeTransport;
    const svc = new ClaudeLiveService(transport, costs, { model });
    const t0 = Date.now();
    const spent = () => costs.entries.reduce((n, e) => n + Number(e.amountUsd), 0);
    let out: Awaited<ReturnType<ClaudeLiveService['planAutoBatch']>>;
    try {
      out = await svc.planAutoBatch(input, () => undefined);
    } catch (e) {
      gasto += spent();
      console.log(`  FALHOU: ${(e as Error).message}; custo medido US$ ${spent().toFixed(4)} (total US$ ${gasto.toFixed(4)})`);
      break;
    }
    gasto += out.costUsd;
    lastOut = Math.round(costs.entries.filter((e) => e.unit === 'ktoken_out').reduce((n, e) => n + Number(e.units), 0) * 1000);
    console.log(`  OK em ${((Date.now() - t0) / 1000).toFixed(0)}s, custo medido US$ ${out.costUsd} (total US$ ${gasto.toFixed(4)})`);
    console.log(`  lançamentos de custo: ${JSON.stringify(costs.entries)}`.slice(0, 900));
    console.log(`  why: ${JSON.stringify(out.why)}`);
    for (const it of out.items) console.log(`  item ${it.type}: change="${it.change}" whyKey=${it.whyKey} rationale="${it.rationale}"\n    params=${JSON.stringify(it.params)}`);
    const v = validatePlan(out, ctx, allowed);
    console.log(`  violações do regras.ts: ${v.length ? JSON.stringify(v) : 'nenhuma'}`);
    if (!v.length) console.log(`  final: ${JSON.stringify(finalizePlan(out, ctx, regrasDeMidiaFallback).map((f) => ({ code: f.code, params: f.params })))}`);
    const co = out.items.find((x) => x.params.type === 'COLD_OPEN');
    if (co && co.params.type === 'COLD_OPEN') {
      const { teaserStartSec: a, teaserEndSec: b } = co.params;
      console.log(`  fala do teaser: "${WORDS.filter((w) => w.startSec >= a - 0.05 && w.endSec <= b + 0.05).map((w) => w.word).join(' ')}"`);
    }
  }
  console.log(`\ncusto total medido: US$ ${gasto.toFixed(4)}${yes ? '' : ' (nada rodou: passe --yes)'}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
