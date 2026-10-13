import type { OfferBriefDraft, ScriptDraft } from '../contrato';
import { MemoryCostStore } from '../store/memoria.store';
import { FakeClaudeService } from './fake-claude.service';

const offer: OfferBriefDraft = {
  name: 'Budget App', language: 'en', kind: 'App', what: 'Budget App finds forgotten subscriptions.',
  audience: 'busy parents', promise: 'Save $300 a month.', pains: 'Money disappears every month.',
  proof: '40k users.', offerAndPrice: '$9/mo', cta: 'Start your free trial.', notes: null,
};

function run(o: OfferBriefDraft, count = 4, avoidAngles: string[] = []) {
  const costs = new MemoryCostStore();
  const claude = new FakeClaudeService(costs, { model: 'claude-opus-5-5', stepMs: 0 });
  const stages: string[] = [];
  const done = new Map<number, ScriptDraft>();
  const failed = new Map<number, string>();
  const speech = new Map<string, string>();
  const p = claude.generateScripts(
    { workspaceId: 'ws', creativeId: 'cr', jobId: 'j', offer: o, count, avoidAngles, winners: [] },
    {
      onStage: (s) => stages.push(s),
      onDelta: (slot, b, field, text) => {
        if (field === 'speech') speech.set(`${slot}:${b}`, (speech.get(`${slot}:${b}`) ?? '') + text);
      },
      onScriptDone: (slot, d) => done.set(slot, d),
      onScriptFailed: (slot, code) => failed.set(slot, code),
    },
  );
  return { p, stages, done, failed, speech, costs };
}

describe('FakeClaudeService.generateScripts', () => {
  it('N roteiros com gancho primeiro, blocos contínuos, streaming que soma a fala', async () => {
    const r = run(offer);
    expect(await r.p).toEqual({ costUsd: 0 });
    expect(r.stages).toEqual(['reading_brief', 'writing']);
    expect(r.done.size).toBe(4);
    const angles = new Set([...r.done.values()].map((d) => d.angle));
    expect(angles.size).toBe(4);
    for (const [slot, d] of r.done) {
      expect(d.blocks[0].label).toBe('hook');
      expect(d.blocks[0].visualPrompt).toMatch(/^SOLO SHOT/);
      d.blocks.forEach((b, i) => {
        if (i) expect(b.startSec).toBe(d.blocks[i - 1].endSec);
        expect(r.speech.get(`${slot}:${i}`)).toBe(b.speech);
      });
      expect(d.durationSec).toBe(d.blocks[d.blocks.length - 1].endSec);
      expect(d.blocks.some((b) => b.speech.includes('Save $300 a month.'))).toBe(true);
    }
    expect(r.costs.entries).toEqual([expect.objectContaining({ provider: 'ANTHROPIC', kind: 'LLM', amountUsd: 0, creativeId: 'cr', jobId: 'j' })]);
  });

  it('é determinístico e respeita avoidAngles', async () => {
    const a = run(offer, 3);
    const b = run(offer, 3);
    await Promise.all([a.p, b.p]);
    expect([...a.done.entries()]).toEqual([...b.done.entries()]);
    const used = [...a.done.values()].map((d) => d.angle);
    const c = run(offer, 3, used);
    await c.p;
    expect([...c.done.values()].some((d) => used.includes(d.angle))).toBe(false);
  });

  it('falha parcial não derruba os outros', async () => {
    const r = run({ ...offer, notes: 'tone: calm [mock:fail-slot:1]' }, 3);
    await r.p;
    expect([...r.failed.entries()]).toEqual([[1, 'PROVIDER_ERROR']]);
    expect([...r.done.keys()].sort()).toEqual([0, 2]);
  });

  it('escreve no idioma da oferta', async () => {
    const r = run({ ...offer, language: 'pt-BR', audience: 'mães ocupadas' }, 1);
    await r.p;
    expect(r.done.get(0)!.blocks[0].speech).toMatch(/^Para tudo:/);
  });
});

describe('FakeClaudeService.extractOffer', () => {
  const claude = new FakeClaudeService(new MemoryCostStore(), { model: 'm', stepMs: 0 });

  it('devolve o briefing com etapas na ordem', async () => {
    const stages: string[] = [];
    const r = await claude.extractOffer({ url: 'https://www.budgetapp.com/x', workspaceId: 'w', jobId: 'j' }, (s) => stages.push(s));
    expect(stages).toEqual(['fetching_page', 'extracting', 'detecting_language']);
    expect(r).toMatchObject({ name: 'Budgetapp', language: 'en', costUsd: 0 });
  });

  it('detecta pt-BR no texto colado', async () => {
    const r = await claude.extractOffer({ pageText: 'Curso X\nVocê não precisa de nada para começar com uma ideia', workspaceId: 'w', jobId: 'j' }, () => {});
    expect(r.language).toBe('pt-BR');
    expect(r.name).toBe('Curso X');
  });

  it.each([
    ['https://a.com/mock-403', 'PAGE_FORBIDDEN'],
    ['https://a.com/mock-unreadable', 'PAGE_UNREADABLE'],
    ['https://a.com/mock-429', 'RATE_LIMITED'],
  ])('%s → %s', async (url, code) => {
    await expect(claude.extractOffer({ url, workspaceId: 'w', jobId: 'j' }, () => {})).rejects.toMatchObject({ code });
  });

  it('sem url e sem texto → PAGE_UNREADABLE', async () => {
    await expect(claude.extractOffer({ workspaceId: 'w', jobId: 'j' }, () => {})).rejects.toMatchObject({ code: 'PAGE_UNREADABLE' });
  });
});

it('suggestFaceDescription é determinística e no idioma', async () => {
  const claude = new FakeClaudeService(new MemoryCostStore(), { model: 'm', stepMs: 0 });
  const script = { angle: 'a', rationale: 'r', durationSec: 10, blocks: [] };
  const a = await claude.suggestFaceDescription({ offer, script, workspaceId: 'w', creativeId: 'c1' });
  expect(a).toBe(await claude.suggestFaceDescription({ offer, script, workspaceId: 'w', creativeId: 'c1' }));
  expect(a).toContain('busy parents');
});
