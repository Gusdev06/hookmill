// Sobe a API dos testes a partir de um build PRÓPRIO do QA (testes/.cache/api-qa/dist), nunca de api/dist. Dono: maquina-qa.
// Por quê (09/10): a API LIVE da 3001 roda `nest start --watch`, que recompila em api/dist (deleteOutDir) a cada mudança do
// backend; `nest start` do harness apagava e reescrevia o mesmo api/dist com a 3001 no ar (asset do YuNet/rosto do mock lido
// sob demanda, reinício pegando build pela metade). Aqui: tsc incremental com o MESMO tsconfig.build.json do nest, saída
// fora do api/, e o processo roda com cwd = api/ (dotenv do api/.env por baixo; o harness sobrescreve banco, porta, mock e
// chaves). `src` ao lado do dist aponta pro api/src, porque o código acha o modelo do YuNet e a foto do rosto mock por
// `__dirname/../../src/...`.
// Uso: node testes/harness/api-qa.mjs            → compila e roda (webServer do Playwright)
//      node testes/harness/api-qa.mjs --so-build → só compila (pra conferir o build antes de rodar a suíte)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTES = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(TESTES, '..');
const API = join(ROOT, 'api');
export const QA_API_DIR = join(TESTES, '.cache', 'api-qa');
const DIST = join(QA_API_DIR, 'dist');

function build() {
  mkdirSync(QA_API_DIR, { recursive: true });
  const link = join(QA_API_DIR, 'src');
  if (existsSync(link) || (() => { try { return lstatSync(link).isSymbolicLink(); } catch { return false; } })()) unlinkSync(link);
  symlinkSync(relative(QA_API_DIR, join(API, 'src')), link);
  const tsc = createRequire(join(API, 'package.json')).resolve('typescript/bin/tsc');
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [tsc, '-p', join(API, 'tsconfig.build.json'), '--outDir', DIST, '--tsBuildInfoFile', join(QA_API_DIR, 'build.tsbuildinfo')], {
    cwd: API, encoding: 'utf8',
  });
  if (r.status !== 0) {
    process.stderr.write(`[qa] build da API falhou (tsc):\n${r.stdout}\n${r.stderr}\n`);
    process.exit(1);
  }
  if (!existsSync(join(DIST, 'main.js'))) {
    process.stderr.write(`[qa] build sem ${join(DIST, 'main.js')} (o rootDir do tsc mudou?)\n`);
    process.exit(1);
  }
  // o testes/package.json é "type": "module"; a API compilada é CommonJS (como no api/)
  writeFileSync(join(QA_API_DIR, 'package.json'), JSON.stringify({ private: true, type: 'commonjs' }) + '\n');
  process.stdout.write(`[qa] API compilada em ${relative(ROOT, DIST)} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`);
}

build();
if (process.argv.includes('--so-build')) process.exit(0);

const child = spawn(process.execPath, ['--enable-source-maps', join(DIST, 'main.js')], { cwd: API, stdio: 'inherit', env: process.env });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code, sig) => process.exit(code ?? (sig ? 1 : 0)));
