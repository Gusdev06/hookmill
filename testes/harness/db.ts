// Banco dos testes: schema, identidades e reset por teste. Dono: maquina-qa.
// Só fala com `maquina_test` (guardTestDb roda antes de qualquer conexão).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import pg from 'pg';
import { CACHE_DIR, ENV, ROOT_DIR, guardTestDb } from './env.ts';

const require = createRequire(import.meta.url);
const SCHEMA = join(ROOT_DIR, 'api', 'prisma', 'schema.prisma');
const MIGRATIONS = join(ROOT_DIR, 'api', 'prisma', 'migrations');
const SNAPSHOT = join(CACHE_DIR, 'identidades.json');

// timestamp sem fuso (Prisma DateTime) volta como texto cru: sem isso o pg converte pelo fuso local (Bali, UTC+8)
// e o snapshot reinserido sairia deslocado 8 h.
pg.types.setTypeParser(1114, (s: string) => s);

// ───────────── conexão ─────────────
let pool: pg.Pool | null = null;
export function db(): pg.Pool {
  guardTestDb();
  if (!pool) {
    // a URL do Prisma traz ?schema=public, que o pg não entende
    const u = new URL(ENV.databaseUrl);
    u.searchParams.delete('schema');
    pool = new pg.Pool({ connectionString: u.toString(), max: 4 });
  }
  return pool;
}
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
export async function q<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db().query<T>(sql, params)).rows;
}

/** Confirma que estamos mesmo no banco de teste (nome real reportado pelo servidor). */
export async function currentDatabase(): Promise<string> {
  const [{ current_database }] = await q<{ current_database: string }>('select current_database()');
  if (!current_database.endsWith('_test')) throw new Error(`[qa] BLOQUEADO: conectado em "${current_database}"`);
  return current_database;
}

// ───────────── schema ─────────────
export type SchemaMode = 'migrate' | 'push';

/**
 * Aplica o schema no banco de teste SEM comando destrutivo do Prisma:
 * `migrate deploy` se o backend já tem migrações (B1), senão `db push` (sem --force-reset / --accept-data-loss).
 * Se o Prisma pedir pra apagar algo (schema mudou de forma incompatível, ou o banco nasceu do `db push` e agora há
 * migrações → P3005), o setup PARA e pede o reset manual do maquina_test a um humano. O reset por teste é só TRUNCATE.
 */
export function applySchema(): SchemaMode {
  guardTestDb();
  const mode: SchemaMode = existsSync(MIGRATIONS) ? 'migrate' : 'push';
  const prismaCli = require.resolve('prisma/build/index.js');
  const args =
    mode === 'migrate'
      ? ['migrate', 'deploy', '--schema', SCHEMA]
      : ['db', 'push', '--skip-generate', '--schema', SCHEMA];
  const r = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: ROOT_DIR,
    env: { ...process.env, DATABASE_URL: ENV.databaseUrl, DIRECT_URL: ENV.databaseUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    throw new Error(
      `[qa] prisma ${args.slice(0, 2).join(' ')} falhou no maquina_test. Se for P3005 ou perda de dados, o banco de teste ` +
        `precisa ser recriado por um humano (ex.: dropar e recriar maquina_test) antes de rodar de novo.\n${r.stdout}\n${r.stderr}`,
    );
  }
  return mode;
}

