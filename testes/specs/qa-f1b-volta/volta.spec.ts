// Volta do PLATE_IMPL (§16.5, §16.6 Q1): o lote planejado com a troca ligada (F1B-07) não leva a HEADLINE copiada quando a
// API sobe com PLATE_IMPL=off: sai no Gerar sem crédito; a galeria volta a `headline_pending`. Sem reset do banco. Dono: maquina-qa.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { as, expectOk } from '../../harness/api.ts';
import { ateLote } from '../../harness/iterate.ts';
import { saldo, livro } from '../../harness/f1a.ts';
import { SAIDA, fitHeadline, notaQ1 } from '../../harness/f1b.ts';

test('F1B-VOLTA off depois de on: galeria pendente; lote copiado sai no Gerar sem crédito', async () => {
  const ida = JSON.parse(readFileSync(join(SAIDA, 'ida.json'), 'utf8'));
  const fit = await fitHeadline(ida.championId);
  const antes = (await saldo()).balance;
  const b = expectOk(await as('donoA').get(`/iterate/${ida.batchId}`));
  const st = await as('donoA').post(`/iterate/${b.id}/start`, { expectedPieces: b.pieces.length, expectedCostUsd: b.cost?.generateEstimateUsd ?? 0 });
  const fim = st.status === 202 ? await ateLote('donoA', b.id, (x: any) => x.status === 'LAUNCHED' && x.pieces.every((p: any) => ['ready', 'failed', 'left_out'].includes(p.status)), { timeoutMs: 600_000 }) : null;
  const t = expectOk(await as('donoA').get(`/iterate/${ida.templateBatchId}`));
  const tst = await as('donoA').post(`/iterate/${t.id}/start`, { expectedPieces: t.pieces.length, expectedCostUsd: 0, expectedCredits: t.template?.quote ?? 0 });
  const out = { fit, piecesNoGet: b.pieces.map((p: any) => p.type), start: st.status, startErro: st.body?.error, headlinesNoGerar: (fim?.pieces ?? []).filter((p: any) => p.type === 'HEADLINE').length,
    template: { pecas: t.pieces.length, start: tst.status, erro: tst.body?.error }, saldo: [antes, (await saldo()).balance], livro: await livro() };
  notaQ1('f1b-volta', out);
  expect.soft(fit).toEqual({ level: 'hard', reason: 'headline_pending' });
  expect.soft(out.piecesNoGet).not.toContain('HEADLINE');
  expect.soft(out.headlinesNoGerar).toBe(0);
  expect.soft(out.saldo[1]).toBe(out.saldo[0]);
});
