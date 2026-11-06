// s1.mjs — invoca a função e registra cada chamada em medidas/invocacoes.jsonl: REPORT do CloudWatch (Billed Duration, Max Memory, Init), GB-s e custo.
// Trava: não invoca se o acumulado de Lambda passar de TETO_LAMBDA. Uso interno de rodar-*.mjs.
import { createRequire } from 'node:module';
import { appendFileSync, createWriteStream, existsSync, readFileSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const Lm = require('@aws-sdk/client-lambda'); const S3 = require('@aws-sdk/client-s3'); const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) if (process.env[k]) throw new Error(`${k} no ambiente: use só o perfil default`);
const aqui = path.dirname(fileURLToPath(import.meta.url));
export const RAIZ = path.resolve(aqui, '..');
export const BUCKET = 'remotionlambda-useast1-9dano8maol', PRE = 'legenda-s1/';
const REGION = 'us-east-1'; const LOG = path.join(RAIZ, 'medidas', 'invocacoes.jsonl');
const USD_GBS = 0.0000133334, GB = 3008 / 1024, USD_REQ = 0.0000002, USD_DISCO_GBS = 0.0000000309, DISCO_EXTRA = (2048 - 512) / 1024;
export const TETO_LAMBDA = 0.19;
const lam = new Lm.LambdaClient({ region: REGION, maxAttempts: 1, requestHandler: new NodeHttpHandler({ requestTimeout: 0, connectionTimeout: 10000 }) });
const s3 = new S3.S3Client({ region: REGION, maxAttempts: 8 });
const assinar = { expiresIn: 3600 };
const chave = (k) => (k.startsWith(PRE) ? k : PRE + k);
export const urlGet = (k) => getSignedUrl(s3, new S3.GetObjectCommand({ Bucket: BUCKET, Key: chave(k) }), assinar);
export const urlPut = (k) => getSignedUrl(s3, new S3.PutObjectCommand({ Bucket: BUCKET, Key: chave(k) }), assinar);
export async function subir(arq, k) {
  const cabec = await s3.send(new S3.HeadObjectCommand({ Bucket: BUCKET, Key: chave(k) })).catch(() => null);
  if (cabec && cabec.ContentLength === statSync(arq).size) return;
  await s3.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: chave(k), Body: readFileSync(arq) }));
}
export async function baixar(k, arq) {
  const r = await s3.send(new S3.GetObjectCommand({ Bucket: BUCKET, Key: chave(k) }));
  await pipeline(r.Body, createWriteStream(arq)); return statSync(arq).size;
}
export function gasto() {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd || 0), 0);
}
export async function invocar(rotulo, ev, opts = {}) {
  const acum = gasto(); if (acum >= TETO_LAMBDA) throw new Error(`teto: US$ ${acum.toFixed(4)} acumulado`);
  const prev = opts.max_s ? opts.max_s * GB * USD_GBS : 0; if (acum + prev > TETO_LAMBDA) throw new Error(`teto: projeção ${(acum + prev).toFixed(4)}`);
  const t0 = Date.now();
  const r = await lam.send(new Lm.InvokeCommand({ FunctionName: 'hookmill-legenda-s1', Payload: Buffer.from(JSON.stringify(ev)), LogType: 'Tail' }));
  const relogio = (Date.now() - t0) / 1000;
  const log = Buffer.from(r.LogResult || '', 'base64').toString(); const rep = log.split('\n').find((l) => l.startsWith('REPORT')) || '';
  const num = (re) => { const m = rep.match(re); return m ? Number(m[1]) : null; };
  const billed = num(/Billed Duration: (\d+) ms/), max = num(/Max Memory Used: (\d+) MB/), init = num(/Init Duration: ([\d.]+) ms/), dur = num(/\bDuration: ([\d.]+) ms/);
  const gbs = billed != null ? (billed / 1000) * GB : null; const usd = gbs != null ? gbs * USD_GBS + USD_REQ + (billed / 1000) * DISCO_EXTRA * USD_DISCO_GBS : 0;
  let saida = {}; try { saida = JSON.parse(Buffer.from(r.Payload).toString()); } catch { saida = { bruto: Buffer.from(r.Payload).toString().slice(0, 800) }; }
  const reg = { rotulo, op: ev.op, relogio_s: +relogio.toFixed(2), billed_ms: billed, duracao_ms: dur, init_ms: init, max_mem_MB: max, gbs: gbs && +gbs.toFixed(2), usd: +usd.toFixed(6), erro_funcao: r.FunctionError || null, saida, quando: new Date().toISOString() };
  appendFileSync(LOG, JSON.stringify(reg) + '\n');
  console.log(`${rotulo}: relógio ${reg.relogio_s}s, billed ${billed} ms, mem ${max} MB, US$ ${reg.usd} (acum ${(acum + reg.usd).toFixed(4)})${r.FunctionError ? ' ERRO ' + r.FunctionError : ''}${saida.ok === false ? ' FALHOU exit ' + saida.exit + ' ' + (saida.erro || '').slice(-400) : ''}`);
  return reg;
}
