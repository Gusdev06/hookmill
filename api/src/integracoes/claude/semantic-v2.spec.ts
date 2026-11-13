import type { AiFormat, SemanticPlanV2, SemanticVariationV2 } from '@maquina/contratos';
import { IntegracaoError } from '../erros';
import type { CostStore } from '../portas';
import { genderOf } from '../catalogo/genero';
import { VOICES } from '../catalogo/precos';
import { voiceFor, voicesOf } from '../catalogo/vozes';
import { MockSemanticPlanner } from '../mock/semantic-planner';
import { mockPreviewsDraft } from '../mock/semantic-v2-mock';
import { facePromptV2 } from '../wavespeed/prompts-midia';
import { LiveSemanticPlanner } from './semantic-planner';
import { evidenceOf, oneCall, previewFaceFraming, previewImagesUsd, previewsCall, producibleProblemsV2, validateSemanticPlanV2, type SemanticContextV2 } from './semantic-v2';
import type { ClaudeCall, ClaudeResult, ClaudeTransport } from './transporte';

const ctxOf = (extra = ''): SemanticContextV2 => ({
  source: { championId: 'c1', championName: 'Campeão', offerId: 'o1', offerName: 'Renda Extra com IA', rights: 'OWN', updatedAt: '2026-11-07T00:00:00.000Z' },
  language: 'pt-BR', interpretation: null,
  transcript: 'Descubra como usar IA para ganhar uma renda extra no seu tempo livre por R$ 97.',
  facts: [
    { id: 'offer.what', field: 'what', text: 'Curso online que ensina a usar ferramentas de IA para prestar serviços simples e ganhar renda extra.', origin: 'user', verification: 'provided_not_independently_verified' },
    { id: 'offer.promise', field: 'promise', text: 'Aprender um método para oferecer serviços com IA mesmo começando do zero.', origin: 'user', verification: 'provided_not_independently_verified' },
    { id: 'offer.offerAndPrice', field: 'offerAndPrice', text: 'Acesso vitalício por R$ 97, garantia de 7 dias.', origin: 'user', verification: 'provided_not_independently_verified' },
    { id: 'offer.cta', field: 'cta', text: `Clique no botão e garanta sua vaga hoje. ${extra}`.trim(), origin: 'page', verification: 'provided_not_independently_verified' },
  ],
});
const billing = { workspaceId: 'w1', championId: 'c1', jobId: 'j1', variationBatchId: 'b1' };
const FORMATS: AiFormat[] = ['F04', 'F09', 'F10'];

/** O filtro que o backend aplica (§4.2): as 4 primeiras produzíveis e distintas. */
function pick(plan: SemanticPlanV2, format: AiFormat, ctx: SemanticContextV2) {
  const accepted: SemanticVariationV2[] = [];
  const refused: { id: string; problems: string[] }[] = [];
  for (const v of plan.variations) {
    const problems = producibleProblemsV2(v, { format, accepted, evidence: evidenceOf(ctx) });
    if (problems.length) refused.push({ id: v.id, problems });
    else if (accepted.length < 4) accepted.push(v);
  }
  return { accepted, refused };
}

