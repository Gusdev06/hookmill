// Sobe a API de teste (build do QA, mock, maquina_test) e, com --web, o web de teste (Next dev, distDir próprio), com o
// MESMO env que o webServer do Playwright usa. Pra iterar sem subir tudo a cada execução: deixe isto rodando e rode a suíte
// com E2E_REUSE=1 (o globalSetup confere que a API reaproveitada está em mock E no banco de teste). Dono: maquina-qa.
// Uso (de testes/): E2E_API_PORT=3111 node harness/servidores.ts [--web]
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ENV, ROOT_DIR, apiTestEnv, webTestEnv } from './env.ts';

const procs = [
  spawn('node', ['testes/harness/api-qa.mjs'], { cwd: ROOT_DIR, stdio: 'inherit', env: { ...process.env, ...apiTestEnv() } }),
];
if (process.argv.includes('--web')) {
  procs.push(spawn('npx', ['next', 'dev', '--port', String(ENV.webPort)], { cwd: join(ROOT_DIR, 'web'), stdio: 'inherit', env: { ...process.env, ...webTestEnv() } }));
}
console.log(`[qa] API ${ENV.apiUrl}${process.argv.includes('--web') ? ` · web ${ENV.webUrl}` : ''}`);
const parar = () => { for (const p of procs) p.kill('SIGTERM'); process.exit(0); };
process.on('SIGINT', parar);
process.on('SIGTERM', parar);
for (const p of procs) p.on('exit', (code) => { console.log(`[qa] processo saiu (${code})`); parar(); });
