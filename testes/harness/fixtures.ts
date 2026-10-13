// `test` dos specs: reseta o banco de teste ANTES de cada teste (identidades fixas, resto vazio). Dono: maquina-qa.
import { test as base, expect } from '@playwright/test';
import { resetDb } from './db.ts';

export const test = base.extend<{ bancoLimpo: void }>({
  bancoLimpo: [
    async ({}, use) => {
      await resetDb();
      await use();
    },
    { auto: true },
  ],
});
export { expect };
