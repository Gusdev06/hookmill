// QA 03/11 (Q1 do meta-templates-v2): API real em mock (META_MODE=mock, maquina_test, META_CRON=off) com o espião da porta
// Meta (harness/api-qa-espiao.cjs) + web de teste (next dev, sem MSW) ligado nela, 1440 e 390. Dono: maquina-qa.
// Rodar (de testes/):
//   API:       E2E_API_PORT=3161 E2E_SKIP_SCHEMA=1 E2E_EXIGE_MIGRACAO=20261101000100_templates_cold_open_endcard \
//              npx playwright test -c playwright.qa0311.config.ts --project=qa0311-api
//   navegador: o mesmo + E2E_WEB_PORT=3256 E2E_COM_WEB=1 ... --project=qa0311-1440 --project=qa0311-390
// Depois do next dev: restaurar web/tsconfig.json e web/next-env.d.ts (git checkout).
import { defineConfig } from '@playwright/test';
import { ENV, apiTestEnv, webTestEnv } from './harness/env.ts';

const CHROME = process.env.E2E_CHROME_CHANNEL ?? 'chrome';
if ([3000, 3001].includes(ENV.apiPort) || [3000, 3001].includes(ENV.webPort)) throw new Error('[qa] 3000/3001 são do dev.');

export default defineConfig({
  testDir: './specs',
  workers: 1,
  fullyParallel: false,
  timeout: 600_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  globalSetup: './harness/global-setup.ts',
  outputDir: 'test-results/qa-0311',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'qa0311-api', testDir: './specs/qa-0311-api' },
    { name: 'qa0311-1440', testDir: './specs/qa-0311', use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 1440, height: 900 } } },
    // viewport via Emulation.setDeviceMetricsOverride (o Playwright faz isso), então 390 funciona no headless
    { name: 'qa0311-390', testDir: './specs/qa-0311', use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: 'node testes/harness/api-qa-espiao.cjs',
      cwd: '..',
      url: `http://localhost:${ENV.apiPort}/api/v1/health`,
      env: apiTestEnv(),
      reuseExistingServer: process.env.E2E_REUSE === '1',
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    ...(ENV.comWeb
      ? [{
          command: `npx next dev --port ${ENV.webPort}`,
          cwd: '../web',
          url: `${ENV.webUrl}/login`,
          env: { ...webTestEnv(), NEXT_DIST_DIR: '.next-qa-0311' },
          reuseExistingServer: process.env.E2E_REUSE === '1',
          timeout: 240_000,
          stdout: 'ignore' as const,
          stderr: 'pipe' as const,
        }]
      : []),
  ],
});