export async function businessTables(): Promise<string[]> {
  const rows = await q<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> '_prisma_migrations'
      order by table_name`,
  );
  return rows.map((r) => r.table_name);
}

export async function truncateAll(): Promise<void> {
  const tables = await businessTables();
  if (!tables.length) throw new Error('[qa] banco de teste sem tabelas: rode o globalSetup (applySchema)');
  await q(`truncate table ${tables.map((t) => `"${t}"`).join(', ')} restart identity cascade`);
}

// ───────────── identidades fixas ─────────────
// Dois workspaces: A ("QA Alfa", do seed) e B ("QA Beta"). Todos com a mesma senha (ENV.password).
export const WS = { A: 'qa_ws_alfa', B: 'qa_ws_beta' } as const;
export type Persona = 'donoA' | 'adminA' | 'membroA' | 'donoB' | 'duplo' | 'clienteA';
export const PERSONAS: Record<Persona, { id: string; email: string; name: string; memberships: [keyof typeof WS, 'OWNER' | 'ADMIN' | 'MEMBER' | 'CLIENT'][] }> = {
  donoA: { id: 'qa_user_dono_a', email: ENV.ownerEmail, name: 'QA Dono Alfa', memberships: [['A', 'OWNER']] },
  adminA: { id: 'qa_user_admin_a', email: 'qa-admin-a@teste.local', name: 'QA Admin Alfa', memberships: [['A', 'ADMIN']] },
  membroA: { id: 'qa_user_membro_a', email: 'qa-membro-a@teste.local', name: 'QA Membro Alfa', memberships: [['A', 'MEMBER']] },
  donoB: { id: 'qa_user_dono_b', email: 'qa-dono-b@teste.local', name: 'QA Dono Beta', memberships: [['B', 'OWNER']] },
  // membro dos dois: o workspace ativo vem SÓ do token (wid), nunca do fato de ele ser membro de B
  duplo: { id: 'qa_user_duplo', email: 'qa-duplo@teste.local', name: 'QA Duplo', memberships: [['A', 'MEMBER'], ['B', 'MEMBER']] },
  // fase 2 (fase2-agencia §4) / variacao-auto Q1 (13/10): cliente final da agência; só lê, In zip e zip
  clienteA: { id: 'qa_user_cliente_a', email: 'qa-cliente-a@teste.local', name: 'QA Cliente Alfa', memberships: [['A', 'CLIENT']] },
};

interface Snapshot {
  seedMode: 'api' | 'sintetico';
  createdAt: string;
  workspaces: unknown[];
  users: unknown[];
  memberships: unknown[];
}

function apiHasSeed(): boolean {
  const p = join(ROOT_DIR, 'api', 'package.json');
  if (!existsSync(p)) return false;
  return Boolean(JSON.parse(readFileSync(p, 'utf8')).scripts?.seed);
}

/**
 * Cria as identidades e grava o snapshot que o reset reaplica a cada teste.
 * - Com o seed do backend (B1): roda `npm run seed -w api` contra maquina_test pra ter um hash de senha real,
 *   e reaproveita esse hash nas outras personas (mesma senha, hash com sal embutido verifica igual).
 * - Sem o seed (antes do B1) ou na fumaça (sem API): hash sintético; login impossível, mas o reset funciona.
 */
export async function seedIdentities(opts: { useApiSeed: boolean } = { useApiSeed: true }): Promise<Snapshot> {
  await currentDatabase();
  await truncateAll();
  let seedMode: Snapshot['seedMode'] = 'sintetico';
  let hash = 'qa-hash-sintetico-login-impossivel';

  if (opts.useApiSeed && apiHasSeed()) {
    const r = spawnSync('npm', ['run', 'seed', '-w', 'api'], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        DATABASE_URL: ENV.databaseUrl,
        DIRECT_URL: ENV.databaseUrl,
        SEED_OWNER_EMAIL: ENV.ownerEmail,
        SEED_OWNER_PASSWORD: ENV.password,
        SEED_WORKSPACE_NAME: 'QA Alfa',
      },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`[qa] seed da api falhou:\n${r.stdout}\n${r.stderr}`);
    const rows = await q<{ id: string; password_hash: string }>('select id, password_hash from users where email = $1', [ENV.ownerEmail]);
    if (!rows.length) throw new Error(`[qa] seed rodou mas não criou ${ENV.ownerEmail}`);
    hash = rows[0].password_hash;
    // normaliza ids do seed pros ids fixos do QA (cascata não existe em PK; recria com o hash)
    await truncateAll();
    seedMode = 'api';
  }

  // 13/10: short_code (fase2-agencia, NOT NULL sem default) = prefixo do nome do arquivo (CLIENTE_MMDD_CODIGO)
  await q(`insert into workspaces (id, name, short_code, updated_at) values ($1, 'QA Alfa', 'QA', now()), ($2, 'QA Beta', 'QB', now())`, [WS.A, WS.B]);
  for (const p of Object.values(PERSONAS)) {
    // 29/10 (amostra-gratis-v1): o default do banco virou SAMPLE (conta nova travada); as personas do QA são equipe = INTERNAL
    await q(`insert into users (id, email, password_hash, name, access, updated_at) values ($1, $2, $3, $4, 'INTERNAL', now())`, [p.id, p.email, hash, p.name]);
    for (const [ws, role] of p.memberships) {
      await q(`insert into memberships (id, workspace_id, user_id, role) values ($1, $2, $3, $4)`, [`qa_mb_${p.id}_${ws}`, WS[ws], p.id, role]);
    }
  }

  const snap: Snapshot = {
    seedMode,
    createdAt: new Date().toISOString(),
    workspaces: await q('select * from workspaces order by id'),
    users: await q('select * from users order by id'),
    memberships: await q('select * from memberships order by id'),
  };
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2));
  return snap;
}

export function readSnapshot(): Snapshot {
  if (!existsSync(SNAPSHOT)) throw new Error('[qa] sem snapshot de identidades: o globalSetup não rodou');
  return JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
}

/** Reset por teste: esvazia todas as tabelas e devolve só as identidades fixas (mesmos ids → tokens em cache continuam válidos). */
export async function resetDb(): Promise<void> {
  const snap = readSnapshot();
  await truncateAll();
  for (const t of ['workspaces', 'users', 'memberships'] as const) {
    await q(`insert into "${t}" select * from json_populate_recordset(null::"${t}", $1::json)`, [JSON.stringify(snap[t])]);
  }
}
