#!/usr/bin/env node
// `npm run db:restore -- <arquivo.sql.gz> [--into <banco>] [--yes-i-know]`
// Restaura um backup do `npm run db:backup` (só dados) num banco LOCAL já migrado, numa transação única (falhou = nada muda).
//   --into padrão: maquina_restore_test. O banco alvo precisa estar vazio (tabelas de dados com 0 linhas).
//   --into maquina exige --yes-i-know: faz `db:backup` antes, apaga os dados atuais (TRUNCATE) e carrega o arquivo,
//   tudo na mesma transação. Nunca toca em _prisma_migrations. Dono: maquina-arquiteto.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { backup } from './db-backup.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--into');
const into = opt('--into') ?? 'maquina_restore_test';
const die = (m) => {
  console.error(`[db:restore] ${m}`);
  process.exit(1);
};

if (!file) die('uso: npm run db:restore -- <arquivo.sql.gz> [--into <banco>] [--yes-i-know]');
if (!/^[a-z0-9_]+$/.test(into)) die(`nome de banco inválido: ${into}`);
if (into === 'maquina_shadow') die('maquina_shadow é do db:diff (o Prisma zera esse banco); restaure em outro');
const isDev = into === 'maquina';
if (isDev && !flag('--yes-i-know')) die('restaurar no "maquina" APAGA os dados atuais: exige --into maquina --yes-i-know');

const sql = gunzipSync(readFileSync(resolve(file))).toString('utf8');
if (!sql.startsWith('-- HookMill: backup de dados')) die('arquivo não é um backup do db:backup');
// O arquivo traz begin/commit próprios; a transação aqui é nossa.
const body = sql.replace(/^begin;$/m, '').replace(/^commit;$/m, '');

const { Client } = require('pg');
const client = new Client({ host: 'localhost', port: 5433, user: 'maquina', password: 'maquina', database: into });

try {
  if (isDev) await backup();
  await client.connect();
  const { rows: tbls } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations' order by 1",
  );
  if (!tbls.length) die(`banco "${into}" não tem tabelas: migre antes (DATABASE_URL literal + npm run db:migrate)`);
  const q = (t) => `"${t.replace(/"/g, '""')}"`;
  await client.query('begin');
  if (isDev) {
    await client.query(`truncate ${tbls.map((t) => q(t.table_name)).join(', ')} cascade`);
  } else {
    for (const { table_name: t } of tbls) {
      const { rows } = await client.query(`select exists(select 1 from ${q(t)}) as has`);
      if (rows[0].has) {
        await client.query('rollback');
        die(`banco "${into}" não está vazio (tabela ${t}); restaure num banco recém-migrado`);
      }
    }
  }
  await client.query(body);
  await client.query('commit');
  const n = (sql.match(/^insert into /gm) ?? []).length;
  console.log(`[db:restore] ok: ${n} linhas de ${file} em "${into}"`);
} catch (e) {
  await client.query('rollback').catch(() => {});
  die(`ERRO (nada foi alterado): ${e?.message ?? e}`);
} finally {
  await client.end().catch(() => {});
}
