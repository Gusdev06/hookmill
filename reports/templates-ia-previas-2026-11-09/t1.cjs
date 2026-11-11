// T1 (templates-ia-previas-v1 §9), 09/11/2026. Teto US$ 4 / 2 vídeos, autorizado pelo Gusta em 09/11.
// API live na 3161 (t1-api.sh), banco maquina_previas, workspace INTERNAL com monthlySpendCapUsd = 4.
// Etapas: node t1.cjs prep | previews | approve <previewId> | wait | costs
const W = '/data/cerebros/gusta/projects/maquina-anuncios-wt-previas';
const R = `${W}/reports/templates-ia-previas-2026-11-09`;
const { createRequire } = require('node:module');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const req = createRequire(`${W}/api/package.json`);
req('dotenv').config({ path: `${W}/api/.env`, quiet: true });
const { PrismaClient } = req('@prisma/client');
const { JwtService } = req('@nestjs/jwt');
const DB = 'postgresql://maquina:maquina@localhost:5433/maquina_previas?schema=public';
const db = new PrismaClient({ datasources: { db: { url: DB } } });
const API = 'http://localhost:3161/api/v1';
const STATE = `${R}/state.json`;
const st = () => JSON.parse(fs.readFileSync(STATE, 'utf8'));
const save = (o) => fs.writeFileSync(STATE, JSON.stringify(o, null, 2));
const token = (s) => new JwtService({ secret: process.env.JWT_ACCESS_SECRET, signOptions: { expiresIn: '6h' } }).sign({ sub: s.userId, wid: s.ws, role: 'OWNER' });
const call = async (method, path, s, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token(s)}` }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ...j };
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...a) => { const l = `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`; console.log(l); fs.appendFileSync(`${R}/t1.log`, l + '\n'); };

const TRANSCRIPT = 'Para de perder a noite rolando o feed. Esse guia mostra como fazer uma renda extra com ferramentas de IA em um fim de semana, mesmo começando do zero.';

async function prep() {
  const u = await db.user.create({ data: { email: `t1-previas-${Date.now()}@teste.local`, name: 'T1 prévias', passwordHash: 'test-only', access: 'INTERNAL', accountMode: 'OWN' } });
  const w = await db.workspace.create({ data: { name: 'T1 prévias (09/11)', shortCode: 'T1', uiLocale: 'PT_BR', monthlySpendCapUsd: 4, memberships: { create: { userId: u.id, role: 'OWNER' } } } });
  const off = await db.offer.create({ data: {
    workspaceId: w.id, name: 'Renda extra com IA', language: 'pt', createdById: u.id,
    what: 'Guia passo a passo em PDF para começar uma renda extra usando ferramentas de IA, por R$ 97.',
    cta: 'Toque no link e pegue o guia hoje.', audience: 'Adultos que querem uma renda extra sem largar o emprego.',
    promise: 'Começar uma renda extra com IA em um fim de semana.',
  } });
  const words = TRANSCRIPT.split(' ').map((word, i) => ({ word, startSec: i * 0.4, endSec: i * 0.4 + 0.35 }));
  const c = await db.champion.create({ data: { workspaceId: w.id, offerId: off.id, name: 'Talking head de partida', status: 'READY', durationSec: 30, createdById: u.id,
    teardown: { create: { workspaceId: w.id, sections: { identification: { status: 'pending' }, whySells: { status: 'pending' } }, transcript: { language: 'pt', words } } } } });
  save({ userId: u.id, ws: w.id, offerId: off.id, championId: c.id });
  log('prep ok', st());
}

async function poll(s, ok, label, ms) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) {
    last = (await call('GET', `/iterate/${s.batchId}`, s)).data;
    if (last && ok(last)) return last;
    await sleep(5000);
  }
  throw new Error(`timeout ${label}: ${JSON.stringify(last?.ai)?.slice(0, 2000)}`);
}

async function previews() {
  const s = st();
  const t0 = Date.now();
  const r = await call('POST', '/ad-templates/podcast-conversation/use', s, { championId: s.championId, previews: { requestId: randomUUID() } });
  log('use', r.status, r.error ?? r.data?.id);
  if (!r.data?.id) throw new Error('use falhou');
  s.batchId = r.data.id; s.t0 = t0; save(s);
  const b = await poll(s, (x) => ['previews_ready', 'failed', 'plan_failed'].includes(x.ai?.phase) && !x.ai?.generating || x.status === 'PLAN_FAILED', 'prévias', 15 * 60_000);
  s.planReadySec = Math.round((Date.now() - t0) / 1000); save(s);
  fs.writeFileSync(`${R}/batch-previas.json`, JSON.stringify(b, null, 2));
  log('prévias', b.status, b.ai?.phase, `em ${s.planReadySec}s`);
}

async function approve(previewId) {
  const s = st();
  const r = await call('POST', `/iterate/${s.batchId}/ai-previews/approve`, s, { requestId: randomUUID(), previewIds: [previewId], expectedCredits: 0 });
  log('approve', previewId, r.status, r.error ?? r.data);
  (s.approvals ??= []).push({ previewId, at: Date.now() }); save(s);
}

async function wait() {
  const s = st(); let prev = '';
  const b = await poll(s, (x) => {
    const cur = (x.pieces ?? []).map((p) => `${p.code}:${p.status}`).join(' ');
    if (cur !== prev) { log('peças', cur, '| custo', x.cost?.totalUsd); prev = cur; }
    return (x.pieces ?? []).length > 0 && x.pieces.every((p) => ['ready', 'failed', 'done'].includes(p.status));
  }, 'vídeos', 9 * 60_000);
  fs.writeFileSync(`${R}/batch-final.json`, JSON.stringify(b, null, 2));
  log('wait fim', b.status, b.ai?.phase, JSON.stringify(b.cost));
}

async function costs() {
  const s = st();
  const rows = await db.costEntry.findMany({ where: { workspaceId: s.ws }, orderBy: { createdAt: 'asc' } });
  const sum = rows.reduce((a, r) => a + Number(r.amountUsd ?? r.costUsd ?? 0), 0);
  fs.writeFileSync(`${R}/cost-entries.json`, JSON.stringify(rows, (k, v) => (typeof v === 'bigint' ? String(v) : v), 2));
  log('custos', rows.length, 'linhas, total US$', sum.toFixed(4));
}

const [cmd, arg] = process.argv.slice(2);
({ prep, previews, approve: () => approve(arg), wait, costs })[cmd]().catch((e) => { log('ERRO', String(e?.stack ?? e)); process.exitCode = 1; }).finally(() => db.$disconnect());
