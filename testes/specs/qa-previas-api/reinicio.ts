// QA Q1 07/11 — retomada após reinício REAL da API (templates-ia-previas-v1 §3.3). Roda em 3 fases com a API do QA (3151):
//   node testes/specs/qa-previas-api/reinicio.ts prep    (API no ar)  cria lotes prontos + aprova 1 e o chamador mata a API com kill -9
//   node testes/specs/qa-previas-api/reinicio.ts mutate  (API fora)   monta os estados "no meio" direto no banco de teste
//   node testes/specs/qa-previas-api/reinicio.ts check   (API de volta) confere o que o boot + sweep fizeram
// Estados: R1 job inicial QUEUED · R2 job inicial RUNNING · R3 novo ângulo QUEUED · R4 rosto de prévia QUEUED · R5 vídeo aprovado no meio.
import { readFileSync, writeFileSync } from 'node:fs';
import { SLUG, call, db, fixture, get, readyAll, sleep, until, use, uuid, type Fx } from './fx.ts';

const STATE = '/tmp/qprev/reinicio.json';
const phase = process.argv[2];

async function prep() {
  const out: Record<string, { fx: Fx; batchId: string }> = {};
  for (const k of ['R1', 'R2', 'R3', 'R5']) {
    const fx = await fixture({ tag: `qprev-reinicio-${k.toLowerCase()}` });
    const r = await use(fx, k === 'R3' ? SLUG.F10 : SLUG.F09);
    await readyAll(r.data.id, fx);
    out[k] = { fx, batchId: r.data.id };
  }
  // R5: aprova 1 e sai já (o chamador mata a API em seguida, com o vídeo no meio)
  const { fx, batchId } = out.R5;
  const p = (await get(batchId, fx)).ai.previews[0].id;
  const ap = await call('POST', `/iterate/${batchId}/ai-previews/approve`, fx.token, { requestId: uuid(), previewIds: [p], expectedCredits: 0 });
  if (ap.status !== 202) throw new Error(`approve R5 ${ap.status}`);
  writeFileSync(STATE, JSON.stringify(out));
  console.log('prep ok', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.batchId])));
}

async function mutate() {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const c5 = await db.creative.findFirst({ where: { variationBatchId: s.R5.batchId } });
  console.log('R5 creative no kill:', c5?.state);
  for (const [k, status] of [['R1', 'QUEUED'], ['R2', 'RUNNING']] as const) {
    const id = s[k].batchId;
    // "/use aceito e o planejador ainda não respondeu": sem itens, lote PLANNING, job inicial QUEUED/RUNNING
    const items = await db.variationItem.findMany({ where: { batchId: id } });
    if (!items.length && k) { /* 2ª execução */ }
    await db.variationItem.deleteMany({ where: { batchId: id } });
    await db.face.deleteMany({ where: { casting: { batchId: id } } });
    await db.variationCasting.deleteMany({ where: { batchId: id } });
    await db.variationBatch.update({ where: { id }, data: { status: 'PLANNING' } });
    const job = (await db.job.findMany({ where: { variationBatchId: id, type: 'AUTO_PLAN' } }))[0];
    await db.job.update({ where: { id: job.id }, data: { status, finishedAt: null, startedAt: status === 'RUNNING' ? new Date() : null, output: undefined } });
    console.log(k, 'itens apagados', items.length, 'job', job.id, '→', status);
  }
  // R3: novo ângulo aceito (prévia A PLANNED sem variação + job QUEUED kind ai_preview_regen) e R4: prévia B IMAGING com rosto QUEUED
  const id = s.R3.batchId;
  const [a, b] = await db.variationItem.findMany({ where: { batchId: id, previewStatus: { not: null } }, orderBy: { index: 'asc' } });
  const pa0 = (a.payload as any).preview;
  // tolera 2ª execução (a 1ª já tirou a variação): volta a do histórico
  const pa = pa0.variation ? pa0 : { ...pa0, variation: pa0.history[0].variation, cast: pa0.history[0].cast, history: [] };
  s.R3.before = { title: pa.variation.title, cast: pa.cast.map((c: any) => c.name) };
  const at = new Date().toISOString();
  await db.variationItem.update({ where: { id: a.id }, data: { previewStatus: 'PLANNED', previewRegens: 1, payload: { ...(a.payload as object), preview: { ...pa, variation: null, summary: null, cast: [], history: [{ variation: pa.variation, cast: pa.cast, at }], regens: [{ requestId: uuid(), at }] } } } });
  if (!(await db.job.count({ where: { variationBatchId: id, input: { path: ['itemId'], equals: a.id } } }))) await db.job.create({ data: { workspaceId: a.workspaceId, createdById: s.R3.fx.userId, type: 'AUTO_PLAN', status: 'QUEUED', variationBatchId: id, input: { batchId: id, itemId: a.id, kind: 'ai_preview_regen' } } });
  const pb = (b.payload as any).preview;
  const faceIds = pb.cast.map((c: any) => c.faceId);
  await db.face.updateMany({ where: { id: { in: faceIds } }, data: { status: 'QUEUED', fileId: null } });
  await db.variationItem.update({ where: { id: b.id }, data: { previewStatus: 'IMAGING', payload: { ...(b.payload as object), preview: { ...pb, imagingAt: at } } } });
  s.R3.items = { regen: a.id, imaging: b.id, faces: faceIds };
  writeFileSync(STATE, JSON.stringify(s));
  console.log('mutate ok');
}

