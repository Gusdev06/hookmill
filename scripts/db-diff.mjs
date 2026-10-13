#!/usr/bin/env node
// `npm run db:diff`: SQL que falta pras migrações chegarem no schema.prisma (gera o conteúdo de uma migração nova).
// Shadow = URL LITERAL do banco `maquina_shadow` (criado pelo infra:up). Nunca derive essa URL de outra (incidente 07/10).
// Só imprime o SQL; não aplica nada. Dono: maquina-arquiteto.
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkShadowUrl, readApiEnv } from './guard-db.mjs';

const SHADOW_URL = 'postgresql://maquina:maquina@localhost:5433/maquina_shadow?schema=public';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'api');
const env = readApiEnv();
const why = checkShadowUrl(SHADOW_URL, [process.env.DATABASE_URL ?? env.DATABASE_URL, process.env.DIRECT_URL ?? env.DIRECT_URL]);
if (why) {
  console.error(`[db:diff] BLOQUEADO: ${why}`);
  process.exit(1);
}
const r = spawnSync(
  'npx',
  ['prisma', 'migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema.prisma',
    '--shadow-database-url', SHADOW_URL, '--script', ...process.argv.slice(2)],
  { cwd: API, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
