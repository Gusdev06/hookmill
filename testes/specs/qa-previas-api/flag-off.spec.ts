// QA Q1 07/11 — AI_PREVIEWS=off (§1.8): o fluxo de 04/11 roda igual e as rotas novas dão 404. Só com a API do QA subida em off:
//   Q1_FLAG=off Q1_BATCH=<lote de prévias criado com a flag on> npx playwright test -c playwright.qaprevias.config.ts --project=qaprevias-api flag-off
import { expect, test } from '@playwright/test';
import { SLUG, call, cleanup, db, fixture, until, use, uuid } from './fx.ts';

test.skip(process.env.Q1_FLAG !== 'off', 'só com a API em AI_PREVIEWS=off');
test.afterAll(cleanup);

test('AI_PREVIEWS=off: /use volta ao corpo de 04/11 (generation → vídeo), previews recusado, rotas novas 404', async () => {
  const a = await fixture({ tag: 'qprev-off' });
  const p = await use(a, SLUG.F09);
  expect([p.status, p.error?.details?.fields?.[0]]).toEqual([400, { field: 'previews', rule: 'notAllowed' }]);
  const key = uuid();
  const r = await call('POST', `/ad-templates/${SLUG.F09}/use`, a.token, { championId: a.championId, generation: { requestId: key, expectedCredits: 0 } });
  expect(r.status).toBe(202);
  expect(r.data.ai ?? null).toBeNull();
  const again = await call('POST', `/ad-templates/${SLUG.F09}/use`, a.token, { championId: a.championId, generation: { requestId: key, expectedCredits: 0 } });
  expect(again.data.id).toBe(r.data.id);
  const done = await until(r.data.id, a, (b) => b.pieces?.[0]?.status === 'ready' || b.pieces?.[0]?.status === 'failed', 'vídeo 04/11', 300_000);
  expect(done.status).toBe('LAUNCHED');
  expect(done.pieces).toHaveLength(1);
  expect(done.pieces[0].status).toBe('ready');
  expect(done.pieces[0].files?.[0]?.mimeType).toBe('video/mp4');
  expect(await db.variationItem.count({ where: { batchId: r.data.id, previewStatus: { not: null } } })).toBe(0);
  // lote de prévias criado com a flag on: rotas novas = 404 (a leitura continua)
  const old = process.env.Q1_BATCH;
  if (old) {
    const b = await db.variationBatch.findUniqueOrThrow({ where: { id: old } });
    const owner = await db.membership.findFirstOrThrow({ where: { workspaceId: b.workspaceId, role: 'OWNER' } });
    const { JwtService } = (await import('node:module')).createRequire('/data/cerebros/gusta/projects/maquina-anuncios-wt-previas/api/src/main.ts')('@nestjs/jwt');
    const tok = new JwtService({ secret: 'qa-segredo-de-teste-nao-usar-em-lugar-nenhum-0123456789abcdef0123' }).sign({ sub: owner.userId, wid: b.workspaceId, role: 'OWNER' });
    const item = await db.variationItem.findFirstOrThrow({ where: { batchId: old, previewStatus: 'READY' } });
    for (const [path, body] of [['approve', { requestId: uuid(), previewIds: [item.id], expectedCredits: 0 }], [`${item.id}/regenerate`, { requestId: uuid() }], [`${item.id}/retry`, { requestId: uuid() }]] as const) {
      expect((await call('POST', `/iterate/${old}/ai-previews/${path}`, tok, body)).status, path).toBe(404);
    }
    expect((await call('GET', `/iterate/${old}`, tok)).status).toBe(200);
  }
});
