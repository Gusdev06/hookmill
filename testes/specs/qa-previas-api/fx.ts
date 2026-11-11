// QA Q1 (templates-ia-previas-v1 §13): fixtures e cliente HTTP do recorte das prévias. Banco maquina_previas_test,
// API do QA na 3151 (testes/harness/api-qa.mjs, mock, RENDER_IMPL=fake). Nada pago. Dono: maquina-qa.
// O Prisma vem do api/ do worktree (client gerado com as colunas preview_*), nunca do testes/node_modules (client da F1b).
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const W = '/data/cerebros/gusta/projects/maquina-anuncios-wt-previas';
const req = createRequire(`${W}/api/src/main.ts`);
export const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://maquina:maquina@localhost:5433/maquina_previas_test?schema=public';
if (!/localhost:5433\/maquina_previas_test\?/.test(DB_URL)) throw new Error('[qa] Q1 roda só no maquina_previas_test');
export const API = process.env.E2E_API_URL ?? 'http://localhost:3151/api/v1';
if (/:(3000|3001|3141)\//.test(API)) throw new Error('[qa] 3000/3001/3141 não são do QA');
const { PrismaClient } = req('@prisma/client');
const { JwtService } = req('@nestjs/jwt');
export const db = new PrismaClient({ datasources: { db: { url: DB_URL } } });
const jwt = new JwtService({ secret: 'qa-segredo-de-teste-nao-usar-em-lugar-nenhum-0123456789abcdef0123', signOptions: { expiresIn: '2h' } });

export type R = { status: number; success?: boolean; data?: any; error?: { code: string; message?: string; details?: any } }; // eslint-disable-line @typescript-eslint/no-explicit-any
export const call = async (method: string, path: string, token: string, body?: unknown): Promise<R> => {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ...j };
};
export const uuid = () => randomUUID();
export const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

export type Fx = { token: string; ws: string; championId: string; offerId: string; userId: string; tag: string };
export const created = { users: [] as string[], workspaces: [] as string[] };
export const TRANSCRIPT = 'Stop wasting your evenings scrolling. This guide shows how to earn extra income with AI tools in one weekend.';

/** Workspace + dono (+ crédito) + oferta + campeão READY com fala. `what` pode carregar gatilho [mock:*]. */
export async function fixture(o: { access?: 'INTERNAL' | 'PAID'; what?: string; credits?: number; tag?: string } = {}): Promise<Fx> {
  const tag = o.tag ?? 'qprev';
  const u = await db.user.create({ data: { email: `${tag}-${randomUUID()}@teste.local`, name: 'QA previas', passwordHash: 'test-only', access: o.access ?? 'INTERNAL', accountMode: 'OWN' } });
  created.users.push(u.id);
  const w = await db.workspace.create({ data: { name: `QA previas ${tag}`, shortCode: 'QP', memberships: { create: { userId: u.id, role: 'OWNER' } } } });
  created.workspaces.push(w.id);
  const off = await db.offer.create({ data: {
    workspaceId: w.id, name: 'Renda extra com IA', language: 'en', createdById: u.id,
    what: o.what ?? 'A step-by-step guide to earning extra income with AI tools, for 97 reais.',
    cta: 'Tap the link and get the guide today.', audience: 'Adults who want a side income without quitting their job.',
    promise: 'Start a side income with AI in one weekend.',
  } });
  const words = TRANSCRIPT.split(' ').map((word, i) => ({ word, startSec: i * 0.4, endSec: i * 0.4 + 0.35 }));
  const c = await db.champion.create({ data: { workspaceId: w.id, offerId: off.id, name: 'Talking head vencedor', status: 'READY', durationSec: 30, createdById: u.id,
    teardown: { create: { workspaceId: w.id, sections: { identification: { status: 'pending' }, whySells: { status: 'pending' } }, transcript: { language: 'en', words } } } } });
  if (o.credits) {
    // mesmo efeito do CreditosService.post(GRANT): saldo no usuário + linha no ledger
    await db.user.update({ where: { id: u.id }, data: { creditBalance: o.credits } });
    await db.creditEntry.create({ data: { userId: u.id, workspaceId: w.id, pool: 'CREDITS', kind: 'GRANT', amount: o.credits, delta: o.credits, balanceAfter: o.credits, idempotencyKey: `qprev-grant-${randomUUID()}` } });
  }
  return { token: jwt.sign({ sub: u.id, wid: w.id, role: 'OWNER' }), ws: w.id, championId: c.id, offerId: off.id, userId: u.id, tag };
}
/** Membro extra no workspace (CLIENT/MEMBER) → token. */
export async function member(fx: Fx, role: 'CLIENT' | 'MEMBER' | 'ADMIN'): Promise<string> {
  const u = await db.user.create({ data: { email: `qprev-${role.toLowerCase()}-${randomUUID()}@teste.local`, name: role, passwordHash: 'test-only', access: 'INTERNAL' } });
  created.users.push(u.id);
  await db.membership.create({ data: { userId: u.id, workspaceId: fx.ws, role } });
  return jwt.sign({ sub: u.id, wid: fx.ws, role });
}

export const SLUG = { F04: 'ai-faq', F09: 'podcast-solo', F10: 'podcast-conversation' } as const;
export const use = (fx: Fx, slug: string, requestId = uuid(), extra: Record<string, unknown> = {}) =>
  call('POST', `/ad-templates/${slug}/use`, fx.token, { championId: fx.championId, previews: { requestId }, ...extra });
export const get = async (id: string, fx: Fx) => (await call('GET', `/iterate/${id}`, fx.token)).data;
/** Polling (a API real tem o sweep de 3 s ligado; nada é empurrado pelo teste). */
export async function until(id: string, fx: Fx, ok: (b: any) => boolean, label: string, ms = 120_000) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const end = Date.now() + ms;
  let last: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  while (Date.now() < end) {
    last = await get(id, fx);
    if (last && ok(last)) return last;
    await sleep(1000);
  }
  throw new Error(`timeout (${label}): status=${last?.status} ai=${JSON.stringify(last?.ai)?.slice(0, 1500)}`);
}
export const readyAll = (id: string, fx: Fx) => until(id, fx, (b) => b.ai?.phase === 'previews_ready' && b.ai.generating === 0, 'prévias prontas');

export async function cleanup() {
  const ws = created.workspaces;
  if (ws.length) {
    await db.creative.updateMany({ where: { workspaceId: { in: ws } }, data: { finalRenderId: null, selectedFaceId: null } });
    await db.render.deleteMany({ where: { workspaceId: { in: ws } } });
    await db.creative.deleteMany({ where: { workspaceId: { in: ws } } });
    await db.workspace.deleteMany({ where: { id: { in: ws } } });
  }
  if (created.users.length) {
    await db.creditEntry.deleteMany({ where: { userId: { in: created.users } } }).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: created.users } } });
  }
  await db.$disconnect();
}