describe('semantic-v2 — fake determinístico', () => {
  const planner = new MockSemanticPlanner();

  it.each(FORMATS)('%s: 5 candidatas, a da posição 2 é inválida, 4 produzíveis com ideia e apresentador distintos', async (format) => {
    const ctx = ctxOf();
    const plan = await planner.planPreviews(ctx, { format, count: 5, uiLocale: 'en' }, billing);
    expect(plan).toMatchObject({ version: 'semantic-v2', generationMode: 'mock', costUsd: 0, language: 'pt-BR', uiLocale: 'en' });
    expect(plan.variations).toHaveLength(5);
    const { accepted, refused } = pick(plan, format, ctx);
    expect(refused).toEqual([{ id: 'V3', problems: ['requirements'] }]);
    expect(accepted).toHaveLength(4);
    expect(new Set(accepted.map((v) => v.title)).size).toBe(4);
    expect(new Set(accepted.map((v) => v.beats[0].text)).size).toBe(4);
    const people = accepted.flatMap((v) => v.cast);
    expect(new Set(people.map((c) => c.name)).size).toBe(people.length);
    expect(new Set(people.map((c) => c.description)).size).toBe(people.length);
    for (const v of accepted) {
      expect(v.faithful).toBe(false);
      expect(v.formatId).toBe(format);
      expect(v.changes.some((c) => c.axis === 'angle')).toBe(true);
      expect(v.cast).toHaveLength(format === 'F10' ? 2 : 1);
      // gênero declarado = gênero lido na descrição (a voz sai do gênero; nunca mismatch)
      for (const c of v.cast) expect(genderOf(c.description)).toBe(c.gender);
    }
    // determinístico
    expect(await planner.planPreviews(ctx, { format, count: 5, uiLocale: 'en' }, billing)).toEqual(plan);
  });

  it('F10 alterna host/presenter começando pelo host; títulos no idioma da UI, falas no do campeão', async () => {
    const plan = await planner.planPreviews(ctxOf(), { format: 'F10', count: 5, uiLocale: 'en' }, billing);
    const v = plan.variations[0];
    expect(v.beats.map((b) => b.speaker)).toEqual(['host', 'presenter', 'host', 'presenter']);
    expect(v.title).toBe('The doubt that stalls the decision');
    expect(v.beats[0].text).toMatch(/Você/);
  });

  it('gatilhos: plan-few → 1 produzível, plan-three → 3, plan-fail/refusal lançam, plan-one-fail só no planOne', async () => {
    const few = ctxOf('[mock:plan-few]');
    expect(pick(await planner.planPreviews(few, { format: 'F04', count: 5, uiLocale: 'en' }, billing), 'F04', few).accepted).toHaveLength(1);
    const three = ctxOf('[mock:plan-three]');
    expect(pick(await planner.planPreviews(three, { format: 'F09', count: 5, uiLocale: 'en' }, billing), 'F09', three).accepted).toHaveLength(3);
    const req = { format: 'F04' as const, count: 5, uiLocale: 'en' };
    await expect(planner.planPreviews(ctxOf('[mock:plan-fail]'), req, billing)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    await expect(planner.planPreviews(ctxOf('[mock:plan-refusal]'), req, billing)).rejects.toMatchObject({ code: 'SAFETY_BLOCK' });
    const oneFail = ctxOf('[mock:plan-one-fail]');
    await expect(planner.planPreviews(oneFail, req, billing)).resolves.toBeTruthy();
    await expect(planner.planOne(oneFail, { format: 'F04', uiLocale: 'en', exclude: [] }, billing)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it.each(FORMATS)('%s: planOne devolve 1 ideia e apresentador fora das vivas, produzível contra elas', async (format) => {
    const ctx = ctxOf();
    const { accepted } = pick(await planner.planPreviews(ctx, { format, count: 5, uiLocale: 'pt-BR' }, billing), format, ctx);
    const exclude = accepted.map((v) => ({ title: v.title, angle: v.angle, cast: v.cast }));
    const one = await planner.planOne(ctx, { format, uiLocale: 'pt-BR', exclude }, billing);
    expect(one.variations).toHaveLength(1);
    const v = one.variations[0];
    expect(producibleProblemsV2(v, { format, accepted, evidence: evidenceOf(ctx) })).toEqual([]);
    const names = new Set(accepted.flatMap((x) => x.cast.map((c) => c.name)));
    expect(v.cast.some((c) => names.has(c.name))).toBe(false);
    // de novo, com a nova também viva: outra ideia
    const two = await planner.planOne(ctx, { format, uiLocale: 'pt-BR', exclude: [...exclude, { title: v.title, angle: v.angle, cast: v.cast }] }, billing);
    expect(two.variations[0].title).not.toBe(v.title);
  });
});

describe('semantic-v2 — elenco novo e "before" concreto (achados do teste de telas 07/11)', () => {
  const planner = new MockSemanticPlanner();
  it.each(FORMATS)('%s: 3 novos ângulos seguidos na prévia A trazem elenco novo a cada vez, fora das outras vivas', async (format) => {
    const ctx = ctxOf();
    const { accepted } = pick(await planner.planPreviews(ctx, { format, count: 5, uiLocale: 'en' }, billing), format, ctx);
    const initialNames = accepted.flatMap((v) => v.cast.map((c) => c.name));
    expect(new Set(initialNames).size).toBe(initialNames.length); // 4 elencos distintos já nas iniciais
    let current = accepted[0];
    const others = accepted.slice(1);
    const history: SemanticVariationV2[] = [];
    for (let round = 0; round < 3; round++) {
      history.push(current);
      const live = [...others, ...history]; // o que o backend manda: vivas do lote + histórico da própria prévia
      const one = await planner.planOne(ctx, { format, uiLocale: 'en', exclude: live.map((v) => ({ title: v.title, angle: v.angle, cast: v.cast })) }, billing);
      const next = one.variations[0];
      expect(producibleProblemsV2(next, { format, accepted: live, evidence: evidenceOf(ctx) })).toEqual([]);
      const taken = new Set(live.flatMap((v) => v.cast.map((c) => c.name)));
      expect(next.cast.filter((c) => taken.has(c.name))).toEqual([]);
      current = next;
    }
  });
  it('changes[].before descreve o anúncio original de fato, nunca rótulo genérico', async () => {
    const ctx = ctxOf();
    const plan = await planner.planPreviews(ctx, { format: 'F04', count: 5, uiLocale: 'en' }, billing);
    for (const v of plan.variations) for (const c of v.changes) {
      expect(c.before).not.toMatch(/^(source ad|original|ângulo do anúncio|apresentador do anúncio)/i);
    }
    const ch = plan.variations[0].changes;
    expect(ch.find((c) => c.axis === 'messenger')?.before).toMatch(/^Talking head speaking about Curso online/);
    expect(ch.find((c) => c.axis === 'objection')?.before).toContain('Descubra como usar IA');
    expect(previewsCall(ctx, { format: 'F04', count: 5, uiLocale: 'en' }).system).toMatch(/Never a generic label/);
    expect(JSON.stringify(previewsCall(ctx, { format: 'F04', count: 5, uiLocale: 'en' }).schema)).toContain('sourceAd');
  });
  it('cast_repeat: nome de quem já está vivo no lote recusa a candidata', () => {
    const ctx = ctxOf();
    const [a, b] = validateSemanticPlanV2(mockPreviewsDraft(ctx, { format: 'F09', count: 5, uiLocale: 'en' }), ctx, { format: 'F09', uiLocale: 'en' }, 'mock', 0).variations;
    const clone = { ...b, cast: [{ ...b.cast[0], name: a.cast[0].name.toUpperCase() }] };
    expect(producibleProblemsV2(clone, { format: 'F09', accepted: [a], evidence: evidenceOf(ctx) })).toEqual(['cast_repeat']);
  });
});

describe('semantic-v2 — producibleProblemsV2', () => {
  const ctx = ctxOf();
  const base = () => validateSemanticPlanV2(mockPreviewsDraft(ctx, { format: 'F10', count: 5, uiLocale: 'en' }), ctx, { format: 'F10', uiLocale: 'en' }, 'mock', 0).variations[0];
  const check = (v: SemanticVariationV2, format: AiFormat = 'F10', accepted: SemanticVariationV2[] = []) => producibleProblemsV2(v, { format, accepted, evidence: evidenceOf(ctx) });

  it('número só se estiver nos fatos ou na fala do campeão', () => {
    const ok = base(); ok.beats[1].text = 'Hoje o acesso sai por R$ 97 com garantia de 7 dias.';
    expect(check(ok)).toEqual([]);
    const bad = base(); bad.beats[1].text = 'Mais de 3000 alunos já faturaram com esse método.';
    expect(check(bad)).toEqual(['invented_number']);
  });
  it('turnos, elenco, formato, tamanho, CTA e conceito repetido', () => {
    const v = base();
    expect(check({ ...v, beats: [v.beats[1], v.beats[0], v.beats[2], v.beats[3]] })).toContain('turns');
    expect(check({ ...v, cast: [v.cast[0]] })).toContain('cast');
    expect(check(v, 'F04')).toEqual(expect.arrayContaining(['format', 'turns', 'cast']));
    expect(check({ ...v, beats: v.beats.map((b) => ({ ...b, text: `${b.text} ${'palavra '.repeat(30)}` })) })).toContain('total_words');
    expect(check({ ...v, beats: [...v.beats.slice(0, 3), { ...v.beats[3], text: 'Clique.' }] })).toContain('beat_words');
    expect(check({ ...v, beats: v.beats.slice(0, 2) })).toEqual(expect.arrayContaining(['beat_count', 'missing_cta']));
    expect(check({ ...v, id: 'V9' }, 'F10', [{ ...v, title: ` ${v.title.toUpperCase()}!`, cast: [] }])).toEqual(['duplicate_concept']);
  });
});

describe('semantic-v2 — adaptador real (transporte falso)', () => {
  const ctx = ctxOf();
  const req = { format: 'F10' as const, count: 5, uiLocale: 'en' };
  const usage = [{ model: 'claude-opus-5-5', inputTokens: 2000, outputTokens: 6000, cacheWriteTokens: 8000, cacheReadTokens: 0 }];
  const setup = (result: Partial<ClaudeResult>) => {
    const calls: ClaudeCall[] = [];
    const record = jest.fn().mockResolvedValue(undefined);
    const transport: ClaudeTransport = { run: async (c) => { calls.push(c); return { text: JSON.stringify(mockPreviewsDraft(ctx, req)), stopReason: 'end_turn', usage, ...result }; } };
    return { calls, record, planner: new LiveSemanticPlanner(transport, { record } as unknown as CostStore, 'claude-opus-5-5') };
  };

  it('valida, grava o custo real por chamada (com o lote) e marca live', async () => {
    const { calls, record, planner } = setup({});
    const plan = await planner.planPreviews(ctx, req, billing);
    expect(plan.generationMode).toBe('live');
    expect(plan.variations).toHaveLength(5);
    // 2000×4 + 8000×4×1,25 + 6000×20 por Mtok = 0,008 + 0,04 + 0,12
    expect(plan.costUsd).toBeCloseTo(0.168, 6);
    expect(record).toHaveBeenCalledTimes(2);
    expect(record.mock.calls[0][0]).toMatchObject({ workspaceId: 'w1', variationBatchId: 'b1', jobId: 'j1', provider: 'ANTHROPIC', kind: 'LLM' });
    expect(calls).toHaveLength(1);
    const schema = JSON.stringify(calls[0].schema);
    expect(schema).toContain('"enum":["host","presenter"]');
    expect(schema).not.toContain('narrator');
    expect(JSON.parse(calls[0].user)).toMatchObject({ count: 5, format: 'F10' });
  });

  it('planPreviews e planOne compartilham o prefixo cacheável (system + contexto) e o planOne leva as excluídas', () => {
    const exclude = [{ title: 'T', angle: 'A', cast: [{ speaker: 'host' as const, name: 'Ana', gender: 'female' as const, description: 'A woman' }] }];
    const a = previewsCall(ctx, req), b = oneCall(ctx, { format: 'F10', uiLocale: 'en', exclude });
    expect(b.system).toBe(a.system);
    expect(b.context).toBe(a.context);
    expect(JSON.parse(b.user).excluded[0]).toMatchObject({ title: 'T', cast: [{ name: 'Ana' }] });
    expect(a.system).toMatch(/NEW IDEAS/);
    expect(a.system).toMatch(/No invented testimonials/);
  });

  it('recusa → SAFETY_BLOCK, corte por max_tokens / JSON quebrado / raiz inválida → PROVIDER_ERROR; custo gravado mesmo assim', async () => {
    for (const [result, code] of [[{ stopReason: 'refusal' }, 'SAFETY_BLOCK'], [{ stopReason: 'max_tokens' }, 'PROVIDER_ERROR'], [{ text: '{"variations": [' }, 'PROVIDER_ERROR'], [{ text: '{"x":1}' }, 'PROVIDER_ERROR']] as const) {
      const { record, planner } = setup(result);
      await expect(planner.planPreviews(ctx, req, billing)).rejects.toMatchObject({ code });
      expect(record).toHaveBeenCalledTimes(2);
    }
  });

  it('candidata malformada (fato inventado) sai; as outras seguem', () => {
    const raw = mockPreviewsDraft(ctx, req);
    raw.variations[1].factRefs.push('offer.fake_testimonial');
    const plan = validateSemanticPlanV2(raw, ctx, req, 'live', 0);
    expect(plan.variations.map((v) => v.id)).toEqual(['V1', 'V3', 'V4', 'V5']);
    expect(plan.rejected).toEqual([{ index: 1, reason: 'fact reference' }]);
  });

  it('13/11: trecho sem factRefs (GPT da Kie omite) herda os fatos da variação; presente e inválido segue derrubando', () => {
    const raw = mockPreviewsDraft(ctx, req);
    for (const v of raw.variations) for (const b of v.beats) delete (b as { factRefs?: unknown }).factRefs;
    const plan = validateSemanticPlanV2(raw, ctx, req, 'live', 0);
    expect(plan.rejected).toEqual([]);
    expect(plan.variations).toHaveLength(raw.variations.length);
    for (const v of plan.variations) for (const b of v.beats) expect(b.factRefs).toEqual(['mechanism', 'proof', 'cta'].includes(b.role) ? v.factRefs : []);
    const bad = mockPreviewsDraft(ctx, req);
    bad.variations[0].beats[0].factRefs = ['offer.fake'];
    expect(validateSemanticPlanV2(bad, ctx, req, 'live', 0).rejected).toEqual([{ index: 0, reason: 'fact reference' }]);
  });

  it('título longo é cortado na palavra, não derruba a candidata', () => {
    const raw = mockPreviewsDraft(ctx, req);
    raw.variations[0].title = 'Um título bem comprido que passa do limite de sessenta caracteres da tela';
    const v = validateSemanticPlanV2(raw, ctx, req, 'live', 0).variations[0];
    expect(v.title.length).toBeLessThanOrEqual(60);
    expect(v.title.endsWith('…')).toBe(true);
  });

  it('sem chave: NOT_CONFIGURED; estimativa > 0 e a do planOne menor', async () => {
    await expect(new LiveSemanticPlanner(null, {} as CostStore, 'claude-opus-5-5').planPreviews(ctx, req, billing)).rejects.toBeInstanceOf(IntegracaoError);
    const { planner } = setup({});
    const all = planner.estimatePreviews(ctx, req), one = planner.estimateOne(ctx, { format: 'F10', uiLocale: 'en', exclude: [] });
    expect(all).toBeGreaterThan(0.2);
    expect(all).toBeLessThan(0.5);
    expect(one).toBeLessThan(all);
  });
});

describe('voiceFor — voz no gênero do rosto', () => {
  it('nunca troca de gênero nem devolve neutra; respeita exclude; esgotado, repete a menos usada do mesmo gênero', () => {
    for (const g of ['female', 'male'] as const) {
      const used: string[] = [];
      for (let i = 0; i < 20; i++) {
        const v = voiceFor(g, 'pt-BR', used);
        expect(VOICES.find((x) => x.id === v.voiceId)?.gender).toBe(g);
        if (i < voicesOf(g).length) expect(used).not.toContain(v.voiceId);
        used.push(v.voiceId);
      }
      const counts = voicesOf(g).map((x) => used.filter((u) => u === x.id).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
    expect(voiceFor('female', 'en')).toEqual({ voiceId: 'Calm_Woman', voiceName: 'Calm Woman' });
    expect(voiceFor('male', 'en')).toEqual({ voiceId: 'Casual_Guy', voiceName: 'Casual Guy' });
  });
});

describe('rosto da prévia — facePromptV2 com framing', () => {
  it('sem framing: o prompt de sempre; com framing: cenário da descrição e olhar pedido', () => {
    const d = 'A woman in her 30s, plain grey t-shirt, sitting in a bright kitchen';
    const plain = facePromptV2(d);
    expect(plain).toContain('looking straight into the lens');
    expect(plain).toContain('a believable everyday setting softly out of focus');
    expect(facePromptV2(d, '9:16', {})).toBe(plain);
    const left = facePromptV2(d, '9:16', { gaze: 'camera_left', setting: 'described' });
    expect(left).toContain('just off frame to the left');
    expect(left).toContain('the setting from the description');
    expect(left).not.toContain('looking straight into the lens');
    expect(left).toContain('SOLO SHOT');
  });
  it('F10 com olhares opostos; F04/F09 para a lente; custo das imagens Soul', () => {
    expect(previewFaceFraming('F10', 'host').gaze).toBe('camera_right');
    expect(previewFaceFraming('F10', 'presenter').gaze).toBe('camera_left');
    expect(previewFaceFraming('F09', 'presenter')).toEqual({ gaze: 'lens', setting: 'described' });
    expect(previewImagesUsd('F04', 4)).toBe(0.024);
    expect(previewImagesUsd('F10', 4)).toBe(0.048);
  });
});
