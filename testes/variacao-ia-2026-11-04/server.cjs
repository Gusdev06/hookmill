// QA isolado: apenas maquina_test, provedores mock, sem tocar 3000/3001 ou reiniciar a API do Claude.
const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cache = path.join(root, 'testes/.cache/semantic-ia');
Object.assign(process.env, {
  NODE_ENV: 'test', PORT: '3241', PUBLIC_API_URL: 'http://localhost:3241', WEB_ORIGIN: 'http://localhost:3341',
  DATABASE_URL: 'postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public',
  DIRECT_URL: 'postgresql://maquina:maquina@localhost:5433/maquina_test?schema=public',
  JWT_ACCESS_SECRET: 'qa-semantic-local-only-not-a-real-secret-01234567890123',
  STORAGE_ENDPOINT: 'http://localhost:9000', STORAGE_REGION: 'us-east-1', STORAGE_BUCKET: 'maquina-anuncios-test',
  STORAGE_ACCESS_KEY_ID: 'maquina', STORAGE_SECRET_ACCESS_KEY: 'maquina-dev-secret',
  INTEGRACOES_MODE: 'mock', META_MODE: 'mock', META_CRON: 'off', BOOT_RECOVERY: 'off', TEST_MODE: 'off',
  RENDER_IMPL: 'fake', RENDER_REMIX_IMPL: 'fake', ANALYZE_IMPL: 'local', AD_LIBRARY_MODE: 'mock', AI_VARIATIONS_ENABLED: 'on',
  ANTHROPIC_API_KEY: '', WAVESPEED_API_KEY: '', HF_API_KEY_ID: '', HF_API_KEY_SECRET: '', APIFY_TOKEN: '',
  RENDER_LAMBDA_KINDS: '', REMOTION_AWS_ACCESS_KEY_ID: '', REMOTION_AWS_SECRET_ACCESS_KEY: '',
  AWS_ACCESS_KEY_ID: '', AWS_SECRET_ACCESS_KEY: '', AWS_SESSION_TOKEN: '', AWS_PROFILE: '', ANALYZE_LAMBDA_FUNCTION: '',
  PEXELS_API_KEY: '', TEMPLATES: 'on', ITERATE_TEMPLATES: 'on',
});
require('ts-node').register({ project: path.join(root, 'api/tsconfig.json'), transpileOnly: true });
process.chdir(path.join(root, 'api'));
const { NestFactory } = require('@nestjs/core');
const { PrismaClient } = require('@prisma/client');
const { AppModule } = require(path.join(root, 'api/src/app.module.ts'));
const { configureApp } = require(path.join(root, 'api/src/main.ts'));
const { hashPassword } = require(path.join(root, 'api/src/common/util/crypto.ts'));
const { JobsService } = require(path.join(root, 'api/src/jobs/jobs.service.ts'));
const db = new PrismaClient();
let app, workspaceId, userId;
async function close() {
  if (app) { await app.get(JobsService).idle(); await app.close(); }
  if (workspaceId) await db.workspace.delete({ where: { id: workspaceId } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
}
(async () => {
  const [row] = await db.$queryRaw`SELECT current_database() as name`;
  if (row.name !== 'maquina_test') throw new Error('Banco de teste obrigatório');
  app = await NestFactory.create(AppModule, { logger: ['error'], rawBody: true }); configureApp(app);
  const email = `semantic-ui-${randomUUID()}@teste.local`, password = 'semantic-qa-local-123';
  const user = await db.user.create({ data: { email, name: 'Semantic QA', passwordHash: await hashPassword(password), access: 'INTERNAL', accountMode: 'OWN', uiLocale: 'PT_BR' } }); userId = user.id;
  const ws = await db.workspace.create({ data: { name: 'Planejamento de refeições', shortCode: 'AI', uiLocale: 'PT_BR', onboardingCompletedAt: new Date(), memberships: { create: { userId: user.id, role: 'OWNER' } } } }); workspaceId = ws.id;
  const offer = await db.offer.create({ data: { workspaceId, name: 'Meal Planner', language: 'pt-BR', what: 'Aplicativo com cardápio semanal e lista de compras.', audience: 'Pessoas que organizam as refeições da semana.', pains: 'Decidir o cardápio e organizar os ingredientes.', promise: 'Planeje as refeições e organize suas compras em um lugar.', cta: 'Conheça a demonstração do aplicativo.', createdById: user.id } });
  const champion = await db.champion.create({ data: { workspaceId, offerId: offer.id, name: 'Organize a semana — talking head', status: 'READY', rights: 'OWN', createdById: user.id, teardown: { create: { workspaceId, sections: {}, transcript: { language: 'pt-BR', words: [{ word: 'Planeje', startSec: 0, endSec: 1 }, { word: 'suas', startSec: 1, endSec: 1.5 }, { word: 'refeições.', startSec: 1.5, endSec: 2 }] } } } } });
  fs.mkdirSync(cache, { recursive: true }); fs.writeFileSync(path.join(cache, 'fixture.json'), JSON.stringify({ email, password, workspaceId, championId: champion.id }));
  await app.listen(3241, '127.0.0.1');
  console.log('SEMANTIC_QA_READY http://localhost:3241');
})().catch(async (e) => { console.error(e.message); await close(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await close(); process.exit(0); });
