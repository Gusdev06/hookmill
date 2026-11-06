// Recuperação local: build estável anterior + somente o módulo de variação, sem promover features concorrentes incompletas.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '../..');
const api = path.join(root, 'api');
const cache = path.join(root, 'testes/.cache/semantic-runtime');
const old = path.join(cache, 'api-dist-before-refresh');
const stage = path.join(cache, 'ready-dist');
const mode = process.argv[2];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  if (mode === 'prepare') {
    fs.cpSync(old, stage, { recursive: true });
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ type: 'commonjs' }));
    fs.copyFileSync(path.join(api, 'package.json'), path.join(cache, 'package.json'));
    for (const rel of ['variacao-ia', 'integracoes/claude/semantic-planner.js', 'integracoes/claude/semantic-planner.js.map', 'integracoes/mock/semantic-planner.js', 'integracoes/mock/semantic-planner.js.map']) {
      fs.cpSync(path.join(api, 'dist', rel), path.join(stage, rel), { recursive: true });
    }
    const appPath = path.join(stage, 'app.module.js');
    const app = fs.readFileSync(appPath, 'utf8');
    if (!app.includes('let AppModule = class AppModule') || !app.includes('templates_module_1.TemplatesModule,') || app.includes('variacao_ia_module_1')) throw new Error('Build base divergente');
    fs.writeFileSync(appPath, app.replace('let AppModule = class AppModule', 'const variacao_ia_module_1 = require("./variacao-ia/variacao-ia.module");\nlet AppModule = class AppModule').replace('templates_module_1.TemplatesModule,', 'templates_module_1.TemplatesModule,\n            variacao_ia_module_1.VariacaoIaModule,').replace('//# sourceMappingURL=app.module.js.map', ''));
    process.chdir(api);
    require(path.join(stage, 'app.module.js'));
    console.log('Stage carregável: build anterior + módulo de variações. Fontes das outras features preservadas.');
    return;
  }
  if (mode !== 'restart') throw new Error('Use prepare ou restart PID');
  const pid = Number(process.argv[3]);
  const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  if (command !== 'node dist/main.js') throw new Error('Processo divergente');
  const env = dotenv.parse(fs.readFileSync(path.join(api, '.env')));
  const url = new URL(env.DATABASE_URL);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/maquina' || env.PORT !== '3001') throw new Error('Apenas API e banco locais');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    if (await db.job.count({ where: { status: { in: ['RUNNING', 'QUEUED'] } } })) throw new Error('Há jobs ativos; não reiniciar');
  } finally { await db.$disconnect(); }
  if (!fs.readFileSync(path.join(stage, 'app.module.js'), 'utf8').includes('variacao_ia_module_1.VariacaoIaModule')) throw new Error('Stage não preparado');
  process.kill(pid, 'SIGTERM');
  let stopped = false;
  for (let i = 0; i < 40; i++) {
    await pause(250);
    try { process.kill(pid, 0); } catch { stopped = true; break; }
  }
  if (!stopped) throw new Error('Processo não encerrou; sem SIGKILL');
  // Preserva todo o build concorrente para inspeção, e promove atomicamente o snapshot preparado.
  const displaced = path.join(cache, `unpromoted-dist-${Date.now()}`);
  fs.renameSync(path.join(api, 'dist'), displaced);
  fs.renameSync(stage, path.join(api, 'dist'));
  const logPath = path.join(cache, 'api.log');
  const fd = fs.openSync(logPath, 'a');
  const child = spawn(process.execPath, ['dist/main.js'], { cwd: api, detached: true, stdio: ['ignore', fd, fd], env: process.env });
  child.unref(); fs.closeSync(fd);
  for (let i = 0; i < 40; i++) {
    await pause(500);
    try {
      const res = await fetch('http://localhost:3001/api/v1/ai-variations/config');
      if (res.status === 401) {
        const receipt = { previousPid: pid, pid: child.pid, configStatusWithoutAuth: 401, mode: 'previous-stable-build-plus-semantic-module', logPath, displaced, at: new Date().toISOString() };
        fs.writeFileSync(path.join(__dirname, 'runtime-refresh-result.json'), JSON.stringify(receipt, null, 2));
        console.log(JSON.stringify(receipt)); return;
      }
    } catch {}
  }
  throw new Error('A API não ficou pronta; inspecionar o log local, backup preservado');
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
