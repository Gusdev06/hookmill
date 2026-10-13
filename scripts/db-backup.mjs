#!/usr/bin/env node
// `npm run db:backup`: cópia só-leitura dos DADOS do banco dev `maquina` em .infra/backups/maquina-<AAAA-MM-DD-HHMM>.sql.gz
// (fora do git), mantendo os 10 mais recentes. `infra:up` chama backupIfStale(12 h). Dono: maquina-arquiteto.
//
// Por que não pg_dump: o Postgres embutido (@embedded-postgres) só traz initdb/pg_ctl/postgres, e a máquina não tem
// pg_dump. O dump é feito pelo `pg` numa transação REPEATABLE READ READ ONLY (foto consistente, sem escrita).
// Formato: SQL só de dados (o schema vem das migrações, cuja lista vai no cabeçalho). Restaurar num banco com o mesmo
// schema e vazio:  gunzip -c <arquivo> | psql "<url>"   (ou rodar o .sql pelo `pg`). FKs desligadas durante a carga
// via session_replication_role = replica.
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BACKUP_DIR = join(ROOT, '.infra', 'backups');
const KEEP = 10;
const CONN = { host: 'localhost', port: 5433, user: 'maquina', password: 'maquina' };

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const ident = (s) => `"${s.replace(/"/g, '""')}"`;
const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
};

function backups(db = 'maquina') {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => new RegExp(`^${db}-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.sql\\.gz$`).test(f))
    .map((f) => ({ f, mtime: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

/** db: banco de origem (padrão maquina; outro só pra teste, ex. `npm run db:backup -- --from maquina_test`). */
export async function backup(db = 'maquina') {
  if (!/^[a-z0-9_]+$/.test(db)) throw new Error(`nome de banco inválido: ${db}`);
  mkdirSync(BACKUP_DIR, { recursive: true });
  const { Client } = require('pg');
  const client = new Client({ ...CONN, database: db });
  await client.connect();
  const file = join(BACKUP_DIR, `${db}-${stamp()}.sql.gz`);
  const tmp = `${file}.partial`;
  const gz = createGzip();
  const out = createWriteStream(tmp);
  gz.pipe(out);
  const write = (s) => new Promise((ok) => (gz.write(s) ? ok() : gz.once('drain', ok)));
  let rows = 0;
  let tables = 0;
  try {
    await client.query('begin transaction isolation level repeatable read read only');
    const hasMigs = (await client.query("select to_regclass('public._prisma_migrations') is not null as ok")).rows[0].ok;
    const migs = hasMigs
      ? (await client.query('select migration_name from _prisma_migrations where finished_at is not null order by 1')).rows.map((x) => x.migration_name)
      : null;
    await write(`-- HookMill: backup de dados do banco "${db}" em ${new Date().toISOString()}\n`);
    await write(`-- Migrações registradas: ${migs ? migs.join(', ') || '(nenhuma)' : '(sem _prisma_migrations)'}\n`);
    await write('begin;\nset session_replication_role = replica;\n');
    const { rows: tbls } = await client.query(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations' order by 1",
    );
    for (const { table_name: t } of tbls) {
      tables++;
      const res = await client.query(`select row_to_json(x)::text as j from ${ident(t)} x`);
      if (!res.rows.length) continue;
      await write(`\n-- ${t}: ${res.rows.length} linhas\n`);
      for (const { j } of res.rows) {
        await write(`insert into ${ident(t)} select * from json_populate_record(null::${ident(t)}, ${lit(j)});\n`);
        rows++;
      }
    }
    const { rows: seqs } = await client.query("select schemaname, sequencename, last_value from pg_sequences where schemaname = 'public' and last_value is not null");
    for (const s of seqs) await write(`select setval(${lit(`${ident(s.schemaname)}.${ident(s.sequencename)}`)}, ${s.last_value});\n`);
    await write('commit;\n');
    await client.query('commit');
  } catch (e) {
    await client.end().catch(() => {});
    gz.destroy();
    rmSync(tmp, { force: true });
    throw e;
  }
  await client.end();
  await new Promise((ok) => {
    out.on('finish', ok);
    gz.end();
  });
  const { renameSync } = await import('node:fs');
  renameSync(tmp, file);
  const all = backups(db);
  for (const old of all.slice(KEEP)) rmSync(join(BACKUP_DIR, old.f), { force: true });
  console.log(`[db:backup] ${file.replace(`${ROOT}/`, '')} · ${tables} tabelas · ${rows} linhas · ${(statSync(file).size / 1024).toFixed(1)} KB · mantidos ${Math.min(all.length, KEEP)}`);
  return file;
}

/** Roda backup se o último tiver mais de `hours` horas (ou não existir). */
export async function backupIfStale(hours = 12) {
  const last = backups()[0];
  if (last && Date.now() - last.mtime < hours * 3600 * 1000) {
    console.log(`[db:backup] último backup tem menos de ${hours} h (${last.f}); pulando`);
    return null;
  }
  return backup();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const i = process.argv.indexOf('--from');
  backup(i > 0 ? process.argv[i + 1] : 'maquina').catch((e) => {
    console.error(`[db:backup] ERRO: ${e?.stack ?? e}`);
    process.exit(1);
  });
}
