// Playwright contra a API/web de DEV já no ar (pedido do coordenador 21/10: API :3001 INTEGRACOES_MODE=mock META_MODE=mock,
// web :3000 sem MSW, banco `maquina`). Não sobe servidor, não roda globalSetup, não reseta banco: cada teste cria contas
// novas pelo signup. Dono: maquina-qa.
//   cd testes && npx playwright test -c playwright.dev.config.ts --project=dev-1440 --project=dev-390
import { defineConfig } from '@playwright/test';

const CHROME = process.env.E2E_CHROME_CHANNEL ?? 'chrome';
const WEB = process.env.QA_DEV_WEB ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './specs/dev-meta-onboarding',
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-dev' }]],
  outputDir: 'test-results/dev',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', baseURL: WEB },
  projects: [
    { name: 'dev-1440', use: { browserName: 'chromium', channel: CHROME, viewport: { width: 1440, height: 900 } } },
    // 390: viewport via Emulation.setDeviceMetricsOverride (Playwright), por isso passa do piso de 500 px da janela headless
    { name: 'dev-390', use: { browserName: 'chromium', channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  ],
});
