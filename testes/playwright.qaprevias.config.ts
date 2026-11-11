// QA Q1 07/11 (templates-ia-previas-v1 §13): prévias da IA. API do QA na 3151 e web na 3246 (subidos à parte, ver
// testes/qa-previas-2026-11-07.md), banco maquina_previas_test, tudo mock. Sem globalSetup: nada de TRUNCATE (o banco é
// compartilhado com os int specs desta frente); cada spec cria e apaga os próprios workspaces. Dono: maquina-qa.
import { defineConfig } from '@playwright/test';

const api = process.env.E2E_API_URL ?? 'http://localhost:3151/api/v1';
const web = process.env.E2E_WEB_URL ?? 'http://localhost:3246';
if (/:(3000|3001|3141)\b/.test(api) || /:(3000|3001|3236)\b/.test(web)) throw new Error('[qa] portas do dev/time não são do QA');
const chromium = { browserName: 'chromium' as const, launchOptions: { executablePath: process.env.E2E_CHROMIUM ?? '/usr/bin/chromium', args: ['--disable-dev-shm-usage'] } };

export default defineConfig({
  testDir: './specs',
  workers: 1,
  fullyParallel: false,
  timeout: 900_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: process.env.Q1_PW_OUT ?? '/tmp/qprev/pw-out',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 25_000 },
  projects: [
    { name: 'qaprevias-api', testDir: './specs/qa-previas-api' },
    { name: 'qaprevias-1440', testDir: './specs/qa-previas-ui', use: { ...chromium, baseURL: web, viewport: { width: 1440, height: 900 } } },
    // 390: o Playwright aplica Emulation.setDeviceMetricsOverride em cada página (o headless não desce de 500 px de janela)
    { name: 'qaprevias-390', testDir: './specs/qa-previas-ui', use: { ...chromium, baseURL: web, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  ],
});
