// QA Q1 07/11 — templates-ia-previas-v1 §3/§5/§7, caixa-preta contra a API real do QA (3151, mock, sweep de 3 s ligado).
// Rodar: E2E_API_URL=http://localhost:3151/api/v1 npx playwright test -c playwright.qaprevias.config.ts --project=qaprevias-api
import { expect, test } from '@playwright/test';
import { SLUG, TRANSCRIPT, call, cleanup, db, fixture, get, member, readyAll, until, use, uuid, type Fx } from './fx.ts';

test.describe.configure({ mode: 'serial' });
test.skip(process.env.Q1_FLAG === 'off', 'API em AI_PREVIEWS=off: só o flag-off.spec');
let saved: { id: string; credits: number | null; status: string; uses: number } | null = null;

test.afterAll(async () => {
  if (saved) await db.template.update({ where: { id: saved.id }, data: { credits: saved.credits, status: saved.status, uses: saved.uses } });
  await cleanup();
});

test('/use: validação, 202 PLANNING, idempotência, conflito, permissões e isolamento', async () => {
  const a = await fixture({ tag: 'qprev-use' });
  const b = await fixture({ tag: 'qprev-use-b' });
  const client = await member(a, 'CLIENT');
  const path = `/ad-templates/${SLUG.F09}/use`;
  const bad = await call('POST', path, a.token, { championId: a.championId, previews: { requestId: 'nao-uuid' } });
  expect([bad.status, bad.error?.code]).toEqual([400, 'VALIDATION_ERROR']);
  const gen = await call('POST', path, a.token, { championId: a.championId, generation: { requestId: uuid(), expectedCredits: 0 } });
  expect([gen.status, gen.error?.details?.fields?.[0]]).toEqual([400, { field: 'generation', rule: 'notAllowed' }]);
  const none = await call('POST', path, a.token, { championId: a.championId });
  expect([none.status, none.error?.details?.fields?.[0]?.field]).toEqual([400, 'previews']);
  const two = await call('POST', path, a.token, { championId: a.championId, creativeId: 'x', previews: { requestId: uuid() } });
  expect(two.status).toBe(400);
  expect((await call('POST', path, client, { championId: a.championId, previews: { requestId: uuid() } })).status).toBe(403);
  const foreign = await call('POST', path, b.token, { championId: a.championId, previews: { requestId: uuid() } });
  expect(foreign.status, 'campeão de outro workspace').toBe(404);

  const key = uuid();
  const [r1, r2] = await Promise.all([use(a, SLUG.F09, key), use(a, SLUG.F09, key)]); // clique duplo no "Make 4 previews"
  expect([r1.status, r2.status]).toEqual([202, 202]);
  expect(r1.data.id).toBe(r2.data.id);
  expect(r1.data.status).toBe('PLANNING');
  expect(r1.data.ai).toMatchObject({ phase: 'planning', format: 'F09' }); // previews [] ou já 'planned' (o mock responde na hora)
  expect(r1.data.ai.previews.every((p: any) => p.status === 'planned' || p.status === 'imaging')).toBe(true);
  expect(await db.variationBatch.count({ where: { workspaceId: a.ws } })).toBe(1);
  const conflict = await call('POST', `/ad-templates/${SLUG.F04}/use`, a.token, { championId: a.championId, previews: { requestId: key } });
  expect([conflict.status, conflict.error?.code, conflict.error?.details?.reason]).toEqual([409, 'INVALID_STATE', 'request_conflict']);
  // a mesma chave em OUTRO workspace não colide
  expect((await use(b, SLUG.F09, key)).status).toBe(202);
  // outro workspace não lê nem escreve
  expect((await call('GET', `/iterate/${r1.data.id}`, b.token)).status).toBe(404);
  expect((await call('GET', `/iterate/${r1.data.id}`, client)).status).toBe(200); // CLIENT lê
  const done = await readyAll(r1.data.id, a);
  const pid = done.ai.previews[0].id;
  for (const [p, body] of [['approve', { requestId: uuid(), previewIds: [pid], expectedCredits: 0 }], [`${pid}/regenerate`, { requestId: uuid() }], [`${pid}/retry`, { requestId: uuid() }]] as const) {
    expect((await call('POST', `/iterate/${r1.data.id}/ai-previews/${p}`, b.token, body)).status, `outro ws ${p}`).toBe(404);
    expect((await call('POST', `/iterate/${r1.data.id}/ai-previews/${p}`, client, body)).status, `CLIENT ${p}`).toBe(403);
  }
  // nada reservado nas prévias
  expect(await db.creditEntry.count({ where: { userId: a.userId } })).toBe(0);
});

