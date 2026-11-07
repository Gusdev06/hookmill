// QA 06/11 do recorte F1b (troca-texto-queimado-v1 §16.6 Q1). API real em mock (Claude/WaveSpeed), troca de texto LOCAL
// (Python + Chrome da VPS, US$ 0) só no workspace qa_ws_alfa, render da HEADLINE no Remotion local, banco maquina_q1_test,
// portas 3471/3466 (nunca 3000/3001). outputDir fora de testes/test-results. Dono: maquina-qa.
// Servidores (de testes/), fase local:
//   PLATE_IMPL=local PLATE_WORKSPACE_IDS=qa_ws_alfa TROCA_PYTHON=/tmp/trocavenv/bin/python REMOTION_BROWSER_EXECUTABLE=<chrome-headless-shell> \
//   E2E_REMIX_REAL=1 E2E_API_PORT=3471 E2E_WEB_PORT=3466 E2E_LIMITES_V2=1 E2E_DATABASE_URL=postgresql://maquina:maquina@localhost:5433/maquina_q1_test?schema=public \
//   node harness/servidores.ts --web
// Suíte: os mesmos E2E_* + E2E_REUSE=1 E2E_COM_WEB=1 Q1_FASE=local npx playwright test -c playwright.qaf1b.config.ts --project=qaf1b-api
// Fase off: servidores com PLATE_IMPL=off; antes rode a volta (playwright.qaf1b-volta.config.ts), depois Q1_FASE=off.
import { defineConfig } from '@playwright/test';
import { ENV } from './harness/env.ts';

if ([3000, 3001].includes(ENV.apiPort) || [3000, 3001].includes(ENV.webPort)) throw new Error('[qa] 3000/3001 são do dev.');
if (!/maquina_q1_test/.test(ENV.databaseUrl)) throw new Error('[qa] este recorte roda só no banco maquina_q1_test.');
const chromium = { browserName: 'chromium' as const, launchOptions: { executablePath: process.env.E2E_CHROMIUM ?? '/usr/bin/chromium' } };

export default defineConfig({
  testDir: './specs',
  workers: 1,
  fullyParallel: false,
  timeout: 2_400_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  globalSetup: './harness/global-setup.ts',
  outputDir: process.env.Q1_PW_OUT ?? '/tmp/q1/pw-out',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 25_000, acceptDownloads: true },
  projects: [
    { name: 'qaf1b-api', testDir: './specs/qa-f1b-api' },
    { name: 'qaf1b-1440', testDir: './specs/qa-f1b', use: { ...chromium, baseURL: ENV.webUrl, viewport: { width: 1440, height: 900 } } },
    // 390: viewport por Emulation.setDeviceMetricsOverride (o Playwright aplica em cada página/rota), então funciona no headless
    { name: 'qaf1b-390', testDir: './specs/qa-f1b', use: { ...chromium, baseURL: ENV.webUrl, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
});
