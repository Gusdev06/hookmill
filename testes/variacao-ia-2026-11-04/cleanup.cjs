// Remove somente a fixture criada por server.cjs, caso o terminal interrompa o teardown.
const { PrismaClient } = require('@prisma/client');
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '../..');
const fixture = JSON.parse(readFileSync(resolve(root, 'testes/.cache/semantic-ia/fixture.json'), 'utf8'));
const db = new PrismaClient({ datasources: { db: { url: 'postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public' } } });
(async () => {
  const [database] = await db.$queryRaw`SELECT current_database() as name`;
  if (database.name !== 'maquina_test' || !/^semantic-ui-[a-f0-9-]+@teste\.local$/.test(fixture.email)) throw new Error('Fixture de QA obrigatória');
  const owner = await db.user.findUnique({ where: { email: fixture.email } });
  const workspace = await db.workspace.findUnique({ where: { id: fixture.workspaceId }, include: { memberships: true } });
  if (workspace) {
    if (!owner || workspace.memberships.length !== 1 || workspace.memberships[0].userId !== owner.id || workspace.name !== 'Planejamento de refeições') throw new Error('Fixture divergente; não remover');
    await db.workspace.delete({ where: { id: workspace.id } });
  }
  if (owner) await db.user.delete({ where: { id: owner.id } });
  const remaining = await db.workspace.count({ where: { id: fixture.workspaceId } });
  const receipt = { database: database.name, remainingFixtureWorkspaces: remaining, remainingFixtureUsers: await db.user.count({ where: { email: fixture.email } }), checkedAt: new Date().toISOString() };
  writeFileSync(resolve(__dirname, 'cleanup-result.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
})().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
