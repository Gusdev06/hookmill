// Apenas as três fixtures deixadas pelo teste interrompido das 08:49 UTC; nunca o banco maquina.
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: 'postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public' } } });
(async () => {
  const rows = await db.workspace.findMany({ where: { name: 'AI templates QA', createdAt: { gte: new Date('2026-11-04T08:49:50Z'), lt: new Date('2026-11-04T08:50:00Z') } }, include: { memberships: { include: { user: true } } } });
  if (!rows.length) { console.log('Fixtures já removidas.'); return; }
  if (rows.length !== 3 || !rows.every((w) => w.memberships.every((m) => /^ai-template-.*@teste\.local$/.test(m.user.email)))) throw new Error('Fixtures divergentes');
  const ids = rows.map((w) => w.id), users = [...new Set(rows.flatMap((w) => w.memberships.map((m) => m.userId)))];
  if (await db.job.count({ where: { workspaceId: { in: ids }, status: { in: ['QUEUED', 'RUNNING'] } } })) throw new Error('Fixture com trabalho ativo');
  await db.$transaction(async (tx) => {
    await tx.creative.updateMany({ where: { workspaceId: { in: ids } }, data: { finalRenderId: null, selectedFaceId: null } });
    await tx.render.deleteMany({ where: { workspaceId: { in: ids } } });
    await tx.creative.deleteMany({ where: { workspaceId: { in: ids } } });
    await tx.workspace.deleteMany({ where: { id: { in: ids } } });
    await tx.user.deleteMany({ where: { id: { in: users } } });
  }, { timeout: 30000 });
  console.log(JSON.stringify({ removedTestWorkspaces: ids.length, removedTestUsers: users.length }));
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
