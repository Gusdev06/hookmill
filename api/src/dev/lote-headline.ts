// Lote AUTO novo com o MESMO campeão (pedido do Gusta 26/10, teto US$ 2,50) pra ver o HEADLINE com a correção do
// headline_over_face. O campeão veio de upload (sem rota de reuso direto): nasce um lote ANALYSIS_FAILED copiado do antigo
// e a API (:3001) faz o POST /iterate/:id/retry, que reaproveita a análise (reuse) e roda o plano pelo mesmo serviço.
//   npx ts-node --transpile-only src/dev/lote-headline.ts            # cria + plano + resumo (não lança)
//   npx ts-node --transpile-only src/dev/lote-headline.ts --start <id>  # lança o lote já planejado (Gerar)
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { sign } from 'jsonwebtoken';

const ANTIGO = 'cmvot8qxv000b22xlz0yrm60t';
const WS = 'cmvosjusa0003220ogre6h0cf';
const API = `http://localhost:${process.env.PORT ?? 3001}/api/v1`;
const TETO = 2.5;

(async () => {
  const p = new PrismaClient();
  const owner = await p.membership.findFirstOrThrow({ where: { workspaceId: WS, role: 'OWNER' }, select: { userId: true } });
  const token = sign({ sub: owner.userId, wid: WS, role: 'OWNER' }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '30m' });
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, data: j.data, error: j.error };
  };
  const startIdx = process.argv.indexOf('--start');
  let id: string;
  if (startIdx > 0) {
    id = process.argv[startIdx + 1];
  } else {
    const old = await p.variationBatch.findUniqueOrThrow({ where: { id: ANTIGO } });
    const b = await p.variationBatch.create({
      data: {
        workspaceId: old.workspaceId, championId: old.championId, offerId: old.offerId, mode: 'AUTO', language: old.language, requests: [], settings: {},
        status: 'ANALYSIS_FAILED', errorCode: 'INTERRUPTED', failReason: 'novo lote pelo retry (dev/lote-headline.ts)', failStage: 'planning',
        estimatedCostUsd: old.estimatedCostUsd, createdById: owner.userId,
      },
    });
    id = b.id;
    console.log(`lote novo ${id}`);
    const r = await call('POST', `/iterate/${id}/retry`);
    console.log(`retry: ${r.status} ${r.error?.code ?? r.data?.status ?? ''}`);
  }
  let v: any;
  for (let k = 0; k < 120; k++) {
    v = (await call('GET', `/iterate/${id}`)).data;
    if (!v || ['PLAN_READY', 'ANALYSIS_FAILED', 'LAUNCHED'].includes(v.status)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const conta: Record<string, number> = {};
  for (const x of v.pieces ?? []) conta[x.type] = (conta[x.type] ?? 0) + 1;
  const items = await p.variationItem.findMany({ where: { batchId: id, autoType: 'HEADLINE' as never }, select: { code: true, payload: true } });
  console.log(JSON.stringify({
    id, status: v.status, error: v.error, tipos: conta, generateEstimateUsd: v.cost?.generateEstimateUsd, analysisUsd: v.cost?.analysisUsd,
    headlines: items.map((i) => [i.code, (i.payload as any)?.params?.text, (i.payload as any)?.params?.highlight]),
    headlineBlocked: v.insight?.headlineBlocked ?? null, captionsAuto: v.insight?.captionsAuto, swaps: v.insight?.swaps,
  }, null, 1));
  if (startIdx > 0 && v.status === 'PLAN_READY') {
    const est = v.cost?.generateEstimateUsd ?? 0;
    if (est + (v.cost?.analysisUsd ?? 0) > TETO) throw new Error(`estimativa ${est} + análise acima do teto ${TETO}`);
    const s = await call('POST', `/iterate/${id}/start`, { expectedPieces: v.pieces.length, expectedCostUsd: est });
    console.log(`start: ${s.status} ${s.error?.code ?? s.data?.status ?? ''}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
