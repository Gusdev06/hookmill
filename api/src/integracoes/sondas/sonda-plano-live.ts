// Prova live do planAutoBatch em 2 etapas (bug "compiled grammar is too large", 25/10). SÓ LEITURA no banco: monta o
// AutoPlanInput de um lote existente como o PlanoAutoService monta (sem captura de página nova e sem frames-chave, pra
// não tocar no storage), chama a Anthropic de verdade e mostra itens, violações do regras.ts e custo. NÃO grava nada,
// NÃO muda status do lote, custo em memória. Uso (de api/):
//   npx ts-node --transpile-only src/integracoes/sondas/sonda-plano-live.ts <batchId> --yes      (~US$ 0,30; teto 0,50)
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import { editMapOf, measurementsOf, sectionsOf, transcriptOf } from '../../campeoes/champion-views';
import { planCtxOf } from '../../iteracao/contexto';
import { regrasDeMidiaFallback } from '../../iteracao/portas';
import { allowedFor, allowedFrameIds, rulesFor, validatePlan } from '../../iteracao/regras';
import { draftOf } from '../../ofertas/ofertas.service';
import { ClaudeLiveService } from '../claude/claude.service';
import { FRAME_TWO_SOURCE } from '../claude/auto-plano-moldura';
import { SdkClaudeTransport } from '../claude/transporte';
import type { AutoPlanInput } from '../contrato';
import { MemoryCostStore } from '../store/memoria.store';