test('prévias: 4 ideias distintas, elenco diferente, voz no gênero, imagem pronta, changes[].before descritivo, fora de pieces[]', async () => {
  const a = await fixture({ tag: 'qprev-conteudo' });
  for (const [fmt, speakers] of [['F04', 1], ['F09', 1], ['F10', 2]] as const) {
    const r = await use(a, SLUG[fmt]);
    expect(r.status).toBe(202);
    const t0 = Date.now();
    const b = await readyAll(r.data.id, a);
    test.info().annotations.push({ type: 'tempo', description: `${fmt}: PLAN_READY em ${((Date.now() - t0) / 1000).toFixed(1)} s` });
    const ps = b.ai.previews;
    expect(b.status).toBe('PLAN_READY');
    expect(b.pieces).toEqual([]);
    expect(ps.map((p: any) => p.letter)).toEqual(['A', 'B', 'C', 'D']);
    expect(b.ai).toMatchObject({ format: fmt, approvable: 4, generating: 0, approvals: [], prices: { videoEach: null }, limits: { regenPerPreview: 3, regenPerBatch: 6, regenUsed: 0, retryPerPreview: 2 } });
    expect(new Set(ps.map((p: any) => p.title)).size).toBe(4);
    expect(new Set(ps.map((p: any) => p.angle)).size).toBe(4);
    const names = ps.flatMap((p: any) => p.cast.map((c: any) => c.name));
    expect(names.length).toBe(4 * speakers);
    expect(new Set(names).size, `elenco único no lote ${fmt}`).toBe(4 * speakers);
    expect(new Set(ps.flatMap((p: any) => p.cast.map((c: any) => c.voiceId))).size, `vozes sem repetir ${fmt}`).toBe(4 * speakers);
    for (const p of ps) {
      expect(p.status).toBe('ready');
      expect(p.cast).toHaveLength(speakers);
      expect(p.title.length).toBeLessThanOrEqual(60);
      expect(p.angle.length).toBeLessThanOrEqual(140);
      expect(p.summary.length).toBeLessThanOrEqual(240);
      expect(p.hook).toBe(p.beats[0].text);
      expect(p.hook).not.toContain('Stop wasting your evenings'); // nenhuma repete o gancho do campeão
      expect(p.beats.length).toBeGreaterThanOrEqual(3);
      expect(p.beats.length).toBeLessThanOrEqual(6);
      if (fmt === 'F10') expect(p.beats.map((x: any) => x.speaker)).toEqual(p.beats.map((_: any, i: number) => (i % 2 ? 'presenter' : 'host')));
      for (const c of p.cast) {
        expect(c.status).toBe('ready');
        expect(c.image?.url).toMatch(/^https?:\/\//);
        expect(c.image.width / c.image.height).toBeCloseTo(9 / 16, 2); // mock = 720x1280 (Soul V2 real = 1152x2048)
        expect(c.voiceName).toBeTruthy();
      }
      expect(p.changes.length).toBeGreaterThan(0);
      // "vs. your ad": o before descreve o anúncio de partida (fala/oferta), não um rótulo genérico
      for (const ch of p.changes) {
        expect(ch.before.split(/\s+/).length, `before curto demais: "${ch.before}"`).toBeGreaterThanOrEqual(4);
      }
      expect(p.changes.some((ch: any) => ch.before.includes(TRANSCRIPT.split(' ').slice(0, 4).join(' '))), 'algum before cita a fala real do campeão').toBe(true);
      expect(p.estimate.durationSec).toBeGreaterThan(0);
      expect([p.regenerations, p.retries, p.pieceId, p.action]).toEqual([{ used: 0, max: 3 }, { used: 0, max: 2 }, null, null]);
    }
    // voz no gênero do rosto (catálogo da maquina-ia)
    const items = await db.variationItem.findMany({ where: { batchId: r.data.id, previewStatus: { not: null } } });
    expect(items.every((i: any) => i.included === false)).toBe(true);
    expect(await db.creative.count({ where: { variationBatchId: r.data.id } })).toBe(0);
  }
  // amostras de texto pro relatório
  const last = (await db.variationBatch.findFirst({ where: { workspaceId: a.ws }, orderBy: { createdAt: 'desc' } }))!;
  const v = (await get(last.id, a)).ai.previews[0];
  test.info().annotations.push({ type: 'amostra', description: JSON.stringify({ title: v.title, hook: v.hook, cast: v.cast.map((c: any) => `${c.name}/${c.gender}/${c.voiceName}`), changes: v.changes }) });
});

test('approve: validação, CREDITS_CHANGED, clique duplo, conflito, 2 abas, incremental (1 + depois mais 1) e cobrança só na aprovação', async () => {
  const tpl = await db.template.findUniqueOrThrow({ where: { slug: SLUG.F09 }, select: { id: true, credits: true, status: true, uses: true } });
  saved = tpl;
  await db.template.update({ where: { id: tpl.id }, data: { credits: 5, status: 'LIVE' } });
  const a = await fixture({ access: 'PAID', credits: 50, tag: 'qprev-approve' });
  const other = await fixture({ tag: 'qprev-approve-b' });
  const r = await use(a, SLUG.F09);
  expect(r.status).toBe(202);
  expect(r.data.ai.prices.videoEach).toBe(5);
  const b = await readyAll(r.data.id, a);
  const [p1, p2, p3, p4] = b.ai.previews.map((p: any) => p.id);
  const route = `/iterate/${r.data.id}/ai-previews/approve`;
  for (const body of [
    { requestId: uuid(), previewIds: [], expectedCredits: 5 },
    { requestId: uuid(), previewIds: [p1, p2, p3, p4, 'x'], expectedCredits: 25 },
    { requestId: uuid(), previewIds: [p1, p1], expectedCredits: 10 },
    { requestId: uuid(), previewIds: [p1], expectedCredits: -1 },
    { requestId: 'x', previewIds: [p1], expectedCredits: 5 },
    { requestId: uuid(), previewIds: [p1] },
  ]) expect((await call('POST', route, a.token, body)).status, JSON.stringify(body)).toBe(400);
  // prévia de outro lote (outro workspace) = 404
  const ro = await use(other, SLUG.F09);
  const ob = await readyAll(ro.data.id, other);
  expect((await call('POST', route, a.token, { requestId: uuid(), previewIds: [ob.ai.previews[0].id], expectedCredits: 5 })).status).toBe(404);
  const ch = await call('POST', route, a.token, { requestId: uuid(), previewIds: [p1], expectedCredits: 0 });
  expect([ch.status, ch.error?.code, ch.error?.details]).toEqual([409, 'CREDITS_CHANGED', { credits: 5 }]);
  expect(await db.creditEntry.count({ where: { userId: a.userId, kind: 'RESERVE' } })).toBe(0);

  const k1 = uuid();
  const [x, y] = await Promise.all([1, 2].map(() => call('POST', route, a.token, { requestId: k1, previewIds: [p1], expectedCredits: 5 })));
  expect([x.status, y.status]).toEqual([202, 202]);
  expect(x.data.status).toBe('LAUNCHED');
  const ap = x.data.ai.previews.find((p: any) => p.id === p1);
  expect([ap.status, ap.pieceId]).toEqual(['approved', p1]);
  expect(x.data.pieces.map((p: any) => p.id)).toEqual([p1]);
  expect(await db.creditEntry.count({ where: { userId: a.userId, kind: 'RESERVE' } })).toBe(1);
  expect((await db.user.findUniqueOrThrow({ where: { id: a.userId } })).creditBalance).toBe(45);
  const conflict = await call('POST', route, a.token, { requestId: k1, previewIds: [p2], expectedCredits: 5 });
  expect([conflict.status, conflict.error?.details?.reason]).toEqual([409, 'request_conflict']);
  const again = await call('POST', route, a.token, { requestId: uuid(), previewIds: [p1], expectedCredits: 5 });
  expect([again.status, again.error?.details?.reason]).toEqual([409, 'preview_not_ready']);
  // regenerar prévia aprovada = 409 (APPROVED é final)
  const rgApproved = await call('POST', `/iterate/${r.data.id}/ai-previews/${p1}/regenerate`, a.token, { requestId: uuid() });
  expect([rgApproved.status, rgApproved.error?.details?.state]).toEqual([409, 'approved']);
  // duas abas, chaves diferentes, mesma prévia
  const tabs = await Promise.all([uuid(), uuid()].map((k) => call('POST', route, a.token, { requestId: k, previewIds: [p2], expectedCredits: 5 })));
  expect(tabs.map((t) => t.status).sort()).toEqual([202, 409]);
  expect(tabs.find((t) => t.status === 409)!.error?.details?.reason).toBe('preview_not_ready');
  expect(await db.creditEntry.count({ where: { userId: a.userId, kind: 'RESERVE' } })).toBe(2);
  const done = await until(r.data.id, a, (bb) => bb.ai.phase === 'done', 'vídeos prontos', 240_000);
  expect(done.pieces.map((p: any) => p.id).sort()).toEqual([p1, p2].sort());
  expect(done.pieces.every((p: any) => p.status === 'ready' && p.files?.[0]?.mimeType === 'video/mp4')).toBe(true);
  expect(done.ai.approvable).toBe(2); // faixa "Make them too"
  // volta depois e aprova as outras 2 de uma vez (P4)
  const late = await call('POST', route, a.token, { requestId: uuid(), previewIds: [p3, p4], expectedCredits: 10 });
  expect(late.status).toBe(202);
  const all = await until(r.data.id, a, (bb) => bb.ai.phase === 'done' && bb.pieces.length === 4, '4 vídeos', 240_000);
  expect(all.ai.approvals).toHaveLength(3);
  // assentamento: 20 cobrados, nada estornado; biblioteca com 4 criativos
  await until(r.data.id, a, () => true, 'x', 1000);
  let run: any;
  for (let i = 0; i < 60; i++) { run = await db.templateRun.findUniqueOrThrow({ where: { batchId: r.data.id } }); if (run.status === 'SETTLED') break; await new Promise((ok) => setTimeout(ok, 2000)); }
  expect([run.status, run.charged, run.refunded]).toEqual(['SETTLED', 20, 0]);
  expect((await db.user.findUniqueOrThrow({ where: { id: a.userId } })).creditBalance).toBe(30);
  expect(await db.creative.count({ where: { variationBatchId: r.data.id } })).toBe(4);
  const lib = await call('GET', '/library', a.token);
  test.info().annotations.push({ type: 'biblioteca', description: `GET /library ${lib.status} itens=${JSON.stringify(lib.data)?.split('"id"').length - 1}` });
});

test('vídeo aprovado que falha: estorno só daquela aprovação', async () => {
  // o gatilho entra na fala (mechanism usa as 22 primeiras palavras do "what"): imagens passam, TTS/lipsync falham
  const a = await fixture({ access: 'PAID', credits: 50, tag: 'qprev-estorno', what: '[mock:PROVIDER_ERROR] A step-by-step guide to earning extra income with AI tools.' });
  const r = await use(a, SLUG.F09);
  expect(r.status).toBe(202);
  const b = await readyAll(r.data.id, a);
  const [p1] = b.ai.previews.map((p: any) => p.id);
  const ap = await call('POST', `/iterate/${r.data.id}/ai-previews/approve`, a.token, { requestId: uuid(), previewIds: [p1], expectedCredits: 5 });
  expect(ap.status).toBe(202);
  expect((await db.user.findUniqueOrThrow({ where: { id: a.userId } })).creditBalance).toBe(45);
  const failed = await until(r.data.id, a, (bb) => bb.ai.phase === 'failed', 'vídeo falho', 240_000);
  expect(failed.pieces[0].status).toBe('failed');
  expect(failed.ai.approvable).toBe(3);
  let run: any;
  for (let i = 0; i < 60; i++) { run = await db.templateRun.findUniqueOrThrow({ where: { batchId: r.data.id } }); if (run.status === 'SETTLED') break; await new Promise((ok) => setTimeout(ok, 2000)); }
  expect([run.status, run.charged, run.refunded]).toEqual(['SETTLED', 0, 5]);
  expect((await db.user.findUniqueOrThrow({ where: { id: a.userId } })).creditBalance).toBe(50);
  expect(await db.creditEntry.count({ where: { userId: a.userId, kind: 'REFUND' } })).toBe(1);
});

test('Novo ângulo: elenco novo a cada vez, grátis, idempotente, teto 3/prévia e 6/lote com scope', async () => {
  const a = await fixture({ tag: 'qprev-regen' });
  const r = await use(a, SLUG.F10);
  const b0 = await readyAll(r.data.id, a);
  const [p1, p2, p3] = b0.ai.previews.map((p: any) => p.id);
  const regen = (id: string, k = uuid()) => call('POST', `/iterate/${r.data.id}/ai-previews/${id}/regenerate`, a.token, { requestId: k });
  const seen: string[][] = [b0.ai.previews[0].cast.map((c: any) => c.name)];
  const titles = [b0.ai.previews[0].title];
  const k = uuid();
  const [g1, g2] = await Promise.all([regen(p1, k), regen(p1, k)]); // clique duplo
  expect([g1.status, g2.status]).toEqual([202, 202]);
  expect(g1.data.regenerations).toEqual({ used: 1, max: 3 });
  expect(g1.data.status).toBe('planned');
  for (let n = 1; n <= 3; n++) {
    if (n > 1) expect((await regen(p1)).status).toBe(202);
    const b = await until(r.data.id, a, (bb) => bb.ai.previews[0].status === 'ready', `regen ${n}`);
    const p = b.ai.previews[0];
    const names = p.cast.map((c: any) => c.name);
    const others = b.ai.previews.slice(1).flatMap((x: any) => x.cast.map((c: any) => c.name));
    expect(names.some((nm: string) => seen.flat().includes(nm)), `regen ${n} repetiu alguém do elenco anterior: ${names} vs ${seen}`).toBe(false);
    expect(names.some((nm: string) => others.includes(nm)), `regen ${n} repetiu alguém de outra prévia viva`).toBe(false);
    expect(titles).not.toContain(p.title);
    expect(p.regenerations.used).toBe(n);
    expect(p.cast.every((c: any) => c.image)).toBe(true);
    seen.push(names); titles.push(p.title);
  }
  test.info().annotations.push({ type: 'elenco por novo ângulo (A)', description: seen.map((s) => s.join('+')).join(' → ') });
  const cap = await regen(p1);
  expect([cap.status, cap.error?.code, cap.error?.details]).toEqual([429, 'REGEN_LIMIT', { scope: 'preview', used: 3, max: 3 }]);
  // ocupado (planned/imaging) = 409
  expect((await regen(p2)).status).toBe(202);
  const busy = await regen(p2);
  expect(busy.status).toBe(409);
  await until(r.data.id, a, (bb) => bb.ai.generating === 0, 'p2');
  for (const id of [p2, p3]) { expect((await regen(id)).status).toBe(202); await until(r.data.id, a, (bb) => bb.ai.generating === 0, 'lote'); }
  const batchCap = await regen(p3);
  expect([batchCap.status, batchCap.error?.code, batchCap.error?.details]).toEqual([429, 'REGEN_LIMIT', { scope: 'batch', used: 6, max: 6 }]);
  const v = (await get(r.data.id, a)).ai;
  expect(v.limits.regenUsed).toBe(6);
  expect(v.phase).toBe('previews_ready');
  const all = v.previews.flatMap((p: any) => p.cast.map((c: any) => c.name));
  expect(new Set(all).size, 'elenco do lote segue único depois das refações').toBe(all.length);
  expect(await db.creditEntry.count({ where: { userId: a.userId } })).toBe(0);
});

test('Try again: novo ângulo que falha no planejador vira failed/planning; retry fora do teto, máx. 2 (429 scope retry)', async () => {
  const a = await fixture({ tag: 'qprev-retry', what: 'A step-by-step guide to earning extra income with AI tools. [mock:plan-one-fail]' });
  const r = await use(a, SLUG.F04);
  const b = await readyAll(r.data.id, a);
  const p1 = b.ai.previews[0].id;
  // retry em prévia não-failed = 409
  const notFailed = await call('POST', `/iterate/${r.data.id}/ai-previews/${p1}/retry`, a.token, { requestId: uuid() });
  expect([notFailed.status, notFailed.error?.details?.allowed]).toEqual([409, ['FAILED']]);
  expect((await call('POST', `/iterate/${r.data.id}/ai-previews/${p1}/regenerate`, a.token, { requestId: uuid() })).status).toBe(202);
  let f = (await until(r.data.id, a, (bb) => bb.ai.previews[0].status === 'failed', 'falha planOne')).ai;
  expect(f.previews[0]).toMatchObject({ failStage: 'planning', action: 'retry', regenerations: { used: 1, max: 3 }, retries: { used: 0, max: 2 } });
  expect(f.phase).toBe('previews_ready'); // falha de prévia não derruba o lote
  const rk = uuid();
  const [t1, t2] = await Promise.all([1, 2].map(() => call('POST', `/iterate/${r.data.id}/ai-previews/${p1}/retry`, a.token, { requestId: rk })));
  expect([t1.status, t2.status]).toEqual([202, 202]);
  expect(t1.data.retries.used).toBe(1);
  f = (await until(r.data.id, a, (bb) => bb.ai.previews[0].status === 'failed', 'falha retry 1')).ai;
  expect(f.previews[0].retries.used).toBe(1);
  expect((await call('POST', `/iterate/${r.data.id}/ai-previews/${p1}/retry`, a.token, { requestId: uuid() })).status).toBe(202);
  f = (await until(r.data.id, a, (bb) => bb.ai.previews[0].status === 'failed' && bb.ai.previews[0].retries.used === 2, 'falha retry 2')).ai;
  expect(f.previews[0].action).toBeNull();
  const cap = await call('POST', `/iterate/${r.data.id}/ai-previews/${p1}/retry`, a.token, { requestId: uuid() });
  expect([cap.status, cap.error?.code, cap.error?.details]).toEqual([429, 'REGEN_LIMIT', { scope: 'retry', used: 2, max: 2 }]);
  expect(f.limits.regenUsed, 'retry não conta no teto de refações').toBe(1);
  // aprovar uma prévia failed = 409 preview_not_ready
  const ap = await call('POST', `/iterate/${r.data.id}/ai-previews/approve`, a.token, { requestId: uuid(), previewIds: [p1], expectedCredits: 0 });
  expect([ap.status, ap.error?.details?.reason]).toEqual([409, 'preview_not_ready']);
});

test('planejador: plan-few/plan-fail/plan-refusal = PLAN_FAILED; plan-three = "3 of 4"; escritas recusadas no PLAN_FAILED', async () => {
  for (const trig of ['plan-few', 'plan-fail', 'plan-refusal']) {
    const a = await fixture({ tag: `qprev-${trig}`, what: `A step-by-step guide to earning extra income with AI tools. [mock:${trig}]` });
    const r = await use(a, SLUG.F09);
    expect(r.status).toBe(202);
    const b = await until(r.data.id, a, (bb) => bb.ai?.phase === 'failed', trig);
    expect(b.status).toBe('PLAN_FAILED');
    expect(b.ai.errorCode).toBeTruthy();
    expect(b.ai.failReason).toBeTruthy();
    test.info().annotations.push({ type: trig, description: `${b.ai.errorCode} — ${b.ai.failReason} (previews=${b.ai.previews.length})` });
    const ap = await call('POST', `/iterate/${r.data.id}/ai-previews/approve`, a.token, { requestId: uuid(), previewIds: ['x'], expectedCredits: 0 });
    expect([ap.status, ap.error?.details?.state]).toEqual([409, 'PLAN_FAILED']);
  }
  const t = await fixture({ tag: 'qprev-three', what: 'A step-by-step guide to earning extra income with AI tools. [mock:plan-three]' });
  const r3 = await use(t, SLUG.F09);
  const b3 = await readyAll(r3.data.id, t);
  expect([b3.status, b3.ai.previews.length, b3.ai.approvable]).toEqual(['PLAN_READY', 3, 3]);
});
