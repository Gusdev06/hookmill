// QA 06/11 do recorte F1b (troca-texto-queimado-v1 §16.6 Q1, §15.1, §15.5.7, §16.11) pela API. API real com Claude/WaveSpeed
// em mock, PLATE_IMPL=local (Python + Chrome da VPS, US$ 0) só no workspace alfa (PLATE_WORKSPACE_IDS=qa_ws_alfa), render
// da HEADLINE no Remotion local (E2E_REMIX_REAL=1), TEST_MODE=off, conta PAID com crédito. Banco maquina_q1_test.
// Os 4 vídeos reais da S4 entram pelo upload, como um usuário. Rodar: ver playwright.qaf1b.config.ts. Dono: maquina-qa.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '../../harness/fixtures.ts';
import { as, expectErro, expectOk } from '../../harness/api.ts';
import { q } from '../../harness/db.ts';
import { esperarJobsQuietos } from '../../harness/f2.ts';
import { ateLote } from '../../harness/iterate.ts';
import { comCreditos, livro, prepararWs, saldo } from '../../harness/f1a.ts';
import { HEADLINE, SAIDA, SEM_ROSTO_02, camadaS4, campeaoReal, fitHeadline, lookDe, notaQ1, novoLote, placasDe, planejado, texto, type Caso } from '../../harness/f1b.ts';

test.describe.configure({ timeout: 2_400_000 });
test.beforeEach(async () => { await prepararWs(); await comCreditos(100); });
test.afterEach(async () => { await esperarJobsQuietos(600_000); });

const FASE = process.env.Q1_FASE ?? 'local';
const ligado = FASE === 'local';
const headlines = (b: any) => (b.pieces ?? []).filter((p: any) => p.type === 'HEADLINE');
const gerar = async (b: any) => expectOk(await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost?.generateEstimateUsd ?? 0, ...(b.template && { expectedCredits: b.template.quote }) }), 202);
const terminou = (id: string) => ateLote('donoA', id, (b: any) => (b.pieces ?? []).length > 0 && b.pieces.every((p: any) => ['ready', 'failed', 'left_out'].includes(p.status)), { oQue: 'render', timeoutMs: 1_800_000 });

/** Mede pelo caminho do produto: campeão real + camada da S4 + lote normal (mede sob demanda e faz a placa). */
async function medido(caso: Caso, o: { semRosto?: boolean } = {}) {
  const c = await campeaoReal(caso);
  await camadaS4(c.championId, caso, c.baseMap, o);
  const antes = await fitHeadline(c.championId);
  const t0 = Date.now();
  const lote = await novoLote(c.championId);
  const s = (Date.now() - t0) / 1000;
  const look = await lookDe(c.championId);
  const placas = await placasDe(c.championId);
  notaQ1(`look-${caso}`, look);
  return { ...c, antes, lote, s, look, placas, depois: await fitHeadline(c.championId) };
}

