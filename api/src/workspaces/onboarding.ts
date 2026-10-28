// Onboarding v2 (docs/contratos/onboarding-v2.md §2, D5): o estado de cada passo e o % são DERIVADOS do conteúdo, numa
// função só, usada pelo GET /workspace, pelo cartão do Clients, pela Home e pela sessão (GET /auth/me, em lote, sem N+1).
// Nada aqui grava status: `onboardingStep` continua dizendo só onde retomar; `onboardingCompletedAt` continua o único
// marcador de "concluído".
import { Injectable } from '@nestjs/common';
import type { Onboarding, OnboardingStep, OnboardingStepInfo, OnboardingSummary, UserRef } from '@maquina/contratos';
import type { Prisma, Workspace } from '@prisma/client';
import { initials } from '../common/util/format';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { ONBOARDING_STEPS, onboardingOf } from './cliente';

export type StepKey = OnboardingStepInfo['key'];
/** Ordem fixa dos 6 passos (fase2-agencia §3.3): 1 business, 2 meta, 3 offer, 4 audience, 5 goals, 6 brain. */
export const STEP_KEYS: readonly StepKey[] = ['business', 'meta', 'offer', 'audience', 'goals', 'brain'];

/** Nome que o cadastro dá ao 1º cliente quando a pessoa não informa (auth.service): não conta como "preenchido". */
export const DEFAULT_CLIENT_NAME = 'New client';

/** O que o cálculo precisa saber além da linha do workspace (vem em lote). */
export interface OnboardingFacts {
  /** ≥ 1 oferta ativa com `what` e `promise` */
  offerComplete: boolean;
  /** alguma oferta ativa com `audience` */
  audience: boolean;
  /** conexão Meta ACTIVE com conta e página escolhidas */
  metaConnected: boolean;
}
export const NO_FACTS: OnboardingFacts = { offerComplete: false, audience: false, metaConnected: false };

export type OnboardingWs = Pick<Workspace, 'name' | 'resultType' | 'monthlySpendCapUsd' | 'onboardingStep' | 'onboardingCompletedAt'>;

/** Um passo está preenchido? (tabela do §2) */
function isDone(key: StepKey, ws: OnboardingWs, f: OnboardingFacts): boolean {
  switch (key) {
    case 'business': return ws.resultType != null && ws.name.trim() !== '' && ws.name.trim() !== DEFAULT_CLIENT_NAME;
    case 'meta': return f.metaConnected;
    case 'offer': return f.offerComplete;
    case 'audience': return f.audience;
    case 'goals': return ws.monthlySpendCapUsd != null;
    case 'brain': return ws.onboardingCompletedAt != null;
  }
}

/**
 * Os 6 passos com estado derivado. `enabled: false` só no meta com META_MODE=off (o web não mostra; o wizard vira 5).
 * `skipped`: só o meta, quando a pessoa já passou dele (ou concluiu) sem conectar.
 */
export function onboardingSteps(ws: OnboardingWs, facts: OnboardingFacts, metaEnabled: boolean): OnboardingStepInfo[] {
  const current = onboardingOf(ws).step;
  const completed = ws.onboardingCompletedAt != null;
  return STEP_KEYS.map((key, i) => {
    const step = (i + 1) as OnboardingStep;
    const enabled = key !== 'meta' || metaEnabled;
    let state: OnboardingStepInfo['state'];
    if (isDone(key, ws, facts)) state = 'done';
    else if (key === 'meta' && (completed || current > step)) state = 'skipped';
    else if (!completed && current === step) state = 'current';
    else state = 'todo';
    return { step, key, state, enabled };
  });
}

/**
 * `completedAt ? 100 : round(counted / passos habilitados × 100)` (§2 + D10, 21/10). `counted` = passos `enabled` com
 * `state: 'done'` E `step < onboardingStep`: o Continue do passo N grava N+1, então "já alcançado" = o usuário salvou o
 * passo no wizard. O teto padrão do cadastro (goals `done` desde o 1º segundo) não conta até a pessoa passar pelo passo 5;
 * conta nova = 0 %. O `state` de cada item NÃO muda (goals segue `done` no trilho); `skipped` não conta. Borda aceita:
 * voltar pelo trilho e clicar Continue regrava `onboardingStep` menor e o % cai até avançar de novo.
 */
export function onboardingPercent(steps: OnboardingStepInfo[], completedAt: Date | string | null, onboardingStep: number): number {
  if (completedAt) return 100;
  const enabled = steps.filter((s) => s.enabled);
  if (!enabled.length) return 0;
  const counted = enabled.filter((s) => s.state === 'done' && s.step < onboardingStep).length;
  return Math.round((counted / enabled.length) * 100);
}

export interface OnboardingCalc { steps: OnboardingStepInfo[]; percent: number }