async function main() {
  const batchId = process.argv[2];
  if (!batchId || batchId.startsWith('--')) throw new Error('passe o batchId');
  const prisma = new PrismaClient();
  try {
    const b = await prisma.variationBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: { offer: true, workspace: true, createdBy: { select: { uiLocale: true } }, champion: { include: { teardown: true } } },
    });
    const teardown = b.champion.teardown!;
    const sections = sectionsOf(teardown.sections)!;
    const captured = !!b.pageCaptureFileId;
    const ctx = planCtxOf({ offer: b.offer, workspace: b.workspace, champion: b.champion, teardown }, regrasDeMidiaFallback, { captured });
    // catálogo novo (25/10): CUT, REVIEW, NATIVE_SEARCH, STATIC (2) e FRAME (8, templates diferentes, com as 6 de 2 fontes).
    // A sonda aplica isso por cima do allowedFor do backend (que muda em paralelo); --catalogo-backend usa o dele cru.
    // headline-e-legenda-v1 §1.2: a sonda monta o `headline` do input do editMap como o backend fará (maior camada
    // headline; senão `text` ≥ 50 % da duração fora do terço de baixo); sem camada = modo add
    const em = editMapOf(teardown.editMap);
    const mm = measurementsOf(teardown.measurements);
    const total = Math.max(1, Math.round((mm?.durationSec ?? 1) * (mm?.fps ?? 30)));
    const frameH = mm?.height ?? 1920;
    const cands = (em?.layers ?? []).filter((l) => l.text && (l.kind === 'headline' || (l.kind === 'text' && (l.endFrame - l.startFrame) / total >= 0.5 && l.box.y < frameH * 0.66)));
    const hlLayer = cands.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0] ?? null;
    const language = b.champion.language || transcriptOf(teardown.transcript)?.language || b.offer.language;
    const headline = hlLayer
      ? { mode: 'replace' as const, original: hlLayer.text, lines: Math.max(1, Math.round(hlLayer.box.h / (hlLayer.style.fontSizePx * hlLayer.style.lineHeight))), maxChars: Math.min(90, Math.max(20, Math.round((hlLayer.text ?? '').length * 1.2))), hasHighlight: !!hlLayer.style.highlightColor, language }
      : { mode: 'add' as const, original: null, lines: 2, maxChars: 60, hasHighlight: false, language: b.offer.language };
    if (hlLayer) console.log(`headline lida: "${hlLayer.text}" estilo=${JSON.stringify(hlLayer.style)} fundo=${JSON.stringify(hlLayer.background)} frames ${hlLayer.startFrame}-${hlLayer.endFrame}/${total}`);
    console.log(`input.headline=${JSON.stringify(headline)}`);
    const NEW: Record<string, number> = { HEADLINE: headline.mode === 'replace' ? 3 : 2, CUT: 2, REVIEW: 1, NATIVE_SEARCH: 2, STATIC: 2, FRAME: 8 };
    const allowed = process.argv.includes('--catalogo-backend')
      ? allowedFor(ctx)
      : [{ type: 'HEADLINE', max: NEW.HEADLINE } as unknown as ReturnType<typeof allowedFor>[number], ...allowedFor(ctx).filter((a) => a.type in NEW && (a.type as string) !== 'HEADLINE').map((a) => ({ ...a, max: Math.min(NEW[a.type], a.max > 0 ? NEW[a.type] : 0) }))];
    const m = measurementsOf(teardown.measurements);
    const transcript = transcriptOf(teardown.transcript);
    const input = {
      workspaceId: b.workspaceId, batchId: b.id, jobId: 'sonda-plano-live',
      uiLocale: b.createdBy.uiLocale,
      screenLanguage: b.champion.language || transcript?.language || b.offer.language,
      offer: draftOf(b.offer),
      workspace: { name: b.workspace.name, industry: b.workspace.industry, market: b.workspace.market },
      page: { captured, text: null },
      teardown: sections, transcript: transcript?.words ?? [],
      media: { durationSec: ctx.durationSec, cuts: m?.cuts?.length ?? 0, silences: ctx.silences, hasWrittenHook: ctx.hasWrittenHook, hasEndCard: ctx.hasEndCard },
      keyframes: [],
      allowed: allowed.map((a) => ({ type: a.type, max: a.max })),
      allowedFrames: [...new Set([...allowedFrameIds(ctx), ...(process.argv.includes('--catalogo-backend') ? [] : FRAME_TWO_SOURCE)])],
      rules: rulesFor(allowed),
      headline,
    } as unknown as AutoPlanInput;
    console.log(`lote ${b.id} status=${b.status} teardown=${teardown.id} allowed=${JSON.stringify(input.allowed)} frames=${JSON.stringify((input as unknown as { allowedFrames: string[] }).allowedFrames)}`);
    if (!process.argv.includes('--yes')) return console.log('nada rodou (passe --yes)');

    const costs = new MemoryCostStore();
    const transport = new SdkClaudeTransport(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2 }), {
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', effort: 'medium', fallbacks: true,
    });
    const svc = new ClaudeLiveService(transport, costs, { model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5' });
    const t0 = Date.now();
    const out = await svc.planAutoBatch(input, () => undefined);
    console.log(`OK em ${((Date.now() - t0) / 1000).toFixed(0)}s, custo US$ ${out.costUsd}, ${costs.entries.length / 2} chamada(s)`);
    for (const it of out.items) console.log(`  ${it.type.padEnd(13)} ${JSON.stringify(it.params).slice(0, 220)}`);
    const frames = out.items.filter((x) => (x.type as string) === 'FRAME').map((x) => x.params as unknown as { template: string; texts: Record<string, unknown>; sources: Record<string, string> });
    for (const h of out.items.filter((x) => (x.type as string) === 'HEADLINE')) console.log(`HEADLINE: ${JSON.stringify(h.params)} (${(h.params as unknown as { text: string }).text.length}/${headline.maxChars} caracteres)`);
    console.log(`molduras: ${frames.length} → ${frames.map((f) => f.template).join(', ')}`);
    for (const f of frames.filter((x) => x.template === 'ranking')) console.log(`ranking: items=${JSON.stringify(f.texts.items)} sources=${JSON.stringify(f.sources)}`);
    const v = validatePlan(out, ctx, allowed);
    console.log(`violações do regras.ts: ${v.length ? JSON.stringify(v).slice(0, 800) : 'nenhuma'}`);
    const after = await prisma.variationBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } });
    console.log(`status do lote depois: ${after.status} (sem mudança: ${after.status === b.status})`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