test.describe('PLATE_IMPL=local, workspace interno', () => {
  test.skip(!ligado, 'só com Q1_FASE=local');

  test('F1B-01 recorte S4: medida no produto, régua, intervalo, placa, oferta e galeria (02, 05, 06, solto)', async () => {
    const res: Record<string, unknown> = {};
    const esperado: Record<Caso, { kind: string; font: string; intervalo: [number, number] }> = {
      's4-02': { kind: 'box', font: 'tiktok-sans-600', intervalo: [0, 198] },
      's4-05': { kind: 'box', font: 'tiktok-sans-500', intervalo: [0, 191] },
      's4-06': { kind: 'box', font: 'tiktok-sans-500', intervalo: [0, 335] },
      's4-solto': { kind: 'loose', font: 'arimo-600', intervalo: [0, 161] },
    };
    for (const caso of Object.keys(esperado) as Caso[]) {
      const m = await medido(caso);
      const e = esperado[caso];
      const h = headlines(m.lote);
      res[caso] = {
        plano_s: m.s, fitAntes: m.antes, fitDepois: m.depois, insight: m.lote.insight?.headlineBlocked ?? null, headlines: h.map((p: any) => ({ code: p.code, headline: p.headline })),
        look: m.look && { kind: m.look.kind, intervalo: [m.look.startFrame, m.look.endFrame], font: m.look.font, verdict: m.look.verdict, lines: m.look.text?.lines, sizePx: m.look.text?.sizePx },
        placas: m.placas, checklist: m.lote.analysis?.checklist,
      };
      notaQ1(`f1b-01-${caso}`, res[caso]);
      expect.soft(m.antes, `${caso}: galeria sem medida = pendente`).toEqual({ level: 'hard', reason: 'headline_pending' });
      expect.soft(m.look?.kind, `${caso}: kind`).toBe(e.kind);
      expect.soft(m.look?.font?.fontId, `${caso}: fonte pela régua`).toBe(e.font);
      expect.soft([m.look?.startFrame, m.look?.endFrame], `${caso}: intervalo`).toEqual(e.intervalo);
      expect.soft(m.look?.verdict?.ok, `${caso}: veredito ${JSON.stringify(m.look?.verdict?.reason)}`).toBe(true);
      expect.soft(m.lote.insight?.headlineBlocked ?? null, `${caso}: headlineBlocked`).toBeNull();
      expect.soft(h.length, `${caso}: HEADLINE oferecida no lote`).toBeGreaterThan(0);
      for (const p of h) expect.soft(p.headline, `${caso}: PieceHeadline`).toMatchObject({ mode: 'replace', copy: e.kind });
      expect.soft(m.depois, `${caso}: galeria depois da medida`).toEqual({ level: 'ok', reason: null });
      if (e.kind === 'loose') {
        expect.soft(m.placas.map((p: any) => p.status), 'placa do solto').toEqual(['READY']);
        const mt = m.placas[0]?.metrics ?? {};
        notaQ1('placa-solto-metricas', mt);
        expect.soft(m.lote.analysis?.checklist ?? [], 'preparing_plate no checklist').toEqual(expect.arrayContaining([{ key: 'preparing_plate', status: 'done' }]));
      } else expect.soft(m.placas, `${caso}: caixa não tem CHAMPION_PLATE (§16.4)`).toEqual([]);
    }
    notaQ1('f1b-01', res);
  });

  test('F1B-02 escada no solto e na caixa pelo PATCH …/texts: mesmas, aprovada, curta, 1 linha, longa (sem IA)', async () => {
    const out: Record<string, unknown> = {};
    const solto = await medido('s4-solto');
    const ps = headlines(solto.lote)[0];
    expect(ps, 'HEADLINE no lote do solto').toBeTruthy();
    const casos: [string, string, number, string | null][] = [
      ['mesmas', 'How to view your man’s\nrecent following on IG', 200, null],
      ['aprovada', 'Tired of scrolling his endless following list?', 200, null],
      ['quase-curta', 'Want to see who he follows now?', 422, 'headline_too_short'],
      ['curta', 'See who he follows', 422, 'headline_too_short'],
      ['1-linha', 'See his new follows', 422, 'headline_too_short'],
      ['longa2', 'Tired of scrolling his endless list just to see who he followed?', 200, null],
      ['longa', 'Tired of scrolling his endless following list just to find out who he added last night?', -1, null],
      ['longa-demais', 'Tired of scrolling his endless following list every single night just to find out who he added, who he liked and who he texted back while you were asleep?', 422, null],
    ];
    for (const [nome, t, st, regra] of casos) {
      const r = await texto(solto.lote.id, ps.id, t);
      const it = (await q(`select payload->'params'->>'fitStep' f from variation_items where id = $1`, [ps.id]))[0];
      out[`solto/${nome}`] = { status: r.status, code: r.body?.error?.code, violations: r.body?.error?.details?.violations, fitStep: it?.f };
      if (st > 0) expect.soft(r.status, `solto ${nome}: ${JSON.stringify(r.body?.error)}`).toBe(st);
      if (regra) expect.soft(JSON.stringify(r.body?.error?.details), `solto ${nome}`).toContain(regra);
    }
    const c02 = await medido('s4-02', { semRosto: SEM_ROSTO_02 }); // Q1-B1 corrigido: rosto real (rosto_frac só medida na caixa)
    const pc = headlines(c02.lote)[0];
    expect(pc, 'HEADLINE no lote do 02').toBeTruthy();
    for (const [nome, t] of [
      ['mesmas', 'Si en 2 minutos no te\nbusca, es porque\nnunca fue para ti..'],
      ['novo', 'Si en 7 días no vuelve a escribirte, nunca fue para ti..'],
      ['curta', 'Si no te busca, no es para ti'],
      ['longa', 'Si en 7 días no vuelve a escribirte ni a buscarte por ningún lado, es porque nunca fue para ti y nunca lo será..'],
      ['longa-demais', 'Si en 7 días no vuelve a escribirte ni a buscarte por ningún lado ni a llamarte ni a mandarte un audio ni a mirar tus historias ni a darte like, es porque nunca fue para ti y nunca lo será, así que suéltalo ya..'],
    ]) {
      const r = await texto(c02.lote.id, pc.id, t);
      const it = (await q(`select payload->'params'->>'fitStep' f from variation_items where id = $1`, [pc.id]))[0];
      out[`02/${nome}`] = { status: r.status, code: r.body?.error?.code, violations: r.body?.error?.details?.violations, fitStep: it?.f };
    }
    notaQ1('f1b-02-escada', out);
    expect.soft((out['02/curta'] as any).status, 'caixa curta: sem piso (§16.3)').toBe(200);
    expect.soft((out['02/longa-demais'] as any).status, 'caixa longa demais: 422').toBe(422);
  });

  test('F1B-03 lote de template HEADLINE no solto, 05, 02 e 06 (Q1-B2, 3:4 como 4:5): crédito por peça, render real local, peça baixada', async () => {
    const pecas: unknown[] = [];
    for (const [caso, novo] of [['s4-solto', 'Tired of scrolling his endless following list?'], ['s4-05', "If he doesn't text you back within an hour, I’ll pay you $50"], ['s4-02', 'Si en 7 días no vuelve a escribirte, nunca fue para ti..'], ['s4-06', 'Él ya está con otra? Te propongo algo. Si en 7 días no te escribe, dime mentirosa']] as const) {
      const m = await medido(caso, { semRosto: caso === 's4-02' && SEM_ROSTO_02 });
      const antes = (await saldo()).balance;
      const b = await planejado('donoA', expectOk(await as('donoA').post(`/ad-templates/${HEADLINE}/use`, { championId: m.championId }), 202).id);
      expect(b.status).toBe('PLAN_READY');
      const hs = headlines(b);
      expect(hs.length, `${caso}: peças HEADLINE do template`).toBeGreaterThan(0);
      // 1 peça só, com o texto novo do teste (as outras saem do lote antes do Gerar)
      for (const p of hs.slice(1)) await as('donoA').patch(`/iterate/${b.id}/items/${p.id}`, { included: false }).catch(() => undefined);
      expectOk(await texto(b.id, hs[0].id, novo));
      const b2 = await planejado('donoA', b.id);
      await gerar(b2);
      const fim = await terminou(b.id);
      const p = fim.pieces.find((x: any) => x.id === hs[0].id);
      const depois = (await saldo()).balance;
      const [r] = await q(`select r.input, r.status, r.error_code, r.impl, r.duration_sec from renders r join creatives c on r.creative_id = c.id where c.variation_item_id = $1 order by r.created_at desc limit 1`, [hs[0].id]);
      const url = p?.files?.[0]?.url ?? p?.files?.[0]?.file?.url;
      const dir = join(SAIDA, 'pecas-local');
      mkdirSync(dir, { recursive: true });
      let arq: string | null = null;
      if (url) {
        const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
        arq = join(dir, `${caso}.mp4`);
        writeFileSync(arq, bytes);
      }
      const plate = (await q(`select f.storage_key from champion_plates c join files f on f.id = c.file_id where c.champion_id = $1 and c.status = 'READY'`, [m.championId]))[0]?.storage_key ?? null;
      const linha = { caso, status: p?.status, errorCode: p?.errorCode, saldo: [antes, depois], quote: b.template?.quote, livro: await livro(), input: r?.input, arq, plate, look: m.look };
      pecas.push(linha);
      notaQ1(`f1b-03-${caso}`, linha);
      expect.soft(p?.status, `${caso}: ${p?.errorCode} ${p?.failReason}`).toBe('ready');
      expect.soft(url, `${caso}: arquivo da peça`).toBeTruthy();
    }
    notaQ1('f1b-03', pecas);
  });

  test('F1B-04 HEADLINE_PENDING e HEADLINE_NO_FIT no Gerar: peça sai, nada cobrado (PAID, TEST_MODE=off)', async () => {
    const m = await medido('s4-solto');
    const out: Record<string, unknown> = {};
    for (const caso of ['pending', 'no_fit'] as const) {
      if (caso === 'no_fit') await novoLote(m.championId); // refaz a placa apagada no caso anterior
      const antes = (await saldo()).balance;
      const n0 = (await livro()).length;
      const b = await planejado('donoA', expectOk(await as('donoA').post(`/ad-templates/${HEADLINE}/use`, { championId: m.championId }), 202).id);
      const hs = headlines(b);
      expect(hs.length, `${caso}: peças`).toBeGreaterThan(0);
      if (caso === 'pending') await q(`delete from champion_plates where champion_id = $1`, [m.championId]);
      else await q(`update variation_items set payload = jsonb_set(payload, '{params,text}', '"Who?"') where batch_id = $1 and auto_type = 'HEADLINE'`, [b.id]);
      await gerar(b);
      const fim = await terminou(b.id);
      // o assentamento roda a cada 5 s (creditos.service SETTLE_EVERY_MS): espera o REFUND até 60 s
      let depois = (await saldo()).balance;
      for (let i = 0; i < 30 && depois !== antes; i++) { await new Promise((r) => setTimeout(r, 2000)); depois = (await saldo()).balance; }
      const lv = (await livro()).slice(n0);
      out[caso] = { quote: b.template?.quote, saldo: [antes, depois], livro: lv, pieces: fim.pieces.map((p: any) => ({ status: p.status, errorCode: p.errorCode, retryHint: p.retryHint, failReason: p.failReason })) };
      for (const p of fim.pieces) {
        expect.soft(p.status, `${caso}`).not.toBe('ready');
        expect.soft(p.errorCode, `${caso}`).toBe(caso === 'pending' ? 'HEADLINE_PENDING' : 'HEADLINE_NO_FIT');
      }
      expect.soft(depois, `${caso}: saldo volta ao de antes`).toBe(antes);
    }
    notaQ1('f1b-04', out);
  });

  test('F1B-05 workspace fora de PLATE_WORKSPACE_IDS (beta): igual ao F1a; e isolamento entre workspaces', async () => {
    const a = await medido('s4-solto');
    const b = await campeaoReal('s4-solto', 'B');
    await camadaS4(b.championId, 's4-solto', b.baseMap);
    const lote = await novoLote(b.championId, 'donoB');
    const out = {
      fit: await fitHeadline(b.championId, 'donoB'), insight: lote.insight?.headlineBlocked, headlines: headlines(lote).length,
      look: await lookDe(b.championId), placas: await placasDe(b.championId), checklist: lote.analysis?.checklist,
      custoTroca: await q(`select count(*)::int n from cost_entries where champion_id = $1 and (unit ilike '%plate%' or model ilike '%legenda%' or provider::text ilike '%troca%')`, [b.championId]),
      // isolamento: B não lê o campeão/lote de A, e A não lê o de B
      bLeA: (await as('donoB').get(`/champions/${a.championId}`)).status, bLeLoteA: (await as('donoB').get(`/iterate/${a.lote.id}`)).status,
      bEditaTextoA: (await as('donoB').patch(`/iterate/${a.lote.id}/items/${headlines(a.lote)[0]?.id}/texts`, { texts: [{ path: 'text', value: 'hack' }] })).status,
      aLeB: (await as('donoA').get(`/iterate/${lote.id}`)).status,
    };
    notaQ1('f1b-05', out);
    expect.soft(out.fit).toEqual({ level: 'hard', reason: 'headline_pending' });
    expect.soft(out.insight).toEqual({ reason: 'headline_pending', mode: 'replace' });
    expect.soft(out.headlines).toBe(0);
    expect.soft(out.look, 'beta não mede').toBeUndefined();
    expect.soft(out.placas).toEqual([]);
    expect.soft(out.bLeA).toBe(404);
    expect.soft(out.bLeLoteA).toBe(404);
    expect.soft(out.bEditaTextoA).toBe(404);
    expect.soft(out.aLeB).toBe(404);
  });

  test('F1B-06 B4 pela API: wants [headline] com HEADLINE possível = asked; sem (beta) = ignorado, lote não encolhe', async () => {
    const respostas = (wants: string[]) => ({ answers: { goal: 'auto', ai: 'free_only', aiCapUsd: null, aiCapCredits: null, wants }, save: false });
    const a = await medido('s4-solto');
    const ra = await as('donoA').put(`/iterate/${a.lote.id}/answers`, respostas(['headline']));
    const la = await planejado('donoA', a.lote.id);
    const b = await campeaoReal('s4-solto', 'B');
    await camadaS4(b.championId, 's4-solto', b.baseMap);
    const lb0 = await novoLote(b.championId, 'donoB');
    const rb = await as('donoB').put(`/iterate/${lb0.id}/answers`, respostas(['headline']));
    const lb = await planejado('donoB', lb0.id);
    const out = {
      a: { status: ra.status, incluidas: la.pieces.length, headline: headlines(la).map((p: any) => p.selection), naoSel: (la.notSelected ?? []).length },
      b: { status: rb.status, antes: lb0.pieces.length, incluidas: lb.pieces.length, naoSel: (lb.notSelected ?? []).map((p: any) => p.selection) },
    };
    notaQ1('f1b-06-b4', out);
    expect.soft(ra.status).toBe(200);
    expect.soft(rb.status).toBe(200);
    expect.soft(out.a.headline).toContain('asked');
    expect.soft(out.b.incluidas, 'beta: pedido ignorado, o lote não vira 1 peça').toBeGreaterThanOrEqual(4);
  });

  test('F1B-08 Q1-B5: campeão antigo (sem medida) medido em segundo plano pela galeria e pelo use do template', async () => {
    const out: Record<string, unknown> = {};
    for (const via of ['galeria', 'use'] as const) {
      const c = await campeaoReal('s4-solto');
      await camadaS4(c.championId, 's4-solto', c.baseMap); // tira a medida: campeão "antigo"
      const lookAntes = await lookDe(c.championId);
      const t0 = Date.now();
      let primeira: unknown;
      if (via === 'galeria') primeira = await fitHeadline(c.championId);
      else { const r = await as('donoA').post(`/ad-templates/${HEADLINE}/use`, { championId: c.championId }); primeira = { status: r.status, erro: r.body?.error }; }
      let fit = await fitHeadline(c.championId);
      // a 2ª leitura da galeria não pode pedir outra medida enquanto a 1ª está em voo; espera o resultado sem lote normal nenhum
      while (fit.level !== 'ok' && Date.now() - t0 < 300_000) { await new Promise((r) => setTimeout(r, 3000)); fit = await fitHeadline(c.championId); }
      const lotes = await q(`select count(*)::int n from variation_batches where champion_id = $1`, [c.championId]);
      const look = await lookDe(c.championId);
      out[via] = { lookAntes: lookAntes ?? null, primeira, fitFinal: fit, s: (Date.now() - t0) / 1000, lotes: lotes[0].n, look: look && { kind: look.kind, verdict: look.verdict, font: look.font?.fontId } };
      expect.soft(lookAntes, `${via}: começa sem medida`).toBeUndefined();
      expect.soft(fit, `${via}: medido sem lote normal`).toEqual({ level: 'ok', reason: null });
      expect.soft(look?.kind, `${via}: look gravado`).toBe('loose');
      if (via === 'galeria') expect.soft(lotes[0].n, 'galeria: nenhum lote criado').toBe(0);
    }
    notaQ1('f1b-08-b5', out);
  });

  test('F1B-07 ida (fica para a fase off): lote planejado com HEADLINE copiada, guardado para a volta', async () => {
    // sem reset depois: o spec da fase off lê este lote (playwright.qaf1b-volta.config.ts)
    const a = await medido('s4-05');
    const b = await planejado('donoA', expectOk(await as('donoA').post(`/ad-templates/${HEADLINE}/use`, { championId: a.championId }), 202).id);
    const n = await novoLote(a.championId);
    notaQ1('ida', { championId: a.championId, templateBatchId: b.id, quote: b.template?.quote, batchId: n.id, headlines: headlines(n).map((p: any) => p.id), saldo: (await saldo()).balance });
    expect(headlines(b).length).toBeGreaterThan(0);
    expect(headlines(n).length).toBeGreaterThan(0);
  });
});

