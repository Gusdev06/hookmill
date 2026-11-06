// Atualiza somente o processo local, após build + migração. Não interrompe trabalho ativo.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '../..'), api = path.join(root, 'api');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const pid = Number(process.argv[2]);
  const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  if (!/^(?:\S*\/)?node dist\/main\.js$/.test(cmd)) throw new Error('Processo divergente');
  const env = dotenv.parse(fs.readFileSync(path.join(api, '.env')));
  const url = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/maquina' || env.PORT !== '3001') throw new Error('Somente ambiente local');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const active = {
      jobs: await db.job.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
      tasks: await db.providerTask.count({ where: { status: 'SUBMITTED' } }),
      renders: await db.render.count({ where: { status: { in: ['QUEUED', 'RENDERING'] } } }),
    };
    if (Object.values(active).some(Boolean)) throw new Error(`Trabalho em andamento: ${JSON.stringify(active)}`);
  } finally { await db.$disconnect(); }
  if (!fs.existsSync(path.join(api, 'dist/templates-ai/templates-ai.service.js'))) throw new Error('Build incompleto');
  process.kill(pid, 'SIGTERM');
  let stopped = false;
  for (let i = 0; i < 40; i++) { await pause(250); try { process.kill(pid, 0); } catch { stopped = true; break; } }
  if (!stopped) throw new Error('Não encerrou; nenhum SIGKILL enviado');
  const logPath = path.join(root, 'testes/.cache/semantic-runtime/api-ai-production.log');
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, ['dist/main.js'], { cwd: api, detached: true, stdio: ['ignore', fd, fd], env: process.env });
  child.unref(); fs.closeSync(fd);
  for (let i = 0; i < 40; i++) {
    await pause(500);
    try { if ((await fetch('http://localhost:3001/api/v1/ad-templates')).status === 401) {
      const receipt = { previousPid: pid, pid: child.pid, ready: true, logPath, at: new Date().toISOString() };
      fs.writeFileSync(path.join(root, 'reports/templates-ia-background-2026-11-04/runtime.json'), JSON.stringify(receipt, null, 2));
      console.log(JSON.stringify(receipt)); return;
    } } catch {}
  }
  throw new Error('API ainda não ficou pronta; consultar o log');
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
