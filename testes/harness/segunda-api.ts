// Sobe uma SEGUNDA instância da API (porta própria, mesmo env de teste, banco maquina_test) pra testar a retomada no boot
// sem derrubar a API do webServer. Usa o build do QA (testes/.cache/api-qa/dist, feito pelo harness/api-qa.mjs do webServer;
// nunca api/dist, que é o da 3001). Dono: maquina-qa.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ENV, QA_API_DIST, ROOT_DIR, apiTestEnv } from './env.ts';

export interface SegundaApi { proc: ChildProcess; saida: () => string; parar: () => Promise<void> }

export async function subirSegundaApi(port = ENV.apiPort + 1, timeoutMs = 60_000, envExtra: Record<string, string> = {}): Promise<SegundaApi> {
  const main = join(QA_API_DIST, 'main.js');
  if (!existsSync(main)) throw new Error(`[qa] ${main} não existe: o webServer (harness/api-qa.mjs) ainda não compilou a API`);
  let out = '';
  const proc = spawn(process.execPath, [main], {
    cwd: join(ROOT_DIR, 'api'),
    env: { ...process.env, ...apiTestEnv(), PORT: String(port), PUBLIC_API_URL: `http://localhost:${port}`, ...envExtra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (b) => (out += b));
  proc.stderr!.on('data', (b) => (out += b));
  const parar = () =>
    new Promise<void>((res) => {
      if (proc.exitCode !== null) return res();
      proc.once('exit', () => res());
      proc.kill('SIGTERM');
      setTimeout(() => proc.kill('SIGKILL'), 5000);
    });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`[qa] segunda API morreu no boot:\n${out.slice(-2000)}`);
    const ok = await fetch(`http://localhost:${port}/api/v1/health`).then((r) => r.ok, () => false);
    if (ok) return { proc, saida: () => out, parar };
    await new Promise((r) => setTimeout(r, 300));
  }
  await parar();
  throw new Error(`[qa] segunda API não respondeu em ${timeoutMs} ms:\n${out.slice(-2000)}`);
}
