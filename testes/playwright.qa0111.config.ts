// QA 01/11 (templates, home v2, shell, Eddy, landing): web em MSW (sem API, sem banco), porta própria. Dono: maquina-qa.
// Subir o web antes (de web/): NEXT_DIST_DIR=.next-qa-3081 NEXT_PUBLIC_API_MOCKING=enabled NEXT_PUBLIC_API_URL=http://localhost:3999/api/v1
//   NEXT_PUBLIC_ONBOARDING_EDDY=on npx next dev --port 3081   ·   rodar (de testes/): npx playwright test -c playwright.qa0111.config.ts
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.QA_WEB_PORT ?? 3081);
if ([3000, 3001].includes(PORT)) throw new Error('[qa] 3000/3001 são do dev (3001 em LIVE).');
const baseURL = `http://localhost:${PORT}`;
const CHROME = process.env.E2E_CHROME_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './specs/qa-0111',
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'test-results/qa-0111',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'qa0111-1440', use: { browserName: 'chromium', channel: CHROME, viewport: { width: 1440, height: 900 } } },
    { name: 'qa0111-390', use: { browserName: 'chromium', channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
});
