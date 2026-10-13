#!/usr/bin/env node
// Infra local da HookMill, sem Docker e sem instalar nada no sistema.
//   Postgres 17 (binários do pacote npm @embedded-postgres, mesma major do Supabase) na porta 5433
//   S3 local = versitygw (gateway S3 open-source, binário baixado pra .infra/bin com sha256 conferido) na porta 9000
// Tudo mora em .infra/ (fora do git). Uso: node scripts/infra.mjs up|down|status|reset
// Dono: maquina-arquiteto.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INFRA = join(ROOT, '.infra');

const PG = {
  dir: join(INFRA, 'pg'),
  socketDir: join(INFRA, 'pg-socket'),
  log: join(INFRA, 'pg.log'),
  port: 5433,
  user: 'maquina',
  password: 'maquina',
  // maquina_shadow: o ÚNICO shadow do Prisma (npm run db:diff); o Prisma zera esse banco a cada uso. Incidente 07/10.
  databases: ['maquina', 'maquina_test', 'maquina_shadow'],
};

const S3 = {
  version: 'v1.8.0',
  bin: join(INFRA, 'bin', 'versitygw'),
  dataDir: join(INFRA, 's3'),
  log: join(INFRA, 's3.log'),
  pidFile: join(INFRA, 's3.pid'),
  port: 9000,
  accessKey: 'maquina',
  secretKey: 'maquina-dev-secret',
  buckets: ['maquina-anuncios', 'maquina-anuncios-test'],
};

