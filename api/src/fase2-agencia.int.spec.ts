// Fase 2 · agência multi-cliente (docs/contratos/fase2-agencia.md) contra a infra LOCAL (maquina_test + bucket de teste),
// integrações em mock (custo zero). Cobre B1/B2: backfill, Home = Clients (= 3), papel CLIENT, New client com copyTeam,
// onboarding/ONBOARDING_INCOMPLETE, pausar, download com nome provisório × congelado × colisão (_2).
import 'dotenv/config';
process.env.INTEGRACOES_MODE = 'mock';
process.env.BOOT_RECOVERY = 'off';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';
import { StorageService } from './arquivos/storage.service';
import { hashPassword } from './common/util/crypto';
import { configureApp } from './main';

const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? '');
jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const PASSWORD = 'senha-teste-1234';
const DAY = 86_400_000;
type Who = 'owner' | 'admin' | 'member' | 'client' | 'other';

describe(isLocal ? 'Fase 2 agência (integração local)' : 'Fase 2 agência [pulado: DATABASE_URL não é localhost]', () => {
  if (!isLocal) {
    it.skip('precisa de banco local', () => undefined);
    return;
  }

  let app: NestExpressApplication;
  let base: string;
  const prisma = new PrismaClient();
  const users = {} as Record<Who, { id: string; email: string; token: string }>;
  let w1: string; // agência/cliente ativo (MC)
  let w2: string; // workspace de outro usuário
  const created: string[] = []; // workspaces criados pelo POST /workspaces
  let offerId: string;
  let waitingCreative: string;

  const call = async (method: string, path: string, token?: string, body?: unknown) => {
    const r = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = r.status === 204 ? null : await r.json();
    return { status: r.status, body: json as any };
  };
  const mmdd = () => {
    const d = new Date();
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  };

  beforeAll(async () => {
    const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`;
    expect(db).toBe('maquina_test');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true, logger: ['error'] });
    configureApp(app);
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as import('node:net').AddressInfo).port}`;

    const hash = await hashPassword(PASSWORD);
    for (const k of ['owner', 'admin', 'member', 'client', 'other'] as Who[]) {
      const email = `f2-${RUN}-${k}@teste.local`;
      const u = await prisma.user.create({ data: { email, name: `F2 ${k}`, passwordHash: hash } });
      users[k] = { id: u.id, email, token: '' };
    }
    w1 = (await prisma.workspace.create({
      data: {
        name: `f2-${RUN}-agencia`, shortCode: 'MC', onboardingStep: 6, onboardingCompletedAt: new Date(),
        memberships: { create: (['owner', 'admin', 'member', 'client'] as Who[]).map((k) => ({ userId: users[k].id, role: k === 'owner' ? 'OWNER' : k === 'admin' ? 'ADMIN' : k === 'member' ? 'MEMBER' : 'CLIENT' })) },
      },
    })).id;
    w2 = (await prisma.workspace.create({
      data: { name: `f2-${RUN}-outro`, shortCode: 'OT', onboardingCompletedAt: new Date(), memberships: { create: { userId: users.other.id, role: 'OWNER' } } },
    })).id;
    for (const k of Object.keys(users) as Who[]) {
      const r = await call('POST', '/auth/login', undefined, { email: users[k].email, password: PASSWORD });
      expect(r.status).toBe(200);
      users[k].token = r.body.data.accessToken;
    }

    // "Waiting for you" do w1: 1 criativo esperando + 1 lote PLAN_READY + 1 PLAN_FAILED = 3.
    // Fora da conta: rascunho de 8 dias, lote PLANNING, LAUNCHED e PLAN_READY de campeão arquivado.
    const owner = users.owner.id;
    offerId = (await prisma.offer.create({ data: { workspaceId: w1, name: 'Colchão', language: 'en', what: 'Mattress', promise: 'Sleep', createdById: owner } })).id;
    waitingCreative = (await prisma.creative.create({ data: { workspaceId: w1, offerId, name: 'Esperando roteiro', language: 'en', state: 'SCRIPTS_READY', createdById: owner } })).id;
    await prisma.creative.create({ data: { workspaceId: w1, offerId, name: 'Rascunho velho', language: 'en', state: 'AVATAR_PENDING', createdById: owner, updatedAt: new Date(Date.now() - 8 * DAY) } });
    await prisma.creative.create({ data: { workspaceId: w1, offerId, name: 'Gerando', language: 'en', state: 'SCRIPTS_WRITING', createdById: owner } });
    const champ = (name: string, archived = false) =>
      prisma.champion.create({ data: { workspaceId: w1, offerId, name, status: 'READY', createdById: owner, archivedAt: archived ? new Date() : null } });
    const live = await champ('Campeão vivo');
    const dead = await champ('Campeão arquivado', true);
    const batch = (championId: string, status: 'PLANNING' | 'PLAN_READY' | 'PLAN_FAILED' | 'LAUNCHED') =>
      prisma.variationBatch.create({ data: { workspaceId: w1, championId, offerId, status, language: 'en', requests: [], createdById: owner } });
    await batch(live.id, 'PLAN_READY');
    await batch(live.id, 'PLAN_FAILED');
    await batch(live.id, 'PLANNING');
    await batch(live.id, 'LAUNCHED');
    await batch(dead.id, 'PLAN_READY');
  });

  afterAll(async () => {
    const ids = [w1, w2, ...created].filter(Boolean);
    if (ids.length) {
      await prisma.creative.updateMany({ where: { workspaceId: { in: ids } }, data: { selectedFaceId: null, selectedScriptId: null, finalRenderId: null, thumbnailFileId: null } });
      await prisma.creative.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.variationBatch.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.champion.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.job.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.offer.deleteMany({ where: { workspaceId: { in: ids } } });
      await prisma.workspace.deleteMany({ where: { id: { in: ids } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: `f2-${RUN}-` } } });
    }
    await app?.close();
    await prisma.$disconnect();
  });

  it('backfill da migração: workspace anterior à fase2_agencia nunca cai em SETUP', async () => {
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      select count(*)::int as n from workspaces w, _prisma_migrations m
      where m.migration_name = '20261012000000_fase2_agencia' and w.created_at < (m.started_at at time zone 'UTC')
        and (w.onboarding_completed_at is null or w.onboarding_step <> 6 or w.short_code !~ '^[A-Z0-9]{2,6}$')`;
    expect(n).toBe(0);
  });

  it('Home = Clients = 3 (1 criativo + PLAN_READY + PLAN_FAILED); lotes listados só com needs_you', async () => {
    const home = await call('GET', '/creatives?filter=needs_you', users.owner.token);
    expect(home.status).toBe(200);
    expect(home.body.meta.waitingOnYou).toEqual({ creatives: 1, batches: 2, total: 3 });
    expect(home.body.meta.counts.needs_you).toBe(1); // badge do Review: só criativos
    expect(home.body.data.map((c: any) => c.id)).toEqual([waitingCreative]);
    expect(home.body.meta.waitingBatches.map((b: any) => b.status).sort()).toEqual(['PLAN_FAILED', 'PLAN_READY']);
    expect(home.body.meta.waitingBatches[0]).toMatchObject({ championName: 'Campeão vivo', offer: { id: offerId, name: 'Colchão' } });

    const clients = await call('GET', '/workspaces', users.owner.token);
    expect(clients.status).toBe(200);
    const card = clients.body.data.find((c: any) => c.id === w1);
    expect(card.waitingOnYou).toEqual(home.body.meta.waitingOnYou);
    expect(card).toMatchObject({ isActive: true, role: 'OWNER', status: 'LIVE', shortCode: 'MC' });
    expect(clients.body.meta).toMatchObject({ canCreate: true });

    // filtros de busca não mudam o número do workspace; counts seguem os filtros
    const filtered = await call('GET', `/creatives?filter=needs_you&q=zzz-nada`, users.owner.token);
    expect(filtered.body.meta.waitingOnYou.total).toBe(3);
    expect(filtered.body.meta.counts.needs_you).toBe(0);
    const all = await call('GET', '/creatives?filter=all', users.owner.token);
    expect(all.body.meta.waitingOnYou.total).toBe(3);
    expect(all.body.meta.waitingBatches).toEqual([]);

    // o CLIENT vê o mesmo número
    expect((await call('GET', '/creatives', users.client.token)).body.meta.waitingOnYou.total).toBe(3);
  });

  it('GET /workspaces: só os workspaces do usuário (isolamento)', async () => {
    const r = await call('GET', '/workspaces', users.other.token);
    expect(r.body.data.map((c: any) => c.id)).toEqual([w2]);
    expect(r.body.meta.summary).toEqual({ live: 1, setup: 0, paused: 0, waitingTotal: 0 });
  });

  it('CLIENT: lê tudo, mas não gasta nem configura (403 sem @ClientAllowed)', async () => {
    const t = users.client.token;
    expect((await call('GET', '/workspace', t)).status).toBe(200);
    expect((await call('GET', '/workspace/members', t)).status).toBe(200);
    expect((await call('GET', '/library', t)).status).toBe(200);
    const denied: [string, string, unknown][] = [
      ['POST', '/offers', { name: 'x', language: 'en' }],
      ['POST', '/creatives', { offerId }],
      ['PATCH', `/creatives/${waitingCreative}`, { name: 'x' }],
      ['PATCH', '/workspace', { name: 'x' }],
      ['POST', '/workspace/onboarding/complete', {}],
      ['POST', '/workspace/invites', { email: 'x@y.z', role: 'MEMBER' }],
      ['POST', '/workspaces', { name: 'Novo' }],
      ['POST', `/creatives/${waitingCreative}/changes`, { type: 'SCENE', sceneIndex: 0 }],
      ['POST', `/creatives/${waitingCreative}/changes`, { type: 'FACE' }],
    ];
    for (const [m, p, b] of denied) {
      const r = await call(m, p, t, b);
      expect([m, p, r.status, r.body.error?.code]).toEqual([m, p, 403, 'FORBIDDEN']);
    }
    // rotas liberadas passam do guard (o resto é regra do recurso)
    const text = await call('POST', `/creatives/${waitingCreative}/changes`, t, { type: 'TEXT' });
    expect(text.status).toBe(409);
    expect((await call('PATCH', '/auth/me', t, { uiLocale: 'EN' })).status).toBe(200);
    expect((await call('POST', '/auth/switch-workspace', t, { workspaceId: w1 })).status).toBe(200);
  });

  it('MEMBER: não cria cliente nem configura; ADMIN configura', async () => {
    expect((await call('POST', '/workspaces', users.member.token, { name: 'Novo' })).status).toBe(403);
    expect((await call('PATCH', '/workspace', users.member.token, { industry: 'x' })).status).toBe(403);
    const r = await call('PATCH', '/workspace', users.admin.token, { industry: 'Sleep products' });
    expect(r.status).toBe(200);
    expect(r.body.data.industry).toBe('Sleep products');
  });

  it('convite e papel aceitam CLIENT', async () => {
    const inv = await call('POST', '/workspace/invites', users.owner.token, { email: `f2-${RUN}-conv@teste.local`, role: 'CLIENT' });
    expect(inv.status).toBe(201);
    const mem = await call('PATCH', `/workspace/members/${users.member.id}`, users.owner.token, { role: 'CLIENT' });
    expect(mem.body.data.role).toBe('CLIENT');
    await call('PATCH', `/workspace/members/${users.member.id}`, users.owner.token, { role: 'MEMBER' });
  });

  it('New client: SETUP, criador OWNER, copia OWNER/ADMIN (copyTeam), sessão trocada; copyTeam false = só o criador', async () => {
    const r = await call('POST', '/workspaces', users.owner.token, { name: 'Mattress Company', businessType: 'ONLINE_STORE' });
    expect(r.status).toBe(201);
    const s = r.body.data;
    created.push(s.client.id);
    expect(s.workspace).toEqual({ id: s.client.id, name: 'Mattress Company', role: 'OWNER' });
    expect(s.accessToken).toBeTruthy();
    expect(s.refreshToken).toBeTruthy();
    expect(s.client).toMatchObject({ shortCode: 'MC', status: 'SETUP', isActive: true, role: 'OWNER', onboarding: { step: 1, totalSteps: 6, completedAt: null }, waitingOnYou: { total: 0 } });
    const team = await prisma.membership.findMany({ where: { workspaceId: s.client.id }, select: { userId: true, role: true } });
    expect(team.map((m) => `${m.userId}:${m.role}`).sort()).toEqual([`${users.admin.id}:ADMIN`, `${users.owner.id}:OWNER`].sort());

    // a sessão nova já aponta pro cliente novo
    const me = await call('GET', '/workspace', s.accessToken);
    expect(me.body.data).toMatchObject({ id: s.client.id, status: 'SETUP', defaultResult: 'PURCHASES' });

    const solo = await call('POST', '/workspaces', users.owner.token, { name: 'Solo', shortCode: 'SOLO', copyTeam: false });
    created.push(solo.body.data.client.id);
    expect(await prisma.membership.count({ where: { workspaceId: solo.body.data.client.id } })).toBe(1);

    expect((await call('POST', '/workspaces', users.owner.token, { name: 'x', shortCode: 'mc' })).status).toBe(400);
  });

  it('onboarding: autosave, ONBOARDING_INCOMPLETE, complete idempotente, passo travado depois, pausar', async () => {
    const r = await call('POST', '/workspaces', users.owner.token, { name: 'Dental Clinic' });
    const t = r.body.data.accessToken;
    const id = r.body.data.client.id;
    created.push(id);

    const inc = await call('POST', '/workspace/onboarding/complete', t, {});
    expect(inc.status).toBe(422);
    expect(inc.body.error).toMatchObject({ code: 'ONBOARDING_INCOMPLETE', details: { missing: ['businessType', 'offer'] } });

    const p = await call('PATCH', '/workspace', t, { onboardingStep: 3, businessType: 'LOCAL_BUSINESS', market: 'Brasil', websiteUrl: 'https://dental.example' });
    expect(p.body.data).toMatchObject({ onboarding: { step: 3 }, defaultResult: 'LEADS', market: 'Brasil', status: 'SETUP' });
    expect((await call('PATCH', '/workspace', t, { websiteUrl: 'ftp://x' })).status).toBe(400);
    expect((await call('PATCH', '/workspace', t, { onboardingStep: 7 })).status).toBe(400);

    const inc2 = await call('POST', '/workspace/onboarding/complete', t, {});
    expect(inc2.body.error.details).toEqual({ missing: ['offer'] });

    await prisma.offer.create({ data: { workspaceId: id, name: 'Implante', language: 'pt-BR', createdById: users.owner.id } });
    const done = await call('POST', '/workspace/onboarding/complete', t, {});
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe('LIVE');
    expect(done.body.data.onboarding.completedAt).toBeTruthy();
    const again = await call('POST', '/workspace/onboarding/complete', t, {});
    expect(again.status).toBe(200);
    expect(again.body.data.onboarding.completedAt).toBe(done.body.data.onboarding.completedAt);

    const locked = await call('PATCH', '/workspace', t, { onboardingStep: 2 });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatchObject({ code: 'INVALID_STATE', details: { reason: 'onboarding_completed' } });

    expect((await call('PATCH', '/workspace', t, { paused: true })).body.data.status).toBe('PAUSED');
    const list = await call('GET', '/workspaces', t);
    expect(list.body.data[list.body.data.length - 1].id).toBe(id); // pausado vai pro fim
    expect(list.body.meta.summary.paused).toBe(1);
    expect((await call('PATCH', '/workspace', t, { paused: false })).body.data.status).toBe('LIVE');
  });

  describe('Send: download com nome padronizado (§3.5, §6)', () => {
    const storage = () => app.get(StorageService);
    async function renderReady(name: string) {
      const owner = users.owner.id;
      const c = await prisma.creative.create({ data: { workspaceId: w1, offerId, name, language: 'en', state: 'RENDER_READY', format: 'VERTICAL_9_16', createdById: owner } });
      const script = await prisma.script.create({ data: { workspaceId: w1, creativeId: c.id, letter: 'A', status: 'READY' } });
      const face = await prisma.face.create({ data: { workspaceId: w1, creativeId: c.id, batch: 1, position: 1, description: 'x', status: 'READY' } });
      const file = await storage().put(Buffer.from('fake-mp4'), { workspaceId: w1, kind: 'RENDER_VIDEO', mimeType: 'video/mp4' });
      await prisma.render.create({ data: { workspaceId: w1, creativeId: c.id, status: 'READY', settings: {}, input: {}, fileId: file.id, durationSec: 21.5 } });
      await prisma.creative.update({ where: { id: c.id }, data: { selectedScriptId: script.id, selectedFaceId: face.id } });
      return c.id;
    }

    it('provisório → congelado no approve (CLIENT) → colisão _2; Content-Disposition no storage', async () => {
      const expected = `MC_NEW_${mmdd()}_A_F2_9x16`;
      const a = await renderReady('Envio A');
      const b = await renderReady('Envio B');

      const prov = await call('GET', `/creatives/${a}/download`, users.client.token);
      expect(prov.status).toBe(200);
      expect(prov.body.data).toMatchObject({ fileName: `${expected}.mp4`, frozen: false, sizeBytes: 8, durationSec: 21.5 });
      const res = await fetch(prov.body.data.url);
      expect(res.status).toBe(200);
      // confirma que o storage local respeita o ResponseContentDisposition (senão a rota precisaria do 302 → /download/file)
      expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${expected}.mp4"`);

      const ok = await call('POST', `/creatives/${a}/approve`, users.client.token, {});
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ state: 'APPROVED', adName: expected });
      const frozen = await call('GET', `/creatives/${a}/download`, users.owner.token);
      expect(frozen.body.data).toMatchObject({ fileName: `${expected}.mp4`, frozen: true });

      // mesmo dia, mesmas partes: o provisório já enxerga a colisão; o approve congela com _2
      expect((await call('GET', `/creatives/${b}/download`, users.owner.token)).body.data.fileName).toBe(`${expected}_2.mp4`);
      const ok2 = await call('POST', `/creatives/${b}/approve`, users.owner.token, {});
      expect(ok2.body.data.adName).toBe(`${expected}_2`);

      // shortCode editado não renomeia aprovados
      await call('PATCH', '/workspace', users.owner.token, { shortCode: 'ZZ' });
      expect((await call('GET', `/creatives/${a}/download`, users.owner.token)).body.data.fileName).toBe(`${expected}.mp4`);
      await call('PATCH', '/workspace', users.owner.token, { shortCode: 'MC' });

      const lib = await call('GET', '/library', users.client.token);
      expect(lib.body.data.find((i: any) => i.id === a).adName).toBe(expected);
      expect((await call('PUT', `/library/${a}/winner`, users.client.token, { isWinner: true })).status).toBe(200);
    });

    it('CLIENT pede ajuste de TEXT (sem custo) num criativo pronto', async () => {
      const c = await renderReady('Envio texto');
      const r = await call('POST', `/creatives/${c}/changes`, users.client.token, { type: 'TEXT' });
      expect(r.status).toBe(200);
      expect(r.body.data.creative.state).toBe('EDIT_PENDING');
    });

    it('fora de RENDER_READY/APPROVED: 409; outro workspace: 404', async () => {
      const r = await call('GET', `/creatives/${waitingCreative}/download`, users.owner.token);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('INVALID_STATE');
      expect((await call('GET', `/creatives/${waitingCreative}/download`, users.other.token)).status).toBe(404);
    });
  });
});
