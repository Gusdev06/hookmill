// Playwright da HookMill. Dono: maquina-qa.
//   npm run fumaca -w testes     → só harness (banco maquina_test + reset), sem API
//   npm run contrato -w testes   → contrato, isolamento e máquina de estados contra a API em mock (porta 3101, banco maquina_test)
//   npm run e2e:navegador -w testes → fluxo inteiro no navegador em 1440 e 390 px (Q3; depende de F3/B2/I1/V2)
//   npm run feature2 -w testes   → feature 2 "variar campeão" (Q5). Pendente até o B4a/B4b: o projeto só existe com
//                                   E2E_F2=1, então `contrato` e `e2e` não mudam. Fixtures: npm run fixtures -w testes
import { defineConfig } from '@playwright/test';
import { ENV, apiTestEnv, webTestEnv } from './harness/env.ts';

// 09/10: o Chromium do Playwright 1.63 (build 1243) não está baixado nesta máquina; o editor usa o Google Chrome instalado
// (channel 'chrome', perfil temporário). E2E_CHROME_CHANNEL='' volta pro Chromium do Playwright (precisa `npx playwright install`).
const CHROME = process.env.E2E_CHROME_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: './specs',
  // banco único com reset por teste: nada de paralelo
  workers: 1,
  fullyParallel: false,
  timeout: ENV.comWeb ? 600_000 : 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './harness/global-setup.ts',
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'fumaca', testDir: './specs/fumaca' },
    { name: 'contrato', testDir: './specs/contrato' },
    { name: 'isolamento', testDir: './specs/isolamento' },
    { name: 'estados', testDir: './specs/estados' },
    ...(process.env.E2E_F2 === '1' ? [{ name: 'feature2', testDir: './specs/feature2', timeout: 180_000 }] : []),
    {
      name: 'fluxo-1440',
      testDir: './specs/fluxo',
      use: { baseURL: ENV.webUrl, browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
    {
      // Playwright aplica a viewport via Emulation.setDeviceMetricsOverride (não pelo tamanho da janela),
      // então 390 funciona no headless mesmo com o piso de 500 px da janela do Chrome.
      name: 'fluxo-390',
      testDir: './specs/fluxo',
      use: { baseURL: ENV.webUrl, browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    // Editor no vídeo v1 (F2d, 09/10): `npm run editor` (API), `npm run editor:navegador` (1440 + 390), `npm run editor:render`
    { name: 'editor', testDir: './specs/editor', timeout: 180_000 },
    {
      name: 'editor-1440',
      testDir: './specs/editor-ui',
      timeout: 300_000,
      use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'editor-390',
      testDir: './specs/editor-ui',
      timeout: 300_000,
      use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    // Variação automática v1 (Q1, 13/10): API (render fake), navegador 1440/390 e o tempo real do lote (E2E_RENDER_REAL=1)
    { name: 'iterate', testDir: './specs/iterate', timeout: 240_000 },
    {
      name: 'iterate-1440',
      testDir: './specs/iterate-ui',
      timeout: 420_000,
      use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'iterate-390',
      testDir: './specs/iterate-ui',
      timeout: 420_000,
      use: { baseURL: ENV.webUrl, browserName: 'chromium', channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    // Estático montado (A) + molduras (B1) — estatico-montado-e-molduras-v1 (25/10). Pendente até as entregas da §C.1:
    // os projetos só existem com E2E_EM=1, então `contrato`/`e2e`/`iterate` não mudam. Cada spec ainda pula sozinho
    // (motivo no relatório) enquanto a API do QA não tiver a entrega (harness/estatico-molduras.ts › entrega()).
    ...(process.env.E2E_EM === '1'
      ? [
          { name: 'estatico', testDir: './specs/estatico', timeout: 300_000 },
          { name: 'molduras', testDir: './specs/molduras', timeout: 300_000 },
          {
            name: 'em-1440',
            testDir: './specs/estatico-molduras-ui',
            timeout: 600_000,
            use: { baseURL: ENV.webUrl, browserName: 'chromium' as const, channel: CHROME, viewport: { width: 1440, height: 900 } },
          },
          {
            name: 'em-390',
            testDir: './specs/estatico-molduras-ui',
            timeout: 600_000,
            use: { baseURL: ENV.webUrl, browserName: 'chromium' as const, channel: CHROME, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
          },
        ]
      : []),
    ...(ENV.renderReal ? [{ name: 'iterate-render', testDir: './specs/iterate-render', timeout: 14_400_000 }] : []),
    ...(ENV.renderReal
      ? [{ name: 'editor-render', testDir: './specs/editor-render', timeout: 900_000, use: { baseURL: ENV.webUrl, browserName: 'chromium' as const, channel: CHROME, viewport: { width: 1440, height: 900 } } }]
      : []),
  ],
  // A API dos testes sobe aqui, com o env de teste (banco maquina_test, bucket de teste, INTEGRACOES_MODE=mock, CORS = web de teste).
  // reuseExistingServer: false → se algo já ocupa a porta, falha em vez de usar um servidor apontando pra outro banco.
  // O web (Next dev na 3210, API de teste, sem MSW) só sobe com E2E_COM_WEB=1 (npm run e2e:navegador).
  // E2E_REUSE=1 (09/10): reaproveita a API/web que o harness/servidores.ts subiu; o globalSetup confere mock + banco de teste.
  webServer: ENV.noApi
    ? undefined
    : [
        {
          command: ENV.apiCmd,
          cwd: '..',
          url: `http://localhost:${ENV.apiPort}/api/v1/health`,
          env: apiTestEnv(),
          reuseExistingServer: process.env.E2E_REUSE === '1',
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        ...(ENV.comWeb
          ? [
              {
                command: `npx next dev --port ${ENV.webPort}`,
                cwd: '../web',
                url: `${ENV.webUrl}/login`,
                env: webTestEnv(),
                reuseExistingServer: process.env.E2E_REUSE === '1',
                timeout: 180_000,
                stdout: 'ignore' as const,
                stderr: 'pipe' as const,
              },
            ]
          : []),
      ],
});
