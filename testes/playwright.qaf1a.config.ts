// QA 06/11 do recorte F1a (troca-texto-queimado-v1 §15.1/15.3/15.4/15.13 + f1a-handoff). API real em mock + web de teste (sem MSW),
// banco próprio maquina_f1a_test, portas próprias (nunca 3000/3001). Nada pago. Dono: maquina-qa.
// Servidores (de testes/), em outro terminal:
//   E2E_API_PORT=3171 E2E_WEB_PORT=3266 E2E_LIMITES_V2=1 E2E_DATABASE_URL=postgresql://maquina:maquina@localhost:5433/maquina_f1a_test?schema=public node harness/servidores.ts --web
// Suíte: os mesmos env + E2E_REUSE=1 E2E_COM_WEB=1 E2E_SKIP_SCHEMA=1 E2E_EXIGE_MIGRACAO=20261110000100_editor_universal \
//   npx playwright test -c playwright.qaf1a.config.ts --project=qaf1a-api --project=qaf1a-1440 --project=qaf1a-390
// Depois: restaurar web/next-env.d.ts (o next dev aponta pra .next-qa). Não dar git checkout em web/tsconfig.json sem olhar: tem mudança sem commit.
import { defineConfig } from '@playwright/test';
import { ENV } from './harness/env.ts';

const CHROME = process.env.E2E_CHROME_CHANNEL ?? 'chrome';
if ([3000, 3001].includes(ENV.apiPort) || [3000, 3001].includes(ENV.webPort)) throw new Error('[qa] 3000/3001 são do dev.');
if (!/maquina_f1a_test/.test(ENV.databaseUrl)) throw new Error('[qa] este recorte roda só no banco maquina_f1a_test.');

export default defineConfig({
  testDir: './specs',
  workers: 1,
  fullyParallel: false,
  timeout: 600_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  globalSetup: './harness/global-setup.ts',
  outputDir: 'test-results/qa-f1a',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 25_000, acceptDownloads: true },
  projects: [
    { name: 'qaf1a-api', testDir: './specs/qa-f1a-api' },
    { name: 'qaf1a-1440', testDir: './specs/qa-f1a', use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 1440, height: 900 } } },
    // viewport via Emulation.setDeviceMetricsOverride (o Playwright faz isso em cada rota), então 390 funciona no headless
    { name: 'qaf1a-390', testDir: './specs/qa-f1a', use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
});