test.describe('PLATE_IMPL=off', () => {
  test.skip(ligado, 'só com Q1_FASE=off');
  test('F1B-OFF-01 off = F1a: alfa não mede, galeria pendente, lote sem HEADLINE, sem placa', async () => {
    const c = await campeaoReal('s4-solto');
    const lookPosAnalise = await lookDe(c.championId);
    await camadaS4(c.championId, 's4-solto', c.baseMap);
    const lote = await novoLote(c.championId);
    const out = { lookPosAnalise, fit: await fitHeadline(c.championId), insight: lote.insight?.headlineBlocked, headlines: headlines(lote).length, look: await lookDe(c.championId), placas: await placasDe(c.championId), checklist: lote.analysis?.checklist };
    notaQ1('f1b-off-01', out);
    expect.soft(lookPosAnalise, 'off: a análise não mede').toBeUndefined();
    expect.soft(out.fit).toEqual({ level: 'hard', reason: 'headline_pending' });
    expect.soft(out.insight).toEqual({ reason: 'headline_pending', mode: 'replace' });
    expect.soft(out.headlines).toBe(0);
    expect.soft(out.look).toBeUndefined();
    expect.soft(out.placas).toEqual([]);
    expect.soft((out.checklist ?? []).map((x: any) => x.key)).not.toContain('preparing_plate');
    const e = expectErro(await as('donoA').post(`/ad-templates/${HEADLINE}/use`, { championId: c.championId }), 422, 'TEMPLATE_DOESNT_FIT');
    expect.soft(JSON.stringify(e)).toContain('headline_pending');
  });
});