// CORS dos buckets (editor-v1 §8): o @remotion/player do web busca a mídia das URLs assinadas com fetch (pré-carga, áudio,
// Range). Origens = WEB_ORIGIN do api/.env (lista por vírgula) + localhost:3000/127.0.0.1:3000. Produção (Supabase): docs/render.md.
function corsOrigins() {
  const origins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
  const envFile = join(ROOT, 'api', '.env');
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(/^\s*WEB_ORIGIN\s*=\s*([^#\n]*)/m);
    for (const o of (m?.[1] ?? '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').replace(/\/$/, ''))) if (o) origins.add(o);
  }
  return [...origins];
}
const S3_CORS_RULES = () => [{
  AllowedOrigins: corsOrigins(),
  AllowedMethods: ['GET', 'HEAD'],
  AllowedHeaders: ['*'],                                   // Range e o que o browser mandar no preflight
  ExposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Type', 'ETag'],
  MaxAgeSeconds: 3600,
}];

const log = (msg) => console.log(`[infra] ${msg}`);
const die = (msg) => {
  console.error(`[infra] ERRO: ${msg}`);
  process.exit(1);
};

// ───────────── Postgres ─────────────

// O pacote da plataforma é ESM e exporta o caminho absoluto de cada binário.
const PG_PKG = `@embedded-postgres/${platform()}-${arch()}`;
let pgPaths;
try {
  pgPaths = await import(PG_PKG);
} catch {
  die(`pacote ${PG_PKG} não instalado. Rode "npm install" na raiz.`);
}
function pgBin(name) {
  const p = pgPaths[name];
  if (!p || !existsSync(p)) die(`binário ${name} não encontrado em ${PG_PKG}`);
  return p;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

function pgRunning() {
  if (!existsSync(join(PG.dir, 'PG_VERSION'))) return false;
  return run(pgBin('pg_ctl'), ['-D', PG.dir, 'status']).ok;
}

async function pgUp() {
  mkdirSync(INFRA, { recursive: true });
  mkdirSync(PG.socketDir, { recursive: true });
  if (!existsSync(join(PG.dir, 'PG_VERSION'))) {
    log('Postgres: criando cluster em .infra/pg');
    const pwfile = join(INFRA, '.pgpass-init');
    writeFileSync(pwfile, PG.password);
    const r = run(pgBin('initdb'), ['-D', PG.dir, '-U', PG.user, `--pwfile=${pwfile}`, '-A', 'scram-sha-256', '-E', 'UTF8', '--no-locale']);
    rmSync(pwfile, { force: true });
    if (!r.ok) die(`initdb falhou:\n${r.out}`);
  }
  if (pgRunning()) {
    log(`Postgres: já rodando na porta ${PG.port}`);
  } else {
    const r = run(pgBin('pg_ctl'), ['-D', PG.dir, '-l', PG.log, '-w', '-t', '30', '-o', `-p ${PG.port} -k ${PG.socketDir} -c listen_addresses=localhost`, 'start']);
    if (!r.ok) die(`pg_ctl start falhou (veja .infra/pg.log):\n${r.out}`);
    log(`Postgres: no ar na porta ${PG.port}`);
  }
  const { Client } = require('pg');
  const client = new Client({ host: 'localhost', port: PG.port, user: PG.user, password: PG.password, database: 'postgres' });
  await client.connect();
  for (const db of PG.databases) {
    const { rowCount } = await client.query('select 1 from pg_database where datname = $1', [db]);
    if (!rowCount) {
      await client.query(`create database ${db}`);
      log(`Postgres: banco "${db}" criado`);
    }
  }
  await client.end();
}

function pgDown() {
  if (!pgRunning()) return log('Postgres: já parado');
  const r = run(pgBin('pg_ctl'), ['-D', PG.dir, '-m', 'fast', '-w', 'stop']);
  if (!r.ok) die(`pg_ctl stop falhou:\n${r.out}`);
  log('Postgres: parado');
}

async function pgStatus() {
  if (!pgRunning()) return log('Postgres: PARADO');
  const { Client } = require('pg');
  const client = new Client({ host: 'localhost', port: PG.port, user: PG.user, password: PG.password, database: 'maquina' });
  await client.connect();
  const { rows } = await client.query('select version() as v, current_database() as db');
  const dbs = await client.query("select datname from pg_database where datname like 'maquina%' order by 1");
  await client.end();
  log(`Postgres: OK porta ${PG.port} · ${rows[0].v.split(' on ')[0]} · bancos: ${dbs.rows.map((r) => r.datname).join(', ')}`);
}

// ───────────── S3 local (versitygw) ─────────────

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) die(`download falhou (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function ensureS3Binary() {
  if (existsSync(S3.bin)) return;
  const os = { darwin: 'Darwin', linux: 'Linux' }[platform()];
  const cpu = { arm64: 'arm64', x64: 'x86_64' }[arch()];
  if (!os || !cpu) die(`plataforma ${platform()}/${arch()} sem binário do versitygw`);
  const file = `versitygw_${S3.version}_${os}_${cpu}.tar.gz`;
  const base = `https://github.com/versity/versitygw/releases/download/${S3.version}`;
  log(`S3: baixando versitygw ${S3.version} (${file})`);
  const [tar, sums] = await Promise.all([download(`${base}/${file}`), download(`${base}/checksums.txt`)]);
  const expected = sums.toString('utf8').split('\n').find((l) => l.trim().endsWith(file))?.split(/\s+/)[0];
  const actual = createHash('sha256').update(tar).digest('hex');
  if (!expected || expected !== actual) die(`sha256 não confere pra ${file} (esperado ${expected}, veio ${actual})`);
  const binDir = dirname(S3.bin);
  mkdirSync(binDir, { recursive: true });
  const tmp = join(binDir, file);
  writeFileSync(tmp, tar);
  const r = run('tar', ['-xzf', tmp, '-C', binDir]);
  rmSync(tmp, { force: true });
  if (!r.ok) die(`tar falhou:\n${r.out}`);
  if (!existsSync(S3.bin)) {
    // alguns releases extraem numa subpasta
    const found = run('find', [binDir, '-type', 'f', '-name', 'versitygw']).out.split('\n')[0];
    if (!found) die('binário versitygw não encontrado depois de extrair');
    run('mv', [found, S3.bin]);
  }
  run('chmod', ['+x', S3.bin]);
  run('xattr', ['-d', 'com.apple.quarantine', S3.bin]); // macOS: binário baixado por script não tem quarentena, mas garante
  log('S3: binário pronto (sha256 conferido)');
}

function s3Pid() {
  if (!existsSync(S3.pidFile)) return null;
  const pid = Number(readFileSync(S3.pidFile, 'utf8'));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function s3Client() {
  const { S3Client } = require('@aws-sdk/client-s3');
  return new S3Client({
    endpoint: `http://localhost:${S3.port}`,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: S3.accessKey, secretAccessKey: S3.secretKey },
  });
}

async function waitS3(ms = 15000) {
  const { ListBucketsCommand } = require('@aws-sdk/client-s3');
  const client = s3Client();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await client.send(new ListBucketsCommand({}));
      return client;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  die('S3 local não respondeu em 15 s (veja .infra/s3.log)');
}

async function s3Up() {
  await ensureS3Binary();
  mkdirSync(S3.dataDir, { recursive: true });
  if (s3Pid()) {
    log(`S3: já rodando na porta ${S3.port}`);
  } else {
    const out = openSync(S3.log, 'a');
    const child = spawn(S3.bin, ['--access', S3.accessKey, '--secret', S3.secretKey, '--port', `:${S3.port}`, 'posix', S3.dataDir], {
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    writeFileSync(S3.pidFile, String(child.pid));
    log(`S3: no ar na porta ${S3.port} (pid ${child.pid})`);
  }
  const client = await waitS3();
  const { CreateBucketCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
  for (const Bucket of S3.buckets) {
    try {
      await client.send(new HeadBucketCommand({ Bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket }));
      log(`S3: bucket "${Bucket}" criado`);
    }
  }
  await s3Cors(client);
}

/** Aplica (idempotente) o CORS em todos os buckets. Roda no `up`; `npm run infra:cors` reaplica sem reiniciar nada. */
async function s3Cors(client) {
  const { PutBucketCorsCommand } = require('@aws-sdk/client-s3');
  const rules = S3_CORS_RULES();
  for (const Bucket of S3.buckets) await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: rules } }));
  log(`S3: CORS (GET/HEAD/Range) pra ${rules[0].AllowedOrigins.join(', ')}`);
}

