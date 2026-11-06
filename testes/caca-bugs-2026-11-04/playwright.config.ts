import { defineConfig } from '@playwright/test';
// Only the running isolated API is used. Global setup verifies database and mock mode.
export default defineConfig({
  testDir: '..',
  testMatch: [/specs\/qa-0111-api\/.*\.spec\.ts/, /specs\/isolamento\/.*\.spec\.ts/, /caca-bugs-2026-11-04\/grant-race\.spec\.ts/],
  globalSetup: '../harness/global-setup.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 900000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['json', { outputFile: './round3-playwright.json' }]],
  outputDir: './playwright-results',
});
