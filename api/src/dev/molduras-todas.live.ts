// Ligação real do script das 18 molduras (molduras-todas.ts): contexto Nest MÍNIMO (config + Prisma + custos; sem o
// AppModule, pra não subir fila de render, retomada nem crons ao lado da API que está no ar), Prisma no banco local e a
// chamada de detalhe da moldura pelo mesmo transporte/sistema/esquema da ia. Fora dos testes (lá entram fakes).
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import Anthropic from '@anthropic-ai/sdk';
import type { FrameTemplateId } from '@maquina/contratos';
import type { Prisma } from '@prisma/client';
import { editMapOf, measurementsOf, sectionsOf, transcriptOf } from '../campeoes/champion-views';
import { num } from '../common/util/format';
import { AppConfigModule } from '../config/config.module';
import { initialState } from '../criativos/state-machine';
import { CustosModule } from '../custos/custos.module';
import { CustosService } from '../custos/custos.service';
import { AUTO_EDIT_TEMPLATE, PRIORITY_BATCH, engineFor } from '../edicao/pecas';
import { AUTO_PLAN_SYSTEM, autoPlanContext, languageName } from '../integracoes/claude/auto-plano';
import { FRAME_DETAIL_SCHEMA, framesDetailMessage } from '../integracoes/claude/auto-plano-detalhe';
import { FRAME_TEMPLATES } from '../integracoes/claude/auto-plano-moldura';
import { recordLlmCost } from '../integracoes/claude/custo';
import { SdkClaudeTransport } from '../integracoes/claude/transporte';
import { parseJsonObject } from '../integracoes/claude/validacao-campeao';
import type { AutoPlanInput } from '../integracoes/contrato';
import { PrismaCostStore } from '../integracoes/store/prisma.store';
import { planCtxOf } from '../iteracao/contexto';
import { regrasDeMidiaFallback } from '../iteracao/portas';
import { draftOf } from '../ofertas/ofertas.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ALVO, RENDER_USD_PADRAO, type Deps, type EscritorDeTextos, type FrameExistente, type LoteDados } from './molduras-todas';

@Module({ imports: [AppConfigModule, PrismaModule, CustosModule] })
class MoldurasDevModule {}

const MAX_KEYFRAMES = 8;