async function check() {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const res: Record<string, unknown> = {};
  const j1 = await db.job.findFirst({ where: { variationBatchId: s.R1.batchId, type: 'AUTO_PLAN' } });
  const b1 = await until(s.R1.batchId, s.R1.fx, (b) => b.status !== 'PLANNING' || b.ai.previews.length > 0, 'R1', 60_000).catch((e) => ({ err: String(e) }));
  const r1 = await until(s.R1.batchId, s.R1.fx, (b) => b.ai.phase !== 'planning', 'R1 fim', 90_000).catch(async () => get(s.R1.batchId, s.R1.fx));
  res.R1 = { jobAntes: j1?.status, jobDepois: (await db.job.findUnique({ where: { id: j1!.id } }))?.status, status: r1.status, phase: r1.ai.phase, previews: r1.ai.previews.length, errorCode: r1.ai.errorCode, ok: r1.status === 'PLAN_READY', first: (b1 as any)?.status };
  const r2 = await until(s.R2.batchId, s.R2.fx, (b) => b.ai.phase !== 'planning', 'R2', 60_000).catch(async () => get(s.R2.batchId, s.R2.fx));
  const j2 = await db.job.findFirst({ where: { variationBatchId: s.R2.batchId, type: 'AUTO_PLAN' } });
  res.R2 = { status: r2.status, phase: r2.ai.phase, errorCode: r2.ai.errorCode, job: `${j2?.status}/${j2?.errorCode}`, ok: r2.status === 'PLAN_FAILED' && j2?.errorCode === 'INTERRUPTED' };
  const r3 = await until(s.R3.batchId, s.R3.fx, (b) => b.ai.generating === 0, 'R3/R4', 90_000).catch(async () => get(s.R3.batchId, s.R3.fx));
  const pa = r3.ai.previews.find((p: any) => p.id === s.R3.items.regen);
  const pb = r3.ai.previews.find((p: any) => p.id === s.R3.items.imaging);
  res.R3 = { status: pa?.status, title: pa?.title, before: s.R3.before, cast: pa?.cast?.map((c: any) => c.name), failReason: pa?.failReason, ok: pa?.status === 'ready' && pa.title !== s.R3.before.title };
  const faces = await db.face.findMany({ where: { id: { in: s.R3.items.faces } } });
  res.R4 = { status: pb?.status, faces: faces.map((f: any) => f.status), failReason: pb?.failReason, ok: pb?.status === 'ready' };
  const r5 = await until(s.R5.batchId, s.R5.fx, (b) => b.ai.phase === 'done' || b.ai.phase === 'failed', 'R5', 240_000).catch(async () => get(s.R5.batchId, s.R5.fx));
  res.R5 = { phase: r5.ai.phase, piece: r5.pieces?.[0]?.status, ok: r5.ai.phase === 'done' };
  console.log(JSON.stringify(res, null, 2));
  await sleep(10);
}

const fn = { prep, mutate, check }[phase as 'prep'];
if (!fn) throw new Error('fase: prep | mutate | check');
fn().then(() => db.$disconnect(), async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
