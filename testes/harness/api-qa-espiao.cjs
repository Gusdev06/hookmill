// API do QA com "espião" da porta Meta mock (QA 03/11, meta-templates-v2). Dono: maquina-qa.
// Mesmo build do harness/api-qa.mjs (testes/.cache/api-qa/dist, nunca api/dist), mesmo AppModule e mesmo configureApp do
// main.ts. A única diferença: duas rotas SÓ deste processo de teste, fora do prefixo /api/v1 e fora do código de produção,
// que leem/zeram o `FakeMetaService.sent` (os corpos Graph que a publicação montou: campaignBody/adSetBody/creativeBody).
// Com isso o QA confere, pela API real em mock e por HTTP, o que chegaria na Graph (lifetime_budget, end_time, locales…).
// Só sobe com META_MODE=mock (aborta em live/off) e nunca na 3000/3001.
// Uso: E2E_API_CMD='node testes/harness/api-qa-espiao.cjs' (cwd = raiz do monorepo, como o webServer do Playwright).
const { spawnSync } = require('node:child_process');
const { join, resolve } = require('node:path');

const TESTES = resolve(__dirname, '..');
const ROOT = resolve(TESTES, '..');
const API = join(ROOT, 'api');
const DIST = join(TESTES, '.cache', 'api-qa', 'dist');

if (process.env.META_MODE !== 'mock') { console.error('[qa-espiao] BLOQUEADO: META_MODE precisa ser mock'); process.exit(1); }
if (['3000', '3001'].includes(String(process.env.PORT))) { console.error('[qa-espiao] BLOQUEADO: 3000/3001 são do dev'); process.exit(1); }

const b = spawnSync(process.execPath, [join(TESTES, 'harness', 'api-qa.mjs'), '--so-build'], { stdio: 'inherit' });
if (b.status !== 0) process.exit(b.status ?? 1);
process.chdir(API); // dotenv do api/.env por baixo (o env do harness ganha), como no api-qa.mjs

(async () => {
  const { NestFactory } = require('node:module').createRequire(join(DIST, 'main.js'))('@nestjs/core');
  const { AppModule } = require(join(DIST, 'app.module.js'));
  const { configureApp, installProcessGuards } = require(join(DIST, 'main.js'));
  const { META_SERVICE } = require(join(DIST, 'integracoes', 'integracoes.module.js'));
  installProcessGuards();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const meta = app.get(META_SERVICE);
  if (!meta || !meta.sent) { console.error('[qa-espiao] MetaService não é o FakeMetaService (sem .sent)'); process.exit(1); }
  const ex = app.getHttpAdapter().getInstance();
  ex.get('/__qa/meta-sent', (_req, res) => res.json(meta.sent));
  ex.post('/__qa/meta-sent/reset', (_req, res) => {
    meta.sent.campaigns.length = 0; meta.sent.adsets.length = 0; meta.sent.creatives.length = 0;
    res.json({ ok: true });
  });
  const config = configureApp(app);
  await app.listen(config.port);
  console.log(`[qa-espiao] API em http://localhost:${config.port}/api/v1 + /__qa/meta-sent`);
})().catch((e) => { console.error(e); process.exit(1); });
