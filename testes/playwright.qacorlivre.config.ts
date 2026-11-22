// QA da legenda movel (22/11 cor livre). Reaproveita API 3111 + web 3210 do harness/servidores.ts (E2E_REUSE=1). Dono: maquina-qa.
import { defineConfig } from '@playwright/test';
import { ENV } from './harness/env.ts';
const CHROME = process.env.E2E_CHROME_CHANNEL ?? 'chrome';
export default defineConfig({
  testDir: './specs/qa-cor-livre',
  workers: 1, fullyParallel: false, timeout: 900_000, expect: { timeout: 20_000 },
  reporter: [['list']],
  globalSetup: './harness/global-setup.ts',
  outputDir: 'test-results/qa-cor-livre',
  use: { actionTimeout: 25_000, acceptDownloads: true },
  projects: [
    { name: 'ed-1440', use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 1440, height: 900 } } },
    { name: 'ed-390', use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
});
