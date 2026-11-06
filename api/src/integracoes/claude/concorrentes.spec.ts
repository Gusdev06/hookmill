import type { BrainDigest, JudgePageInput } from '../contrato';
import { MemoryCostStore } from '../store/memoria.store';
import { ClaudeLiveService } from './claude.service';
import { JUDGE_SYSTEM, PROPOSE_SYSTEM, bareDomain } from './concorrentes';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './transporte';

const brain: BrainDigest = {
  name: 'Orbit Budget', industry: 'Personal finance app', market: 'United States', websiteUrl: 'https://www.orbitbudget.com/', language: 'en',
  offers: [{ name: 'Orbit', kind: 'App', what: 'Budget app', audience: 'Young couples', promise: 'Save $300', pains: 'Money disappears', offerAndPrice: '7-day trial', cta: 'Start', sourceUrl: 'https://go.orbitbudget.com/trial' }],
};
const usage = (model: string, i = 2000, o = 400) => [{ model, inputTokens: i, outputTokens: o, cacheWriteTokens: 0, cacheReadTokens: 0 }];

class FakeTransport implements ClaudeTransport {
  calls: ClaudeCall[] = [];
  constructor(private readonly reply: (call: ClaudeCall, n: number) => ClaudeResult) {}
  async run(call: ClaudeCall): Promise<ClaudeResult> {
    const n = this.calls.push(call) - 1;
    return this.reply(call, n);
  }
}

const proposal = {
  countryCode: 'us',
  countryReason: 'Mercado informado.',
  brands: [
    { brand: 'Rocket Money', domain: 'https://www.rocketmoney.com/start', why: 'mesmo público' },
    { brand: 'Orbit Budget', domain: 'orbitbudget.com', why: 'o próprio cliente' },
    { brand: 'Blocked Co', domain: 'blocked.com', why: 'x' },
    { brand: 'Monarch', domain: 'monarchmoney.com', why: 'y' },
    { brand: 'Sem dominio', domain: 'n/a', why: 'z' },
  ],
  terms: [
    { term: 'save money fast', kind: 'promise' },
    { term: '"stop overspending"', kind: 'promise' },
    { term: 'budget app', kind: 'product' },
    { term: 'already searched', kind: 'product' },
    { term: 'expense tracker', kind: 'product' },
    { term: 'living paycheck to paycheck', kind: 'pain' },
    { term: 'money disappears', kind: 'pain' },
    { term: 'third pain phrase', kind: 'pain' },
  ],
};

