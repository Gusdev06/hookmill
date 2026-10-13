#!/usr/bin/env node
// Trava de segurança dos bancos da HookMill. Dono: maquina-arquiteto.
//
// REGRAS (incidente de 07/10: um `prisma migrate diff --shadow-database-url` apontado pro banco dev `maquina`
// apagou todos os dados de teste do Gusta; o Prisma ZERA o banco shadow antes de usar):
//   1. Migração e seed só rodam contra banco LOCAL (localhost/127.0.0.1). Outro banco de propósito: ALLOW_REMOTE_DB=1.
//   2. Shadow database: o ÚNICO aceito é `maquina_shadow` em localhost. Qualquer `--shadow-database-url` (ou
//      SHADOW_DATABASE_URL) igual ao DATABASE_URL/DIRECT_URL, ou apontando pra `maquina`, `maquina_test`, `maquina_b5`
//      ou qualquer outro banco = BLOQUEADO. Sem exceção por variável de ambiente.
//   3. Comando Prisma com shadow só via `npm run db:diff` (URL literal, scripts/db-diff.mjs). Nada de
//      `prisma migrate dev`, `migrate reset` ou `db push` nos bancos locais.
//   4. Antes de migrar o `maquina`: `npm run db:backup`.
//
// Uso: node scripts/guard-db.mjs [args do comando que vai rodar]   (os args são varridos atrás de --shadow-database-url)
// Também exporta checkShadowUrl(url) pro scripts/db-diff.mjs.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SHADOW_DB = 'maquina_shadow';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function readApiEnv() {
  const envFile = join(ROOT, 'api', '.env');
  const fromFile = {};
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return fromFile;
}

function parse(url) {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: u.port || '5432', db: decodeURIComponent(u.pathname.replace(/^\//, '')) };
  } catch {
    return null;
  }
}

/** Devolve null se a URL de shadow é aceitável, ou o motivo do bloqueio. */
export function checkShadowUrl(shadowUrl, mainUrls = []) {
  const s = parse(shadowUrl);
  if (!s) return `shadow URL inválida: ${shadowUrl}`;
  if (!['localhost', '127.0.0.1'].includes(s.host)) return `shadow fora de localhost (${s.host})`;
  for (const m of mainUrls.filter(Boolean)) {
    const p = parse(m);
    if (p && p.host === s.host && p.port === s.port && p.db === s.db) return `shadow igual ao banco principal (${s.db})`;
  }
  if (s.db !== SHADOW_DB) return `shadow aponta pro banco "${s.db}"; o único aceito é "${SHADOW_DB}"`;
  return null;
}

function shadowArgs(argv) {
  const out = [];
  argv.forEach((a, i) => {
    if (a === '--shadow-database-url') out.push(argv[i + 1]);
    else if (a.startsWith('--shadow-database-url=')) out.push(a.slice('--shadow-database-url='.length));
  });
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fromFile = readApiEnv();
  const urls = ['DATABASE_URL', 'DIRECT_URL'].map((k) => [k, process.env[k] ?? fromFile[k]]);
  const remote = urls.filter(([, v]) => v && !/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(v));

  if (urls.every(([, v]) => !v)) {
    console.error('[guard-db] DATABASE_URL não definido (api/.env). Copie api/.env.example.');
    process.exit(1);
  }
  const shadows = shadowArgs(process.argv.slice(2));
  const envShadow = process.env.SHADOW_DATABASE_URL ?? fromFile.SHADOW_DATABASE_URL;
  if (envShadow) shadows.push(envShadow);
  for (const sh of shadows) {
    const why = checkShadowUrl(sh, urls.map(([, v]) => v));
    if (why) {
      console.error(`[guard-db] BLOQUEADO: ${why}. O Prisma APAGA o banco shadow. Use "npm run db:diff".`);
      process.exit(1);
    }
  }
  if (remote.length && process.env.ALLOW_REMOTE_DB !== '1') {
    console.error(`[guard-db] BLOQUEADO: ${remote.map(([k]) => k).join(', ')} não aponta pra localhost (pode ser o Supabase de produção).`);
    console.error('[guard-db] Se é isso mesmo, rode com ALLOW_REMOTE_DB=1 e com o ok do Gusta.');
    process.exit(1);
  }
  console.log('[guard-db] ok: banco local');
}