export function onboardingCalc(ws: OnboardingWs, facts: OnboardingFacts, metaEnabled: boolean): OnboardingCalc {
  const steps = onboardingSteps(ws, facts, metaEnabled);
  return { steps, percent: onboardingPercent(steps, ws.onboardingCompletedAt, ws.onboardingStep) };
}

/** Versão curta pro seletor de cliente (WorkspaceRef.onboarding). */
export function onboardingSummaryOf(ws: OnboardingWs, calc: OnboardingCalc): OnboardingSummary {
  const o = onboardingOf(ws);
  return { step: o.step, percent: calc.percent, completedAt: o.completedAt };
}

export type UpdatedByRow = { id: string; name: string } | null | undefined;

/** `Onboarding` completo do contrato (GET /workspace, cartão do Clients). */
export function onboardingFull(
  ws: OnboardingWs & Pick<Workspace, 'onboardingUpdatedAt'>, calc: OnboardingCalc, updatedBy: UpdatedByRow,
): Onboarding {
  const ref: UserRef | null = updatedBy ? { id: updatedBy.id, name: updatedBy.name, initials: initials(updatedBy.name) } : null;
  return {
    ...onboardingOf(ws),
    totalSteps: ONBOARDING_STEPS,
    percent: calc.percent,
    steps: calc.steps,
    updatedBy: ref,
    updatedAt: ws.onboardingUpdatedAt?.toISOString() ?? null,
  };
}

type Db = Pick<PrismaService, 'offer' | 'metaConnection' | 'workspace'> | Prisma.TransactionClient;

/**
 * Lê os fatos de N workspaces em 2 queries (1 de ofertas ativas, 1 de conexões Meta) e grava "quem mexeu por último
 * no setup" (§1). É a única porta de entrada dos módulos pro cálculo, pra o número ser igual em toda tela.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  get metaEnabled(): boolean {
    return this.config.metaEnabled;
  }

  /** Fatos por workspace, sem N+1: ofertas ativas (what/promise/audience) + conexões ACTIVE com conta e página. */
  async facts(workspaceIds: string[], db: Db = this.prisma): Promise<Map<string, OnboardingFacts>> {
    const out = new Map<string, OnboardingFacts>(workspaceIds.map((id) => [id, { ...NO_FACTS }]));
    if (!workspaceIds.length) return out;
    const [offers, connections] = await Promise.all([
      db.offer.findMany({
        where: { workspaceId: { in: workspaceIds }, archivedAt: null, OR: [{ AND: [{ what: { not: null } }, { promise: { not: null } }] }, { audience: { not: null } }] },
        select: { workspaceId: true, what: true, promise: true, audience: true },
      }),
      db.metaConnection.findMany({
        where: { workspaceId: { in: workspaceIds }, status: 'ACTIVE', adAccountId: { not: null }, pageId: { not: null } },
        select: { workspaceId: true },
      }),
    ]);
    for (const o of offers) {
      const f = out.get(o.workspaceId);
      if (!f) continue;
      if (o.what?.trim() && o.promise?.trim()) f.offerComplete = true;
      if (o.audience?.trim()) f.audience = true;
    }
    for (const c of connections) {
      const f = out.get(c.workspaceId);
      if (f) f.metaConnected = true;
    }
    return out;
  }

  /** Passos + % de vários workspaces de uma vez (sessão, GET /auth/me, GET /workspaces). */
  async calcMany<W extends OnboardingWs & { id: string }>(workspaces: W[], db: Db = this.prisma): Promise<Map<string, OnboardingCalc>> {
    const facts = await this.facts(workspaces.map((w) => w.id), db);
    return new Map(workspaces.map((w) => [w.id, onboardingCalc(w, facts.get(w.id) ?? NO_FACTS, this.metaEnabled)]));
  }

  async calcOne(ws: OnboardingWs & { id: string }, db: Db = this.prisma): Promise<OnboardingCalc> {
    return (await this.calcMany([ws], db)).get(ws.id)!;
  }

  /** Grava onboardingUpdatedBy/At (PATCH /workspace, complete, ofertas em SETUP, PUT /meta/selection). */
  async touch(workspaceId: string, userId: string, db: Db = this.prisma): Promise<void> {
    await db.workspace.update({ where: { id: workspaceId }, data: { onboardingUpdatedById: userId, onboardingUpdatedAt: new Date() } });
  }

  /** Idem, só enquanto o workspace está em SETUP (ofertas e seleção da Meta fora do wizard não contam). */
  async touchIfSetup(workspaceId: string, userId: string, db: Db = this.prisma): Promise<boolean> {
    const r = await db.workspace.updateMany({
      where: { id: workspaceId, onboardingCompletedAt: null },
      data: { onboardingUpdatedById: userId, onboardingUpdatedAt: new Date() },
    });
    return r.count === 1;
  }
}