export async function reais(): Promise<{ deps: Deps; fechar: () => Promise<void> }> {
  const app = await NestFactory.createApplicationContext(MoldurasDevModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);
  const custos = app.get(CustosService);
  const cfg = app.get(ConfigService);
  const model = cfg.get<string>('ANTHROPIC_MODEL') || 'claude-opus-5-5';

  const carregar = async (): Promise<LoteDados> => {
    const b = await prisma.variationBatch.findUniqueOrThrow({
      where: { id: ALVO.batchId },
      include: { offer: true, workspace: true, createdBy: { select: { uiLocale: true } }, champion: { include: { teardown: true } } },
    });
    const teardown = b.champion.teardown;
    if (b.workspaceId !== ALVO.workspaceId) throw new Error(`lote em outro workspace (${b.workspaceId})`);
    if (b.mode !== 'AUTO') throw new Error(`lote não é AUTO (${b.mode})`);
    if (!teardown || teardown.id !== ALVO.teardownId) throw new Error(`teardown do campeão não é o esperado (${teardown?.id ?? 'nenhum'})`);
    const sections = sectionsOf(teardown.sections);
    if (!sections) throw new Error('campeão sem teardown');
    const m = measurementsOf(teardown.measurements);
    const transcript = transcriptOf(teardown.transcript);
    const ctx0 = planCtxOf({ offer: b.offer, workspace: b.workspace, champion: b.champion, teardown }, regrasDeMidiaFallback, { captured: false });
    const ctx = { ...ctx0, screenLanguage: ALVO.screenLanguage };
    const kfs = m?.keyframes ?? [];
    const step = Math.max(1, Math.ceil(kfs.length / MAX_KEYFRAMES));
    const input: AutoPlanInput = {
      workspaceId: b.workspaceId, batchId: b.id, jobId: 'dev-molduras-todas', uiLocale: b.createdBy.uiLocale,
      screenLanguage: ALVO.screenLanguage, offer: draftOf(b.offer),
      workspace: { name: b.workspace.name, industry: b.workspace.industry, market: b.workspace.market },
      // a captura da Amnayalife está quebrada (Gusta, 25/10): sem página, como um lote sem captura
      page: { captured: false, text: null },
      teardown: sections, transcript: transcript?.words ?? [],
      media: { durationSec: ctx.durationSec, cuts: m?.cuts?.length ?? 0, silences: ctx.silences, hasWrittenHook: ctx.hasWrittenHook, hasEndCard: ctx.hasEndCard },
      keyframes: kfs.filter((_, i) => i % step === 0).slice(0, MAX_KEYFRAMES).map((k) => ({ atSec: k.atSec, reason: k.reason, url: '' })),
      allowed: [{ type: 'FRAME', max: FRAME_TEMPLATES.length }],
      allowedFrames: [...FRAME_TEMPLATES],
      rules: { min: 1, max: FRAME_TEMPLATES.length, minDiversityPct: 40 },
    };
    const items = await prisma.variationItem.findMany({
      where: { batchId: b.id, kind: 'AUTO_EDIT' },
      include: { creative: { include: { renders: { where: { stale: false, format: 'VERTICAL_9_16' }, orderBy: { createdAt: 'desc' }, take: 1 } } } },
      orderBy: { index: 'asc' },
    });
    const existentes: FrameExistente[] = items
      .filter((i) => i.autoType === 'FRAME')
      .map((i) => ({
        template: ((i.payload as { params?: { template?: string } } | null)?.params?.template ?? '') as FrameTemplateId,
        code: i.code ?? '', index: i.index, render: (i.creative?.renders[0]?.status ?? null) as FrameExistente['render'],
        itemId: i.id, creativeId: i.creative?.id ?? null, creativeState: i.creative?.state ?? null,
      }));
    const whyRows = ((b.insight as { why?: { key: string; text: string }[] } | null)?.why ?? []);
    const renderCost = await prisma.costEntry.aggregate({ where: { variationBatchId: b.id, kind: 'RENDER' }, _max: { amountUsd: true } });
    return {
      batchId: b.id, workspaceId: b.workspaceId, offerId: b.offerId, championId: b.championId, championName: b.champion.name,
      language: b.language, createdById: b.createdById, offer: draftOf(b.offer), ctx, input, editMap: editMapOf(teardown.editMap),
      whys: Object.fromEntries(whyRows.map((w) => [w.key, w.text])),
      existentes, codigos: items.map((i) => i.code).filter((c): c is string => !!c),
      maxIndex: items.reduce((a, i) => Math.max(a, i.index), -1),
      renderUsd: num(renderCost._max.amountUsd) ?? RENDER_USD_PADRAO,
      model,
    };
  };

  const escritor = (lote: LoteDados): EscritorDeTextos => {
    const apiKey = cfg.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY vazio no api/.env');
    const effort = (cfg.get<string>('ANTHROPIC_EFFORT') || 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    const transport = new SdkClaudeTransport(new Anthropic({ apiKey, maxRetries: 2 }), {
      model, effort, fallbacks: (cfg.get<string>('ANTHROPIC_FALLBACKS') ?? 'on').toLowerCase() !== 'off',
    });
    const costs = new PrismaCostStore(prisma);
    const context = autoPlanContext(lote.input);
    const screenLanguage = languageName(lote.ctx.screenLanguage ?? 'en');
    return {
      async escrever(alvo, outros) {
        const res = await transport.run({
          system: AUTO_PLAN_SYSTEM, context, schema: FRAME_DETAIL_SCHEMA, maxTokens: 16000,
          user: framesDetailMessage([alvo], { screenLanguage, whys: lote.whys }), // 25/10: a ia agora escreve N molduras por chamada; aqui 1
        });
        const costUsd = await recordLlmCost(costs, { workspaceId: lote.workspaceId, variationBatchId: lote.batchId, model }, res.usage);
        if (res.stopReason === 'refusal') throw new Error('claude declined (refusal)');
        if (res.stopReason === 'max_tokens') throw new Error('claude hit max_tokens');
        const r = parseJsonObject(res.text);
        const first = Array.isArray(r.frames) ? (r.frames as Record<string, unknown>[])[0] : (r.frame as Record<string, unknown> | undefined);
        const frame = first && typeof first === 'object' ? first : {};
        return { frame, costUsd };
      },
    };
  };

  const gravar: Deps['gravar'] = async (lote, pecas) => {
    const t0 = Date.now();
    return prisma.$transaction(async (tx) => {
      const out: { code: string; itemId: string; creativeId: string; renderId: string }[] = [];
      for (const [seq, p] of pecas.entries()) {
        const item = await tx.variationItem.create({
          data: {
            workspaceId: lote.workspaceId, batchId: lote.batchId, kind: 'AUTO_EDIT', index: p.index, status: 'READY', rationale: p.rationale,
            payload: { params: p.params, whyKey: p.whyKey, dev: 'molduras-todas' } as unknown as Prisma.InputJsonValue,
            autoType: 'FRAME', code: p.code, axis: 'DIVERSITY', change: p.change, inZip: true,
          },
        });
        const c = await tx.creative.create({
          data: {
            workspaceId: lote.workspaceId, offerId: lote.offerId, name: `${lote.championName} · ${p.code}`,
            language: lote.language, state: initialState('AUTO_PIECE_START'), createdById: lote.createdById,
            origin: 'VARIATION', championId: lote.championId, variationBatchId: lote.batchId, variationItemId: item.id,
            variationKind: 'AUTO_EDIT', variationCode: p.code, voiceSource: 'CHAMPION_AUDIO', format: 'VERTICAL_9_16',
          },
        });
        // mesma fila do start do lote: 9:16, priority 0, createdAt em ordem (a API no ar tira no próximo ciclo do poller)
        const r = await tx.render.create({
          data: {
            workspaceId: lote.workspaceId, creativeId: c.id, status: 'QUEUED', format: 'VERTICAL_9_16', engine: engineFor('FRAME'),
            priority: PRIORITY_BATCH, settings: { templateId: AUTO_EDIT_TEMPLATE }, input: {}, createdAt: new Date(t0 + seq),
          },
        });
        out.push({ code: p.code, itemId: item.id, creativeId: c.id, renderId: r.id });
      }
      return out;
    });
  };

  const deps: Deps = {
    carregar,
    escritor,
    tetoDoWorkspace: (ws, usd) => custos.assertWithinCap(ws, usd),
    gravar,
    // --rerender (25/10): 2ª fonte zerada nas de 2 fontes (a API resolve na ordem nova: Pexels › imagem › trecho do
    // campeão), renders antigos ficam stale, 9:16 novo QUEUED prioridade 10; peça falha volta pra RENDERING (assenta sozinha)
    rerenderizar: async (lote, linhas) => prisma.$transaction(async (tx) => {
      const out: { code: string; renderId: string }[] = [];
      for (const l of linhas) {
        const item = await tx.variationItem.findUniqueOrThrow({ where: { id: l.itemId }, select: { payload: true } });
        const payload = (item.payload ?? {}) as { params?: Record<string, unknown> };
        if (l.duasFontes) {
          await tx.variationItem.update({
            where: { id: l.itemId },
            data: { payload: { ...payload, params: { ...(payload.params ?? {}), second: null, secondNote: null } } as unknown as Prisma.InputJsonValue, errorCode: null, failReason: null, leftOutAt: null },
          });
        }
        if (l.creativeState === 'RENDER_FAILED') {
          await tx.creative.update({ where: { id: l.creativeId }, data: { state: 'RENDERING' } });
        }
        await tx.render.updateMany({ where: { creativeId: l.creativeId, format: 'VERTICAL_9_16', stale: false, status: { in: ['FAILED'] } }, data: { stale: true } });
        const r = await tx.render.create({
          data: {
            workspaceId: lote.workspaceId, creativeId: l.creativeId, status: 'QUEUED', format: 'VERTICAL_9_16', engine: engineFor('FRAME'),
            priority: 10, settings: { templateId: AUTO_EDIT_TEMPLATE }, input: {},
          },
          select: { id: true },
        });
        out.push({ code: l.code, renderId: r.id });
      }
      return out;
    }),
    log: (s) => console.log(s),
  };
  return { deps, fechar: () => app.close() };
}
