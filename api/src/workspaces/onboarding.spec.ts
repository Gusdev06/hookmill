// Onboarding v2 §2 (D5): percent e estado dos passos derivados do conteúdo; D10 (21/10): um passo só entra no % quando
// `done` E já alcançado (`step < onboardingStep`), então o teto padrão do cadastro não faz a conta nova nascer com 17 %;
// META_MODE=off tira o passo 2; o lote (GET /auth/me, GET /workspaces) faz 1 query por tabela, qualquer que seja o número.
import type { Prisma } from '@prisma/client';
import { NO_FACTS, OnboardingService, onboardingCalc, onboardingFull, onboardingPercent, onboardingSteps, type OnboardingFacts, type OnboardingWs } from './onboarding';

const ws = (over: Partial<OnboardingWs> = {}): OnboardingWs => ({
  name: 'New client', businessType: null, monthlySpendCapUsd: null, onboardingStep: 1, onboardingCompletedAt: null, ...over,
});
const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({ ...NO_FACTS, ...over });
const states = (steps: ReturnType<typeof onboardingSteps>) => Object.fromEntries(steps.map((s) => [s.key, s.state]));

describe('onboardingSteps / onboardingPercent (onboarding-v2 §2)', () => {
  it('conta nova: 0 %, passo 1 current, os outros todo (nome padrão "New client" não conta como preenchido)', () => {
    const steps = onboardingSteps(ws(), facts(), true);
    expect(steps).toHaveLength(6);
    expect(steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(states(steps)).toEqual({ business: 'current', meta: 'todo', offer: 'todo', audience: 'todo', goals: 'todo', brain: 'todo' });
    expect(steps.every((s) => s.enabled)).toBe(true);
    expect(onboardingPercent(steps, null, 1)).toBe(0);
  });

  it('business done = businessType + nome próprio; goals done = teto informado; percent (D10) só conta passo done já alcançado', () => {
    const row = ws({ name: 'Mooncloth', businessType: 'ONLINE_STORE', monthlySpendCapUsd: 10 as unknown as Prisma.Decimal, onboardingStep: 3 });
    const steps = onboardingSteps(row, facts(), true);
    expect(states(steps)).toMatchObject({ business: 'done', goals: 'done', offer: 'current' });
    expect(onboardingPercent(steps, null, 3)).toBe(17); // business (1 < 3) conta; goals (5 < 3) ainda não
    expect(onboardingPercent(steps, null, 6)).toBe(33); // passou do passo 5: goals entra
    expect(onboardingCalc(row, facts(), true).percent).toBe(17);
  });

  it('D10: conta nova com o teto padrão do cadastro (monthlySpendCapUsd = 10, step 1) nasce em 0 %; goals fica done no trilho', () => {
    const signup = ws({ name: 'Mooncloth', monthlySpendCapUsd: 10 as unknown as Prisma.Decimal, onboardingStep: 1 });
    const calc = onboardingCalc(signup, facts(), true);
    expect(states(calc.steps).goals).toBe('done');
    expect(calc.percent).toBe(0);
    expect(onboardingCalc(signup, facts(), false).percent).toBe(0); // META_MODE=off: 0 de 5, não 20 %
    // cliente criado por POST /workspaces (sem teto, nome dado): também 0 %
    expect(onboardingCalc(ws({ name: 'Segundo Cliente', onboardingStep: 1 }), facts(), true).percent).toBe(0);
    // Continue do passo 5 grava onboardingStep 6 → goals conta (1 de 6)
    expect(onboardingCalc({ ...signup, onboardingStep: 6 }, facts(), true).percent).toBe(17);
    // borda aceita: voltar pelo trilho e regravar um step menor derruba o % até avançar de novo
    expect(onboardingCalc({ ...signup, onboardingStep: 2 }, facts(), true).percent).toBe(0);
  });

  it('meta pulado ("Skip for now"): onboardingStep > 2 sem conexão = skipped; conectado = done', () => {
    expect(states(onboardingSteps(ws({ onboardingStep: 3 }), facts(), true)).meta).toBe('skipped');
    expect(states(onboardingSteps(ws({ onboardingStep: 2 }), facts(), true)).meta).toBe('current');
    expect(states(onboardingSteps(ws({ onboardingStep: 1 }), facts(), true)).meta).toBe('todo');
    expect(states(onboardingSteps(ws({ onboardingStep: 1 }), facts({ metaConnected: true }), true)).meta).toBe('done');
  });

  it('offer done = oferta ativa com what e promise; audience done = alguma oferta com audience', () => {
    const steps = onboardingSteps(ws({ onboardingStep: 5 }), facts({ offerComplete: true, audience: true }), true);
    expect(states(steps)).toMatchObject({ offer: 'done', audience: 'done', goals: 'current', meta: 'skipped' });
    expect(onboardingPercent(steps, null, 5)).toBe(33); // skipped não conta
  });

  it('META_MODE=off: meta enabled=false e o percent divide por 5', () => {
    const steps = onboardingSteps(ws({ name: 'Mooncloth', businessType: 'APP', onboardingStep: 3 }), facts({ offerComplete: true }), false);
    const meta = steps.find((s) => s.key === 'meta')!;
    expect(meta.enabled).toBe(false);
    expect(steps.filter((s) => s.enabled)).toHaveLength(5);
    expect(onboardingPercent(steps, null, 3)).toBe(20); // business = 1 de 5 (offer done mas o passo 3 é o atual)
    expect(onboardingPercent(steps, null, 4)).toBe(40); // business + offer = 2 de 5
  });

  it('concluído: percent 100 mesmo com passo vazio; brain done; nenhum current', () => {
    const steps = onboardingSteps(ws({ name: 'Mooncloth', businessType: 'APP', onboardingStep: 6, onboardingCompletedAt: new Date() }), facts({ offerComplete: true }), true);
    expect(states(steps)).toEqual({ business: 'done', meta: 'skipped', offer: 'done', audience: 'todo', goals: 'todo', brain: 'done' });
    expect(onboardingPercent(steps, new Date(), 6)).toBe(100);
    expect(onboardingCalc(ws({ onboardingCompletedAt: new Date() }), facts(), true).percent).toBe(100);
  });

  it('onboardingFull: updatedBy como UserRef (initials) e updatedAt ISO; null quando ninguém mexeu', () => {
    const row = { ...ws({ onboardingStep: 2 }), onboardingUpdatedAt: new Date('2026-10-21T10:00:00Z') };
    const full = onboardingFull(row, onboardingCalc(row, facts(), true), { id: 'u1', name: 'Tordan Silva' });
    expect(full).toMatchObject({ step: 2, totalSteps: 6, completedAt: null, percent: 0, updatedBy: { id: 'u1', name: 'Tordan Silva', initials: 'TS' }, updatedAt: '2026-10-21T10:00:00.000Z' });
    expect(full.steps).toHaveLength(6);
    expect(onboardingFull({ ...row, onboardingUpdatedAt: null }, onboardingCalc(row, facts(), true), null)).toMatchObject({ updatedBy: null, updatedAt: null });
  });
});

describe('OnboardingService (lote, sem N+1)', () => {
  function fakeDb(offers: { workspaceId: string; what: string | null; promise: string | null; audience: string | null }[], connected: string[]) {
    return {
      offer: { findMany: jest.fn().mockResolvedValue(offers) },
      metaConnection: { findMany: jest.fn().mockResolvedValue(connected.map((workspaceId) => ({ workspaceId }))) },
      workspace: { update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
  }

  it('calcMany de 1 e de 50 workspaces = 1 query de ofertas + 1 de conexões (constante)', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `w${i}`);
    const db = fakeDb([{ workspaceId: 'w3', what: 'Sheets', promise: 'Sleep', audience: null }, { workspaceId: 'w7', what: null, promise: null, audience: 'Moms' }], ['w3']);
    const svc = new OnboardingService(db as never, { metaEnabled: true } as never);
    const many = await svc.calcMany(ids.map((id) => ({ id, ...ws({ onboardingStep: 4 }) })), db as never);
    expect(db.offer.findMany).toHaveBeenCalledTimes(1);
    expect(db.metaConnection.findMany).toHaveBeenCalledTimes(1);
    expect(db.offer.findMany.mock.calls[0][0].where.workspaceId.in).toHaveLength(50);
    expect(many.size).toBe(50);
    expect(states(many.get('w3')!.steps)).toMatchObject({ meta: 'done', offer: 'done', audience: 'current' });
    expect(many.get('w3')!.percent).toBe(33);
    expect(states(many.get('w7')!.steps)).toMatchObject({ meta: 'skipped', offer: 'todo', audience: 'done' });
    expect(many.get('w0')!.percent).toBe(0);

    const one = await svc.calcOne({ id: 'x', ...ws() }, db as never);
    expect(db.offer.findMany).toHaveBeenCalledTimes(2);
    expect(one.percent).toBe(0);
  });

  it('lista vazia não consulta nada; touchIfSetup só grava com onboardingCompletedAt null', async () => {
    const db = fakeDb([], []);
    const svc = new OnboardingService(db as never, { metaEnabled: true } as never);
    expect((await svc.facts([], db as never)).size).toBe(0);
    expect(db.offer.findMany).not.toHaveBeenCalled();
    db.workspace.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await svc.touchIfSetup('w1', 'u1', db as never)).toBe(false);
    expect(db.workspace.updateMany.mock.calls[0][0].where).toEqual({ id: 'w1', onboardingCompletedAt: null });
    expect(db.workspace.updateMany.mock.calls[0][0].data.onboardingUpdatedById).toBe('u1');
  });
});