/** Preflight + GET com Origin, como o browser faz. Devolve 'ok' ou o motivo. */
async function s3CorsCheck(Bucket, Key) {
  const origin = 'http://localhost:3000';
  const url = `http://localhost:${S3.port}/${Bucket}/${Key}`;
  const pre = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' } });
  if (pre.headers.get('access-control-allow-origin') !== origin) return `preflight ${pre.status} sem Allow-Origin`;
  return 'ok';
}

function s3Down() {
  const pid = s3Pid();
  if (!pid) return log('S3: já parado');
  process.kill(pid, 'SIGTERM');
  rmSync(S3.pidFile, { force: true });
  log('S3: parado');
}

async function s3Status() {
  if (!s3Pid()) return log('S3: PARADO');
  const client = await waitS3(3000);
  const { ListBucketsCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const { Buckets = [] } = await client.send(new ListBucketsCommand({}));
  const Bucket = S3.buckets[0];
  const Key = `_healthcheck/${Date.now()}.txt`;
  await client.send(new PutObjectCommand({ Bucket, Key, Body: 'ok', ContentType: 'text/plain' }));
  const got = await (await client.send(new GetObjectCommand({ Bucket, Key }))).Body.transformToString();
  const cors = await s3CorsCheck(Bucket, Key).catch((e) => `erro ${e.message}`);
  await client.send(new DeleteObjectCommand({ Bucket, Key }));
  log(`S3: OK porta ${S3.port} · buckets: ${Buckets.map((b) => b.Name).join(', ')} · put/get/delete: ${got === 'ok' ? 'ok' : 'FALHOU'} · CORS: ${cors}`);
}

// ───────────── comandos ─────────────

const cmd = process.argv[2];
try {
  if (cmd === 'up') {
    await pgUp();
    const { backupIfStale } = await import('./db-backup.mjs');
    await backupIfStale(12); // cópia do banco dev se a última tiver mais de 12 h (.infra/backups, últimas 10)
    await s3Up();
    await pgStatus();
    await s3Status();
  } else if (cmd === 'down') {
    pgDown();
    s3Down();
  } else if (cmd === 'cors') {
    if (!s3Pid()) die('S3 parado: rode infra:up');
    await s3Cors(await waitS3(3000));
    await s3Status();
  } else if (cmd === 'status') {
    await pgStatus();
    await s3Status();
  } else if (cmd === 'reset') {
    pgDown();
    s3Down();
    rmSync(PG.dir, { recursive: true, force: true });
    rmSync(S3.dataDir, { recursive: true, force: true });
    log('dados locais apagados (.infra/pg e .infra/s3). Rode infra:up de novo.');
  } else {
    die('uso: node scripts/infra.mjs up|down|status|reset|cors');
  }
} catch (err) {
  die(err?.stack ?? String(err));
}
