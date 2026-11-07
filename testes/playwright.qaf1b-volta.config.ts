// QA F1b, "volta" do PLATE_IMPL: roda com a API em PLATE_IMPL=off SEM globalSetup e SEM reset (lê o lote que o F1B-07 deixou).
// Ordem: fase local (F1B-07) → subir a API com PLATE_IMPL=off → este config → Q1_FASE=off no config principal. Dono: maquina-qa.
import { defineConfig } from '@playwright/test';
import { ENV } from './harness/env.ts';

if (!/maquina_q1_test/.test(ENV.databaseUrl)) throw new Error('[qa] só no banco maquina_q1_test.');
export default defineConfig({
  testDir: './specs/qa-f1b-volta', workers: 1, timeout: 900_000, reporter: [['list']], outputDir: '/tmp/q1/pw-out-volta',
  projects: [{ name: 'qaf1b-volta', testDir: './specs/qa-f1b-volta' }],
});
