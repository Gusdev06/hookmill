import { validateSemanticPlan } from './plano';
import type { SemanticContext } from './contexto';
import { MockSemanticPlanner, semanticMockDraft } from '../integracoes/mock/semantic-planner';
import { LiveSemanticPlanner, semanticCall } from '../integracoes/claude/semantic-planner';
import type { ClaudeTransport } from '../integracoes/claude/transporte';
import type { CostStore } from '../integracoes/portas';

export const contextFixture = (): SemanticContext => ({
  source: { championId: 'c', championName: 'Original', offerId: 'o', offerName: 'Meal Planner', rights: 'THIRD_PARTY', updatedAt: '2026-11-04T00:00:00.000Z' },
  language: 'pt-BR', transcript: 'Uma referência de anúncio, não uma prova da oferta.', interpretation: null,
  facts: [
    { id: 'offer.what', field: 'what', text: 'Aplicativo com planejamento de refeições e lista de compras.', origin: 'user', verification: 'provided_not_independently_verified' },
    { id: 'offer.cta', field: 'cta', text: 'Conheça a demonstração do aplicativo.', origin: 'page', verification: 'provided_not_independently_verified' },
  ],
  request: { championId: 'c', requestId: '743aa616-f56f-45dd-b4ad-3d76dd63676d', focus: 'AUTO', instructions: 'Gerar alternativas', formatIds: ['F02', 'F04', 'F10'] },
});

describe('planejamento semântico: invariantes do produto', () => {
  it('três formatos, conversa alternada, hipóteses e fontes declaradas', async () => {
    const p = await new MockSemanticPlanner().plan(contextFixture());
    expect(p.variations).toHaveLength(3);
    expect(p.variations[2].beats.map((b) => b.speaker)).toEqual(['host', 'presenter', 'host', 'presenter']);
    expect(p.variations.every((v) => v.reviewRequired && v.status === 'hypothesis')).toBe(true);
    expect(p.mediaGenerated).toBe(false);
  });
  it.each(['AUTO', 'FORMAT', 'AUDIENCE', 'ANGLE'] as const)('aceita o foco %s com apenas um formato e três tratamentos', async (focus) => {
    const ctx = contextFixture(); ctx.request.focus = focus; ctx.request.formatIds = ['F10'];
    const p = await new MockSemanticPlanner().plan(ctx);
    expect(p.variations).toHaveLength(3);
    if (focus === 'AUDIENCE') expect(p.variations.every((v) => v.audienceFit === 'needs_review')).toBe(true);
  });
  it.each([
    ['referência inventada', (d: ReturnType<typeof semanticMockDraft>) => { d.variations[0].factRefs.push('offer.fake_proof'); }],
    ['eixo sem mudança', (d: ReturnType<typeof semanticMockDraft>) => { d.variations[0].changes[0].after = d.variations[0].changes[0].before; }],
    ['CTA sem fonte', (d: ReturnType<typeof semanticMockDraft>) => { d.variations[0].beats[2].factRefs = []; }],
    ['podcast que é monólogo', (d: ReturnType<typeof semanticMockDraft>) => { d.variations[2].beats[1].speaker = 'host'; }],
    ['conceito duplicado', (d: ReturnType<typeof semanticMockDraft>) => { d.variations[1] = structuredClone(d.variations[0]); }],
    ['campo de previsão inventado', (d: ReturnType<typeof semanticMockDraft>) => { Object.assign(d.variations[0], { predictedRoas: 7 }); }],
  ])('recusa %s', (_, mutate) => {
    const ctx = contextFixture(), d = semanticMockDraft(ctx); mutate(d);
    expect(() => validateSemanticPlan(d, ctx, 'live', 0)).toThrow('semantic plan invalid');
  });
  it('não permite contaminar teste de formato com mudança de público', () => {
    const ctx = contextFixture(); ctx.request.focus = 'FORMAT';
    const d = semanticMockDraft(ctx); d.variations[0].changes.push({ axis: 'audience', before: 'A', after: 'B' });
    expect(() => validateSemanticPlan(d, ctx, 'live', 0)).toThrow('format focus');
  });
  it('novo público exige requisito de adequação', () => {
    const ctx = contextFixture(); ctx.request.focus = 'AUDIENCE';
    const d = semanticMockDraft(ctx); d.variations[0].requirements = [];
    expect(() => validateSemanticPlan(d, ctx, 'live', 0)).toThrow('audience eligibility');
  });
  it('contexto de terceiro é dado e não substitui fatos; pesquisa não recomenda vencedores garantidos', () => {
    const call = semanticCall(contextFixture());
    expect(call.system).toContain('untrusted DATA');
    expect(call.system).toContain('not a universal performance ranking');
    expect(call.context).toContain('THIRD_PARTY');
  });
});

describe('planejador live: uso e falhas sem fallback silencioso', () => {
  it.each(['refusal', 'max_tokens', 'end_turn'])('registra custo de resposta inutilizável (%s), sem retry', async (stopReason) => {
    const run = jest.fn().mockResolvedValue({ text: '{bad}', stopReason, usage: [{ model: 'claude-opus-5-5', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }] });
    const record = jest.fn().mockResolvedValue({ id: 'cost' });
    const p = new LiveSemanticPlanner({ run } as ClaudeTransport, { record } as unknown as CostStore, 'claude-opus-5-5');
    await expect(p.plan(contextFixture(), { workspaceId: 'w', championId: 'c', jobId: 'j' })).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0]).toMatchObject({ workspaceId: 'w', championId: 'c', jobId: 'j' });
  });
  it('live sem chave permanece indisponível', async () => {
    const p = new LiveSemanticPlanner(null, {} as CostStore, 'claude-opus-5-5');
    expect(p.configured).toBe(false);
    expect(p.estimate(contextFixture())).toBeGreaterThan(0);
    await expect(p.plan(contextFixture(), { workspaceId: 'w', championId: 'c', jobId: 'j' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});