describe('ClaudeLiveService.proposeCompetitors / judgeCompetitors (Ad Radar D1/D4)', () => {
  it('D1: Sonnet, effort medium, Brain no bloco cacheável; filtra cliente, bloqueado e termo repetido; não grava custo', async () => {
    const t = new FakeTransport(() => ({ text: JSON.stringify(proposal), stopReason: 'end_turn', usage: usage('claude-sonnet-5-5') }));
    const costs = new MemoryCostStore();
    const svc = new ClaudeLiveService(t, costs, { model: 'claude-opus-5-5' });
    const out = await svc.proposeCompetitors({ brain, blocked: { pageNames: [], domains: ['blocked.com'] }, reuseTerms: ['Already searched'], maxBrands: 6 });
    expect(t.calls[0]).toMatchObject({ system: PROPOSE_SYSTEM, model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(t.calls[0].context).toContain('"industry": "Personal finance app"');
    expect(t.calls[0].user).toContain('Do not suggest (removed by the client): blocked.com');
    expect(t.calls[0].user).toContain('"Already searched"');
    expect(out.countryCode).toBe('US');
    expect(out.brands.map((b) => b.domain)).toEqual(['rocketmoney.com', 'monarchmoney.com']);
    expect(out.terms).toEqual([
      { term: 'save money fast', kind: 'promise' }, { term: 'stop overspending', kind: 'promise' },
      { term: 'budget app', kind: 'product' }, { term: 'expense tracker', kind: 'product' },
      { term: 'living paycheck to paycheck', kind: 'pain' }, { term: 'money disappears', kind: 'pain' },
    ]);
    expect(out.model).toBe('claude-sonnet-5-5');
    expect(out.costUsd).toBeCloseTo((2000 * 2 + 400 * 10) / 1e6, 6);
    expect(costs.entries).toHaveLength(0);
  });

  it('D1: maxBrands corta; JSON inválido tenta 1× de novo e soma o uso das duas', async () => {
    const t = new FakeTransport((_c, n) => ({ text: n === 0 ? 'nope' : JSON.stringify(proposal), stopReason: 'end_turn', usage: usage('claude-sonnet-5-5') }));
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5', researchProposeModel: 'claude-sonnet-5' });
    const out = await svc.proposeCompetitors({ brain, blocked: { pageNames: [], domains: [] }, reuseTerms: [], maxBrands: 1 });
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0].model).toBe('claude-sonnet-5');
    expect(out.brands).toHaveLength(1);
    expect(out.costUsd).toBeCloseTo(2 * (2000 * 2 + 400 * 10) / 1e6, 6);
  });

  it('D1: recusa = SAFETY_BLOCK sem repetir', async () => {
    const t = new FakeTransport(() => ({ text: '', stopReason: 'refusal', usage: usage('claude-sonnet-5-5') }));
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' });
    await expect(svc.proposeCompetitors({ brain, blocked: { pageNames: [], domains: [] }, reuseTerms: [], maxBrands: 6 })).rejects.toMatchObject({ code: 'SAFETY_BLOCK' });
    expect(t.calls).toHaveLength(1);
  });

  const pages: JudgePageInput[] = [
    { pageId: 'p1', pageName: 'Rocket Money', likeCount: 1000, hosts: ['rocketmoney.com'], texts: ['Cancel subscriptions'], adsSeen: 6, oldestDays: 120, suspectDisposable: false },
    { pageId: 'p2', pageName: 'Credit Karma', likeCount: 500, hosts: ['creditkarma.com'], texts: ['Check your score'], adsSeen: 3, oldestDays: 40, suspectDisposable: false },
    { pageId: 'p3', pageName: 'Xkqzrtp Ѕhop', likeCount: null, hosts: [], texts: ['budget'], adsSeen: 2, oldestDays: 2, suspectDisposable: true },
    { pageId: 'p4', pageName: 'Forgotten', likeCount: null, hosts: [], texts: [], adsSeen: 2, oldestDays: null, suspectDisposable: false },
  ];

  it('D4: Haiku sem effort; descartável vira none; Página esquecida = none/0; nota limitada', async () => {
    const t = new FakeTransport(() => ({
      text: JSON.stringify({ items: [
        { pageId: 'p1', relation: 'direct', score: 140, reason: 'Mesmo produto.' },
        { pageId: 'p2', relation: 'adjacent', score: 66, reason: 'Mesmo público, produto vizinho (crédito).' },
        { pageId: 'p3', relation: 'direct', score: 90, reason: 'x' },
      ] }),
      stopReason: 'end_turn', usage: usage('claude-haiku-4-5', 6000, 500),
    }));
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' });
    const out = await svc.judgeCompetitors({ brain, pages });
    expect(t.calls[0]).toMatchObject({ system: JUDGE_SYSTEM, model: 'claude-haiku-4-5', effort: null });
    expect(out.items).toEqual([
      { pageId: 'p1', relation: 'direct', score: 100, reason: 'Mesmo produto.' },
      { pageId: 'p2', relation: 'adjacent', score: 66, reason: 'Mesmo público, produto vizinho (crédito).' },
      { pageId: 'p3', relation: 'none', score: 40, reason: 'x' },
      { pageId: 'p4', relation: 'none', score: 0, reason: '(sem veredito do juiz)' },
    ]);
    expect(out.costUsd).toBeCloseTo((6000 * 1 + 500 * 5) / 1e6, 6);
  });

  it('D4: resposta cobrindo menos da metade tenta de novo; até 25 Páginas; lista vazia não chama', async () => {
    const many = Array.from({ length: 30 }, (_, k) => ({ ...pages[0], pageId: `q${k}` }));
    const t = new FakeTransport((c, n) => {
      const asked = JSON.parse(c.user.replace(/^Pages \(JSON\):\n/, '')) as { pageId: string }[];
      const items = (n === 0 ? asked.slice(0, 3) : asked).map((p) => ({ pageId: p.pageId, relation: 'direct', score: 70, reason: 'ok' }));
      return { text: JSON.stringify({ items }), stopReason: 'end_turn', usage: usage('claude-haiku-4-5') };
    });
    const svc = new ClaudeLiveService(t, new MemoryCostStore(), { model: 'claude-opus-5-5' });
    const out = await svc.judgeCompetitors({ brain, pages: many });
    expect(t.calls).toHaveLength(2);
    expect(out.items).toHaveLength(25);
    const empty = await svc.judgeCompetitors({ brain, pages: [] });
    expect(empty).toMatchObject({ items: [], costUsd: 0 });
    expect(t.calls).toHaveLength(2);
  });

  it('bareDomain', () => {
    expect(bareDomain('HTTPS://www.Foo.co.uk/path?x')).toBe('foo.co.uk');
    expect(bareDomain('foo')).toBeNull();
  });
});
