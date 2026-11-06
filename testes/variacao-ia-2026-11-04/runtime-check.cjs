// Diagnóstico somente leitura do processo local; imprime apenas flags não secretas e contagem de jobs.
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '../..');
const env = dotenv.parse(readFileSync(path.join(root, 'api/.env')));
const address = new URL(env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(address.hostname) || address.pathname !== '/maquina') throw new Error('Apenas banco local maquina');
const pid = process.argv[2];
if (!/^\d+$/.test(pid ?? '')) throw new Error('PID obrigatório');
const command = execFileSync('ps', ['eww', '-p', pid, '-o', 'command='], { encoding: 'utf8' });
if (!command.startsWith('node dist/main.js ')) throw new Error('Processo divergente');
const names = ['NODE_ENV', 'PORT', 'META_MODE', 'META_CRON', 'BOOT_RECOVERY', 'INTEGRACOES_MODE', 'ANTHROPIC_MODEL', 'TEST_MODE', 'RENDER_IMPL', 'RENDER_REMIX_IMPL', 'ANALYZE_IMPL', 'AD_LIBRARY_MODE', 'AI_VARIATIONS_ENABLED', 'TEMPLATES', 'ITERATE_TEMPLATES'];
const flags = Object.fromEntries(names.map((name) => [name, { exported: command.match(new RegExp(`(?:^| )${name}=([^ ]*)`))?.[1] ?? null, file: env[name] ?? null }]));
const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
(async () => {
  const activeJobs = await db.job.groupBy({ by: ['type', 'status'], where: { status: { in: ['QUEUED', 'RUNNING'] } }, _count: true });
  console.log(JSON.stringify({ pid, flags, activeJobs }, null, 2));
})().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
